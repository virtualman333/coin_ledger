'use strict';
/**
 * MySQL 后端（STORAGE=mysql）。
 *
 * 文档结构保持不变（和 store-json.js 完全一致），但在库里落成关系表：
 *
 *   cl_users     一个账号一行（口令盐/散列原样存，字段名与文档一一对应）
 *   cl_holdings  一条持仓一行，主键 (uid, id)，外键级联删除
 *   cl_prices    行情覆盖，一个品种一行（没有覆盖的品种就不占行）
 *   cl_visits    按天的匿名访问计数（不存 IP）
 *   cl_meta      版本 / rev / 创建时间 / 访问总数等单值
 *
 * 上层仍然用「读整份文档 → mutator 改 → 落库」的模型：数据量极小
 * （1 个账号、十几条持仓），整份同步比维护十几条增量 SQL 更不容易错。
 * 每次落库都在一个事务里，失败整体回滚，内存镜像不会被污染。
 */
const mysql = require('mysql2/promise');

let pool = null;

function cfg() {
  return {
    host: process.env.MYSQL_HOST || '127.0.0.1',
    port: Number(process.env.MYSQL_PORT || 3306),
    user: process.env.MYSQL_USER || 'coin_ledger',
    password: process.env.MYSQL_PASSWORD || '',
    database: process.env.MYSQL_DB || 'coin_ledger',
    charset: 'utf8mb4',
    timezone: 'Z',              // 统一按 UTC 存取，和文档里的 ISO 字符串对齐
    decimalNumbers: true,       // DECIMAL 直接给 number，避免字符串混进业务计算
    supportBigNumbers: true,
    waitForConnections: true,
    connectionLimit: Number(process.env.MYSQL_POOL || 5),
    queueLimit: 0,
    connectTimeout: 10000
  };
}

const DDL = [
  `CREATE TABLE IF NOT EXISTS cl_meta (
     k VARCHAR(32) NOT NULL,
     v TEXT NOT NULL,
     PRIMARY KEY (k)
   ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='单值元信息：版本/rev/时间戳'`,

  `CREATE TABLE IF NOT EXISTS cl_users (
     id VARCHAR(16) NOT NULL,
     name VARCHAR(32) NOT NULL,
     role VARCHAR(16) NOT NULL DEFAULT 'user',
     salt CHAR(32) NOT NULL,
     hash CHAR(128) NOT NULL,
     created_at DATETIME(3) NOT NULL,
     last_login DATETIME(3) NULL,
     wx_openid VARCHAR(64) NULL COMMENT '微信 openid，微信登录用',
     wx_unionid VARCHAR(64) NULL,
     is_test TINYINT(1) NOT NULL DEFAULT 0 COMMENT '测试账号：允许被删除',
     nickname VARCHAR(32) NULL COMMENT '显示昵称（可重复，与登录名无关）',
     avatar VARCHAR(64) NULL COMMENT '头像文件名，存 public/avatar/',
     PRIMARY KEY (id),
     UNIQUE KEY uk_name (name),
     KEY idx_wx (wx_openid)
   ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='账号'`,

  `CREATE TABLE IF NOT EXISTS cl_holdings (
     uid VARCHAR(16) NOT NULL,
     ord INT NOT NULL,
     id VARCHAR(32) NOT NULL,
     name VARCHAR(64) NOT NULL,
     rolls INT NOT NULL DEFAULT 0,
     cost DECIMAL(12,2) NOT NULL DEFAULT 0,
     market DECIMAL(12,2) NOT NULL DEFAULT 0,
     grp VARCHAR(32) NOT NULL DEFAULT '独立藏品',
     sep TINYINT(1) NOT NULL DEFAULT 0,
     PRIMARY KEY (uid, ord),
     KEY idx_name (name),
     CONSTRAINT fk_holdings_user FOREIGN KEY (uid) REFERENCES cl_users (id) ON DELETE CASCADE
   ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='持仓（按账号隔离，ord 保持前端顺序）'`,

  `CREATE TABLE IF NOT EXISTS cl_prices (
     coin_i INT NOT NULL,
     est DECIMAL(12,2) NOT NULL,
     updated_at DATETIME(3) NOT NULL,
     PRIMARY KEY (coin_i)
   ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='行情覆盖（全局）'`,

  `CREATE TABLE IF NOT EXISTS cl_visits (
     day CHAR(10) NOT NULL,
     hits INT NOT NULL DEFAULT 0,
     PRIMARY KEY (day)
   ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='按天匿名访问计数'`
];

function nowISO() { return new Date().toISOString(); }

