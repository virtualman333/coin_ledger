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

  /**
   * GET /plaza —— 收藏广场已于 2026-11-22 整块下线。
   * 这个 tab 曾在导航里公开过，旧书签/外链不该吃 404，直接 301 回首页。
   */
  app.get('/plaza', async function legacyPlazaHandler(request, reply) {
    reply.hijack();
    reply.raw.writeHead(301, { Location: '/' }).end();
  });

  TABS.forEach(function (tab) {
    if (tab === 'home') return;   // '/' 已注册
    app.get('/' + tab, async function tabHandler(request, reply) {
      sendPage(reply, { tab: tab, i: null });
    });
  });

  /**
   * GET /pm/:code —— 贵金属单枚独立页（全量库 2823 条）。
   * 查库拿公告事实注入页面级 meta 与静态正文；查不到也让前端渲染可读空态。
   * 数据库连接异常不能把整页打成 500，降级为无 pmItem 的通用 meta。
   */
  app.get('/pm/:code', async function pmItemPageHandler(request, reply) {
    const code = String(request.params.code || '').toUpperCase();
    if (!/^[A-Za-z0-9_-]{1,32}$/.test(code)) {
      reply.hijack();
      reply.raw.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('404 Not Found');
      return;
    }
    let pmItem = null;
    try {
      const rows = await app.db.query(
        'SELECT raw, name, project_name, year, material, weight_g, face, max_mintage, quality FROM cl_ecgci_pm WHERE code = ? LIMIT 1',
        [code]);
      const r = rows && rows[0] && rows[0][0];
      if (r) {
        let raw = r.raw || {};
        if (typeof raw === 'string') { try { raw = JSON.parse(raw); } catch (e) { raw = {}; } }
        pmItem = {
          name: raw.name || r.name || code,
          projectName: raw.projectName || r.project_name || '',
          year: raw.projectYear || raw.year || r.year || '',
          material: raw.material || r.material || '',
          weight: raw.weight || r.weight_g || '',
          face: raw.denomination != null ? raw.denomination : r.face,
          fineness: raw.fineness || '',
          circulation: raw.circulation || r.max_mintage || '',
          quality: raw.quality || r.quality || '',
          castingUnit: raw.castingUnit || '',
          issuePrice: raw.initialPrice == null || raw.initialPrice === '' ? null : Number(raw.initialPrice),
          announce: raw.projectAnnounceName || raw.description || ''
        };
      }
    } catch (e) { /* 数据库不可用时降级，页面仍可打开 */ }
    reply.hijack();
    seo.sendPmItemIndex(reply.raw, { tab: 'pm', code: code, pmItem: pmItem });
  });

  app.get('/coin/:no', async function coinPageHandler(request, reply) {
    const no = Number(request.params.no);

    // 贵金属走独立 SSR 分支：只出公告事实与规格表，不拼接任何价格文字（arch 6.4）
    // draft 尚未核验上架，公开页面仍按不存在处理（404）—— 与公开 API 口径一致
    if (no >= 138) {
      const pmSvc = require('../services/pm.service').create({
        dataSource: app.dataSource,
        withTx: app.withTx
      });
      const pm = await pmSvc.findByNo(no);
      if (pm) {
        reply.hijack();
        if (pm.status !== 'published') {
          reply.raw.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('404 Not Found');
          return;
        }
        seo.sendPmIndex(reply.raw, pm);
        return;
      }
    }

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
