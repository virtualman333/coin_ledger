'use strict';
/**
 * 管理端 · 反馈路由（HTTP 层）。
 *
 *   GET    /api/admin/feedback        列表（?status=open|done|all）
 *   PATCH  /api/admin/feedback/:id    标记完成 / 重新打开 / 回复
 *   DELETE /api/admin/feedback/:id    删除
 *
 * 用户侧提交见 routes/feedback.js。
 */
const feedbackService = require('../../services/feedback.service');
const { readBody, clientIP } = require('../../core/http');

module.exports = async function adminFeedbackRoutes(app) {
  app.get('/api/admin/feedback', { preHandler: app.requireAdmin }, async function list(request, reply) {
    reply.send(feedbackService.adminList(request.query || {}));
  });

  app.patch('/api/admin/feedback/:id', { preHandler: app.requireAdmin }, async function patchOne(request, reply) {
    const body = await readBody(request.raw, 4096);
    reply.send(feedbackService.adminPatch(request.user, request.params.id, body, clientIP(request.raw)));
  });

  app.delete('/api/admin/feedback/:id', { preHandler: app.requireAdmin }, async function remove(request, reply) {
    reply.send(feedbackService.adminRemove(request.user, request.params.id, clientIP(request.raw)));
  });
};
