'use strict';
/**
 * 拍照数币（纯图像算法，无 AI / 无第三方接口）。
 *
 *   POST /api/coin-count   登录；base64 图片 → 硬币数量 + 标注图
 *
 * 定位为「工具」：只数圆形亮斑的个数，不识别币种、不生成内容，
 * 规避个人主体小程序的深度合成类目红线。
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const config = require('../config');
const wxsec = require('../wxsec');
const legacy = require('../legacy/api-handler');
const coinCount = require('../services/coin-count.service');

const PUBLIC_DIR = config.PUBLIC_DIR;
const OUT_DIR = path.join(PUBLIC_DIR, 'collection');

module.exports = async function coinCountRoutes(app) {
  app.post('/api/coin-count', { preHandler: app.requireLogin }, async function (request, reply) {
    const me = request.user;
    // base64 图片最大 12MB（原图 ≤9MB）；body plugin 是 passthrough，必须读原始流
    const body = await legacy.readBody(request.raw, 13 * 1024 * 1024);
    const data = String(body.image || '');
    const m = /^data:image\/(jpeg|jpg|png|webp);base64,([A-Za-z0-9+/=]+)$/.exec(data);
    if (!m) return reply.code(400).send({ ok: false, error: '只支持 JPEG / PNG / WebP 图片' });
    const buf = Buffer.from(m[2], 'base64');
    if (!buf.length || buf.length > 9 * 1024 * 1024) {
      return reply.code(400).send({ ok: false, error: '图片不能超过 9MB' });
    }

    // 内容安全审核（失败按配置放行，见 wxsec）
    try {
      const chk = await wxsec.checkImage(buf, me.wxOpenid || '');
      if (chk && chk.ok === false) {
        return reply.code(400).send({ ok: false, error: '图片内容不合适，换一张吧' });
      }
    } catch (e) { /* 审核服务异常不阻断计数 */ }

    let result;
    try {
      result = coinCount.count(buf);
    } catch (e) {
      return reply.code(400).send({ ok: false, error: '图片解析失败，换一张清晰的照片' });
    }

    // 标注图落盘，供用户核对圈选是否正确
    let marked = '';
    try {
      const png = coinCount.annotate(result, buf);
      fs.mkdirSync(OUT_DIR, { recursive: true });
      const name = 'cnt-' + me.id + '-' + Date.now().toString(36) + '-' + crypto.randomBytes(3).toString('hex') + '.png';
      fs.writeFileSync(path.join(OUT_DIR, name), png);
      marked = '/collection/' + name;
    } catch (e) { marked = ''; }

    reply.send({
      ok: true,
      count: result.count,
      marked: marked,
      width: result.width,
      height: result.height,
      ms: result.ms
    });
  });

  /**
   * GET /api/coin-count/preview?f=cnt-xxx.png
   * 分享海报用的标注图缩略图（JPEG base64）。
   * 小程序画 canvas 取网络图要先过 downloadFile 合法域名，域名没配就画不出来；
   * 改成点「分享结果图」时按需取一次，客户端写本地临时文件，绕开域名依赖，
   * 也避免每次计数都多传几百 KB。
   */
  app.get('/api/coin-count/preview', { preHandler: app.requireLogin }, async function (request, reply) {
    const f = String((request.query && request.query.f) || '');
    if (!/^cnt-[A-Za-z0-9_-]{1,80}\.png$/.test(f)) {
      return reply.code(400).send({ ok: false, error: '参数不对' });
    }
    const file = path.join(OUT_DIR, f);
    if (!fs.existsSync(file)) {
      return reply.code(404).send({ ok: false, error: '标注图已过期，重新拍一张吧' });
    }
    try {
      const jpg = coinCount.previewJpeg(fs.readFileSync(file), 680, 76);
      reply.send({ ok: true, dataUrl: 'data:image/jpeg;base64,' + jpg.toString('base64') });
    } catch (e) {
      reply.code(400).send({ ok: false, error: '缩略图生成失败' });
    }
  });
};
