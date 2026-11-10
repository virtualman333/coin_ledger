'use strict';
/**
 * 把 data/db.json 迁移到 MySQL（幂等，可重复执行）。
 *
 *   MYSQL_PASSWORD=xxx node tools/migrate-to-mysql.js             # 预演：连库、建表、报告差异
 *   MYSQL_PASSWORD=xxx node tools/migrate-to-mysql.js --write     # 真正写入（库非空需再加 --force）
 *   MYSQL_PASSWORD=xxx node tools/migrate-to-mysql.js --write --force
 *
 * 环境变量与线上一致：MYSQL_HOST / MYSQL_PORT / MYSQL_USER / MYSQL_PASSWORD / MYSQL_DB
 * 数据源可用 --file 指定（默认 data/db.json）。
 *
 * 写完后会把 MySQL 里的数据重新读回来，与源 JSON 逐字段比对，并打印表行数。
 */
const fs = require('fs');
const path = require('path');

const WRITE = process.argv.includes('--write');
const FORCE = process.argv.includes('--force');
const fileArg = process.argv.indexOf('--file');
const SRC_FILE = fileArg > -1
  ? process.argv[fileArg + 1]
  : path.join(__dirname, '..', 'data', 'db.json');

function die(msg) {
  console.error('[migrate] ' + msg);
  process.exit(1);
}

function holdCount(doc) {
  return Object.values(doc.holdings || {}).reduce((n, arr) => n + (Array.isArray(arr) ? arr.length : 0), 0);
}

function summarize(doc) {
  return {
    users: (doc.users || []).length,
    holdings: holdCount(doc),
    prices: Object.keys(doc.prices || {}).length,
    visitDays: Object.keys((doc.visits && doc.visits.days) || {}).length,
    visitsTotal: (doc.visits && doc.visits.total) || 0,
    rev: doc.rev || 0
  };
}

/** 逐字段比对（金额/数量按数值比，时间按 ISO 字符串比） */
function diff(src, back) {
  const issues = [];
  const sUsers = src.users || [];
  const bUsers = back.users || [];
  if (sUsers.length !== bUsers.length) issues.push(`账号数 ${sUsers.length} ≠ ${bUsers.length}`);
  sUsers.forEach((u) => {
    const b = bUsers.find((x) => x.id === u.id);
    if (!b) { issues.push(`账号 ${u.id} 缺失`); return; }
    ['name', 'role', 'salt', 'hash'].forEach((k) => {
      if (String(u[k] || '') !== String(b[k] || '')) issues.push(`账号 ${u.id}.${k} 不一致`);
    });
    if ((u.createdAt || '') !== (b.createdAt || '')) issues.push(`账号 ${u.id}.createdAt ${u.createdAt} ≠ ${b.createdAt}`);
    if ((u.lastLogin || '') !== (b.lastLogin || '')) issues.push(`账号 ${u.id}.lastLogin ${u.lastLogin} ≠ ${b.lastLogin}`);
  });

  Object.keys(src.holdings || {}).forEach((uid) => {
    const a = Array.isArray(src.holdings[uid]) ? src.holdings[uid] : [];
    const b = Array.isArray((back.holdings || {})[uid]) ? back.holdings[uid] : [];
    if (a.length !== b.length) issues.push(`持仓 ${uid} 条数 ${a.length} ≠ ${b.length}`);
    a.forEach((h, i) => {
      const t = b[i] || {};
      if (h.id !== t.id || h.name !== t.name) issues.push(`持仓 ${uid}[${i}] 身份不一致（${h.id}/${h.name}）`);
      if (Number(h.rolls) !== Number(t.rolls)) issues.push(`持仓 ${h.name}.rolls ${h.rolls} ≠ ${t.rolls}`);
      if (Number(h.cost) !== Number(t.cost)) issues.push(`持仓 ${h.name}.cost ${h.cost} ≠ ${t.cost}`);
      if (Number(h.market) !== Number(t.market)) issues.push(`持仓 ${h.name}.market ${h.market} ≠ ${t.market}`);
      if ((h.group || '') !== (t.group || '')) issues.push(`持仓 ${h.name}.group ${h.group} ≠ ${t.group}`);
      if (!!h.sep !== !!t.sep) issues.push(`持仓 ${h.name}.sep 不一致`);
    });
  });

  const sp = src.prices || {};
  const bp = back.prices || {};
  if (Object.keys(sp).length !== Object.keys(bp).length) {
    issues.push(`行情条数 ${Object.keys(sp).length} ≠ ${Object.keys(bp).length}`);
  }
  Object.keys(sp).forEach((k) => {
    if (Number(sp[k]) !== Number(bp[k])) issues.push(`行情 ${k} ${sp[k]} ≠ ${bp[k]}`);
  });

  const sTotal = (src.visits && src.visits.total) || 0;
  const bTotal = (back.visits && back.visits.total) || 0;
  if (Number(sTotal) !== Number(bTotal)) issues.push(`访问总数 ${sTotal} ≠ ${bTotal}`);

  if (Number(src.rev || 0) !== Number(back.rev || 0)) {
    issues.push(`rev ${src.rev} ≠ ${back.rev}`);
  }
  return issues;
}

