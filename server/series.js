'use strict';
/**
 * 系列主数据。
 *
 * 品种与系列是多对多：coin.seriesKeys = ['CN','SXC']，
 * 所以「纪念钞」和「生肖纪念钞」可以同时包含龙钞/蛇钞/马钞。
 *
 * 这里只管系列本身的元信息（名称、简介、卡图、排序），
 * 成员的增减通过品种的 seriesKeys 维护。
 */
const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '..', 'public', 'data', 'series.json');
const IMG_DIR = path.join(__dirname, '..', 'public', 'img', 'series');

function load() {
  try {
    const doc = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    if (doc && Array.isArray(doc.items)) return doc;
  } catch (e) { /* 首次运行 */ }
  return { updated: '', note: '', items: [] };
}

function save(doc) {
  doc.updated = new Date().toISOString().slice(0, 10);
  const tmp = FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(doc, null, 1) + '\n');
  fs.renameSync(tmp, FILE);
}

/** 按 seriesKeys 统计每个系列的品种数 */
function listWithCount(coins) {
  const doc = load();
  const counts = {};
  (coins || []).forEach((c) => {
    const keys = Array.isArray(c.seriesKeys) && c.seriesKeys.length
      ? c.seriesKeys
      : (c.series ? [c.series] : []);
    keys.forEach((k) => { counts[k] = (counts[k] || 0) + 1; });
  });
  return doc.items
    .map((s) => Object.assign({}, s, { count: counts[s.key] || 0 }))
    .sort((a, b) => (a.sort || 0) - (b.sort || 0));
}

/** 查询单个系列（含 count） */
function one(key, coins) {
  return listWithCount(coins).filter((s) => s.key === key)[0] || null;
}

/** 新建：key 只允许字母数字下划线，且不能重名 */
function create(fields) {
  const doc = load();
  const key = String(fields.key || '').trim();
  if (!/^[A-Za-z0-9_]{1,12}$/.test(key)) return { ok: false, error: 'key 只能 1–12 位字母、数字或下划线' };
  if (doc.items.some((s) => s.key === key)) return { ok: false, error: '这个 key 已经存在' };
  const name = String(fields.name || '').trim();
  if (!name) return { ok: false, error: '系列名不能为空' };
  const item = {
    key: key,
    name: name.slice(0, 24),
    desc: String(fields.desc || '').slice(0, 120),
    img: String(fields.img || ''),
    sort: Number(fields.sort) || (doc.items.length + 1) * 10,
  };
  doc.items.push(item);
  save(doc);
  return { ok: true, item: item };
}

function update(key, fields) {
  const doc = load();
  const item = doc.items.filter((s) => s.key === key)[0];
  if (!item) return { ok: false, error: '系列不存在' };
  if (typeof fields.name === 'string' && fields.name.trim()) item.name = fields.name.trim().slice(0, 24);
  if (typeof fields.desc === 'string') item.desc = fields.desc.slice(0, 120);
  if (typeof fields.img === 'string') item.img = fields.img;
  if (fields.sort !== undefined && isFinite(Number(fields.sort))) item.sort = Number(fields.sort);
  save(doc);
  return { ok: true, item: item };
}

/** 删除：还会在品种的 seriesKeys 里移除该 key，避免悬空引用 */
function remove(key, coins) {
  const doc = load();
  const before = doc.items.length;
  doc.items = doc.items.filter((s) => s.key !== key);
  if (doc.items.length === before) return { ok: false, error: '系列不存在' };
  save(doc);
  let touched = 0;
  (coins || []).forEach((c) => {
    if (Array.isArray(c.seriesKeys) && c.seriesKeys.indexOf(key) >= 0) {
      c.seriesKeys = c.seriesKeys.filter((k) => k !== key);
      touched += 1;
    }
  });
  return { ok: true, touched: touched };
}

/** 存卡图：base64 → public/img/series/<key>.jpg */
function saveImage(key, dataUrl) {
  const m = /^data:image\/(jpeg|jpg|png);base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl || ''));
  if (!m) return { ok: false, error: '只支持 JPEG / PNG' };
  const buf = Buffer.from(m[2], 'base64');
  if (!buf.length || buf.length > 3 * 1024 * 1024) return { ok: false, error: '图片为空或超过 3MB' };
  fs.mkdirSync(IMG_DIR, { recursive: true });
  // 文件名带时间戳：换图后路径变化，天然规避小程序 / 浏览器的图片缓存
  const name = String(key).toLowerCase() + '-' + Date.now().toString(36) + '.jpg';
  fs.writeFileSync(path.join(IMG_DIR, name), buf);
  return { ok: true, img: 'img/series/' + name, size: buf.length };
}

module.exports = { load, save, listWithCount, one, create, update, remove, saveImage, FILE };
