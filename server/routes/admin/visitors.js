'use strict';
/**
 * 管理端 · 访客路由（HTTP 层）。
 *
 *   GET /api/admin/visitors         统计（?client=web|mp|all&range=today|week|month|year|all）
 *   GET /api/admin/visitors/detail  明细（?ip= 或 ?sid=，同样吃 range）
 *
 * 公开埋点见 routes/visitors.js。
 */
const visitorService = require('../../services/visitor.service');

module.exports = async function adminVisitorRoutes(app) {
  app.get('/api/admin/visitors', { preHandler: app.requireAdmin }, async function stats(request, reply) {
    reply.send(visitorService.adminStats(request.query || {}));
  });

  app.get('/api/admin/visitors/detail', { preHandler: app.requireAdmin }, async function detail(request, reply) {
    reply.send(visitorService.adminDetail(request.query || {}));
  });
};
