'use strict';
/**
 * 收藏增强接口（Web / 小程序 / 鸿蒙共用）。
 *
 *   POST /api/serial/analyze       号码分析（无需登录）
 *   POST /api/serial/analyze-batch 批量分析 + 连号识别
 *   POST /api/holding/image        收藏图片上传（登录，base64 落盘，≤3 张由 holdings 白名单约束）
 *
 * 原「收藏广场」(/api/shares、/api/following) 已于 2026-11-22 整块下线，
 * 这里只保留与单条收藏相关的能力，路由名不再叫 plaza。
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const config = require('../config');
const wxsec = require('../wxsec');
const serial = require('../serial');
const { readBody } = require('../core/http');

const PUBLIC_DIR = config.PUBLIC_DIR;
const COLLECTION_DIR = path.join(PUBLIC_DIR, 'collection');

module.exports = async function holdingsExtraRoutes(app) {
  /* ---------------- 号码分析 ---------------- */
  app.post('/api/serial/analyze', async function (request, reply) {
    const body = await readBody(request.raw, 16 * 1024);
    const no = String(body.no == null ? '' : body.no).slice(0, 32);
    reply.send(Object.assign({ ok: true }, serial.analyze(no)));
  });

  app.post('/api/serial/analyze-batch', async function (request, reply) {
    const body = await readBody(request.raw, 64 * 1024);
    const list = Array.isArray(body.nos) ? body.nos.slice(0, 200) : [];
    const r = serial.analyzeBatch(list);
    reply.send({ ok: true, items: r.items, runs: r.runs });
  });

  /* ---------------- 收藏图片上传 ---------------- */
  app.post('/api/holding/image', { preHandler: app.requireLogin }, async function (request, reply) {
    const me = request.user;
    const body = await readBody(request.raw, 3 * 1024 * 1024);
    const data = String(body.image || '');
    const m = /^data:image\/(jpeg|jpg|png|webp);base64,([A-Za-z0-9+/=]+)$/.exec(data);
    if (!m) return reply.code(400).send({ ok: false, error: '只支持 JPEG / PNG / WebP' });
    const buf = Buffer.from(m[2], 'base64');
    if (!buf.length || buf.length > 2 * 1024 * 1024) {
      return reply.code(400).send({ ok: false, error: '图片不能超过 2MB' });
    }
    // 内容安全审核（失败时按配置放行，见 wxsec）
    const chk = await wxsec.checkImage(buf, me.wxOpenid || '');
    if (chk && chk.ok === false) {
      return reply.code(400).send({ ok: false, error: '图片内容不合适，换一张吧' });
    }
    const ext = m[1] === 'png' ? 'png' : (m[1] === 'webp' ? 'webp' : 'jpg');
    fs.mkdirSync(COLLECTION_DIR, { recursive: true });
    const name = me.id + '-' + Date.now().toString(36) + '-' + crypto.randomBytes(3).toString('hex') + '.' + ext;
    fs.writeFileSync(path.join(COLLECTION_DIR, name), buf);
    reply.send({ ok: true, path: '/collection/' + name });
  });
};
