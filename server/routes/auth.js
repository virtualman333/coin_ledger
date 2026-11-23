'use strict';
/**
 * 账号域路由（HTTP 层）。
 *
 *   GET    /api/auth/me        当前登录者
 *   POST   /api/auth/register  注册（用户名 + 密码）
 *   POST   /api/auth/login     登录（带同 IP 失败限制）
 *   POST   /api/auth/wx/login  微信一键登录（自动建号）
 *   POST   /api/auth/wx/bind   绑定微信（登录）
 *   POST   /api/auth/wx/unbind 解绑微信（登录）
 *   GET    /api/auth/huawei/status    华为登录是否启用
 *   GET    /api/auth/huawei/start     网页：302 到华为授权页（种 state Cookie）
 *   GET    /api/auth/huawei/callback  网页：回跳换登录态后 302 回 /account
 *   POST   /api/auth/huawei/login     鸿蒙等客户端：{ code } 直接登录
 *   POST   /api/auth/huawei/bind      绑定华为账号（登录）
 *   POST   /api/auth/huawei/unbind    解绑华为账号（登录）
 *   POST   /api/auth/logout    退出
 *   POST   /api/auth/password  改密码（登录）
 *   POST   /api/user/name      改用户名，仅一次（登录）
 *   POST   /api/me/profile     昵称 + 头像（登录）
 *
 * 本层只做三件事：读 body（各自体积上限）、调 service、把 Set-Cookie 挂到响应上。
 * 业务规则与错误文案全在 services/auth.service.js，出错由统一错误出口收敛。
 *
 * 华为登录的两条链路差别只在「谁承担回跳」：网页走 302 + HttpOnly state Cookie
 * （浏览器天然带 Cookie，state 防 CSRF）；鸿蒙端自己拿 authorizationCode 直接递交。
 * client_secret 在任何链路上都只出现在服务器。
 */
const crypto = require('crypto');

const authService = require('../services/auth.service');
const huawei = require('../huawei');
const config = require('../config');
const { readBody, clientIP, isSecure } = require('../core/http');

const STATE_COOKIE = 'cl_hw_state';
const STATE_COOKIE_PATH = '/api/auth/huawei';
const ACCOUNT_PATH = '/account';

/** 授权前的 state Cookie：只给 /api/auth/huawei 用，HttpOnly，10 分钟过期 */
function stateCookie(value, opts) {
  const o = opts || {};
  const attrs = 'Path=' + STATE_COOKIE_PATH + '; HttpOnly; SameSite=Lax' + (o.secure ? '; Secure' : '');
  return o.clear
    ? STATE_COOKIE + '=; ' + attrs + '; Max-Age=0'
    : STATE_COOKIE + '=' + encodeURIComponent(value) + '; ' + attrs
      + '; Max-Age=' + Math.floor(huawei.STATE_TTL_MS / 1000);
}

function readStateCookie(rawReq) {
  const raw = String((rawReq.headers && rawReq.headers.cookie) || '');
  let found = '';
  raw.split(';').some((kv) => {
    const i = kv.indexOf('=');
    if (i < 0) return false;
    if (kv.slice(0, i).trim() !== STATE_COOKIE) return false;
    try { found = decodeURIComponent(kv.slice(i + 1).trim()); } catch (e) { found = ''; }
    return true;
  });
  return found;
}

/** 网页流程失败统一回账户页，用短错误码让前端展示中文（URL 里不塞中文） */
function failToAccount(reply, code, secure) {
  return reply
    .header('Set-Cookie', stateCookie('', { clear: true, secure: secure }))
    .redirect(ACCOUNT_PATH + '?hwerr=' + encodeURIComponent(code));
}

