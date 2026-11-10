'use strict';
/**
 * 微信内容安全检测。
 *
 * 小程序里允许用户提交文字与图片（纠错反馈），微信要求这类 UGC 必须过内容安全接口，
 * 否则审核按「用户生成内容未经审核」拒。这里封装两个同步接口：
 *   msg_sec_check  文本（v2）
 *   img_sec_check  图片（multipart，单张 < 1MB —— 客户端上传前已压缩）
 *
 * access_token 有配额（2000 次/天/接口 左右）且 2 小时过期，这里做内存缓存，
 * 提前 5 分钟过期，失败时清空缓存重取一次。
 *
 * 任何接口异常都**不阻断业务**：返回 { ok: true, skipped: reason }，
 * 只记录日志 —— 内容安全服务抖动时不该让用户完全无法反馈。
 */
const https = require('https');

const APPID = process.env.WX_APPID || 'wx905c4968911fa23d';
const SECRET = process.env.WX_APPSECRET || '';

let cache = { token: '', exp: 0 };
let pending = null;

function request(options, body) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, (r) => {
      let raw = '';
      r.setEncoding('utf8');
      r.on('data', (c) => { raw += c; });
      r.on('end', () => {
        try { resolve({ status: r.statusCode, json: JSON.parse(raw) }); }
        catch (e) { reject(new Error('微信返回无法解析：' + raw.slice(0, 120))); }
      });
    });
    req.on('error', reject);
    req.setTimeout(8000, () => req.destroy(new Error('内容安全接口超时')));
    if (body) req.write(body);
    req.end();
  });
}

function getToken(force) {
  if (!SECRET) return Promise.resolve('');
  const now = Date.now();
  if (!force && cache.token && cache.exp > now) return Promise.resolve(cache.token);
  if (pending) return pending;                       // 并发只取一次
  const url = 'https://api.weixin.qq.com/cgi-bin/token?grant_type=client_credential'
    + '&appid=' + encodeURIComponent(APPID) + '&secret=' + encodeURIComponent(SECRET);
  pending = request({ method: 'GET', hostname: 'api.weixin.qq.com', path: url.replace('https://api.weixin.qq.com', '') })
    .then((r) => {
      const j = r.json || {};
      if (!j.access_token) throw new Error('取 access_token 失败：' + (j.errmsg || j.errcode || 'unknown'));
      cache = { token: j.access_token, exp: Date.now() + Math.max(60, (j.expires_in || 7200) - 300) * 1000 };
      return cache.token;
    })
    .finally(() => { pending = null; });
  return pending;
}

/** 文本检测。suggest: pass / review / risky；review 也按不通过处理（审核口径偏保守） */
async function checkText(content, openid) {
  const text = String(content || '').trim();
  if (!text) return { ok: true };
  const token = await getToken().catch((e) => { console.warn('[wxsec] ' + e.message); return ''; });
  if (!token) return { ok: true, skipped: 'no-token' };

  async function post(tk, payload) {
    const body = JSON.stringify(payload);
    return request({
      method: 'POST',
      hostname: 'api.weixin.qq.com',
      path: '/wxa/msg_sec_check?access_token=' + encodeURIComponent(tk),
      headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) },
    }, body).catch((e) => ({ json: { errcode: -1, errmsg: e.message } }));
  }

  // v2 需要真实 openid；密码注册的账号没有 openid，会报 40003，此时退回 v1（不需要 openid）
  const v2 = { content: text, version: 2, scene: 1 };
  if (openid) v2.openid = openid;
  let r = await post(token, v2);

  if (r.json && (r.json.errcode === 40001 || r.json.errcode === 42001)) {
    const fresh = await getToken(true).catch(() => '');
    if (fresh) r = await post(fresh, v2);
  }
  if (r.json && (r.json.errcode === 40003 || r.json.errcode === 40002)) {
    r = await post(token, { content: text });
  }

  const j = r.json || {};
  if (j.errcode === 87014) return { ok: false, reason: 'text-risky' };
  const suggest = j.result && j.result.suggest;
  if (suggest === 'risky' || suggest === 'review') return { ok: false, reason: 'text-' + suggest };
  if (j.errcode && j.errcode !== 0) {
    console.warn('[wxsec] 文本检测异常 errcode=' + j.errcode + ' ' + (j.errmsg || ''));
    return { ok: true, skipped: 'api-error-' + j.errcode };
  }
  return { ok: true };
}

/** 图片检测：multipart/form-data，字段名 media，单张 < 1MB */
async function checkImage(buf) {
  if (!buf || !buf.length) return { ok: true };
  if (buf.length > 1024 * 1024) return { ok: true, skipped: 'too-big' };  // 客户端已压缩，超限则跳过
  const token = await getToken().catch((e) => { console.warn('[wxsec] ' + e.message); return ''; });
  if (!token) return { ok: true, skipped: 'no-token' };

  const boundary = '----coinledger' + Date.now().toString(16);
  const head = Buffer.from(
    '--' + boundary + '\r\n'
    + 'Content-Disposition: form-data; name="media"; filename="check.jpg"\r\n'
    + 'Content-Type: application/jpeg\r\n\r\n');
  const tail = Buffer.from('\r\n--' + boundary + '--\r\n');
  const body = Buffer.concat([head, buf, tail]);

  const r = await request({
    method: 'POST',
    hostname: 'api.weixin.qq.com',
    path: '/wxa/img_sec_check?access_token=' + encodeURIComponent(token),
    headers: {
      'content-type': 'multipart/form-data; boundary=' + boundary,
      'content-length': body.length,
    },
  }, body).catch((e) => ({ json: { errcode: -1, errmsg: e.message } }));

  const j = r.json || {};
  if (j.errcode === 87014) return { ok: false, reason: 'image-risky' };
  if (j.errcode && j.errcode !== 0) {
    console.warn('[wxsec] 图片检测异常 errcode=' + j.errcode + ' ' + (j.errmsg || ''));
    return { ok: true, skipped: 'api-error-' + j.errcode };
  }
  return { ok: true };
}

module.exports = { checkText, checkImage, getToken };
