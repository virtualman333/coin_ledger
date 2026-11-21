'use strict';
/**
 * 管理端 · 用户域路由（HTTP 层）。
 *
 *   GET    /api/admin/users              列表（分页/搜索/角色/状态/排序）
 *   GET    /api/admin/audit              审计日志
 *   POST   /api/admin/users/batch        批量标记测试/禁用/启用/删除
 *   GET    /api/admin/users/:id          用户详情
 *   PATCH  /api/admin/users/:id          改角色/测试标记/禁用
 *   DELETE /api/admin/users/:id          删除账号
 *   GET    /api/admin/users/:id/holdings 某用户持仓明细
 *
 * 全部挂在 app.requireAdmin 之下；业务约束（不能动自己、最后一个管理员）在 service 层。
 */
const usersService = require('../../services/admin-users.service');
const { readBody, clientIP } = require('../../core/http');

module.exports = async function adminUsersRoutes(app) {
  app.get('/api/admin/users', { preHandler: app.requireAdmin }, async function list(request, reply) {
    reply.send(usersService.list(request.query || {}));
  });

  app.get('/api/admin/audit', { preHandler: app.requireAdmin }, async function auditLog(request, reply) {
    reply.send(usersService.auditLog(request.query || {}));
  });

  // 静态段优先于 :id，写在这里只是让人一眼看出批量和单条的先后关系
  app.post('/api/admin/users/batch', { preHandler: app.requireAdmin }, async function batch(request, reply) {
    const body = await readBody(request.raw, 16384);
    reply.send(await usersService.batch(request.user, body, clientIP(request.raw)));
  });

  app.get('/api/admin/users/:id', { preHandler: app.requireAdmin }, async function one(request, reply) {
    reply.send(usersService.one(request.params.id));
  });

  app.get('/api/admin/users/:id/holdings', { preHandler: app.requireAdmin }, async function holdings(request, reply) {
    reply.send(usersService.holdingsOf(request.params.id));
  });

  app.patch('/api/admin/users/:id', { preHandler: app.requireAdmin }, async function patchOne(request, reply) {
    const body = await readBody(request.raw, 4096);
    reply.send(await usersService.patchOne(request.user, request.params.id, body, clientIP(request.raw)));
  });

  app.delete('/api/admin/users/:id', { preHandler: app.requireAdmin }, async function remove(request, reply) {
    reply.send(await usersService.remove(request.user, request.params.id, clientIP(request.raw)));
  });
};
