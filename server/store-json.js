'use strict';
/**
 * JSON 文档后端（v3 之前的默认实现，现在作为 MySQL 的回退方案）。
 *
 * 单个 JSON 文档 + 原子写入。文档结构：
 * {
 *   version: 2,
 *   rev, createdAt, updatedAt,
 *   users:    [{ id, name, role, salt, hash, createdAt, lastLogin }],
 *   holdings: { [userId]: [ { id, name, rolls, cost, market, group, sep } ] },
 *   prices:   { [coinIndex]: number },        // 行情是全局共享的
 *   visits:   { total, days: { 'YYYY-MM-DD': n } }
 * }
 *
 * 只有在 STORAGE != mysql（默认）时才会被 require 到。
 */
const fs = require('fs');
const path = require('path');

const DATA_DIR = process.env.COIN_DATA_DIR || path.join(__dirname, '..', 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');
const TMP_FILE = DB_FILE + '.tmp';

let doc = null;

function nowISO() {
  return new Date().toISOString();
}

function emptyDoc() {
  return {
    version: 2,
    createdAt: nowISO(),
    updatedAt: nowISO(),
    users: [],
    holdings: {},   // userId -> [持仓]
    prices: {},     // 全局行情覆盖
    visits: { total: 0, days: {} },   // 匿名访问计数（不记录 IP）
    rev: 0
  };
}

function ensureDir() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

/** v1 -> v2：把单一 holdings 数组暂存，等 index.js 建好超管后认领 */
function migrate(d) {
  let changed = false;
  if (!d.version || d.version < 2) {
    d.version = 2;
    changed = true;
  }
  if (!Array.isArray(d.users)) { d.users = []; changed = true; }
  if (!d.holdings || typeof d.holdings !== 'object' || Array.isArray(d.holdings)) {
    const legacy = Array.isArray(d.holdings) ? d.holdings : [];
    d.holdings = legacy.length ? { _legacy: legacy } : {};
    changed = true;
  }
  if (!d.prices || typeof d.prices !== 'object') { d.prices = {}; changed = true; }
  if (!d.visits || typeof d.visits !== 'object') { d.visits = { total: 0, days: {} }; changed = true; }
  if (!d.visits.days || typeof d.visits.days !== 'object') { d.visits.days = {}; changed = true; }
  if (typeof d.rev !== 'number') { d.rev = 0; changed = true; }
  return changed;
}

function write(obj) {
  ensureDir();
  const payload = JSON.stringify(obj, null, 1);
  fs.writeFileSync(TMP_FILE, payload, 'utf8');
  fs.renameSync(TMP_FILE, DB_FILE);   // 同分区 rename 是原子操作
}

function load() {
  if (doc) return doc;
  ensureDir();
  try {
    const raw = fs.readFileSync(DB_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    doc = Object.assign(emptyDoc(), parsed);
    if (migrate(doc)) {
      write(doc);
      console.log('[store] 数据已升级到 v2（多用户）');
    }
  } catch (e) {
    if (e.code !== 'ENOENT') {
      try {
        fs.renameSync(DB_FILE, DB_FILE + '.corrupt.' + Date.now());
        console.error('[store] db.json 解析失败，已备份并重建：', e.message);
      } catch (_) { /* ignore */ }
    }
    doc = emptyDoc();
    write(doc);
  }
  return doc;
}

async function init() {
  return load();
}

/** 用新文档覆盖落盘（调用方已完成 mutator） */
async function save(next) {
  doc = next;
  write(next);
}

function flush() {
  if (doc) write(doc);
}

async function close() { /* 无需释放资源 */ }

function info() {
  return { mode: 'json', file: DB_FILE };
}

module.exports = { init, load, save, flush, close, info, DB_FILE, DATA_DIR };
