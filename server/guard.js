'use strict';
/**
 * 反爬 / 防刷：按 IP 的滑窗限流 + 可疑 UA 拦截 + 蜜罐分级处置。
 *
 * 思路是「抬成本」而不是「绝对防住」：
 *   - 正常用户和搜索引擎不受影响
 *   - 脚本即使伪造 UA，也会被限流卡住吞吐
 *   - 蜜罐只有「反复命中」才短封。一次误点（隐藏链接被搜索引擎索引、
 *     浏览器预取、从外部链接点入）不会把真人挡在门外。
 *     历史教训见 README「踩过的坑 · 蜜罐误伤」。
 */
const auth = require('./auth');

const WINDOW_MS = 60 * 1000;

// 每类请求每分钟的额度（单 IP）
const LIMITS = {
  read: Number(process.env.RL_READ || 120),    // 读接口
  write: Number(process.env.RL_WRITE || 30),   // 写接口
  adminWrite: Number(process.env.RL_ADMIN_WRITE || 300), // 管理端写（批量保存）
  login: Number(process.env.RL_LOGIN || 8),    // 登录尝试
  static: Number(process.env.RL_STATIC || 300) // 静态资源
};

// 蜜罐：同一 IP 在窗口内反复命中才封，封禁时长从 24h 降到 30min。
// 全部可用环境变量覆盖；老部署若显式设过 BAN_MS，仍按它自己的值生效。
const TRAP_WINDOW_MS = Number(process.env.TRAP_WINDOW_MS || 10 * 60 * 1000);
const TRAP_BAN_THRESHOLD = Math.max(2, Number(process.env.TRAP_BAN_THRESHOLD || 3));
const BAN_MS = Number(process.env.BAN_MS || 30 * 60 * 1000);
const ABUSE_BAN_MS = 10 * 60 * 1000;                                // 连续超限封 10 分钟

// 白名单：逗号分隔，支持精确 IP、'1.2.3.*'、'1.2.3.' 前缀
const WHITELIST = String(process.env.GUARD_WHITELIST || '')
  .split(',').map((s) => s.trim()).filter(Boolean);

// 明显的脚本/自动化 UA。故意不收 'node'、'curl' 之外常见的库名冲突项，
// 也不收搜索引擎 UA（商业站点要靠它们收录）。
// 只收敛「脚本客户端独有的 UA」。HeadlessChrome / Puppeteer 这类不拦：
// 真爬虫都会伪装成普通 Chrome，拦它们拦不到人，反而误伤截图与预览工具。
const BAD_UA = /(python-requests|python-urllib|scrapy|aiohttp|httpx|requests-html|wget|libwww|httpclient|java\/|go-http-client|okhttp)/i;
// 搜索引擎放行（即使命中上面的规则也不能挡）
const SEARCH_BOT = /(baiduspider|googlebot|bingbot|sogouspider|360spider|bytespider|yisouspider|duckduckbot|applebot)/i;

const counters = new Map();   // "ip|cls" -> {start, n}
const bans = new Map();       // ip -> {until, reason}
const strikes = new Map();    // "ip|ua" / "ip|rate" -> 连续次数
const trapHits = new Map();   // ip -> {start, n}

function now() { return Date.now(); }

// 本机（运维自检、健康检查）不走封禁逻辑，只受限流约束
function isLocalIp(ip) {
  return ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
}

function isWhitelisted(ip) {
  const s = String(ip || '');
  return WHITELIST.some((w) => {
    if (w.endsWith('*')) return s.startsWith(w.slice(0, -1));
    if (w.endsWith('.')) return s.startsWith(w);
    return w === s;
  });
}

/** 本机 + 显式白名单：完全信任，不受封禁与限流影响 */
function isExempt(ip) { return isLocalIp(ip) || isWhitelisted(ip); }

/** 有效登录会话（Cookie / Bearer）= 已通过口令或微信登录的真人，不能被 IP 连坐 */
function hasValidSession(req) {
  const headers = (req && req.headers) || {};
  const bearer = /^Bearer\s+(\S+)$/i.exec(String(headers.authorization || '').trim());
  let token = bearer ? bearer[1] : '';
  if (!token) {
    String(headers.cookie || '').split(';').some((kv) => {
      const i = kv.indexOf('=');
      if (i < 0) return false;
      if (kv.slice(0, i).trim() !== auth.COOKIE) return false;
      try { token = decodeURIComponent(kv.slice(i + 1).trim()); } catch { token = ''; }
      return true;
    });
  }
  return !!auth.verifyToken(token);
}

function isBanned(ip) {
  const b = bans.get(ip);
  if (!b) return null;
  if (now() > b.until) { bans.delete(ip); return null; }
  return b;
}

function ban(ip, ms, reason) {
  bans.set(ip, { until: now() + ms, reason });
}

/** 手动解封：清掉封禁、蜜罐计数与该 IP 的所有连续违规计数 */
function unban(ip) {
  const removed = bans.delete(ip);
  trapHits.delete(ip);
  strikes.forEach((v, k) => {
    if (k === ip || k.startsWith(ip + '|')) strikes.delete(k);
  });
  return removed;
}

