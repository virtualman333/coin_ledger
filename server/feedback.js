'use strict';
/**
 * 纠错反馈：独立的小文件存储。
 *
 * 为什么不用 store 的 doc：MySQL 后端是固定表结构（users/holdings/prices/visits），
 * 加一张表要改别人的迁移脚本；反馈体积小、读写模式简单（追加 + 改状态 + 删除），
 * 单独一个 data/feedback.json 更省事，也方便直接看/备份。
 *
 * 结构：
 *   { items: [ { id, uid, userName, coinId, coinName, text, images:[文件名], status, createdAt, handledAt, reply, repliedAt } ] }
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = process.env.COIN_DATA_DIR || path.join(__dirname, '..', 'data');
const FILE = path.join(DATA_DIR, 'feedback.json');
const IMG_DIR = path.join(__dirname, '..', 'public', 'feedback');
const MAX_ITEMS = 2000;

function ensureDirs() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.mkdirSync(IMG_DIR, { recursive: true });
}

function load() {
  try {
    const doc = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    return doc && Array.isArray(doc.items) ? doc : { items: [] };
  } catch (e) {
    return { items: [] };
  }
}

function save(doc) {
  ensureDirs();
  // 覆盖前留一份上一版，误删还能捞回来
  try {
    if (fs.existsSync(FILE)) fs.copyFileSync(FILE, FILE + '.bak');
  } catch (e) { /* 备份失败不影响主流程 */ }
  const tmp = FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(doc), 'utf8');
  fs.renameSync(tmp, FILE);
}

function list(status) {
  const items = load().items.slice().sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  if (status === 'open' || status === 'done') return items.filter((x) => x.status === status);
  return items;
}

/** 把 dataURL 解成 Buffer（供内容安全检测与落盘） */
function decodeImage(dataUrl) {
  const m = /^data:image\/(jpeg|jpg|png);base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl || ''));
  if (!m) return null;
  const buf = Buffer.from(m[2], 'base64');
  if (!buf.length || buf.length > 3 * 1024 * 1024) return null;
  return buf;
}

/** 把已解码的 Buffer 存成文件，返回文件名 */
function saveBuffer(buf) {
  if (!buf || !buf.length) return null;
  ensureDirs();
  const name = Date.now().toString(36) + '-' + crypto.randomBytes(3).toString('hex') + '.jpg';
  fs.writeFileSync(path.join(IMG_DIR, name), buf);
  return name;
}

/** 兼容旧调用：直接存 dataURL */
function saveImage(dataUrl) {
  return saveBuffer(decodeImage(dataUrl));
}

/** 某用户今天已提交多少条（用于简单的账号级限流） */
function todayCount(uid) {
  const day = new Date().toISOString().slice(0, 10);
  return load().items.filter((x) => x.uid === uid && String(x.createdAt || '').slice(0, 10) === day).length;
}

function add(item) {
  const doc = load();
  const id = crypto.randomBytes(6).toString('hex');
  const record = Object.assign({ id, status: 'open', createdAt: new Date().toISOString() }, item);
  doc.items.unshift(record);
  if (doc.items.length > MAX_ITEMS) doc.items.length = MAX_ITEMS;
  save(doc);
  return record;
}

function update(id, patch) {
  const doc = load();
  const hit = doc.items.filter((x) => x.id === id)[0];
  if (!hit) return null;
  if (patch.status === 'open' || patch.status === 'done') {
    hit.status = patch.status;
    hit.handledAt = patch.status === 'done' ? new Date().toISOString() : null;
  }
  if (typeof patch.note === 'string') hit.note = patch.note.slice(0, 500);
  // 管理员回复：用户端可见。留空表示撤回回复。
  if (typeof patch.reply === 'string') {
    var r = patch.reply.trim().slice(0, 800);
    if (r) { hit.reply = r; hit.repliedAt = new Date().toISOString(); }
    else { delete hit.reply; delete hit.repliedAt; }
  }
  save(doc);
  return hit;
}

/** 某用户自己的反馈（含管理员回复），按时间倒序 */
function listByUser(uid) {
  return load().items
    .filter((x) => Number(x.uid) === Number(uid))
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
    .map((x) => ({
      id: x.id, coinId: x.coinId, coinName: x.coinName, text: x.text,
      images: x.images || [], status: x.status,
      createdAt: x.createdAt, handledAt: x.handledAt || null,
      reply: x.reply || '', repliedAt: x.repliedAt || null
    }));
}

function remove(id) {
  const doc = load();
  const hit = doc.items.filter((x) => x.id === id)[0];
  if (!hit) return null;
  doc.items = doc.items.filter((x) => x.id !== id);
  save(doc);
  (hit.images || []).forEach((f) => {
    try { fs.unlinkSync(path.join(IMG_DIR, f)); } catch (e) { /* 文件可能已不在 */ }
  });
  return hit;
}

module.exports = { load, list, listByUser, add, update, remove, decodeImage, saveBuffer, saveImage, todayCount, IMG_DIR };