module.exports = async function authRoutes(app) {
  app.get('/api/auth/me', async function me(request, reply) {
    reply.send(authService.me(request.raw));
  });

  app.post('/api/auth/register', async function register(request, reply) {
    const body = await readBody(request.raw, 4096);
    const r = await authService.register(body, isSecure(request.raw), clientIP(request.raw));
    reply.header('Set-Cookie', r.cookie).send(r.body);
  });

  app.post('/api/auth/login', async function login(request, reply) {
    const body = await readBody(request.raw, 4096);
    const r = await authService.login(body, clientIP(request.raw), isSecure(request.raw));
    reply.header('Set-Cookie', r.cookie).send(r.body);
  });

  app.post('/api/auth/wx/login', async function wxLogin(request, reply) {
    const body = await readBody(request.raw, 4096);
    const r = await authService.wxLogin(body, isSecure(request.raw), clientIP(request.raw));
    reply.header('Set-Cookie', r.cookie).send(r.body);
  });

  app.post('/api/auth/wx/bind', { preHandler: app.requireLogin }, async function wxBind(request, reply) {
    const body = await readBody(request.raw, 4096);
    reply.send(await authService.wxBind(request.user.id, body));
  });

  app.post('/api/auth/wx/unbind', { preHandler: app.requireLogin }, async function wxUnbind(request, reply) {
    reply.send(await authService.wxUnbind(request.user.id));
  });

  /* ---------------- 华为账号登录 ---------------- */
  app.get('/api/auth/huawei/status', async function hwStatus(request, reply) {
    reply.send({ ok: true, enabled: huawei.enabled() });
  });

  app.get('/api/auth/huawei/start', async function hwStart(request, reply) {
    if (!huawei.enabled()) {
      return reply.code(503).send({ ok: false, error: '华为账号登录还没配置好，请使用用户名密码登录' });
    }
    // mode=bind 表示给当前已登录账号绑定，回来后不能当成登录处理（否则会话会被换号）
    const mode = String((request.query && request.query.mode) || '') === 'bind' ? 'bind' : 'login';
    const st = huawei.newState(mode);
    reply.header('Set-Cookie', stateCookie(st.state, { secure: isSecure(request.raw) }));
    // 授权页停留超过 10 分钟 state 会过期，这是有意的：缩短 CSRF 窗口
    return reply.redirect(huawei.authorizeUrl({ state: st.state }));
  });

  app.get('/api/auth/huawei/callback', async function hwCallback(request, reply) {
    const q = request.query || {};
    const secure = isSecure(request.raw);

    if (q.error) {
      // 用户在华为授权页点了取消，不是故障
      console.log('[huawei] 用户取消授权 error=' + q.error);
      return failToAccount(reply, q.error === 'access_denied' ? 'denied' : 'rejected', secure);
    }

    const code = String(q.code || '').trim();
    if (!code) return failToAccount(reply, 'missing_code', secure);

    // 1) state 必须是我们签发且未过期的
    const checked = huawei.verifyState(q.state);
    if (!checked.ok) {
      console.warn('[huawei] state 校验失败：' + checked.reason);
      return failToAccount(reply, checked.reason === 'expired' ? 'expired' : 'state', secure);
    }
    // 2) 还必须与这个浏览器带来的 Cookie 逐字一致（防止别人把自己的 code 塞给你）
    const cookieState = readStateCookie(request.raw);
    const a = Buffer.from(cookieState);
    const b = Buffer.from(String(q.state || ''));
    if (!cookieState || a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      console.warn('[huawei] state 与 Cookie 不匹配');
      return failToAccount(reply, 'state', secure);
    }

    let profile;
    try {
      // 网页流程必须回传与授权时一致的 redirect_uri
      profile = await huawei.resolveIdentity(code, { redirectUri: config.HUAWEI.redirectUri });
    } catch (e) {
      console.warn('[huawei] 回调失败：' + e.message);
      const errCode = e.status === 400 ? 'expired' : 'server';
      return failToAccount(reply, errCode, secure);
    }

    /* 绑定模式：只把华为身份挂到当前账号上，会话保持不变 */
    if (checked.mode === 'bind') {
      const me = authService.currentUser(request.raw);
      if (!me) return failToAccount(reply, 'needlogin', secure);
      try {
        await authService.huaweiAttach(me.id, profile);
      } catch (e) {
        console.warn('[huawei] 绑定失败：' + e.message);
        return failToAccount(reply, e.status === 409 ? 'bound' : 'server', secure);
      }
      return reply
        .header('Set-Cookie', stateCookie('', { clear: true, secure: secure }))
        .redirect(ACCOUNT_PATH + '?hw=bind');
    }

    let session;
    try {
      session = await authService.huaweiSession(profile, secure, clientIP(request.raw));
    } catch (e) {
      console.warn('[huawei] 建号失败：' + e.message);
      const errCode = e.status === 429 ? 'full' : 'server';
      return failToAccount(reply, errCode, secure);
    }

    return reply
      .header('Set-Cookie', [
        stateCookie('', { clear: true, secure: secure }),
        session.cookie
      ])
      .redirect(ACCOUNT_PATH + '?hw=1' + (session.body.isNew ? '&new=1' : ''));
  });

  app.post('/api/auth/huawei/login', async function hwLogin(request, reply) {
    if (!huawei.enabled()) {
      return reply.code(503).send({ ok: false, error: '华为账号登录还没配置好，请使用用户名密码登录' });
    }
    const body = await readBody(request.raw, 4096);
    const r = await authService.huaweiLogin(body, isSecure(request.raw), clientIP(request.raw));
    reply.header('Set-Cookie', r.cookie).send(r.body);
  });

  app.post('/api/auth/huawei/bind', { preHandler: app.requireLogin }, async function hwBind(request, reply) {
    const body = await readBody(request.raw, 4096);
    reply.send(await authService.huaweiBind(request.user.id, body));
  });

  app.post('/api/auth/huawei/unbind', { preHandler: app.requireLogin }, async function hwUnbind(request, reply) {
    reply.send(await authService.huaweiUnbind(request.user.id));
  });

  // 应用市场合规要求：账号必须能在应用内自助注销（不用等人工）
  app.post('/api/account/delete', { preHandler: app.requireLogin }, async function deleteAccount(request, reply) {
    const r = await authService.deleteAccount(request.user, isSecure(request.raw));
    reply.header('Set-Cookie', r.cookie).send(r.body);
  });

  app.post('/api/auth/logout', async function logout(request, reply) {
    const r = authService.logout(isSecure(request.raw));
    reply.header('Set-Cookie', r.cookie).send(r.body);
  });

  app.post('/api/auth/password', { preHandler: app.requireLogin }, async function password(request, reply) {
    const body = await readBody(request.raw, 4096);
    reply.send(await authService.changePassword(request.user, body));
  });

  app.post('/api/user/name', { preHandler: app.requireLogin }, async function rename(request, reply) {
    const body = await readBody(request.raw, 2048);
    reply.send(await authService.rename(request.user, body));
  });

  app.post('/api/me/profile', { preHandler: app.requireLogin }, async function profile(request, reply) {
    // 头像是 base64 内联上传，给到 6MB（原 handler 同值）
    const body = await readBody(request.raw, 6 * 1024 * 1024);
    reply.send(await authService.updateProfile(request.user, body));
  });
};
