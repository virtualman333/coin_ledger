'use strict';
/**
 * 反馈域路由（HTTP 层，用户侧）。
 *
 *   POST /api/feature-request  提交功能建议（登录，每天 3 条）
 *   GET  /api/feedback/mine    我的反馈与回复（登录）
 *   POST /api/feedback         提交纠错反馈，可带 3 张图（登录，每天 10 条）
 *
 * 管理端处理见 routes/admin/feedback.js。
 */
const feedbackService = require('../services/feedback.service');
const { readBody } = require('../core/http');

module.exports = async function feedbackRoutes(app) {
  app.post('/api/feature-request', { preHandler: app.requireLogin }, async function featureRequest(request, reply) {
    const body = await readBody(request.raw, 8192);
    reply.send(await feedbackService.submitFeature(request.user, body));
  });

  app.get('/api/feedback/mine', { preHandler: app.requireLogin }, async function mine(request, reply) {
    reply.send(feedbackService.mine(request.user));
  });

  app.post('/api/feedback', { preHandler: app.requireLogin }, async function submit(request, reply) {
    // 3 张 base64 图，原 handler 给到 8MB
    const body = await readBody(request.raw, 8 * 1024 * 1024);
    reply.send(await feedbackService.submitCorrection(request.user, body));
  });
};
