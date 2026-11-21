'use strict';
/**
 * 请求体处理。
 *
 * 关键约束：各接口的请求体上限差别极大（4KB 的登录 → 13MB 的批量算号），
 * 而且历史上就是这么卡的。如果 Fastify 先把 body 解析掉，路由层就再也读不到
 * 原始流（已 ended），也没法按接口自己的 limit 拒绝。
 *
 * 所以这里**不做 JSON 解析**：注册一个 `*` 通配解析器，把原始可读流原样交回，
 * 路由层用 core/http 的 readBody(raw, limit) 自己读。Fastify 因此不会消费请求体，
 * 也不会因为「没有对应 content-type 的解析器」而回 415。契约：
 *   - 空 body → readBody 返回 {}；
 *   - 非法 JSON → 400 {"ok":false,"error":"请求体不是合法 JSON"}；
 *   - 超限 → 400 {"ok":false,"error":"请求体过大"}（由各路由自己的 limit 决定）。
 */
const fp = require('fastify-plugin');

/**
 * 把「未解析的请求体」规整成 JSON 对象：空 body 一律给 {}（兼容老前端 POST 不带 body）。
 * 给后续原生路由复用，避免每个 handler 各写一遍 try/catch。
 *
 * @param {unknown} raw Buffer / string / 已经解析好的对象
 * @returns {object} 解析结果
 * @throws {Error} status=400，文案与 legacy readBody 一致
 */
function parseJsonBody(raw) {
  if (raw === undefined || raw === null) return {};
  if (Buffer.isBuffer(raw)) {
    if (!raw.length) return {};
    try {
      return JSON.parse(raw.toString('utf8'));
    } catch (e) {
      const err = new Error('请求体不是合法 JSON');
      err.status = 400;
      throw err;
    }
  }
  if (typeof raw === 'string') {
    if (!raw.trim()) return {};
    try {
      return JSON.parse(raw);
    } catch (e) {
      const err = new Error('请求体不是合法 JSON');
      err.status = 400;
      throw err;
    }
  }
  if (typeof raw === 'object') return raw;
  return {};
}

module.exports = fp(async function bodyPlugin(app) {
  app.removeAllContentTypeParsers();

  // 三参数形态：payload 是原始流，不读它就不会被消费
  app.addContentTypeParser('*', function rawPassthroughParser(request, payload, done) {
    done(null, payload);
  });

  app.decorate('parseJsonBody', parseJsonBody);
}, { name: 'cl-body' });

module.exports.parseJsonBody = parseJsonBody;
