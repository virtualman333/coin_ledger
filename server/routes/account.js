'use strict';
/**
 * 账本域路由（HTTP 层）。
 *
 *   GET  /api/state            当前用户 + 全局 rev/行情
 *   PUT  /api/holdings         整份保存持仓（登录）
 *   POST /api/holdings/reset   重置为默认持仓（登录）
 *   PUT  /api/prices           更新全局行情（管理员）
 *
 * 与原来的区别只有一处：不再从 route 里伸手拿 store 做业务判断，
 * 校验与落库全在 services/account.service.js。
 */
const accountService = require('../services/account.service');
const { readBody } = require('../core/http');

module.exports = async function accountRoutes(app) {
  app.get('/api/state', async function state(request, reply) {
    reply.send(accountService.state(request.raw));
  });

  app.put('/api/holdings', { preHandler: app.requireLogin }, async function saveHoldings(request, reply) {
    const body = await readBody(request.raw);
    reply.send(await accountService.saveHoldings(request.user.id, body.holdings));
  });

  app.post('/api/holdings/reset', { preHandler: app.requireLogin }, async function resetHoldings(request, reply) {
    reply.send(await accountService.resetHoldings(request.user.id));
  });

  app.put('/api/prices', { preHandler: app.requireAdmin }, async function setPrices(request, reply) {
    const body = await readBody(request.raw);
    reply.send(await accountService.setPrices(body.prices));
  });
};
