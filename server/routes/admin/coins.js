'use strict';
/**
 * 管理端 · 品种参数（T03）
 *
 * GET  /api/admin/coins  —— {ok,coins,series,sets,gallery}
 * PATCH /api/admin/coins —— {ok,saved,failed:[{id,error}]}，300 条上限
 * PATCH /api/admin/coin  —— {ok,coin,applied}
 *
 * 鉴权用 plugins/auth 的 requireAdmin preHandler：401/403 文案与 legacy 一致。
 * routes 只做参数解析与 service 调用，写规则全在 coin.service。
 */
const { readBody, clientIP } = require('../../core/http');
const audit = require('../../audit');
const coinService = require('../../services/coin.service');

/**
 * 组装服务。
 *
 * @param {import('fastify').FastifyInstance} app 实例
 * @returns {object} 服务
 */
function svc(app) {
  return coinService.create({ dataSource: app.dataSource, catalog: app.catalog, withTx: app.withTx });
}

module.exports = async function adminCoinRoutes(app) {
  app.get('/api/admin/coins', { preHandler: app.requireAdmin }, async function list(request, reply) {
    reply.send(await svc(app).adminList());
  });

  app.patch('/api/admin/coins', { preHandler: app.requireAdmin }, async function batch(request, reply) {
    const body = await readBody(request.raw, 512 * 1024);
    const result = await svc(app).batchPatch(body, request.user.name, clientIP(request.raw));
    reply.code(result.status).send(result.body);
  });

  app.patch('/api/admin/coin', { preHandler: app.requireAdmin }, async function one(request, reply) {
    const body = await readBody(request.raw, 16384);
    const result = await svc(app).patchOne(body, request.user.name, clientIP(request.raw));
    reply.code(result.status).send(result.body);
  });
};
