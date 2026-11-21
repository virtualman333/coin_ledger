'use strict';
/**
 * 管理端 · 图片（T03）
 *
 * POST   /api/admin/gallery  —— kind 白名单 + 文件存在校验 + gallery_ver 刷新
 * POST   /api/admin/image    —— 6MB bodyLimit + 480/160 缩略图 + gallery_ver 刷新
 * DELETE /api/admin/image?id=&kind= —— 主图连带清 th/ 与 th/s/
 *
 * 响应状态与错误文案由 image.service 返回，route 只负责 reply.code/send。
 */
const { readBody, clientIP } = require('../../core/http');
const imageService = require('../../services/image.service');

/**
 * 组装服务。
 *
 * @param {import('fastify').FastifyInstance} app 实例
 * @returns {object} 服务
 */
function svc(app) {
  return imageService.create({ dataSource: app.dataSource, withTx: app.withTx });
}

module.exports = async function adminImageRoutes(app) {
  app.post('/api/admin/gallery', { preHandler: app.requireAdmin }, async function gallery(request, reply) {
    const body = await readBody(request.raw, 32768);
    const r = await svc(app).saveGallery(body, request.user.name, clientIP(request.raw));
    reply.code(r.status).send(r.body);
  });

  // 6MB：与 legacy readBody(req, 6*1024*1024) 同口径（T01 body 插件不消费流）
  app.post('/api/admin/image', { preHandler: app.requireAdmin, bodyLimit: 6 * 1024 * 1024 }, async function upload(request, reply) {
    const body = await readBody(request.raw, 6 * 1024 * 1024);
    const r = await svc(app).upload(body, request.user.name, clientIP(request.raw));
    reply.code(r.status).send(r.body);
  });

  app.delete('/api/admin/image', { preHandler: app.requireAdmin }, async function remove(request, reply) {
    const r = await svc(app).remove(request.query, request.user.name, clientIP(request.raw));
    reply.code(r.status).send(r.body);
  });
};
