'use strict';
/**
 * 管理端 · 系列（T03）
 *
 * POST   /api/admin/series/members
 * POST   /api/admin/series
 * POST   /api/admin/series/image
 * PATCH  /api/admin/series/:key
 * DELETE /api/admin/series/:key
 *
 * 语义重点（legacy 踩过的坑）：
 *   - members 是「整份替换」，一次请求完成增减，避免逐条 PATCH 被限流打断；
 *   - 主系列回填由 series.service 复刻，不能简化；
 *   - 卡图保存后要紧接着 series.update({img})，否则列表拿不到新图路径。
 */
const { readBody, clientIP } = require('../../core/http');
const audit = require('../../audit');
const seriesService = require('../../services/series.service');

/**
 * 组装服务。
 *
 * @param {import('fastify').FastifyInstance} app 实例
 * @returns {object} 服务
 */
function svc(app) {
  return seriesService.create({
    dataSource: app.dataSource,
    catalog: app.catalog,
    withTx: app.withTx
  });
}

module.exports = async function adminSeriesRoutes(app) {
  app.post('/api/admin/series/members', { preHandler: app.requireAdmin }, async function members(request, reply) {
    const body = await readBody(request.raw, 65536);
    const ip = clientIP(request.raw);
    const r = await svc(app).setMembers(body.key, body.ids, request.user.name, ip);
    if (!r.ok) { reply.code(400).send({ ok: false, error: r.error }); return; }
    reply.send({ ok: true, key: r.key, count: r.count, changed: r.changed, series: r.series });
  });

  app.post('/api/admin/series', { preHandler: app.requireAdmin }, async function create(request, reply) {
    const body = await readBody(request.raw, 16384);
    const ip = clientIP(request.raw);
    const r = await svc(app).create(body);
    if (!r.ok) { reply.code(400).send({ ok: false, error: r.error }); return; }
    console.log('[series] 新建系列 ' + r.item.key + ' ' + r.item.name);
    audit.log(request.user.name, 'series.create', r.item.key, r.item.name, ip);
    reply.send({ ok: true, item: r.item, items: r.items });
  });

  app.post('/api/admin/series/image', { preHandler: app.requireAdmin }, async function image(request, reply) {
    const body = await readBody(request.raw, 6 * 1024 * 1024);
    const ip = clientIP(request.raw);
    const key = String(body.key || '').trim();
    if (!key) { reply.code(400).send({ ok: false, error: '缺少系列 key' }); return; }

    const r = await svc(app).saveImage(key, body.data);
    if (!r.ok) { reply.code(400).send({ ok: false, error: r.error }); return; }
    await svc(app).update(key, { img: r.img });
    audit.log(request.user.name, 'series.image', key, r.img, ip);
    reply.send({ ok: true, img: r.img, items: await svc(app).listWithCount() });
  });

  app.patch('/api/admin/series/:key', { preHandler: app.requireAdmin }, async function update(request, reply) {
    const body = await readBody(request.raw, 16384);
    const ip = clientIP(request.raw);
    const key = String(request.params.key);
    const r = await svc(app).update(key, body);
    if (!r.ok) { reply.code(404).send({ ok: false, error: r.error }); return; }
    audit.log(request.user.name, 'series.update', key, JSON.stringify(body), ip);
    reply.send({ ok: true, item: r.item, items: r.items });
  });

  app.delete('/api/admin/series/:key', { preHandler: app.requireAdmin }, async function remove(request, reply) {
    const ip = clientIP(request.raw);
    const key = String(request.params.key);
    const r = await svc(app).remove(key, request.user.name, ip);
    if (!r.ok) { reply.code(404).send({ ok: false, error: r.error }); return; }
    console.log('[series] 删除系列 ' + key + '，清理成员 ' + r.touched + ' 个');
    reply.send({ ok: true, touched: r.touched, items: r.items });
  });
};
