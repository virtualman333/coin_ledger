'use strict';
/**
 * 统一错误出口。
 *
 * 契约（arch 第 10 节）：
 *   - 错误体永远是 { ok: false, error: string }；
 *   - 未匹配的 /api/* 返回 404 {"ok":false,"error":"接口不存在"}
 *     —— 必须是这句中文，不能是 Fastify 默认的 {"message":"Route ... not found"}；
 *   - 5xx 打一行 [error]，与改造前的 console.error('[error]', e) 一致。
 *
 * 注意：legacy 路由内部自己 try/catch 并 sendJSON，走不到这里；
 * 这里覆盖的是 Fastify 原生路由（health 已注册为原生路由）与框架级异常。
 */
const fp = require('fastify-plugin');

const NOT_FOUND_BODY = { ok: false, error: '接口不存在' };

module.exports = fp(async function errorsPlugin(app) {
  app.setNotFoundHandler(function notFoundHandler(request, reply) {
    reply
      .code(404)
      .type('application/json; charset=utf-8')
      .header('Cache-Control', 'no-store')
      .send(Object.assign({}, NOT_FOUND_BODY));
  });

  app.setErrorHandler(function errorHandler(err, request, reply) {
    const status = Number(err.statusCode || err.status || 500) || 500;
    if (status >= 500) console.error('[error]', err);

    // 已经开始往 socket 写（legacy 的 hijack 路径）时只能收尾，不能重写头
    if (reply.raw.headersSent || reply.sent) {
      try { reply.raw.end(); } catch (e) { /* 连接可能已断 */ }
      return;
    }

    // 413：请求体超限。legacy 用 400 + '请求体过大'，原生路由上线后按语义给 413，
    // 文案保持中文，避免前端拿到英文堆栈。
    let message = err.message || '服务器错误';
    if (err.code === 'FST_ERR_CTP_BODY_TOO_LARGE' || status === 413) message = '请求体过大';
    if (err.code === 'FST_ERR_CTP_INVALID_MEDIA_TYPE' || status === 415) message = '请求体不是合法 JSON';

    reply
      .code(status === 415 ? 400 : status)
      .type('application/json; charset=utf-8')
      .header('Cache-Control', 'no-store')
      .send({ ok: false, error: message });
  });
}, { name: 'cl-errors' });
