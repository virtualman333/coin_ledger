'use strict';
/**
 * 兜底路由（最后注册）。
 *
 * 到这里说明前面所有原生路由都没匹配上：
 *   - /api/*   → 404 `{ok:false,error:'接口不存在'}`（与 setNotFoundHandler 同文案）
 *   - 非 /api  → 交给 SEO 渲染做 SPA 回落；非 GET/HEAD 一律 405 纯文本
 *
 * 历史说明：这里早先是「绞杀者」模式的委托点，把未迁移的 30 个接口原样转给
 * legacy/api-handler.js。那份 1566 行的处理器已经拆完删除，现在只剩这段纯兜底，
 * 不再持有任何业务逻辑 —— 新增接口请按域写进 routes/<域>.js。
 */
const url = require('url');

const seo = require('../services/seo');

module.exports = async function fallbackRoutes(app) {
  app.all('/*', async function fallback(request, reply) {
    const { pathname } = url.parse(request.raw.url || '/');

    if (pathname.startsWith('/api/')) {
      reply.code(404).type('application/json; charset=utf-8').send({ ok: false, error: '接口不存在' });
      return;
    }

    reply.hijack();
    if (request.raw.method !== 'GET' && request.raw.method !== 'HEAD') {
      reply.raw.writeHead(405, { 'Content-Type': 'text/plain; charset=utf-8' }).end('405 Method Not Allowed');
      return;
    }
    const route = seo.spaRoute(pathname);
    if (route) { seo.sendIndex(reply.raw, route); return; }
    reply.raw.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('404 Not Found');
  });
};
