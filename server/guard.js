'use strict';
/**
 * 反爬 / 防刷：按 IP 的滑窗限流 + 可疑 UA 拦截 + 蜜罐封禁。
 *
 * 思路是「抬成本」而不是「绝对防住」：
 *   - 正常用户和搜索引擎不受影响
 *   - 脚本即使伪造 UA，也会被限流卡住吞吐
 *   - 踩到蜜罐链接的直接封 IP，这类请求 100% 不是人
 */

const WINDOW_MS = 60 * 1000;

// 每类请求每分钟的额度（单 IP）
const LIMITS = {
  read: Number(process.env.RL_READ || 120),    // 读接口
  write: Number(process.env.RL_WRITE || 30),   // 写接口
  adminWrite: Number(process.env.RL_ADMIN_WRITE || 300), // 管理端写（批量保存）
  login: Number(process.env.RL_LOGIN || 8),    // 登录尝试
  static: Number(process.env.RL_STATIC || 300) // 静态资源
};

const BAN_MS = Number(process.env.BAN_MS || 24 * 60 * 60 * 1000);   // 蜜罐封禁 24h
const ABUSE_BAN_MS = 10 * 60 * 1000;                                // 连续超限封 10 分钟

// 明显的脚本/自动化 UA。故意不收 'node'、'curl' 之外常见的库名冲突项，
// 也不收搜索引擎 UA（商业站点要靠它们收录）。
// 只收敛「脚本客户端独有的 UA」。HeadlessChrome / Puppeteer 这类不拦：
// 真爬虫都会伪装成普通 Chrome，拦它们拦不到人，反而误伤截图与预览工具。
const BAD_UA = /(python-requests|python-urllib|scrapy|aiohttp|httpx|requests-html|wget|libwww|httpclient|java\/|go-http-client|okhttp)/i;
// 搜索引擎放行（即使命中上面的规则也不能挡）
const SEARCH_BOT = /(baiduspider|googlebot|bingbot|sogouspider|360spider|bytespider|yisouspider|duckduckbot|applebot)/i;

const counters = new Map();   // "ip|cls" -> {start, n}
const bans = new Map();       // ip -> {until, reason}
const strikes = new Map();    // ip -> 连续超限次数

function now() { return Date.now(); }

// 本机（运维自检、健康检查）不走封禁逻辑，只受限流约束
function isLocalIp(ip) {
  return ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
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

  if (isLocalIp(ip)) return null;

  const b = isBanned(ip);
  if (b) {
    return {
      status: 403,
      message: '请求被拒绝',
      headers: { 'Retry-After': String(Math.ceil((b.until - now()) / 1000)) }
    };
  }

  const isSearchBot = SEARCH_BOT.test(ua);
  if (!isSearchBot && ua && BAD_UA.test(ua)) {
    const k = ip + '|ua';
    const n = (strikes.get(k) || 0) + 1;
    strikes.set(k, n);
    if (n >= 3) ban(ip, 60 * 60 * 1000, 'bad-ua');   // 连续 3 次才封，避免误伤配置错误的正常工具
    return { status: 403, message: '请求被拒绝' };
  }

  const cls = ctx.cls || 'static';
  const r = hit(ip, cls, LIMITS[cls] || LIMITS.static);
  if (r.ok) {
    if (strikes.has(ip)) strikes.delete(ip);
    return null;
  }

  // 同一 IP 在多个窗口都超限 → 直接封一段时间，别让他一点点磨
  const s = (strikes.get(ip) || 0) + 1;
  strikes.set(ip, s);
  if (s >= 5) ban(ip, ABUSE_BAN_MS, 'rate-abuse');

  return {
    status: 429,
    message: '请求过于频繁，请稍后再试',
    headers: { 'Retry-After': String(r.retryAfter || 60) }
  };
}

/** 蜜罐：命中即封 */
function trap(ip) {
  ban(ip, BAN_MS, 'honeypot');
  return { ok: true };
}

/** 定时清理，避免 Map 无限增长 */
const cleaner = setInterval(function () {
  const t = now();
  counters.forEach(function (v, k) { if (t - v.start > WINDOW_MS * 2) counters.delete(k); });
  bans.forEach(function (v, k) { if (t > v.until) bans.delete(k); });
  if (!counters.size && !bans.size) strikes.clear();
}, 60 * 1000);
cleaner.unref();

function stats() {
  return { banned: bans.size, tracked: counters.size, limits: LIMITS };
}

module.exports = { inspect, trap, isBanned, ban, stats, BAD_UA, SEARCH_BOT };
