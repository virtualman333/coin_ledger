'use strict';
/**
 * GET /api/bootstrap（T03 迁移第 2 号接口）
 *
 * 目录六件套从 catalog.service 取，用户域三件套仍从 store/auth 取 —— 这正是
 * 绞杀者阶段该有的边界：目录归目录，账号归账号，互不串层。
 *
 * 契约红线：
 *   · 顶层键顺序与 legacy buildBootstrap 完全一致（快照按 JSON.stringify 取摘要）；
 *   · coins 必须是 `no ASC`，**绝不**用 CATALOG_ORDER_SQL（R2 唯一例外）；
 *   · 每项无 est 覆盖时必须复用同一个对象引用，键序逐字不变。
 *
 * 零漂移已由 T02 的 catalog.service.legacyCoins/legacySeriesMap/legacySetsMap
 * 保证（json 模式直接取 coins.json 原对象）；本路由只负责按旧顺序拼装。
 */
const store = require('../store');
const auth = require('../auth');
const config = require('../config');
const imageService = require('../services/image.service');

module.exports = async function bootstrapRoutes(app) {
  app.get('/api/bootstrap', async function bootstrapHandler(request, reply) {
    const d = store.load();
    const me = auth.currentUser(request.raw, d);
    const prices = d.prices || {};

    const part = await app.catalog.buildBootstrap({
      imgSet: imageService.listImageNos(),
      prices: prices
    });

    reply.send({
      version: config.VERSION,
      rev: d.rev || 0,
      serverTime: new Date().toISOString(),
      user: auth.publicUser(me),
      isAdmin: !!(me && me.role === 'admin'),
      coins: part.coins,
      series: part.series,
      sets: part.sets,
      defaults: part.defaults,
      holdings: me && Array.isArray(d.holdings[me.id]) ? d.holdings[me.id] : [],
      imgSet: part.imgSet,
      imgReal: part.imgReal,
      gallery: part.gallery,
      galleryVer: part.galleryVer,
      plan: part.plan,
      seriesMeta: part.seriesMeta,
      desc: part.desc,
      userCount: d.users.length
    });
  });
};
