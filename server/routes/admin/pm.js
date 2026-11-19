'use strict';
/**
 * 管理端 · 贵金属录入（T04，arch 4.3 新增接口）
 *
 * GET    /api/admin/pm?status=draft|published|
 * POST   /api/admin/pm                     新建（默认 draft）
 * PATCH  /api/admin/pm/:no                 编辑
 * PUT    /api/admin/pm/:no/pieces          整份替换套内规格（事务）
 * POST   /api/admin/pm/:no/status          上下架（未 verified 不允许 publish）
 * DELETE /api/admin/pm/:no                 删除草稿（no>=138 且 draft）
 *
 * 字段级错误统一 `{ok:false,error,field}`（schemas/pm.js 给出 field）。
 * routes 只解析参数、记录审计，规则与事务都在 pm.service / schemas/pm.js。
 */
const legacy = require('../../legacy/api-handler');
const audit = require('../../audit');
const pmService = require('../../services/pm.service');

/**
 * 组装服务。
 *
 * @param {import('fastify').FastifyInstance} app 实例
 * @returns {object} 服务
 */
function svc(app) {
  return pmService.create({ dataSource: app.dataSource, withTx: app.withTx });
}

/**
 * 把 service 结果写成响应；4xx 带 field。
 *
 * @param {import('fastify').FastifyReply} reply 响应
 * @param {object} r service 结果
 * @param {number} [okStatus] 成功状态码
 * @returns {void}
 */
function send(reply, r, okStatus) {
  if (!r.ok) { reply.code(400).send({ ok: false, error: r.error, field: r.field || '' }); return; }
  reply.code(okStatus || 200).send(r);
}

module.exports = async function adminPmRoutes(app) {
  app.get('/api/admin/pm', { preHandler: app.requireAdmin }, async function list(request, reply) {
    const q = request.query || {};
    const status = q.status === 'draft' || q.status === 'published' ? q.status : '';
    const items = await svc(app).listByStatus(status);
    reply.send({ ok: true, items: items, total: items.length });
  });

  app.post('/api/admin/pm', { preHandler: app.requireAdmin }, async function create(request, reply) {
    const body = await legacy.readBody(request.raw, 2 * 1024 * 1024);
    const r = await svc(app).create(body);
    if (r.ok) audit.log(request.user.name, 'pm.create', String(r.row.no), r.row.name, legacy.clientIP(request.raw));
    send(reply, r);
  });

  app.patch('/api/admin/pm/:no', { preHandler: app.requireAdmin }, async function update(request, reply) {
    const no = Number(request.params.no);
    const body = await legacy.readBody(request.raw, 2 * 1024 * 1024);
    const r = await svc(app).update(no, body);
    if (r.ok) audit.log(request.user.name, 'pm.update', String(no), JSON.stringify(body).slice(0, 200), legacy.clientIP(request.raw));
    send(reply, r);
  });

  app.put('/api/admin/pm/:no/pieces', { preHandler: app.requireAdmin }, async function pieces(request, reply) {
    const no = Number(request.params.no);
    const body = await legacy.readBody(request.raw, 4 * 1024 * 1024);
    const r = await svc(app).replacePieces(no, Array.isArray(body.pieces) ? body.pieces : body);
    if (r.ok) audit.log(request.user.name, 'pm.pieces', String(no), r.count + ' 行规格', legacy.clientIP(request.raw));
    send(reply, r);
  });

  app.post('/api/admin/pm/:no/status', { preHandler: app.requireAdmin }, async function status(request, reply) {
    const no = Number(request.params.no);
    const body = await legacy.readBody(request.raw, 4096);
    const next = body.status === 'published' ? 'published' : 'draft';
    const r = await svc(app).setStatus(no, next);
    if (r.ok) audit.log(request.user.name, next === 'published' ? 'pm.publish' : 'pm.unpublish', String(no), '', legacy.clientIP(request.raw));
    send(reply, r);
  });

  app.delete('/api/admin/pm/:no', { preHandler: app.requireAdmin }, async function remove(request, reply) {
    const no = Number(request.params.no);
    const r = await svc(app).remove(no);
    if (r.ok) audit.log(request.user.name, 'pm.delete', String(no), '', legacy.clientIP(request.raw));
    send(reply, r.ok ? { ok: true } : { ok: false, error: r.error });
  });
};
