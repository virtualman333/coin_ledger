'use strict';
/**
 * 配置集中处：环境变量只在这里读一次，其余文件一律 require('./config')。
 *
 * 设计约束（见 arch-db-refactor.md 5.3 / 10）：
 *   - `DATA_SOURCE` 默认必须是 `json`。新代码上线首启不改变任何现状，
 *     切到 `db` 必须是一次**显式**动作，否则「灰度可回滚」不成立。
 *   - 数据库口令等敏感值只从环境变量取，**不打印、不落日志**；
 *     `describe()` 返回的对象刻意不含 password。
 *   - 这里只做读取与默认值，不做 I/O —— 启动自检（连库、建表）在 app.js / plugins/db.js。
 */
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PUBLIC_DIR = path.join(ROOT, 'public');

const VERSION = require('../package.json').version || '1.0.0';

/** 读过就 trim，空串当没设 */
function str(name, def) {
  const v = process.env[name];
  if (v === undefined || v === null || String(v).trim() === '') return def;
  return String(v).trim();
}

function num(name, def) {
  const raw = str(name, '');
  // 注意：Number('') === 0 且 isFinite(0) 为真，必须先判空，
  // 否则 PORT / MYSQL_PORT 没设时会变成 0（曾把 3306 变成 0 的真实坑）。
  if (raw === '') return def;
  const v = Number(raw);
  return Number.isFinite(v) ? v : def;
}

/* ---------------- 进程 / 站点 ---------------- */
const PORT = num('PORT', 3100);
const HOST = str('HOST', '127.0.0.1');
const NODE_ENV = str('NODE_ENV', 'development');
const START_AT = Date.now();

const SITE = str('SITE', 'https://coin.virtualman.top');

/* ---------------- 目录、数据文件 ---------------- */
const DATA_DIR = str('COIN_DATA_DIR', path.join(ROOT, 'data'));
const SEED_FILE = str('SEED_FILE', path.join(PUBLIC_DIR, 'data', 'coins.json'));
const PLAN_FILE = str('PLAN_FILE', path.join(PUBLIC_DIR, 'data', 'plan.json'));
const GALLERY_FILE = path.join(PUBLIC_DIR, 'data', 'gallery.json');
const DESCRIPTIONS_FILE = path.join(PUBLIC_DIR, 'data', 'descriptions.json');
const SERIES_FILE = path.join(PUBLIC_DIR, 'data', 'series.json');
const IMAGES_FILE = path.join(PUBLIC_DIR, 'data', 'images.json');
const EXPORT_DIR = str('EXPORT_DIR', path.join(ROOT, 'data', 'exports'));
const SEED_SQL_DIR = path.join(__dirname, 'migrations');
/** 贵金属种子（T04 的 3 套真实数据）：json 模式的只读来源，也是导入脚本的输入 */
const PM_SEED_FILE = str('PM_SEED_FILE', path.join(ROOT, 'data', 'seeds', 'precious-metal-2026.json'));

/* ---------------- 存储与目录数据源 ---------------- */
const STORAGE = str('STORAGE', 'json').toLowerCase() === 'mysql' ? 'mysql' : 'json';

/** 只有 db / json 两个合法值；写错时回落 json 并留一条警告（绝不静默切到 db） */
function normalizeDataSource(raw) {
  const v = String(raw === undefined || raw === null ? '' : raw).trim().toLowerCase();
  if (!v) return 'json';
  if (v === 'db' || v === 'json') return v;
  return 'json';
}

const rawDataSource = str('DATA_SOURCE', 'json').toLowerCase();
const DATA_SOURCE = normalizeDataSource(rawDataSource);

/* ---------------- 管理 ---------------- */
const SUPERADMIN_NAME = str('SUPERADMIN_NAME', 'virtualman');
const WX_APPID = str('WX_APPID', 'wx905c4968911fa23d');

/* ---------------- MySQL ---------------- */
const DB = {
  host: str('MYSQL_HOST', '127.0.0.1'),
  port: num('MYSQL_PORT', 3306),
  user: str('MYSQL_USER', 'coin_ledger'),
  password: str('MYSQL_PASSWORD', ''),
  database: str('MYSQL_DB', 'coin_ledger'),
  poolSize: num('MYSQL_POOL', 5)
};