/** 当前生效的封禁列表，供管理端排查 */
function listBans() {
  const t = now();
  const out = [];
  bans.forEach((v, k) => {
    out.push({ ip: k, reason: v.reason, until: v.until, remainMs: Math.max(0, v.until - t) });
  });
  return out.sort((a, b) => a.until - b.until);
}

function hit(ip, cls, limit) {
  const key = ip + '|' + cls;
  const t = now();
  let e = counters.get(key);
  if (!e || t - e.start >= WINDOW_MS) {
    e = { start: t, n: 0 };
    counters.set(key, e);
  }
  e.n += 1;
  if (e.n <= limit) return { ok: true, remain: limit - e.n };
  return { ok: false, remain: 0, retryAfter: Math.ceil((e.start + WINDOW_MS - t) / 1000) };
}

/**
 * 请求前置检查。返回 null 表示放行，否则返回 {status, message, headers}
 */
function inspect(req, ctx) {
  const ip = ctx.ip;
  const ua = String(req.headers['user-agent'] || '');

  if (isExempt(ip)) return null;

  const b = isBanned(ip);
  // 已登录会话不受 IP 连坐：哪怕同 IP 上有个脚本踩了蜜罐，真人也照样能用
  if (b && !hasValidSession(req)) {
    return {
      status: 403,
      message: '请求被拒绝',
      headers: { 'Retry-After': String(Math.ceil((b.until - now()) / 1000)) }
    };
  }

  const isSearchBot = SEARCH_BOT.test(ua);
  const badUa = !isSearchBot && ua && BAD_UA.test(ua);
  if (!badUa) strikes.delete(ip + '|ua');   // 恢复正常 UA 就清零，别让旧账一直挂着
  if (badUa) {
    const k = ip + '|ua';
    const n = (strikes.get(k) || 0) + 1;
    strikes.set(k, n);
    if (n >= 3) { ban(ip, 60 * 60 * 1000, 'bad-ua'); strikes.delete(k); }
    return { status: 403, message: '请求被拒绝' };
  }

  const cls = ctx.cls || 'static';
  const r = hit(ip, cls, LIMITS[cls] || LIMITS.static);
  if (r.ok) {
    strikes.delete(ip + '|rate');
    return null;
  }

  // 同一 IP 在多个窗口都超限 → 直接封一段时间，别让他一点点磨
  const k = ip + '|rate';
  const s = (strikes.get(k) || 0) + 1;
  strikes.set(k, s);
  if (s >= 5) { ban(ip, ABUSE_BAN_MS, 'rate-abuse'); strikes.delete(k); }

  return {
    status: 429,
    message: '请求过于频繁，请稍后再试',
    headers: { 'Retry-After': String(r.retryAfter || 60) }
  };
}

/**
 * 蜜罐命中处置：一次误点只记录，窗口内反复命中才短封。
 * 返回 {hits, banned, ignored, threshold, banMs} 供日志与监控使用。
 */
function trap(ip, req) {
  const ua = String(((req && req.headers) || {})['user-agent'] || '');
  // 本机 / 白名单 / 搜索引擎 / 已登录用户：记下但不计数、不封
  if (isExempt(ip) || SEARCH_BOT.test(ua) || hasValidSession(req)) {
    return { hits: 0, banned: false, ignored: true };
  }

  const t = now();
  let e = trapHits.get(ip);
  if (!e || t - e.start >= TRAP_WINDOW_MS) {
    e = { start: t, n: 0 };
    trapHits.set(ip, e);
  }
  e.n += 1;
  if (e.n < TRAP_BAN_THRESHOLD) {
    return { hits: e.n, banned: false, threshold: TRAP_BAN_THRESHOLD };
  }
  ban(ip, BAN_MS, 'honeypot');
  trapHits.delete(ip);   // 解封后重新累计，不带着旧账继续封
  return { hits: e.n, banned: true, banMs: BAN_MS };
}

/** 定时清理，避免 Map 无限增长 */
const cleaner = setInterval(function () {
  const t = now();
  counters.forEach(function (v, k) { if (t - v.start > WINDOW_MS * 2) counters.delete(k); });
  bans.forEach(function (v, k) { if (t > v.until) bans.delete(k); });
  trapHits.forEach(function (v, k) { if (t - v.start > TRAP_WINDOW_MS * 2) trapHits.delete(k); });
  if (!counters.size && !bans.size) strikes.clear();
}, 60 * 1000);
cleaner.unref();

function stats() {
  return {
    banned: bans.size,
    tracked: counters.size,
    limits: LIMITS,
    trap: {
      hits: trapHits.size,
      windowMs: TRAP_WINDOW_MS,
      threshold: TRAP_BAN_THRESHOLD,
      banMs: BAN_MS
    },
    whitelist: WHITELIST.length
  };
}

module.exports = {
  inspect, trap, isBanned, ban, unban, listBans, stats,
  hasValidSession, BAD_UA, SEARCH_BOT
};
