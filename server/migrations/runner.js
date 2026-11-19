'use strict';
/**
 * 迁移执行器。
 *
 * 三条硬性要求（arch 3.1 / 5.1）：
 *   1. **顺序执行**：按文件名数字前缀排序，已应用的版本（cl_schema_migrations）跳过；
 *   2. **checksum 校验**：已应用版本的文件内容被改过 → 直接报错停下，
 *      不允许「悄悄改历史迁移」这种事发生（否则各环境库结构会分叉）；
 *   3. **不用 multipleStatements**：触发器体里有分号，靠 `-- @@` 分块 +
 *      每块整段发送，这样 001/002/004 的普通 DDL 与 003 的 BEGIN…END 共用一套逻辑。
 *
 * 只在 `--apply` 时连库；`--dry-run` 也能把块数与语句数算出来（迁移脚本的默认行为）。
 */
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const config = require('../config');

/** 块分隔符：整行（允许前后空白）为 `-- @@` */
const BLOCK_SEPARATOR = /^\s*--\s*@@\s*$/;

/** 迁移记录表（002 里也建了一次，IF NOT EXISTS 幂等；runner 先执行以保证自举） */
const REGISTRY_DDL = `CREATE TABLE IF NOT EXISTS cl_schema_migrations (
  version    VARCHAR(32) NOT NULL,
  checksum   CHAR(64)    NOT NULL,
  applied_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (version)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='已应用的迁移版本与文件校验和'`;

/**
 * 归一化 SQL 文本：统一换行、去行尾空白、去首尾空行。
 * checksum 基于归一化结果，避免 CRLF / 编辑器补空行导致误判「文件被改过」。
 *
 * @param {string} sql 原始文件内容
 * @returns {string} 归一化文本
 */
function normalizeSql(sql) {
  return String(sql)
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+$/gm, '')
    .trim() + '\n';
}

/**
 * 计算文件校验和。
 *
 * @param {string} sql 原始文件内容
 * @returns {string} sha256（hex）
 */
function checksumOf(sql) {
  return crypto.createHash('sha256').update(normalizeSql(sql)).digest('hex');
}

/**
 * 按 `-- @@` 切块。
 *
 * @param {string} sql 迁移文件内容
 * @returns {string[]} 语句块（已去空块）
 */
function splitBlocks(sql) {
  const lines = normalizeSql(sql).split('\n');
  const blocks = [[]];
  lines.forEach((line) => {
    if (BLOCK_SEPARATOR.test(line)) {
      blocks.push([]);
      return;
    }
    blocks[blocks.length - 1].push(line);
  });
  return blocks
    .map((b) => b.join('\n').trim())
    .filter((b) => b && b.replace(/^\s*--.*$/gm, '').trim().length > 0);
}

/**
 * 列出迁移文件（按版本号排序）。
 *
 * @param {string} [dir] 迁移目录，默认 server/migrations
 * @returns {Array<{version:string,file:string,sql:string,checksum:string,blocks:string[]}>} 迁移列表
 */
function listMigrations(dir) {
  const base = dir || config.MIGRATIONS_DIR;
  let files = [];
  try {
    files = fs.readdirSync(base).filter((f) => /^\d+.*\.sql$/.test(f));
  } catch (e) {
    throw new Error('读不到迁移目录：' + base + '（' + e.message + '）');
  }
  return files.sort().map((f) => {
    const file = path.join(base, f);
    const sql = fs.readFileSync(file, 'utf8');
    return {
      version: f.replace(/\.sql$/, ''),
      file: file,
      sql: sql,
      checksum: checksumOf(sql),
      blocks: splitBlocks(sql)
    };
  });
}

/**
 * 确保迁移记录表存在。
 *
 * @param {import('mysql2/promise').PoolConnection|import('mysql2/promise').Pool} conn 连接或池
 * @returns {Promise<void>} 完成
 */
async function ensureRegistry(conn) {
  await conn.query(REGISTRY_DDL);
}

/**
 * 读出已应用版本。
 *
 * @param {object} conn 连接或池
 * @returns {Promise<Map<string,string>>} version → checksum
 */
async function appliedMap(conn) {
  const [rows] = await conn.query('SELECT version, checksum FROM cl_schema_migrations');
  const map = new Map();
  rows.forEach((r) => map.set(String(r.version), String(r.checksum)));
  return map;
}

/**
 * 执行（或演练）全部迁移。
 *
 * @param {object} conn 连接或池；dryRun 时可为 null
 * @param {{dryRun?: boolean, dir?: string, log?: Function}} [opts] 选项
 * @returns {Promise<{applied: string[], skipped: string[], blocks: number, plan: Array}>} 结果摘要
 */
async function apply(conn, opts) {
  const options = opts || {};
  const dryRun = !!options.dryRun;
  const log = typeof options.log === 'function' ? options.log : function () {};
  const migrations = listMigrations(options.dir);

  if (dryRun) {
    const plan = migrations.map((m) => ({ version: m.version, checksum: m.checksum, blocks: m.blocks.length }));
    const blocks = plan.reduce((a, p) => a + p.blocks, 0);
    return { applied: plan.map((p) => p.version), skipped: [], blocks: blocks, plan: plan };
  }

  await ensureRegistry(conn);
  const done = await appliedMap(conn);
  const applied = [];
  const skipped = [];
  let blockCount = 0;

  for (const m of migrations) {
    if (done.has(m.version)) {
      if (done.get(m.version) !== m.checksum) {
        throw new Error(
          '迁移 ' + m.version + ' 的 checksum 与库内记录不一致：'
          + '已应用 ' + done.get(m.version).slice(0, 12) + '… / 当前文件 ' + m.checksum.slice(0, 12) + '…。'
          + '历史迁移不允许修改；如需变更请新增一个迁移文件。'
        );
      }
      skipped.push(m.version);
      continue;
    }
    for (const block of m.blocks) {
      // 整段发送：003 的 BEGIN…END 内部有分号，交给服务端作为一个语句解析
      await conn.query(block);
      blockCount += 1;
    }
    await conn.query(
      'INSERT INTO cl_schema_migrations (version, checksum) VALUES (?, ?) ON DUPLICATE KEY UPDATE checksum = VALUES(checksum)',
      [m.version, m.checksum]
    );
    applied.push(m.version);
    log('[migrate] 已应用 ' + m.version + '（' + m.blocks.length + ' 块）');
  }

  return { applied: applied, skipped: skipped, blocks: blockCount, plan: [] };
}

/**
 * 库能力探测（R3）：版本、JSON 列、触发器支持。
 *
 * @param {object} conn 连接或池
 * @returns {Promise<{version: string, json: boolean}>} 探测结果
 */
async function probe(conn) {
  const [vrows] = await conn.query('SELECT VERSION() AS v');
  const version = vrows && vrows[0] ? String(vrows[0].v) : '';
  let json = false;
  try {
    const [jr] = await conn.query("SELECT JSON_VALID('[]') AS ok");
    json = !!(jr && Number(jr[0].ok) === 1);
  } catch (e) {
    json = false;
  }
  return { version: version, json: json };
}

module.exports = {
  BLOCK_SEPARATOR: BLOCK_SEPARATOR,
  REGISTRY_DDL: REGISTRY_DDL,
  normalizeSql: normalizeSql,
  checksumOf: checksumOf,
  splitBlocks: splitBlocks,
  listMigrations: listMigrations,
  ensureRegistry: ensureRegistry,
  appliedMap: appliedMap,
  apply: apply,
  probe: probe
};
