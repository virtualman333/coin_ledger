'use strict';
/**
 * 管理端操作审计：轻量 JSON 追加日志，独立于业务存储后端（MySQL / JSON 都能用）。
 * 只记录管理端写操作，保留最近 MAX 条，避免文件无限增长。
 */
const fs = require('fs');
const path = require('path');

const DIR = process.env.COIN_DATA_DIR || path.join(__dirname, '..', 'data');
const FILE = path.join(DIR, 'audit.json');
const MAX = 2000;
let seq = 0;

function load() {
  try {
    const list = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

function save(list) {
  try {
    fs.mkdirSync(DIR, { recursive: true });
    fs.writeFileSync(FILE, JSON.stringify(list) + '\n', 'utf8');
  } catch (e) {
    console.error('[audit] 写入失败: ' + e.message);
  }
}

/** actor 操作人，action 如 user.delete / series.create，target 目标名，detail 补充，ip 来源 */
function log(actor, action, target, detail, ip) {
  const list = load();
  list.unshift({
    id: 'a' + Date.now().toString(36) + '-' + (++seq),
    at: new Date().toISOString(),
    actor: String(actor || ''),
    action: String(action || ''),
    target: String(target == null ? '' : target),
    detail: String(detail == null ? '' : detail),
    ip: String(ip || '')
  });
  if (list.length > MAX) list.length = MAX;
  save(list);
}

function query(opts) {
  const q = String((opts && opts.q) || '').trim().toLowerCase();
  const page = Math.max(1, Number((opts && opts.page) || 1) || 1);
  const size = Math.min(200, Math.max(1, Number((opts && opts.size) || 20) || 20));
  let list = load();
  if (q) {
    list = list.filter((x) => [x.actor, x.action, x.target, x.detail, x.ip]
      .some((v) => String(v || '').toLowerCase().includes(q)));
  }
  return { items: list.slice((page - 1) * size, page * size), total: list.length };
}

module.exports = { log, query };