function toDate(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

function iso(v) {
  if (!v) return null;
  if (v instanceof Date) return v.toISOString();
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function placeholders(n) {
  return new Array(n).fill('?').join(',');
}

/* ---------------------------------------------------------
   连接与建表
   --------------------------------------------------------- */
async function ensureSchema() {
  for (const sql of DDL) await pool.query(sql);
  // 老库升级：v3.0.x 之前的 cl_users 没有微信字段，缺了就补上
  await ensureColumn('cl_users', 'wx_openid', 'VARCHAR(64) NULL');
  await ensureColumn('cl_users', 'wx_unionid', 'VARCHAR(64) NULL');
  await ensureColumn('cl_users', 'is_test', 'TINYINT(1) NOT NULL DEFAULT 0');
  await ensureColumn('cl_users', 'nickname', 'VARCHAR(32) NULL');
  await ensureColumn('cl_users', 'avatar', 'VARCHAR(64) NULL');
  const [idx] = await pool.query(
    "SELECT COUNT(*) AS n FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'cl_users' AND index_name = 'idx_wx'"
  );
  if (!idx[0].n) {
    try { await pool.query('ALTER TABLE cl_users ADD KEY idx_wx (wx_openid)'); } catch (e) { /* 已有索引 */ }
  }
}

/** 列不存在才加（MySQL 8 的 ADD COLUMN 不支持 IF NOT EXISTS） */
async function ensureColumn(table, column, def) {
  const [rows] = await pool.query(
    'SELECT COUNT(*) AS n FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ?',
    [table, column]
  );
  if (!rows[0].n) {
    await pool.query('ALTER TABLE ' + table + ' ADD COLUMN ' + column + ' ' + def);
    console.log('[store] 升级表结构：' + table + '.' + column);
  }
}

/** 读整份文档 */
async function loadDoc() {
  const [metaRows] = await pool.query('SELECT k, v FROM cl_meta');
  const meta = {};
  metaRows.forEach((r) => { meta[r.k] = r.v; });

  const [userRows] = await pool.query(
    'SELECT id, name, role, salt, hash, created_at, last_login, wx_openid, wx_unionid, is_test, nickname, avatar FROM cl_users ORDER BY created_at, id'
  );
  const [holdRows] = await pool.query(
    'SELECT uid, ord, id, name, rolls, cost, market, grp, sep, category FROM cl_holdings ORDER BY uid, ord'
  );
  const [priceRows] = await pool.query('SELECT coin_i, est FROM cl_prices ORDER BY coin_i');
  const [visitRows] = await pool.query('SELECT day, hits FROM cl_visits ORDER BY day');

  const holdings = {};
  holdRows.forEach((r) => {
    if (!holdings[r.uid]) holdings[r.uid] = [];
    holdings[r.uid].push({
      id: r.id,
      name: r.name,
      rolls: Number(r.rolls) || 0,
      cost: Number(r.cost) || 0,
      market: Number(r.market) || 0,
      group: r.grp || '独立藏品',
      sep: !!r.sep,
      category: r.category || 'coin'
    });
  });

  const prices = {};
  priceRows.forEach((r) => { prices[String(r.coin_i)] = Number(r.est) || 0; });

  const days = {};
  visitRows.forEach((r) => { days[String(r.day).slice(0, 10)] = Number(r.hits) || 0; });

  return {
    version: Number(meta.version || 2),
    createdAt: meta.created_at || nowISO(),
    updatedAt: meta.updated_at || nowISO(),
    users: userRows.map((r) => ({
      id: r.id,
      name: r.name,
      role: r.role,
      salt: r.salt,
      hash: r.hash,
      createdAt: iso(r.created_at),
      lastLogin: iso(r.last_login),
      wxOpenid: r.wx_openid || '',
      wxUnionid: r.wx_unionid || '',
      isTest: !!r.is_test,
      nickname: r.nickname || '',
      avatar: r.avatar || ''
    })),
    holdings,
    prices,
    visits: { total: Number(meta.visits_total || 0), days },
    rev: Number(meta.rev || 0)
  };
}

/* ---------------------------------------------------------
   整份同步（事务）
   --------------------------------------------------------- */
async function syncMeta(conn, doc) {
  const pairs = {
    version: String(doc.version || 2),
    rev: String(doc.rev || 0),
    created_at: doc.createdAt || nowISO(),
    updated_at: doc.updatedAt || nowISO(),
    visits_total: String((doc.visits && doc.visits.total) || 0)
  };
  for (const [k, v] of Object.entries(pairs)) {
    await conn.query(
      'INSERT INTO cl_meta (k, v) VALUES (?, ?) ON DUPLICATE KEY UPDATE v = VALUES(v)',
      [k, v]
    );
  }
}

async function syncUsers(conn, doc) {
  const users = Array.isArray(doc.users) ? doc.users : [];
  const ids = users.map((u) => u.id);
  if (ids.length) {
    await conn.query(`DELETE FROM cl_users WHERE id NOT IN (${placeholders(ids.length)})`, ids);
  } else {
    await conn.query('DELETE FROM cl_users');
  }
  for (const u of users) {
    await conn.query(
      `INSERT INTO cl_users (id, name, role, salt, hash, created_at, last_login, wx_openid, wx_unionid, is_test, nickname, avatar)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE name = VALUES(name), role = VALUES(role), salt = VALUES(salt),
         hash = VALUES(hash), created_at = VALUES(created_at), last_login = VALUES(last_login),
         wx_openid = VALUES(wx_openid), wx_unionid = VALUES(wx_unionid), is_test = VALUES(is_test),
         nickname = VALUES(nickname), avatar = VALUES(avatar)`,
      [u.id, u.name, u.role || 'user', u.salt, u.hash, toDate(u.createdAt) || new Date(), toDate(u.lastLogin),
        u.wxOpenid || null, u.wxUnionid || null, u.isTest ? 1 : 0, u.nickname || null, u.avatar || null]
    );
  }
}

/**
 * 持仓同步：整用户重写。
 * 线上历史数据里存在 id 重复的持仓（前端不同路径生成的 h13 撞车），
 * 所以不能拿业务 id 当主键，改成 (uid, ord) —— ord 是数组下标，天然唯一，
 * 顺带把前端展示顺序原样保下来。数据量很小，删了重插比逐条 diff 更不容易错。
 */
async function syncHoldings(conn, doc) {
  const map = (doc.holdings && typeof doc.holdings === 'object') ? doc.holdings : {};
  const uids = Object.keys(map);
  if (uids.length) {
    await conn.query(`DELETE FROM cl_holdings WHERE uid NOT IN (${placeholders(uids.length)})`, uids);
  } else {
    await conn.query('DELETE FROM cl_holdings');
  }

  for (const uid of uids) {
    const list = Array.isArray(map[uid]) ? map[uid] : [];
    await conn.query('DELETE FROM cl_holdings WHERE uid = ?', [uid]);
    if (!list.length) continue;
    const rows = list.map((h, i) => [
      uid, i, String(h.id || 'h' + (i + 1)), String(h.name),
      Math.round(Number(h.rolls) || 0),
      Number(h.cost) || 0, Number(h.market) || 0,
      String(h.group || '独立藏品').slice(0, 32), h.sep ? 1 : 0,
      ['coin','note','pm'].indexOf(h.category) >= 0 ? h.category : 'coin'
    ]);
    await conn.query(
      'INSERT INTO cl_holdings (uid, ord, id, name, rolls, cost, market, grp, sep, category) VALUES ?',
      [rows]
    );
  }
}

async function syncPrices(conn, doc) {
  const src = (doc.prices && typeof doc.prices === 'object') ? doc.prices : {};
  const keys = Object.keys(src).map(Number).filter((n) => Number.isInteger(n) && n >= 0);
  if (keys.length) {
    await conn.query(`DELETE FROM cl_prices WHERE coin_i NOT IN (${placeholders(keys.length)})`, keys);
  } else {
    await conn.query('DELETE FROM cl_prices');
  }
  const at = toDate(doc.updatedAt) || new Date();
  for (const k of keys) {
    await conn.query(
      `INSERT INTO cl_prices (coin_i, est, updated_at) VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE est = VALUES(est), updated_at = VALUES(updated_at)`,
      [k, Number(src[String(k)]) || 0, at]
    );
  }
}

async function syncVisits(conn, doc) {
  const days = (doc.visits && doc.visits.days) ? doc.visits.days : {};
  for (const [day, hits] of Object.entries(days)) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) continue;   // 防御：脏 key 不进库
    await conn.query(
      'INSERT INTO cl_visits (day, hits) VALUES (?, ?) ON DUPLICATE KEY UPDATE hits = VALUES(hits)',
      [day, Math.max(0, Math.round(Number(hits) || 0))]
    );
  }
}

