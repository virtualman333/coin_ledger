'use strict';
/**
 * 认证装饰与守卫。
 *
 * T01 阶段所有请求仍然由 legacy/api-handler 自己调 requireLogin/requireAdmin，
 * 所以这里**不挂全局 hook**（挂上去等于每个请求多一次 store 读取，行为也变了）。
 * 它的作用是给 T03 起的原生路由提供同一套语义：
 *
 *   app.requireLogin  → preHandler：未登录 401 {"ok":false,"error":"请先登录","needLogin":true}
 *   app.requireAdmin  → preHandler：未登录 401（同上），非管理员 403 {"ok":false,"error":"需要管理员权限"}
 *
 * 文案与 server/index.js 的 requireLogin / requireAdmin 完全相同，快照会比对。
 */
const fp = require('fastify-plugin');

const store = require('../store');
const auth = require('../auth');

module.exports = fp(async function authPlugin(app) {
  app.decorateRequest('user', null);
  app.decorateRequest('isAdmin', false);

  /**
   * 从原始请求解析当前用户（会话 Cookie 或 Bearer）。
   * 与 legacy 的 auth.currentUser(req, store.load()) 同一实现，只是包了一层 try/catch：
   * MySQL 模式下若 store 尚未 init 完，这里返回 null 而不是把 500 抛给用户。
   *
   * @param {import('http').IncomingMessage} rawReq 原始请求
   * @returns {object|null} 用户文档；未登录/已禁用/无会话时为 null
   */
  function currentUser(rawReq) {
    try {
      return auth.currentUser(rawReq, store.load());
    } catch (e) {
      return null;
    }
  }

  app.decorate('currentUser', currentUser);

  /** 未登录就 401；登录了就挂到 request.user 上 */
  app.decorate('requireLogin', async function requireLogin(request, reply) {
    const me = currentUser(request.raw);
    if (!me) {
      reply.code(401).send({ ok: false, error: '请先登录', needLogin: true });
      return reply;
    }
    request.user = me;
    request.isAdmin = me.role === 'admin';
    return undefined;
  });

  /** 先要登录，再要管理员 */
  app.decorate('requireAdmin', async function requireAdmin(request, reply) {
    const me = currentUser(request.raw);
    if (!me) {
      reply.code(401).send({ ok: false, error: '请先登录', needLogin: true });
      return reply;
    }
    if (me.role !== 'admin') {
      reply.code(403).send({ ok: false, error: '需要管理员权限' });
      return reply;
    }
    request.user = me;
    request.isAdmin = true;
    return undefined;
  });
}, { name: 'cl-auth' });
