'use strict';
/**
 * 预约提醒域路由（HTTP 层）。
 *
 *   GET    /api/reminders  我的提醒 + 订阅模板
 *   POST   /api/reminders  新增/更新（需要已绑定微信）
 *   DELETE /api/reminders  取消（按 id 或 key）
 *
 * 三个都要登录。定时推送本身在 server/reminders.js，与 HTTP 无关。
 */
const reminderService = require('../services/reminder.service');
const { readBody } = require('../core/http');

module.exports = async function reminderRoutes(app) {
  app.get('/api/reminders', { preHandler: app.requireLogin }, async function list(request, reply) {
    reply.send(reminderService.list(request.user));
  });

  app.post('/api/reminders', { preHandler: app.requireLogin }, async function create(request, reply) {
    const body = await readBody(request.raw, 4096);
    reply.send(reminderService.create(request.user, body));
  });

  app.delete('/api/reminders', { preHandler: app.requireLogin }, async function cancel(request, reply) {
    const body = await readBody(request.raw, 4096);
    reply.send(reminderService.cancel(request.user, body));
  });
};
