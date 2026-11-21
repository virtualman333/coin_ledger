'use strict';
/**
 * 反爬 / 限流前置检查（onRequest）。
 *
 * 完全复用 server/guard.js 的分级桶、蜜罐与封禁列表 —— 不引入 @fastify/rate-limit，
 * 因为那会改变 429 文案与阈值，直接违反 G2（契约零破坏）。
 *
 * 与改造前的等价关系（server/index.js 旧 createServer 回调）：
 *   1. res.setHeader('X-Frame-Options' / 'Referrer-Policy')
 *   2. cls 分类：login / adminWrite / read / write / static
 *   3. guard.inspect() 命中 → 原样输出 status + 头 + {"ok":false,"error":message}
 *
 * 之所以用 reply.hijack() 手写响应：命中限流时要先写 Retry-After 再断，
 * 只有直接写 reply.raw 才能保证头部集合与顺序与改造前一致。
 */
const url = require('url');
const fp = require('fastify-plugin');

const guard = require('../guard');
const { clientIP } = require('../core/http');

/**
 * 限流桶分类。逐字复刻 server/index.js 里的三元表达式：
 * 管理端批量保存会连发多次写请求，单独给更宽的桶，避免保存到一半被限流打断。
 *
 * 华为账号登录的「发起授权」和「用 code 换登录态」都算登录尝试，共用 login 桶
 * （防止有人拿别人的 code 反复试）。回跳本身走 read 桶：它有 state + 一次性 code
 * 兜底，且同一出口 IP 下可能有多个真人同时登录，压到 8/分钟容易误伤。
 *
 * @param {string} method HTTP 方法
 * @param {string} pathname 不含 query 的路径
 * @returns {'login'|'adminWrite'|'read'|'write'|'static'}
 */
function classify(method, pathname) {
  if (pathname === '/api/auth/login') return 'login';
  if (pathname === '/api/auth/huawei/start') return 'login';
  if (pathname === '/api/auth/huawei/login') return 'login';
  if (pathname.startsWith('/api/admin/') && method !== 'GET') return 'adminWrite';
  if (pathname.startsWith('/api/')) return method === 'GET' ? 'read' : 'write';
  return 'static';
}

module.exports = fp(async function securityPlugin(app) {
  app.decorate('guardClassify', classify);

  app.addHook('onRequest', async function securityHook(request, reply) {
    const raw = request.raw;
    const res = reply.raw;

    // 安全头由 Nginx 统一加，这里再加只作本地直跑兜底（与改造前一致）
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('Referrer-Policy', 'same-origin');

    const { pathname } = url.parse(raw.url || '/');
    const ip = clientIP(raw);
    const blocked = guard.inspect(raw, { ip: ip, cls: classify(raw.method, pathname) });
    if (!blocked) return;

    const heads = Object.assign({
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store'
    }, blocked.headers || {});

    reply.hijack();
    res.writeHead(blocked.status, heads);
    res.end(JSON.stringify({ ok: false, error: blocked.message }));
  });
}, { name: 'cl-security' });

module.exports.classify = classify;
