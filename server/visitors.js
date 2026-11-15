'use strict';
/**
 * 访客记录：独立小文件存储，不碰用户的 holdings / users 表。
 * data/visits.json 放在 public 之外，外部访问不到。
 *
 * 结构：{ items: [ { id, at, sid, tab, path, ip, ua, uid, userName, client } ] }
 * client = 'web' | 'mp'，历史数据没这个字段时按 web 处理。
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
    { id: crypto.randomBytes(5).toString('hex'), at: new Date().toISOString(), client: 'web' },
    rec
  );
  doc.items.unshift(item);
  if (doc.items.length > MAX_ITEMS) doc.items.length = MAX_ITEMS;
  save(doc);
  return item;
}

/** 同一来源 + 同一会话 + 同一页面 30 秒内只记一次，防止刷新刷 PV */
function recentlySeen(sid, tab, seconds, client) {
  const since = Date.now() - (seconds || 30) * 1000;
  const c = client || 'web';
  return load().items.some((x) =>
    x.sid === sid && x.tab === tab && (x.client || 'web') === c && Date.parse(x.at) > since
  );
}

function dayKey(iso) {
  return String(iso || '').slice(0, 10);
}

/**
 * 小程序页面留存。
 *  - 继续浏览：访问该页面后，同一会话里还打开了别的页面（跳出率的反面）
 *  - 次日回访：访问该页面的 IP，第二天又回来了（任意页面）
 * 网页端页面切换语义不同，不混进这张表。
 */
function pageRetention(items) {
  const mp = items.filter((x) => (x.client || 'web') === 'mp');
  const bySid = {};
  const pageMap = {};
  const ipDays = {};

  mp.forEach((x) => {
    const ip = x.ip || ('sid:' + x.sid);
    const day = dayKey(x.at);
    if (!ipDays[ip]) ipDays[ip] = {};
    ipDays[ip][day] = 1;
    if (!bySid[x.sid]) bySid[x.sid] = [];
    bySid[x.sid].push(x);
    if (!pageMap[x.tab]) {
      pageMap[x.tab] = { tab: x.tab, pv: 0, sessions: {}, continued: 0, returned: 0 };
    }
    pageMap[x.tab].pv += 1;
  });

  Object.keys(bySid).forEach((sid) => {
    const rows = bySid[sid].slice().sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
    const seen = {};
    rows.forEach((x, i) => {
      if (seen[x.tab] || !pageMap[x.tab]) return;
      seen[x.tab] = 1;
      pageMap[x.tab].sessions[sid] = 1;
      if (rows.slice(i + 1).some((y) => y.tab !== x.tab)) pageMap[x.tab].continued += 1;
    });
  });

  const nextDay = (day) => {
    const d = new Date(day + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() + 1);
    return d.toISOString().slice(0, 10);
  };
  mp.forEach((x) => {
    const ip = x.ip || ('sid:' + x.sid);
    if (ipDays[ip] && ipDays[ip][nextDay(dayKey(x.at))]) pageMap[x.tab].returned += 1;
  });

  return Object.keys(pageMap).map((k) => {
    const r = pageMap[k];
    const sessions = Object.keys(r.sessions).length;
    return {
      tab: r.tab,
      pv: r.pv,
      sessions,
      continued: r.continued,
      keepRate: sessions ? Math.round((r.continued / sessions) * 100) : 0,
      returned: r.returned,
      nextRate: r.pv ? Math.round((r.returned / r.pv) * 100) : 0,
    };
  }).sort((a, b) => b.pv - a.pv).slice(0, 20);
}

function stats(items, options) {
  const opts = options || {};
  const client = opts.client && opts.client !== 'all' ? opts.client : '';
  const rows = client ? items.filter((x) => (x.client || 'web') === client) : items;
  const days = {};
  const sessions = {};
  // 访客数按独立 IP 计：同一 IP 开多个标签页 / 多个会话仍算一个人。
  const ipKey = (x) => x.ip || ('sid:' + x.sid);

  rows.forEach((x) => {
    const k = dayKey(x.at);
    if (!days[k]) days[k] = { pv: 0, ips: {} };
    days[k].pv += 1;
    days[k].ips[ipKey(x)] = 1;
    if (!sessions[x.sid]) {
      sessions[x.sid] = {
        first: x.at, last: x.at, pages: {}, ip: x.ip, ua: x.ua,
        uid: x.uid, name: x.userName, client: x.client || 'web',
      };
    }
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
  rows.forEach((x) => { allIps[ipKey(x)] = 1; });
  const today = new Date().toISOString().slice(0, 10);
  const todayRows = rows.filter((x) => dayKey(x.at) === today);
  const todayIps = {};
  todayRows.forEach((x) => { todayIps[ipKey(x)] = 1; });

  // 来源分布始终按全量算，切筛选时也能对比
  const byClient = { web: { pv: 0, ips: {} }, mp: { pv: 0, ips: {} } };
  items.forEach((x) => {
    const c = (x.client || 'web') === 'mp' ? 'mp' : 'web';
    byClient[c].pv += 1;
    byClient[c].ips[ipKey(x)] = 1;
  });

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
      client: s.client,
    };
  }).sort((a, b) => String(b.last).localeCompare(String(a.last))).slice(0, 40);

  return {
    client: client || 'all',
    totalPv: rows.length,
    totalUv: Object.keys(allIps).length,
    todayPv: todayRows.length,
    todayUv: Object.keys(todayIps).length,
    daily,
    sessions: latest,
    byClient: {
      web: { pv: byClient.web.pv, uv: Object.keys(byClient.web.ips).length },
      mp: { pv: byClient.mp.pv, uv: Object.keys(byClient.mp.ips).length },
    },
    avgPages: sids.length
      ? Math.round((sids.reduce((n, k) => n + Object.keys(sessions[k].pages).length, 0) / sids.length) * 10) / 10
      : 0,
    retention: pageRetention(items),
  };
}

module.exports = { load, add, recentlySeen, stats, pageRetention, dayKey };
