'use strict';
/**
 * HTTP 底层工具（core 层，零业务、零全局状态）。
 *
 * 这些函数原本长在 legacy/api-handler.js 里，被 plugins、routes、services 到处 require，
 * 于是「一个 1500 行的文件」变成了所有人的依赖。抽到 core 之后：
 *   - 请求体读取/限流、JSON 响应、客户端 IP、HTTPS 判定只在这里实现一份；
 *   - legacy 目录已删除，新代码不再依赖任何历史包袱。
 *
 * 约定：本层只处理 http.IncomingMessage / ServerResponse，不认识 store、不认识业务字段。
 */

/**
 * 构造一个带状态码的业务错误。
 *
 * 路由层不在每个 handler 里 try/catch：直接抛，由 plugins/errors 的
 * setErrorHandler 统一收敛成 `{ ok:false, error }`，与改造前 sendJSON 的响应体一致。
 *
 * @param {number} status HTTP 状态码
 * @param {string} message 错误文案（前端直接展示，必须是中文人话）
 * @param {object} [body] 需要额外并入响应体的字段（如 wxCode）
 * @returns {Error} 带 status / body 的错误
 */
function httpError(status, message, body) {
  const e = new Error(message);
  e.status = status;
  if (body) e.body = body;
  return e;
}

/**
 * 400 快捷方式（参数校验用，占绝大多数）。
 *
 * @param {string} message 错误文案
 * @returns {Error} status=400
 */
function badRequest(message) {
  return httpError(400, message);
}

/**
 * 直接向原生响应写 JSON（只给还没交给 Fastify 的路径用，如静态层/hijack 后的收尾）。
 *
 * @param {import('http').ServerResponse} res 原生响应
 * @param {number} status 状态码
 * @param {unknown} body 响应体
 * @param {Record<string,string>} [extraHeaders] 额外响应头
 * @returns {void}
 */
function sendJSON(res, status, body, extraHeaders) {
  const payload = JSON.stringify(body);
  res.writeHead(status, Object.assign({
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff'
  }, extraHeaders || {}));
  res.end(payload);
}

/**
 * 读取并解析 JSON 请求体。
 *
 * 为什么不交给 Fastify 解析：plugins/body 注册的是原始流透传解析器，各接口的
 * 体积上限不同（4KB ~ 13MB），由调用方显式传 limit 最直观，也保证了
 * 「空 body → {}」「非法 JSON → 400 请求体不是合法 JSON」这两条老契约。
 *
 * @param {import('http').IncomingMessage} req 原始请求
 * @param {number} [limit] 字节上限
 * @returns {Promise<object>} 解析后的对象
 */
function readBody(req, limit = 256 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { reject(badRequest('请求体过大')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch { reject(badRequest('请求体不是合法 JSON')); }
    });
    req.on('error', reject);
  });
}

/**
 * 取客户端 IP：优先 X-Forwarded-For 首个地址（nginx 反代场景），否则取 socket 地址。
 *
 * @param {import('http').IncomingMessage} req 原始请求
 * @returns {string} IP 文本
 */
function clientIP(req) {
  const xf = req.headers['x-forwarded-for'];
  if (xf) return String(xf).split(',')[0].trim();
  return req.socket.remoteAddress || '-';
}

/**
 * 判断当前请求是不是 HTTPS（用于决定会话 Cookie 要不要加 Secure）。
 *
 * @param {import('http').IncomingMessage} req 原始请求
 * @returns {boolean} 是否安全连接
 */
function isSecure(req) {
  if (req.socket.encrypted) return true;
  return String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https';
}

module.exports = {
  httpError: httpError,
  badRequest: badRequest,
  sendJSON: sendJSON,
  readBody: readBody,
  clientIP: clientIP,
  isSecure: isSecure
};
