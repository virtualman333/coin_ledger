'use strict';
/**
 * 蜜罐路由。
 *
 * `/api/__trap` 只作诱饵：正常前端永远不会请求它，扫描器会。
 * 一次误点只记录，反复命中才短封（阈值与封禁时长见 server/guard.js）。
 *
 * 响应故意与「接口不存在」一致，不向扫描器泄漏这是蜜罐。
 */
const guard = require('../guard');
const { clientIP } = require('../core/http');

module.exports = async function honeypotRoutes(app) {
  app.all('/api/__trap', async function trap(request, reply) {
    const ip = clientIP(request.raw);
    const t = guard.trap(ip, request.raw);
    const detail = t.ignored ? '可信来源，忽略'
      : t.banned ? `第 ${t.hits} 次，已封禁 ${t.banMs}ms`
        : `第 ${t.hits} 次，未达阈值 ${t.threshold}`;
    console.log(`[guard] 蜜罐命中 ${ip}：${detail}`);
    reply.code(404).type('application/json; charset=utf-8').send({ ok: false, error: '接口不存在' });
  });
};
