'use strict';
/**
 * 华为账号登录（Account Kit / OAuth 2.0 授权码模式）。
 *
 * 只做协议层：拼授权页地址、用 authorizationCode 换 access_token、解析凭证拿
 * OpenID/UnionID。**不碰业务、不碰账号表** —— 建号与绑定在
 * services/huawei-account.service.js，便于单测时不发网络请求。
 *
 * 安全口径（与微信登录一致）：
 *   - client_secret 只从环境变量读，绝不返回给客户端、不写日志、不入库；
 *   - 客户端（网页 / 鸿蒙）只递交 authorizationCode，换 token 一律在服务端做；
 *   - 身份标识以 getTokenInfo 返回的 open_id 为准 —— 这是华为服务端在 HTTPS 上
 *     直接给出的结果，比解析 id_token 更不容易被伪造；
 *   - id_token 只用来补昵称/头像（展示用），解析失败就当没有，绝不参与身份判定。
 *
 * 华为侧接口（2026-11 官方文档）：
 *   授权页  GET  {base}/oauth2/v3/authorize
 *   换 token POST {base}/oauth2/v3/token
 *   凭证解析 POST {base}/rest.php?nsp_fmt=JSON&nsp_svc=huawei.oauth2.user.getTokenInfo
 *   头像昵称 POST {accountBase}/rest.php?nsp_svc=GOpen.User.getInfo
 */
const crypto = require('crypto');
const https = require('https');

const config = require('./config');

const STATE_TTL_MS = 10 * 60 * 1000;      // 授权页停留 10 分钟足够，过时就要求重来
const HTTP_TIMEOUT_MS = 8000;

/** 配置不全时所有对外能力都应该关掉，而不是拼出一个半残的授权地址 */
function enabled() {
  return !!config.HUAWEI.enabled;
}

function base() {
  return String(config.HUAWEI.oauthBase || 'https://oauth-login.cloud.huawei.com').replace(/\/+$/, '');
}

/** 头像昵称走的是帐号域（不是 oauth-login），两个域名要分开拼 */
function accountBase() {
  return String(config.HUAWEI.accountBase || 'https://account.cloud.huawei.com').replace(/\/+$/, '');
}

/** OAuth 失败统一带上 HTTP 状态与华为原始错误码，路由层据此决定回什么文案 */
class HuaweiError extends Error {
  constructor(message, status, code) {
    super(message);
    this.name = 'HuaweiError';
    this.status = status || 502;
    this.code = code || 0;
  }
}

/* ---------------- HTTP ---------------- */

/**
 * 发一个 application/x-www-form-urlencoded 请求。
 * 不引第三方 HTTP 库：项目只依赖 fastify + mysql2，多一个 axios 只为两次请求不值。
 *
 * @param {string} pathAndQuery 以 / 开头的路径（含 query）
 * @param {object} form 表单字段
 * @returns {Promise<{status:number, json:object}>} 已解析的响应
 */
function postForm(pathAndQuery, form) {
  const body = new URLSearchParams(form).toString();
  const target = new URL(pathAndQuery, base());

  return new Promise((resolve, reject) => {
    const req = https.request({
      method: 'POST',
      hostname: target.hostname,
      port: target.port || 443,
      path: target.pathname + target.search,
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(body),
        Accept: 'application/json'
      },
      timeout: HTTP_TIMEOUT_MS
    }, (res) => {
      let raw = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { raw += c; });
      res.on('end', () => {
        let json = {};
        if (raw.trim()) {
          try { json = JSON.parse(raw); }
          catch (e) {
            return reject(new HuaweiError('华为账号服务返回了无法解析的内容', 502));
          }
        }
        resolve({ status: res.statusCode || 0, json: json });
      });
    });

    req.on('timeout', () => req.destroy(new HuaweiError('华为账号服务响应超时', 504)));
    req.on('error', (e) => {
      if (e instanceof HuaweiError) return reject(e);
      reject(new HuaweiError('连不上华为账号服务，请稍后重试', 502));
    });
    req.write(body);
    req.end();
  });
}

