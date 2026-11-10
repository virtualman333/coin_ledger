'use strict';
/**
 * 访客记录：独立小文件存储，不碰用户的 holdings / users 表。
 * data/visits.json 放在 public 之外，外部访问不到。
 *
 * 结构：{ items: [ { id, at, sid, tab, path, ip, ua, uid, userName, pages } ] }
 * pages = 这个会话到当前为止看过的不同页面数（前端上报时带上，便于直接看单条）
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = process.env.COIN_DATA_DIR || path.join(__dirname, '..', 'data');
const FILE = path.join(DATA_DIR, 'visits.json');
const MAX_ITEMS = 5000;

function load() {
  try {
    const doc = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    if (doc && Array.isArray(doc.items)) return doc;
  } catch (e) { /* 首次运行 */ }
  return { items: [] };
}

function save(doc) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(doc));
}

function add(rec) {
  const doc = load();
  const item = Object.assign(
    { id: crypto.randomBytes(5).toString('hex'), at: new Date().toISOString() },
    rec
  );
  doc.items.unshift(item);
  if (doc.items.length > MAX_ITEMS) doc.items.length = MAX_ITEMS;
  save(doc);
  return item;
}

/** 同一会话同一页面 30 秒内只记一次，防止刷新刷 PV */
function recentlySeen(sid, tab, seconds) {
  const since = Date.now() - (seconds || 30) * 1000;
  return load().items.some((x) => x.sid === sid && x.tab === tab && Date.parse(x.at) > since);
}

function dayKey(iso) {
  return String(iso || '').slice(0, 10);
}

function stats(items) {
  const days = {};
  const sessions = {};
  // 访客数按独立 IP 计：同一 IP 下开多个标签页 / 多个会话仍算一个人。
  // 拿不到 IP 的极少数记录用会话 ID 兜底，避免全部并成一个。
  const ipKey = (x) => x.ip || ('sid:' + x.sid);
  items.forEach((x) => {
    const k = dayKey(x.at);
    if (!days[k]) days[k] = { pv: 0, ips: {} };
    days[k].pv += 1;
    days[k].ips[ipKey(x)] = 1;
    if (!sessions[x.sid]) sessions[x.sid] = { first: x.at, last: x.at, pages: {}, ip: x.ip, ua: x.ua, uid: x.uid, name: x.userName };
    sessions[x.sid].last = x.at;
    sessions[x.sid].pages[x.tab] = 1;
  });
  const daily = Object.keys(days).sort().reverse().slice(0, 7).map((k) => ({
    date: k,
    pv: days[k].pv,
    uv: Object.keys(days[k].ips).length,
  }));
  const sids = Object.keys(sessions);
  const allIps = {};
  items.forEach((x) => { allIps[ipKey(x)] = 1; });
  const today = new Date().toISOString().slice(0, 10);
  const todayRows = items.filter((x) => dayKey(x.at) === today);
  const todayIps = {};
  todayRows.forEach((x) => { todayIps[ipKey(x)] = 1; });

  // 最近会话（按最后一次访问倒序），带浏览页面数
  const latest = sids.map((sid) => {
    const s = sessions[sid];
    return {
      sid,
      first: s.first,
      last: s.last,
      pages: Object.keys(s.pages),
      pageCount: Object.keys(s.pages).length,
      ip: s.ip,
      ua: s.ua,
      uid: s.uid,
      name: s.name,
    };
  }).sort((a, b) => String(b.last).localeCompare(String(a.last))).slice(0, 40);

  return {
    totalPv: items.length,
    totalUv: Object.keys(allIps).length,
    todayPv: todayRows.length,
    todayUv: Object.keys(todayIps).length,
    daily,
    sessions: latest,
  };
}

module.exports = { load, add, recentlySeen, stats, dayKey };
