'use strict';
/**
 * 页面路由（T03）：把 SPA 的真实路径交给 Fastify 路由表，渲染交给 services/seo.js。
 *
 * 铁律：这里**不重写任何渲染逻辑**。seo.js 是 legacy/page-render.js 的原样搬迁，
 * title / description / canonical / og / JSON-LD / 静态正文块一字未改，
 * 141 个 URL 的 HTML 与基线逐字相同（npm run snapshot:check 会证）。
 *
 * 未命中这些路径的请求（静态文件、/sitemap.xml、未知路径）仍由 plugins/static
 * 的 onRequest 接管；static 通过 seo.isRoutePath() 让路给本文件注册的路由。
 */
const seo = require('../services/seo');

/** SPA tab（与 seo.SPA_TABS 同源，不在这里另写一份） */
const TABS = ['home', 'plan', 'overview', 'series', 'holdings', 'cost', 'all', 'sitemap', 'account', 'admin'];

/**
 * hijack 后直接写原始响应（seo.sendIndex 内部写的是 ServerResponse）。
 *
 * @param {import('fastify').FastifyReply} reply Fastify 响应
 * @param {object} route {tab,i}
 * @returns {void}
 */
function sendPage(reply, route) {
  reply.hijack();
  seo.sendIndex(reply.raw, route);
}

module.exports = async function seoRoutes(app) {
  app.get('/', async function homeHandler(request, reply) {
    sendPage(reply, { tab: 'home', i: null });
  });

  TABS.forEach(function (tab) {
    if (tab === 'home') return;   // '/' 已注册
    app.get('/' + tab, async function tabHandler(request, reply) {
      sendPage(reply, { tab: tab, i: null });
    });
  });

  app.get('/coin/:no', async function coinPageHandler(request, reply) {
    const route = seo.spaRoute('/coin/' + String(request.params.no));
    if (!route) {
      // 越界页码：legacy 的 serveStatic 回 404 纯文本，保持一致
      reply.hijack();
      reply.raw.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('404 Not Found');
      return;
    }
    sendPage(reply, route);
  });
};

module.exports.TABS = TABS;
