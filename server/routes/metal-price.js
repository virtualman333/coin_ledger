'use strict';
/**
 * 贵金属实时行情公开接口。
 *   GET /api/metal-price          金银铂钯 美元/盎司 + 汇率 + 元/克（缓存 10 分钟）
 *   GET /api/metal-price?force=1  强制刷新（仅供排障，仍受并发合并保护）
 */
module.exports = async function metalPriceRoutes(app) {
  app.get('/api/metal-price', async function metalPriceHandler(request, reply) {
    const q = request.query || {};
    const force = String((Array.isArray(q.force) ? q.force[0] : q.force) || '') === '1';
    const snap = await app.metalPrice.getQuotes(force);
    const quotes = {};
    Object.keys(snap.quotes).forEach(function (sym) {
      const x = snap.quotes[sym];
      quotes[sym] = {
        name: x.name,
        usdPerOz: x.usdOz,
        cnyPerGram: x.cnyPerGram,
        fallback: !!x.fallback
      };
    });
    reply.send({
      ok: true,
      troyOzGram: app.metalPrice.TROY_OZ_G,
      fx: snap.fx,
      fxFrom: 'USD/CNY',
      quotes: quotes,
      fetchedAt: snap.fetchedAt,
      stale: !!snap.stale
    });
  });
};
