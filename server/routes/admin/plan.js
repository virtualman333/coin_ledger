'use strict';
/**
 * 管理端 · 发行计划（T03）
 *
 * GET /api/admin/plan  → {ok,plan}
 * PUT /api/admin/plan  → {ok,years,items}；整份替换在 plan.service 的一个事务里完成
 *
 * 保存后 bootstrap 立即生效：json 模式同步更新 legacy 内存 PLAN；
 * db 模式 repo 的 mtime/checksum 缓存按 cl_meta['catalog.rev'] 失效。
 */
const legacy = require('../../legacy/api-handler');
const planService = require('../../services/plan.service');

module.exports = async function adminPlanRoutes(app) {
  app.get('/api/admin/plan', { preHandler: app.requireAdmin }, async function get(request, reply) {
    const svc = planService.create({ dataSource: app.dataSource, withTx: app.withTx });
    reply.send({ ok: true, plan: await svc.get() });
  });

  app.put('/api/admin/plan', { preHandler: app.requireAdmin }, async function put(request, reply) {
    const body = await legacy.readBody(request.raw, 512 * 1024);
    const svc = planService.create({ dataSource: app.dataSource, withTx: app.withTx });
    const r = await svc.replace(body, request.user.name, legacy.clientIP(request.raw));
    reply.code(r.ok ? 200 : 400).send(r);
  });
};
