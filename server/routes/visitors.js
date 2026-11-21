'use strict';
/**
 * 访客域路由（HTTP 层，公开埋点）。
 *
 *   POST /api/visit  记一次访问（匿名，不存 IP 原文以外的身份信息）
 *   GET  /api/visit  访问总量（页脚展示）
 *
 * 管理端统计/明细见 routes/admin/visitors.js。
 */
const visitorService = require('../services/visitor.service');
const { readBody } = require('../core/http');

module.exports = async function visitorRoutes(app) {
  app.post('/api/visit', async function record(request, reply) {
    // 兼容旧版前端（不带 body）：解析失败按空对象处理，总数照记
    let body = {};
    try { body = await readBody(request.raw, 4096); } catch (e) { body = {}; }
    reply.send(await visitorService.record(request.raw, body));
  });

  app.get('/api/visit', async function totals(request, reply) {
    reply.send(visitorService.totals());
  });
};
