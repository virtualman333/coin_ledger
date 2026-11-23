'use strict';
/**
 * 应用配置路由。
 *
 *   GET /api/app-config          公开：小程序冷启动读维护状态
 *   PUT /api/admin/app-config    管理员：开/关维护状态
 *
 * 「维护状态」开启后，小程序隐藏收藏账本相关入口（网站不受影响，
 * 网站本来就承载完整功能）。
 */
const config = require('../services/app-config.service');
const audit = require('../audit');
const { readBody, clientIP, badRequest } = require('../core/http');

module.exports = async function appConfigRoutes(app) {
  app.get('/api/app-config', async function readConfig(request, reply) {
    const maintenance = await config.getMaintenance(app);
    reply.send({ ok: true, maintenance });
  });

  app.put('/api/admin/app-config', { preHandler: app.requireAdmin }, async function writeConfig(request, reply) {
    const body = await readBody(request.raw, 4 * 1024);
    if (typeof body.maintenance !== 'boolean') throw badRequest('maintenance 必须是布尔值');
    const on = await config.setMaintenance(app, body.maintenance);
    audit.log(request.user.name, 'config.maintenance', on ? 'on' : 'off', '', clientIP(request.raw));
    reply.send({ ok: true, maintenance: on });
  });
};
