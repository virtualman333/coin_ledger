'use strict';
/**
 * 贵金属行情公开接口（后端每小时只更新一次，前端拿到的都是本小时缓存）。
 *   GET /api/metal-price          金银铂钯 美元/盎司 + 汇率 + 元/克（小时级缓存，持久化到 data/metal-price-cache.json）
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
      hourKey: snap.hourKey,
      stale: !!snap.stale
    });
  });
};
