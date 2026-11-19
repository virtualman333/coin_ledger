'use strict';
/**
 * GET /api/health
 *
 * T01：注册成 Fastify 原生路由，但**输出仍由老处理器产生** —— 逐字一致优先。
 * 这样做的额外好处是路由表里有一条真路由，`tools/api-snapshot.js` 能验证
 * 「静态路由优先于 /* 通配」这条装配假设确实成立。
 *
 * T03 会换成 catalog.service / account.service 的分层实现，
 * 届时允许新增 catalog 子对象（arch 4.1 第 1 条），但 ok/version/uptime/coins/... 必须保留。
 */
const { delegateToLegacy } = require('./legacy');

module.exports = async function healthRoutes(app) {
  app.get('/api/health', async function healthHandler(request, reply) {
    return delegateToLegacy(request, reply);
  });
};
