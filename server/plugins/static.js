'use strict';
/**
 * 静态资源托管（public/）。
 *
 * 刻意不用 @fastify/static：现有静态层有五个必须逐字保留的行为，
 * 用插件反而要花更多代码去「关掉」它的默认值：
 *   1. ETag = W/"size-mtime"（十六进制），304 判定按 If-None-Match 字符串相等；
 *   2. /img/* 与 /assets/* → Cache-Control: public, max-age=604800（7 天强缓存），
 *      其余 → no-cache；
 *   3. /data/* 只允许本机访问（站点原料不允许被批量下载），其余 IP 403；
 *   4. 文件不存在 → 若是前端路由（/coin/12、/all…）回落注入好 meta 的 index.html，
 *      否则 404 纯文本；
 *   5. 非 GET/HEAD → 405 纯文本。
 *
 * 实现方式：onRequest 里接管所有非 /api 请求（reply.hijack + 直接写 reply.raw），
 * 函数体从 server/index.js 的 serveStatic 原样搬过来，一行逻辑没动。
 */
const fs = require('fs');
const path = require('path');
const url = require('url');
const fp = require('fastify-plugin');

const config = require('../config');
const pageRender = require('../legacy/page-render');
const { clientIP } = require('../legacy/api-handler');

const PUBLIC_DIR = config.PUBLIC_DIR;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.webp': 'image/webp',
  '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8'
};

/**
 * 静态文件响应（原样保留旧实现）。
 *
 * @param {import('http').IncomingMessage} req 原始请求
 * @param {import('http').ServerResponse} res 原始响应
 * @param {string} pathname 不含 query 的路径
 */
function serveStatic(req, res, pathname) {
  let rel = decodeURIComponent(pathname);
  if (rel === '/' || rel === '' || rel === '/index.html') { pageRender.sendIndex(res, { tab: 'home', i: null }); return; }
  // 数据文件是整个站点的原料，不允许被直接批量下载（前端走 /api/bootstrap）
  if (/^\/data\//.test(rel) && clientIP(req) !== '127.0.0.1' && clientIP(req) !== '::1') {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' }).end('403 Forbidden');
    return;
  }
  const filePath = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403).end('Forbidden');
    return;
  }
  fs.stat(filePath, (err, st) => {
    if (err || !st.isFile()) {
      // 没有对应文件 → 看看是不是前端路由（/coin/12、/all…），是就回注入好 meta 的首页
      const route = pageRender.spaRoute(rel);
      if (route) { pageRender.sendIndex(res, route); return; }
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('404 Not Found');
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    const etag = 'W/"' + st.size.toString(16) + '-' + st.mtimeMs.toString(16) + '"';
    if (req.headers['if-none-match'] === etag) { res.writeHead(304).end(); return; }
    const immutable = /^\/(img|assets)\//.test(rel);
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Content-Length': st.size,
      'ETag': etag,
      'Cache-Control': immutable ? 'public, max-age=604800' : 'no-cache',
      'X-Content-Type-Options': 'nosniff'
    });
    fs.createReadStream(filePath).pipe(res);
  });
}

module.exports = fp(async function staticPlugin(app) {
  app.addHook('onRequest', async function staticHook(request, reply) {
    const raw = request.raw;
    const { pathname } = url.parse(raw.url || '/');

    // /api/* 交给 routes/legacy（Fastify 路由层），静态层不插手
    if (pathname.startsWith('/api/')) return;

    reply.hijack();
    if (raw.method !== 'GET' && raw.method !== 'HEAD') {
      reply.raw.writeHead(405, { 'Content-Type': 'text/plain; charset=utf-8' }).end('405 Method Not Allowed');
      return;
    }
    serveStatic(raw, reply.raw, pathname);
  });
}, { name: 'cl-static' });

module.exports.serveStatic = serveStatic;
module.exports.MIME = MIME;