async function main() {
  if (!fs.existsSync(SRC_FILE)) die(`找不到源文件 ${SRC_FILE}`);
  let src;
  try {
    src = JSON.parse(fs.readFileSync(SRC_FILE, 'utf8'));
  } catch (e) {
    die(`源文件解析失败：${e.message}`);
  }

  const db = require('../server/store-mysql');
  const cfg = db._cfg();
  console.log(`[migrate] 源文件 ${SRC_FILE}`);
  console.log(`[migrate] 目标   mysql://${cfg.user}@${cfg.host}:${cfg.port}/${cfg.database}`);
  console.log('[migrate] 源数据 ' + JSON.stringify(summarize(src)));

  await db.init();                 // 连库 + 建表（幂等）
  const cur = await db.loadDoc();
  const before = summarize(cur);
  console.log('[migrate] 库内现状 ' + JSON.stringify(before));

  if (!WRITE) {
    console.log('\n[migrate] 预演模式：未写入。确认无误后加 --write 执行。');
    if (before.users > 0) console.log('[migrate] 注意：库里已有数据，--write 会以 JSON 为准整体覆盖（需再加 --force）');
    await db.close();
    return;
  }

  if (before.users > 0 && !FORCE) {
    die('库里已有数据；确认要以 JSON 整体覆盖请加 --force');
  }

  await db.save(src);
  const back = await db.loadDoc();
  const issues = diff(src, back);

  const pool = db._pool();
  const tables = ['cl_users', 'cl_holdings', 'cl_prices', 'cl_visits', 'cl_meta'];
  console.log('\n[migrate] 表行数：');
  for (const t of tables) {
    const [[row]] = await pool.query(`SELECT COUNT(*) AS n FROM ${t}`);
    console.log(`  ${t.padEnd(12)} ${row.n}`);
  }

  console.log('[migrate] 回读 ' + JSON.stringify(summarize(back)));
  if (issues.length) {
    console.error('\n[migrate] 回读校验不通过：');
    issues.slice(0, 30).forEach((s) => console.error('  ✗ ' + s));
    if (issues.length > 30) console.error(`  … 另有 ${issues.length - 30} 条`);
    await db.close();
    process.exit(2);
  }
  console.log('\n[migrate] 回读校验通过：' + summarize(back).users + ' 账号 / ' +
    summarize(back).holdings + ' 条持仓 / ' + summarize(back).prices + ' 条行情，与源 JSON 一致');
  await db.close();
}

main().catch((e) => {
  console.error('[migrate] 失败：', e.message);
  process.exit(1);
});