async function save(doc, prev) {
  // 只有真变了的表才写：访问计数（/api/visit）不该顺带重写十几行持仓
  const changed = (k) => !prev || JSON.stringify(prev[k]) !== JSON.stringify(doc[k]);
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await syncMeta(conn, doc);                       // rev / updatedAt 每次都会变，必写
    if (changed('users')) await syncUsers(conn, doc); // 先同步账号：持仓有外键依赖
    if (changed('holdings')) await syncHoldings(conn, doc);
    if (changed('prices')) await syncPrices(conn, doc);
    if (changed('visits')) await syncVisits(conn, doc);
    await conn.commit();
  } catch (e) {
    try { await conn.rollback(); } catch (_) { /* ignore */ }
    throw e;
  } finally {
    conn.release();
  }
}

/* ---------------------------------------------------------
   生命周期
   --------------------------------------------------------- */
let lastError = null;

async function init() {
  pool = mysql.createPool(cfg());
  try {
    await pool.query('SELECT 1');
    await ensureSchema();
    lastError = null;
  } catch (e) {
    lastError = e.message;
    throw new Error(`MySQL 初始化失败（${cfg().host}:${cfg().port}/${cfg().database}）：${e.message}`);
  }
  return loadDoc();
}

async function flush() { /* 每次 commit 已落库，无需额外刷盘 */ }

async function close() {
  if (pool) { try { await pool.end(); } catch (_) { /* ignore */ } pool = null; }
}

function info() {
  const c = cfg();
  return {
    mode: 'mysql',
    host: c.host,
    port: c.port,
    database: c.database,
    user: c.user,
    error: lastError || undefined
  };
}

module.exports = {
  init, loadDoc, save, flush, close, info, ensureSchema,
  // 迁移脚本复用
  _pool: () => pool,
  _cfg: cfg,
  _DDL: DDL
};