/**
 * mysql2/promise 连接池参数。
 * `decimalNumbers: true` 与 store-mysql.js 同款：DECIMAL 直接给 number，
 * 否则 `face: "0.10"` 这类字符串会混进投影，导出的 JSON 立刻漂移。
 */
function mysqlOptions(overrides) {
  return Object.assign({
    host: DB.host,
    port: DB.port,
    user: DB.user,
    password: DB.password,
    database: DB.database,
    charset: 'utf8mb4',
    timezone: 'Z',
    decimalNumbers: true,
    // DATE 列（source_date / published_on / issue_date）一律给 'YYYY-MM-DD' 字符串：
    // 投影与导出直接用它，不经过 Date 对象，就不可能因为时区差一天。
    // DATETIME(3) 仍是 Date（内部时间戳，不对外输出）。
    dateStrings: ['DATE'],
    supportBigNumbers: true,
    waitForConnections: true,
    connectionLimit: DB.poolSize,
    queueLimit: 0,
    connectTimeout: 10000,
    // 迁移文件的触发器体里有分号，全靠 runner 按 `-- @@` 切块；
    // 驱动侧一律关掉多语句，避免被二次拆断（见 003_guards.sql 注释）。
    multipleStatements: false
  }, overrides || {});
}

/** 不含口令的安全描述，日志与 /api/health 可用 */
function describe() {
  return {
    dataSource: DATA_SOURCE,
    storage: STORAGE,
    port: PORT,
    host: HOST,
    nodeEnv: NODE_ENV,
    site: SITE,
    mysql: {
      host: DB.host,
      port: DB.port,
      database: DB.database,
      user: DB.user,
      hasPassword: !!DB.password
    }
  };
}

/**
 * 启动自检：只做「取值合法性」判断，不连库。
 * 返回 { ok, errors[], warnings[] }，由 index.js 决定是退出还是仅告警。
 */
function selfCheck() {
  const errors = [];
  const warnings = [];

  if (rawDataSource && DATA_SOURCE !== rawDataSource) {
    warnings.push('DATA_SOURCE=' + rawDataSource + ' 不是合法值（只认 db / json），已回落 json');
  }
  if (DATA_SOURCE === 'db' && !DB.password) {
    warnings.push('DATA_SOURCE=db 但未设置 MYSQL_PASSWORD —— 若本机 MySQL 需要口令将连接失败');
  }
  if (!Number.isInteger(PORT) || PORT <= 0 || PORT > 65535) {
    errors.push('PORT 不合法：' + PORT);
  }
  if (!VERSION) warnings.push('读不到 package.json 的 version');

  return { ok: errors.length === 0, errors: errors, warnings: warnings };
}

module.exports = {
  ROOT: ROOT,
  VERSION: VERSION,

  PORT: PORT,
  HOST: HOST,
  NODE_ENV: NODE_ENV,
  START_AT: START_AT,
  SITE: SITE,

  PUBLIC_DIR: PUBLIC_DIR,
  DATA_DIR: DATA_DIR,
  SEED_FILE: SEED_FILE,
  PLAN_FILE: PLAN_FILE,
  GALLERY_FILE: GALLERY_FILE,
  DESCRIPTIONS_FILE: DESCRIPTIONS_FILE,
  SERIES_FILE: SERIES_FILE,
  IMAGES_FILE: IMAGES_FILE,
  EXPORT_DIR: EXPORT_DIR,
  MIGRATIONS_DIR: SEED_SQL_DIR,
  PM_SEED_FILE: PM_SEED_FILE,

  STORAGE: STORAGE,
  DATA_SOURCE: DATA_SOURCE,
  isDbDataSource: DATA_SOURCE === 'db',

  SUPERADMIN_NAME: SUPERADMIN_NAME,
  WX_APPID: WX_APPID,

  DB: DB,
  mysqlOptions: mysqlOptions,
  describe: describe,
  selfCheck: selfCheck
};
