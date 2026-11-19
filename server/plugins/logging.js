'use strict';
/**
 * 访问日志：单行 `ISO METHOD PATH STATUS ms IP`，与改造前逐字一致。
 *
 * 为什么同时挂 onRequest(raw finish) + onResponse：
 *   - legacy 兜底路由与静态层都走 reply.hijack()，Fastify 认为响应「不是它发的」，
 *     onResponse 不触发 —— 只能监听 reply.raw 的 'finish'；
 *   - Fastify 原生路由（/api/health）走正常 send，onResponse 一定到。
 * 两条路径共用一个 writeLine，靠 reply.__accessLogged 去重，保证**每请求恰好一行**。
 */
const url = require('url');
const fp = require('fastify-plugin');

const { clientIP } = require('../legacy/api-handler');

module.exports = fp(async function loggingPlugin(app) {
  /**
   * 输出一行访问日志（幂等）。
   * @param {import('fastify').FastifyRequest} request 请求
   * @param {import('fastify').FastifyReply} reply 响应
   */
  function writeLine(request, reply) {
    if (reply.__accessLogged) return;
    reply.__accessLogged = true;
    const ms = Date.now() - (reply.__startedAt || Date.now());
    const pathname = url.parse(request.raw.url || '/').pathname;
    const ip = clientIP(request.raw);
    console.log(`${new Date().toISOString()} ${request.raw.method} ${pathname} ${reply.raw.statusCode} ${ms}ms ${ip}`);
  }

  app.addHook('onRequest', async function accessStart(request, reply) {
    reply.__startedAt = Date.now();
    reply.__accessLogged = false;
    // hijack 路径不会触发 onResponse，靠 raw 的 finish 兜底
    reply.raw.once('finish', function onRawFinish() { writeLine(request, reply); });
  });

  app.addHook('onResponse', async function accessEnd(request, reply) {
    writeLine(request, reply);
  });

  app.decorate('writeAccessLine', writeLine);
}, { name: 'cl-logging' });
