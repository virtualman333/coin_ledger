'use strict';
/**
 * 管理端 · 反爬封禁路由（HTTP 层）。
 *
 *   GET  /api/admin/guard/bans   当前封禁列表 + 计数
 *   POST /api/admin/guard/unban  手动解封某个 IP
 *
 * 误伤时可自查、可解封，不必等封禁过期或重启服务。
 * 业务逻辑本身就在 server/guard.js，这里不做第三层包装。
 */
const guard = require('../../guard');
const audit = require('../../audit');
const { readBody, clientIP, badRequest } = require('../../core/http');

module.exports = async function adminGuardRoutes(app) {
  app.get('/api/admin/guard/bans', { preHandler: app.requireAdmin }, async function list(request, reply) {
    reply.send({ ok: true, bans: guard.listBans(), stats: guard.stats() });
  });

  app.post('/api/admin/guard/unban', { preHandler: app.requireAdmin }, async function unban(request, reply) {
    const body = await readBody(request.raw);
    const ip = String(body.ip || '').trim();
    if (!ip) throw badRequest('缺少 ip');
    const removed = guard.unban(ip);
    audit.log(request.user.name, 'guard.unban', ip, removed ? '已解封' : '未找到封禁', clientIP(request.raw));
    reply.send({ ok: true, removed });
  });
};
