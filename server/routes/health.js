'use strict';
/**
 * GET /api/health
 *
 * 进程存活与版本探针：部署脚本 curl 它就判断新版本是否真的起来了。
 * 响应体由 services/health.service 汇总，这里只负责挂路由。
 */
const healthService = require('../services/health.service');

module.exports = async function healthRoutes(app) {
  app.get('/api/health', async function healthHandler(request, reply) {
    reply.send(healthService.snapshot());
  });
};