/* ---------------- 授权页 ---------------- */

/**
 * 生成防 CSRF 的 state。格式 nonce.exp.mode.sig，exp 为毫秒时间戳。
 * mode 只有 login / bind 两种：授权页回来时要区分「登录」还是「给已登录账号绑定」，
 * 否则用户点绑定会被当成登录，把当前会话换成另一个账号。
 * 签名密钥优先用 SESSION_SECRET（与登录会话同一把），没配则用进程内随机值 ——
 * 后者意味着进程重启会让正在授权中的用户失败，可接受（窗口只有 10 分钟）。
 */
const STATE_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');

function b64u(buf) {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * @param {string} nonce 随机串
 * @param {number} exp 过期时间戳
 * @param {string} [mode] login | bind；不传按旧格式（3 段）签名
 * @returns {string} base64url 签名
 */
function signState(nonce, exp, mode) {
  const payload = mode ? nonce + '.' + exp + '.' + mode : nonce + '.' + exp;
  return b64u(crypto.createHmac('sha256', STATE_SECRET).update(payload).digest());
}

/**
 * @param {'login'|'bind'} [mode] 授权完成后的动作
 * @returns {{state:string, exp:number, mode:string}} 本次授权要带出去并写进 Cookie 的值
 */
function newState(mode) {
  const m = mode === 'bind' ? 'bind' : 'login';
  const nonce = crypto.randomBytes(16).toString('hex');
  const exp = Date.now() + STATE_TTL_MS;
  return { state: nonce + '.' + exp + '.' + m + '.' + signState(nonce, exp, m), exp: exp, mode: m };
}

/**
 * 校验 state 的签名与有效期。回调里还要与 Cookie 里那份逐字比对，
 * 单靠这里只能证明「是我们签发的」，证明不了「是同一个浏览器发起的」。
 *
 * 兼容 3 段旧格式（nonce.exp.sig，等价于 mode=login）—— 升级部署时
 * 可能还有用户停在授权页上，别让人家白点一次。
 *
 * @param {string} state 华为回跳带回的 state
 * @returns {{ok:boolean, mode:string, reason?:string}}
 */
function verifyState(state) {
  const s = String(state || '');
  const parts = s.split('.');

  if (parts.length === 3) {
    const [nonce, expStr, sig] = parts;
    const exp = Number(expStr);
    if (!nonce || !Number.isFinite(exp)) return { ok: false, mode: 'login', reason: 'malformed' };
    if (!sameSig(signState(nonce, exp), sig)) return { ok: false, mode: 'login', reason: 'bad-signature' };
    if (Date.now() > exp) return { ok: false, mode: 'login', reason: 'expired' };
    return { ok: true, mode: 'login' };
  }

  if (parts.length !== 4) return { ok: false, mode: 'login', reason: 'malformed' };
  const [nonce, expStr, mode, sig] = parts;
  const exp = Number(expStr);
  if (!nonce || !Number.isFinite(exp) || (mode !== 'login' && mode !== 'bind')) {
    return { ok: false, mode: 'login', reason: 'malformed' };
  }
  if (!sameSig(signState(nonce, exp, mode), sig)) return { ok: false, mode: 'login', reason: 'bad-signature' };
  if (Date.now() > exp) return { ok: false, mode: mode, reason: 'expired' };
  return { ok: true, mode: mode };
}

/** 定长比较，避免时序侧信道 */
function sameSig(expectB64, actualB64) {
  const a = Buffer.from(String(expectB64));
  const b = Buffer.from(String(actualB64));
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/**
 * 拼授权页地址。
 * @param {{state:string, scope?:string, redirectUri?:string}} opts
 * @returns {string} 浏览器直接跳转的 URL
 */
function authorizeUrl(opts) {
  const o = opts || {};
  const q = new URLSearchParams({
    response_type: 'code',
    access_type: 'offline',
    client_id: config.HUAWEI.clientId,
    redirect_uri: o.redirectUri || config.HUAWEI.redirectUri,
    scope: o.scope || config.HUAWEI.scope,
    state: String(o.state || '')
  });
  return base() + '/oauth2/v3/authorize?' + q.toString();
}

/* ---------------- 换 token / 取身份 ---------------- */

/**
 * 用授权码换 access_token（以及 id_token）。
 * 网页流程必须回传与授权时完全一致的 redirect_uri；鸿蒙客户端流程没有回跳地址，
 * 传空即不带该参数 —— 华为对客户端签发的 code 允许这样换。
 *
 * @param {string} code authorizationCode
 * @param {string} [redirectUri] 仅网页流程需要
 * @returns {Promise<{accessToken:string, idToken:string, scope:string}>}
 */
async function exchangeCode(code, redirectUri) {
  if (!enabled()) throw new HuaweiError('华为账号登录未配置', 503);
  const form = {
    grant_type: 'authorization_code',
    code: String(code || ''),
    client_id: config.HUAWEI.clientId,
    client_secret: config.HUAWEI.clientSecret
  };
  if (redirectUri) form.redirect_uri = redirectUri;

  const r = await postForm('/oauth2/v3/token', form);
  const j = r.json || {};
  if (r.status !== 200 || !j.access_token) {
    console.warn('[huawei] token 交换失败 status=' + r.status
      + ' error=' + (j.error || '') + ' desc=' + (j.error_description || ''));
    // 授权码一次性且 5 分钟过期，失败绝大多数是「已用过 / 已过期」
    throw new HuaweiError('登录凭证已失效，请重新点击华为账号登录',
      r.status === 400 ? 400 : 502, j.error || 0);
  }
  return {
    accessToken: String(j.access_token),
    idToken: String(j.id_token || ''),
    scope: String(j.scope || '')
  };
}

/**
 * 获取头像昵称（可选增强，失败不影响登录）。
 *
 * POST {accountBase}/rest.php?nsp_svc=GOpen.User.getInfo
 *   access_token=xxx&getNickName=1
 *
 * getNickName 必须传 1，否则拿到的是「182******74」这种匿名化账号；
 * 即使传 1，用户没设昵称时仍会回落匿名账号，靠 displayNameFlag=1 区分。
 * 头像 headPictureURL 是华为 CDN 外链，用户换头像后旧地址立即失效 ——
 * 所以只当展示用，本站上传的头像（avatar）永远优先。
 *
 * @param {string} accessToken
 * @returns {Promise<{openId:string, unionId:string, nickname:string, avatar:string}>}
 */
async function getUserInfo(accessToken) {
  const r = await postForm(accountBase() + '/rest.php?nsp_svc=GOpen.User.getInfo', {
    access_token: String(accessToken || ''),
    getNickName: '1'
  });
  const j = r.json || {};
  if (r.status !== 200 || (!j.openID && !j.open_id)) {
    console.warn('[huawei] getUserInfo 失败 status=' + r.status
      + ' error=' + (j.error || '') + ' desc=' + (j.error_description || ''));
    throw new HuaweiError('获取华为账号资料失败', 502, j.error || 0);
  }

  let nickname = String(j.displayName || '').trim();
  const anonymous = Number(j.displayNameFlag) === 1 || /\*{2,}/.test(nickname);
  if (anonymous) nickname = '';   // 匿名化手机号不做昵称，交给建号逻辑生成「同好XXXX」

  let avatar = String(j.headPictureURL || '').trim();
  if (!/^https:\/\//i.test(avatar)) avatar = '';

  return {
    openId: String(j.openID || j.open_id || ''),
    unionId: String(j.unionID || j.union_id || ''),
    nickname: nickname.slice(0, 32),
    avatar: avatar.slice(0, 512)
  };
}

/**
 * 解析 access_token，拿 OpenID / UnionID。
 * 文档要求带 open_id=OPENID 才会返回 open_id 字段。
 * getUserInfo 已经同时回了 openID/unionID，这里只是它失败时的兜底通道。
 *
 * @param {string} accessToken
 * @returns {Promise<{openId:string, unionId:string, scope:string}>}
 */
async function getTokenInfo(accessToken) {
  const r = await postForm('/rest.php?nsp_fmt=JSON&nsp_svc=huawei.oauth2.user.getTokenInfo', {
    access_token: String(accessToken || ''),
    open_id: 'OPENID'
  });
  const j = r.json || {};
  if (r.status !== 200 || !j.open_id) {
    console.warn('[huawei] getTokenInfo 失败 status=' + r.status
      + ' error=' + (j.error || '') + ' desc=' + (j.error_description || ''));
    throw new HuaweiError('华为账号信息校验失败，请重试', 502, j.error || 0);
  }
  return {
    openId: String(j.open_id),
    unionId: String(j.union_id || ''),
    scope: String(j.scope || '')
  };
}

/**
 * 只做 payload 解码，**不验签**。
 * 用途仅限把 id_token 里的 display_name / picture 当默认昵称与头像的来源，
 * 身份仍以 getTokenInfo 的 open_id 为准。解不出来就返回空对象。
 *
 * @param {string} idToken JWT
 * @returns {{nickname:string, avatar:string}}
 */
function profileFromIdToken(idToken) {
  const parts = String(idToken || '').split('.');
  if (parts.length < 2) return { nickname: '', avatar: '' };
  let payload = {};
  try {
    const json = Buffer.from(parts[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
    payload = JSON.parse(json);
  } catch (e) {
    return { nickname: '', avatar: '' };
  }
  const nickname = String(payload.display_name || payload.name || payload.nickname || '').trim();
  const avatar = String(payload.picture || payload.head_picture_url || '').trim();
  return { nickname: nickname.slice(0, 32), avatar: avatar };
}

/**
 * 由授权码一步拿到可入库的身份信息。
 *
 * 顺序有讲究：
 *   1. getUserInfo 一次拿到 openID/unionID/昵称/头像（有 profile scope 才有昵称头像）；
 *   2. 它挂了就退回 getTokenInfo，只保证身份（登录不能因为拿不到昵称就失败）；
 *   3. id_token 只做默认昵称的最后兜底，解不出来也无所谓。
 *
 * @param {string} code authorizationCode
 * @param {{redirectUri?:string}} [opts]
 * @returns {Promise<{openId:string, unionId:string, nickname:string, avatar:string, scope:string}>}
 */
async function resolveIdentity(code, opts) {
  const token = await exchangeCode(code, opts && opts.redirectUri);

  let openId = '';
  let unionId = '';
  let nickname = '';
  let avatar = '';
  let scope = token.scope;

  try {
    const info = await getUserInfo(token.accessToken);
    openId = info.openId;
    unionId = info.unionId;
    nickname = info.nickname;
    avatar = info.avatar;
  } catch (e) {
    console.warn('[huawei] 头像昵称接口不可用，退回只校验身份：' + e.message);
  }

  if (!openId) {
    const info = await getTokenInfo(token.accessToken);
    openId = info.openId;
    unionId = unionId || info.unionId;
    scope = info.scope || scope;
  }

  if (!nickname || !avatar) {
    const extra = profileFromIdToken(token.idToken);
    if (!nickname) nickname = extra.nickname;
    if (!avatar) avatar = extra.avatar;
  }

  return { openId, unionId, nickname, avatar, scope };
}

module.exports = {
  enabled,
  signState,
  newState,
  verifyState,
  authorizeUrl,
  exchangeCode,
  getTokenInfo,
  getUserInfo,
  profileFromIdToken,
  resolveIdentity,
  HuaweiError,
  STATE_TTL_MS
};
