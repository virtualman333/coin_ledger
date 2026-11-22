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

/** 本地日期（服务器时区，国内部署即北京时间）；存的是 UTC ISO，直接 slice 会在 00:00-08:00 错一天 */
function dateStr(d) {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
function dayKey(iso) {
  const d = iso ? new Date(iso) : null;
  return (d && !isNaN(d.getTime())) ? dateStr(d) : '';
}

const RANGE_KEYS = ['today', 'week', 'month', 'year', 'all'];

/** 区间边界：start 含、end 不含；周一为一周起点。未知值退回 all，保持旧调用方行为 */
function resolveRange(name) {
  const key = RANGE_KEYS.indexOf(String(name || '')) >= 0 ? String(name) : 'all';
  if (key === 'all') return { key, start: null, end: null };
  const now = new Date();
  const y = now.getFullYear(), m = now.getMonth(), d = now.getDate();
  let start, end;
  if (key === 'today') {
    start = new Date(y, m, d); end = new Date(y, m, d + 1);
  } else if (key === 'week') {
    const back = (now.getDay() + 6) % 7;
    start = new Date(y, m, d - back); end = new Date(y, m, d - back + 7);
  } else if (key === 'month') {
    start = new Date(y, m, 1); end = new Date(y, m + 1, 1);
  } else {
    start = new Date(y, 0, 1); end = new Date(y + 1, 0, 1);
  }
  return { key, start, end };
}

function filterByRange(items, range) {
  const r = range && range.start ? range : resolveRange(range);
  if (!r.start) return (items || []).slice();
  const from = r.start.getTime(), to = r.end.getTime();
  return (items || []).filter((x) => {
    const t = Date.parse(x.at);
    return !isNaN(t) && t >= from && t < to;
  });
}

/** 趋势粒度：今日看小时，周/月看天，年/全部看月，避免 365 根柱子 */
function granularityOf(key) {
  return key === 'today' ? 'hour' : (key === 'year' || key === 'all' ? 'month' : 'day');
}
function bucketKey(iso, gran) {
  const d = iso ? new Date(iso) : null;
  if (!d || isNaN(d.getTime())) return '';
  if (gran === 'hour') return String(d.getHours()).padStart(2, '0');
  if (gran === 'month') return dayKey(iso).slice(0, 7);
  return dayKey(iso);
}
function bucketLabel(k, gran) {
  if (gran === 'hour') return k + ':00';
  if (gran === 'month') return k.slice(5) + '月';
  return k.slice(5);
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
    const d = new Date(day + 'T00:00:00');
    d.setDate(d.getDate() + 1);
    return dateStr(d);
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

/** 按 IP 聚合：同一 IP 的多次访问、多个会话、多个来源合并成一行 */
function ipGroups(items) {
  const map = {};
  const ipKey = (x) => x.ip || ('sid:' + x.sid);
  items.forEach((x) => {
    const ip = ipKey(x);
    if (!map[ip]) {
      map[ip] = {
        ip: x.ip || '—',
        pv: 0, sessions: {}, pages: {}, clients: {}, days: {},
        first: x.at, last: x.at, name: '', nickName: '', ua: x.ua || '', uid: '',
      };
    }
    const g = map[ip];
    g.pv += 1;
    g.sessions[x.sid] = 1;
    g.pages[x.tab] = 1;
    g.clients[x.client || 'web'] = 1;
    g.days[dayKey(x.at)] = 1;
    if (Date.parse(x.at) < Date.parse(g.first)) g.first = x.at;
    if (Date.parse(x.at) > Date.parse(g.last)) g.last = x.at;
    if (!g.name && x.userName) g.name = x.userName;
    // 用户名用来认账号，昵称用来认人 —— 两个都留着，别互相覆盖
    if (!g.nickName && x.nickName) g.nickName = x.nickName;
    if (!g.ua && x.ua) g.ua = x.ua;
    if (!g.uid && x.uid) g.uid = x.uid;
  });
  return Object.keys(map).map((k) => {
    const g = map[k];
    return {
      ip: g.ip,
      pv: g.pv,
      sessionCount: Object.keys(g.sessions).length,
      pageCount: Object.keys(g.pages).length,
      pages: Object.keys(g.pages),
      clients: Object.keys(g.clients),
      days: Object.keys(g.days).length,
      first: g.first,
      last: g.last,
      uid: g.uid || '',
      name: g.name,
      nickName: g.nickName || '',
      ua: g.ua,
    };
  }).sort((a, b) => String(b.last).localeCompare(String(a.last))).slice(0, 60);
}

/**
 * 按用户汇总：登录用户按 uid 聚合，未登录按 IP 归一组（昵称显示「未登录」）。
 *
 * 与 ipGroups 的区别：同一个人换了 IP 只算一行，同一 IP 下的多个账号也分开。
 *
 * @param {Array<object>} items 已按区间/来源筛过的埋点
 * @returns {Array<object>} 按访问次数降序
 */
function userGroups(items) {
  const map = {};
  (items || []).forEach((x) => {
    const key = x.uid ? ('u:' + x.uid) : ('a:' + (x.ip || x.sid));
    if (!map[key]) {
      map[key] = {
        uid: x.uid || '', ip: x.ip || '', pv: 0,
        sessions: {}, pages: {}, clients: {}, days: {}, ips: {},
        first: x.at, last: x.at, name: '', nickName: '', ua: '',
      };
    }
    const g = map[key];
    g.pv += 1;
    g.sessions[x.sid] = 1;
    g.pages[x.tab] = 1;
    g.clients[x.client || 'web'] = 1;
    g.days[dayKey(x.at)] = 1;
    if (x.ip) g.ips[x.ip] = 1;
    if (Date.parse(x.at) < Date.parse(g.first)) g.first = x.at;
    if (Date.parse(x.at) > Date.parse(g.last)) g.last = x.at;
    if (!g.name && x.userName) g.name = x.userName;
    if (!g.nickName && x.nickName) g.nickName = x.nickName;
    if (!g.ua && x.ua) g.ua = x.ua;
  });
  return Object.keys(map).map((k) => {
    const g = map[k];
    return {
      uid: g.uid,
      ip: g.ip,
      pv: g.pv,
      sessionCount: Object.keys(g.sessions).length,
      pageCount: Object.keys(g.pages).length,
      pages: Object.keys(g.pages),
      clients: Object.keys(g.clients),
      days: Object.keys(g.days).length,
      ipCount: Object.keys(g.ips).length,
      first: g.first,
      last: g.last,
      name: g.name,
      nickName: g.nickName || '',
      ua: g.ua,
    };
  }).sort((a, b) => b.pv - a.pv || String(b.last).localeCompare(String(a.last))).slice(0, 200);
}

/** 某个 IP / 会话 / 用户的完整访问明细（管理端弹窗用） */
function detail(items, query) {
  const q = query || {};
  const rows = items.filter((x) => {
    if (q.sid) return x.sid === q.sid;
    if (q.uid) return x.uid === q.uid;
    if (q.ip) return (x.ip || ('sid:' + x.sid)) === q.ip;
    return false;
  });
  return {
    rows: rows.slice(0, 200).map((x) => ({
      at: x.at, tab: x.tab, client: x.client || 'web', sid: x.sid,
      name: x.userName || '', nickName: x.nickName || '', ua: x.ua || '', path: x.path || '', ip: x.ip || '',
    })).sort((a, b) => String(b.at).localeCompare(String(a.at))),
    total: rows.length,
  };
}

function stats(items, options) {
  const opts = options || {};
  const client = opts.client && opts.client !== 'all' ? opts.client : '';
  const all = items || [];
  const range = resolveRange(opts.range);
  const scoped = filterByRange(all, range);
  const rows = client ? scoped.filter((x) => (x.client || 'web') === client) : scoped;
  const gran = granularityOf(range.key);
  const ipKey = (x) => x.ip || ('sid:' + x.sid);

  const buckets = {};
  const sessions = {};
  rows.forEach((x) => {
    const k = bucketKey(x.at, gran);
    if (k) {
      if (!buckets[k]) buckets[k] = { pv: 0, ips: {} };
      buckets[k].pv += 1;
      buckets[k].ips[ipKey(x)] = 1;
    }
    if (!sessions[x.sid]) {
      sessions[x.sid] = {
        first: x.at, last: x.at, pages: {}, ip: x.ip, ua: x.ua,
        uid: x.uid, name: x.userName, nickName: x.nickName || '', client: x.client || 'web',
      };
    }
    {
      const s = sessions[x.sid];
      // 埋点写入顺序不等于时间顺序（并发/补写），first 可能晚于 last，
      // 之前直接 last = x.at 会得到「首次访问在最后一次之后」的脏数据
      if (Date.parse(x.at) < Date.parse(s.first)) s.first = x.at;
      if (Date.parse(x.at) > Date.parse(s.last)) s.last = x.at;
      s.pages[x.tab] = 1;
    }
  });

  // 今日 24 小时 / 月 12 个月 / 天 14 日，超出部分前端也看不过来
  const limit = gran === 'hour' ? 24 : (gran === 'month' ? 12 : 14);
  const daily = Object.keys(buckets).sort().slice(-limit).map((k) => ({
    date: k,
    label: bucketLabel(k, gran),
    pv: buckets[k].pv,
    uv: Object.keys(buckets[k].ips).length,
  }));

  const sids = Object.keys(sessions);
  const rangeIps = {}, allIps = {}, todayIps = {};
  rows.forEach((x) => { rangeIps[ipKey(x)] = 1; });
  all.forEach((x) => { allIps[ipKey(x)] = 1; });
  const today = dateStr(new Date());
  // 今日数字必须跟客户端筛选同口径：选了「网页」还显示含小程序的今日 PV，
  // 页面上就会出现「访问 48 次 / 今日 PV 464」这种自相矛盾的组合
  const todayRows = client ? all.filter((x) => (x.client || 'web') === client) : all;
  let todayPv = 0;
  todayRows.forEach((x) => {
    if (dayKey(x.at) !== today) return;
    todayPv += 1;
    todayIps[ipKey(x)] = 1;
  });

  // 来源分布按所选区间算，和上面的卡片/趋势保持同口径
  const byClient = { web: { pv: 0, ips: {} }, mp: { pv: 0, ips: {} } };
  scoped.forEach((x) => {
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
      nickName: s.nickName || '',
      client: s.client,
    };
  }).sort((a, b) => String(b.last).localeCompare(String(a.last))).slice(0, 40);

  const stamps = scoped.map((x) => Date.parse(x.at)).filter((t) => !isNaN(t));
  const from = stamps.length ? dateStr(new Date(Math.min.apply(null, stamps))) : '';
  const to = stamps.length ? dateStr(new Date(Math.max.apply(null, stamps))) : '';

  return {
    client: client || 'all',
    range: { key: range.key, from, to },
    gran,
    rangePv: rows.length,
    rangeUv: Object.keys(rangeIps).length,
    totalPv: rows.length,          // 兼容旧字段：旧的 total* 现在即「所选区间」
    totalUv: Object.keys(rangeIps).length,
    allPv: all.length,
    allUv: Object.keys(allIps).length,
    todayPv,
    todayUv: Object.keys(todayIps).length,
    daily,
    sessions: latest,
    sessionsTotal: sids.length,     // 会话列表只回传最近 40 条，前端需要知道是否被截断
    byClient: {
      web: { pv: byClient.web.pv, uv: Object.keys(byClient.web.ips).length },
      mp: { pv: byClient.mp.pv, uv: Object.keys(byClient.mp.ips).length },
    },
    avgPages: sids.length
      ? Math.round((sids.reduce((n, k) => n + Object.keys(sessions[k].pages).length, 0) / sids.length) * 10) / 10
      : 0,
    retention: pageRetention(scoped),
    ipGroups: ipGroups(rows),
    userGroups: userGroups(rows),
  };
}

module.exports = { load, add, recentlySeen, stats, pageRetention, ipGroups, userGroups, detail, dayKey, resolveRange, filterByRange };
