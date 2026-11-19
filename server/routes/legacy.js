'use strict';
/**
 * 过渡期兜底路由。
 *
 * 绞杀者模式的核心：T01 只有 Fastify 接管了进程与生命周期，
 * 业务仍然全部走 legacy/api-handler（原 handleApi，一行未改）。
 * 因此「上线即零变化」是可验证的（tools/api-snapshot.js 比对 50 接口 + 141 URL）。
 *
 * 委托方式：reply.hijack() + 直接调 legacy.handleApi(req.raw, reply.raw, pathname)。
 * 为什么不用 reply.send() 承载结果：老处理器自己 writeHead/res.end，
 * 交出控制权才能保证头部（ETag、Set-Cookie、Retry-After）与状态码逐字一致。
 */
const url = require('url');

const legacy = require('../legacy/api-handler');
const pageRender = require('../legacy/page-render');

/**
 * 把当前 Fastify 请求交给老处理器，并把异常收敛成与改造前一致的错误响应。
 *
 * @param {import('fastify').FastifyRequest} request Fastify 请求
 * @param {import('fastify').FastifyReply} reply Fastify 响应（会被 hijack）
 * @returns {Promise<void>} 处理完成
 */
async function delegateToLegacy(request, reply) {
  const raw = request.raw;
  const res = reply.raw;
  const { pathname } = url.parse(raw.url || '/');
  reply.hijack();
  try {
    await legacy.handleApi(raw, res, pathname);
  } catch (e) {
    const status = e.status || 500;
    if (status >= 500) console.error('[error]', e);
    if (!res.headersSent) legacy.sendJSON(res, status, { ok: false, error: e.message || '服务器错误' });
    else res.end();
  }
}

module.exports = async function legacyRoutes(app) {
  /**
   * 兜底：所有未被原生路由匹配的请求。
   * 非 /api 的请求正常情况下已经在 plugins/static 的 onRequest 里被接管，
   * 走到这里的非 /api 分支只可能是 hook 之后的异常路径，按 404 纯文本收尾。
   */
  app.all('/*', async function legacyCatchAll(request, reply) {
    const { pathname } = url.parse(request.raw.url || '/');
    if (pathname.startsWith('/api/')) return delegateToLegacy(request, reply);

    reply.hijack();
    if (request.raw.method !== 'GET' && request.raw.method !== 'HEAD') {
      reply.raw.writeHead(405, { 'Content-Type': 'text/plain; charset=utf-8' }).end('405 Method Not Allowed');
      return;
    }
    const route = pageRender.spaRoute(pathname);
    if (route) { pageRender.sendIndex(reply.raw, route); return; }
    reply.raw.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('404 Not Found');
  });
};

module.exports.delegateToLegacy = delegateToLegacy;
