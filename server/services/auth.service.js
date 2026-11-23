'use strict';
/**
 * 账号域业务层：注册 / 登录 / 微信登录 / 改密 / 改名 / 资料。
 *
 * 从 legacy/api-handler.js 的 10 个 if 分支原样拆出。拆分原则：
 *   - 这里只有业务规则与存储调用，不认识 request/reply；
 *   - 出错一律抛 core/http 的 httpError，由路由层交给统一错误出口；
 *   - 成功返回响应体对象（Set-Cookie 这种传输层细节由路由层处理）。
 *
 * 外部依赖只有 wx 的 code2Session（微信登录）——它属于服务端到服务端的适配，
 * 放在本文件底部，避免再开一个「provider 目录」但只有 50 行代码。
 */
const fs = require('fs');
const path = require('path');
const https = require('https');

const auth = require('../auth');
const store = require('../store');
const wxsec = require('../wxsec');
const huawei = require('../huawei');
const config = require('../config');
const { httpError } = require('../core/http');

const PUBLIC_DIR = config.PUBLIC_DIR;
const WX_APPID = process.env.WX_APPID || 'wx905c4968911fa23d';

/**
 * 用 wx.login 拿到的 code 换 openid。secret 只从环境变量读，永不落盘、不入库。
 *
 * @param {string} code 微信登录凭证
 * @returns {Promise<{openid: string, unionid?: string}>} 会话信息
 */
function code2Session(code) {
  return new Promise((resolve, reject) => {
    const secret = process.env.WX_APPSECRET || '';
    if (!secret) {
      const e = new Error('微信登录还没配置好（服务器缺少 WX_APPSECRET）');
      e.status = 503;
      reject(e);
      return;
    }
    const api = 'https://api.weixin.qq.com/sns/jscode2session?appid=' + encodeURIComponent(WX_APPID)
      + '&secret=' + encodeURIComponent(secret)
      + '&js_code=' + encodeURIComponent(code)
      + '&grant_type=authorization_code';
    const req = https.get(api, { timeout: 8000 }, (r) => {
      let raw = '';
      r.setEncoding('utf8');
      r.on('data', (c) => { raw += c; });
      r.on('end', () => {
        let data;
        try { data = JSON.parse(raw); } catch { return reject(new Error('微信返回了无法解析的内容')); }
        if (data.errcode) {
          const map = {
            40029: '登录凭证已失效，请重试',
            40163: '登录凭证已用过，请重试',
            45011: '操作太频繁，请稍后再试',
            40013: '小程序 AppID 不正确',
            40125: '小程序密钥不正确',
          };
          const e = new Error(map[data.errcode] || ('微信登录失败（' + data.errcode + '）'));
          e.status = data.errcode === 45011 ? 429 : 400;
          e.wxCode = data.errcode;
          console.warn('[wx] jscode2session 失败 errcode=' + data.errcode + ' appid=' + WX_APPID);
          return reject(e);
        }
        if (!data.openid) return reject(new Error('微信没有返回 openid'));
        resolve(data);
      });
      r.on('error', () => reject(new Error('连不上微信服务器，请稍后重试')));
    });
    req.on('timeout', () => req.destroy(new Error('微信接口超时，请重试')));
    req.on('error', () => reject(new Error('连不上微信服务器，请稍后重试')));
  });
}

/**
 * 给微信新用户起一个不冲突的昵称。
 *
 * @param {object} doc 当前用户文档
 * @returns {string} 可用昵称
 */
function wxName(doc) {
  for (let i = 0; i < 50; i += 1) {
    const name = '币友' + Math.random().toString(36).slice(2, 6).toUpperCase();
    if (!auth.findByName(doc, name)) return name;
  }
  return '币友' + Date.now().toString(36).slice(-4).toUpperCase();
}

/**
 * 同 IP 多账号标记（只标记、不限制）。
 *
 * 口径：同一注册 IP 下已存在账号时，本次新建的账号打 regIpDup = true；
 * 首个账号保持干净。判定在 store.commit 的 draft 上做，串行队列天然防并发撞车。
 * 历史账号没有 regIp（老数据无从判断），不参与统计、也不追溯。
 *
 * @param {object} draft commit 里的工作副本
 * @param {string} ip 本次注册来源 IP
 * @returns {{regIp: string, regIpDup: boolean}} 要写进新用户的两个字段
 */
function regIpFields(draft, ip) {
  const clean = String(ip || '').trim().slice(0, 64);
  // 本地回环 / 占位 / 空值不参与判定，避免无 IP 环境互相误标
  if (!clean || clean === '-' || clean === '::1' || clean === '127.0.0.1') {
    return { regIp: clean, regIpDup: false };
  }
  const dup = (draft.users || []).some((u) => u && u.regIp && u.regIp === clean);
  return { regIp: clean, regIpDup: dup };
}

/**
 * 取当前登录用户。
 *
 * @param {import('http').IncomingMessage} rawReq 原始请求
 * @returns {object|null} 用户文档
 */
function currentUser(rawReq) {
  return auth.currentUser(rawReq, store.load());
}

/**
 * 当前登录者（前端启动时探活）。
 *
 * @param {import('http').IncomingMessage} rawReq 原始请求
 * @returns {object} 响应体
 */
function me(rawReq) {
  const user = currentUser(rawReq);
  return { ok: true, user: auth.publicUser(user), isAdmin: !!(user && user.role === 'admin') };
}

/**
 * 注册（用户名 + 密码）。
 *
 * @param {{name?: string, password?: string}} body 请求体
 * @param {boolean} secure 是否 HTTPS（决定 Cookie 的 Secure 标记）
 * @param {string} ip 注册来源 IP（仅用于同 IP 多账号标记，不做限制）
 * @returns {Promise<{body: object, cookie: string}>} 响应体与会话 Cookie
 */
async function register(body, secure, ip) {
  const d = store.load();
  if (d.users.length >= auth.MAX_USERS) throw httpError(429, '注册人数已达上限');

  const v = auth.validateRegister(body.name, body.password);
  if (!v.ok) throw httpError(400, v.error);
  if (auth.findByName(d, v.name)) throw httpError(409, '该用户名已被占用');

  const { salt, hash } = auth.hashPassword(v.password);
  const created = await store.commit((draft) => {
    const u = {
      id: auth.nextID(draft),
      name: v.name,
      role: 'user',
      salt, hash,
      createdAt: new Date().toISOString(),
      lastLogin: new Date().toISOString(),
      ...regIpFields(draft, ip)
    };
    draft.users.push(u);
    if (u.regIpDup) console.log('[reg] 同 IP 重复注册，已标记 ' + u.name + '（' + u.id + '）' + ' IP=' + u.regIp);
    draft.holdings[u.id] = [];       // 新用户从空账本开始
    return u;
  });
  const token = auth.issueToken(created);
  return {
    body: { ok: true, token, user: auth.publicUser(created), isAdmin: false },
    cookie: auth.sessionCookie(token, { secure })
  };
}

/**
 * 用户名 + 密码登录（带同 IP 失败次数限制）。
 *
 * @param {{name?: string, password?: string}} body 请求体
 * @param {string} ip 客户端 IP
 * @param {boolean} secure 是否 HTTPS
 * @returns {Promise<{body: object, cookie: string}>} 响应体与会话 Cookie
 */
async function login(body, ip, secure) {
  if (auth.ipFails(ip) >= auth.MAX_FAIL) throw httpError(429, '尝试次数过多，请 10 分钟后再试');

  const d = store.load();
  const name = String(body.name || '').trim();
  const u = auth.findByName(d, name);
  if (!u || !auth.verifyPassword(body.password, u.salt, u.hash)) {
    auth.markFail(ip);
    throw httpError(401, '用户名或密码不正确');
  }
  auth.clearFail(ip);
  if (u.disabled) throw httpError(403, '账号已被禁用，请联系管理员');

  await store.commit((draft) => {
    const t = auth.findByID(draft, u.id);
    if (t) t.lastLogin = new Date().toISOString();
  });
  const token = auth.issueToken(u);
  return {
    body: { ok: true, token, user: auth.publicUser(u), isAdmin: u.role === 'admin' },
    cookie: auth.sessionCookie(token, { secure })
  };
}

/**
 * 微信一键登录：没绑过就建号，绑过就更新登录时间。
 *
 * @param {{code?: string}} body 请求体
 * @param {boolean} secure 是否 HTTPS
 * @param {string} ip 注册来源 IP（仅用于同 IP 多账号标记，不做限制）
 * @returns {Promise<{body: object, cookie: string}>} 响应体与会话 Cookie
 */
async function wxLogin(body, secure, ip) {
  const code = String(body.code || '').trim();
  if (!code) throw httpError(400, '缺少微信登录凭证');

  let sess;
  try {
    sess = await code2Session(code);
  } catch (e) {
    throw httpError(e.status || 400, e.message, { wxCode: e.wxCode || 0 });
  }

  const cur = store.load();
  let u = cur.users.filter((x) => x.wxOpenid === sess.openid)[0] || null;
  let isNew = false;

  if (!u) {
    if (cur.users.length >= auth.MAX_USERS) throw httpError(429, '注册人数已达上限');
    isNew = true;
    u = await store.commit((draft) => {
      const created = {
        id: auth.nextID(draft),
        name: wxName(draft),
        role: 'user',
        salt: '',
        hash: '',
        wxOpenid: sess.openid,
        wxUnionid: sess.unionid || '',
        createdAt: new Date().toISOString(),
        lastLogin: new Date().toISOString(),
        ...regIpFields(draft, ip)
      };
      draft.users.push(created);
      draft.holdings[created.id] = [];      // 微信新用户从空账本开始
      if (created.regIpDup) console.log('[wx] 同 IP 重复注册，已标记 ' + created.name + '（' + created.id + '）' + ' IP=' + created.regIp);
      return created;
    });
    console.log('[wx] 新建微信用户 ' + u.name + '（' + u.id + '）');
  } else {
    await store.commit((draft) => {
      const t = auth.findByID(draft, u.id);
      if (t) {
        t.lastLogin = new Date().toISOString();
        if (sess.unionid && !t.wxUnionid) t.wxUnionid = sess.unionid;
      }
    });
  }

  const token = auth.issueToken(u);
  return {
    body: { ok: true, token, user: auth.publicUser(u), isAdmin: u.role === 'admin', isNew },
    cookie: auth.sessionCookie(token, { secure })
  };
}

/**
 * 把当前账号绑定到某个微信。
 *
 * @param {string} uid 当前用户 ID
 * @param {{code?: string}} body 请求体
 * @returns {Promise<object>} 响应体
 */
async function wxBind(uid, body) {
  const code = String(body.code || '').trim();
  if (!code) throw httpError(400, '缺少微信登录凭证');

  let sess;
  try {
    sess = await code2Session(code);
  } catch (e) {
    throw httpError(e.status || 400, e.message, { wxCode: e.wxCode || 0 });
  }

  const owner = store.load().users.filter((x) => x.wxOpenid === sess.openid)[0];
  if (owner && owner.id !== uid) throw httpError(409, '这个微信已经绑定过其他账号了');

  await store.commit((draft) => {
    const t = auth.findByID(draft, uid);
    if (t) t.wxOpenid = sess.openid;
  });
  return { ok: true };
}

/**
 * 解绑微信。
 *
 * @param {string} uid 当前用户 ID
 * @returns {Promise<object>} 响应体
 */
async function wxUnbind(uid) {
  await store.commit((draft) => {
    const t = auth.findByID(draft, uid);
    if (t) { t.wxOpenid = ''; t.wxUnionid = ''; }
  });
  return { ok: true };
}

/* ---------------- 华为账号登录（Account Kit） ----------------
   与微信同一套口径：只认服务端换回来的 OpenID，首次自动建号，老用户只刷
   lastLogin 与资料。协议细节（换 token / 取 OpenID / 昵称头像）在 huawei.js，
   这里只做「身份 → 账号」的映射，便于脱离网络单测。 */

/**
 * 华为身份 → 本站账号（有号就登，没号就建）。
 *
 * @param {{openId: string, unionId?: string, nickname?: string, avatar?: string}} profile 华为身份
 * @param {string} ip 注册来源 IP（仅用于同 IP 多账号标记，不做限制）
 * @returns {Promise<{user: object, isNew: boolean}>} 账号与是否新建
 */
async function huaweiUpsert(profile, ip) {
  const p = profile || {};
  const openId = String(p.openId || '').trim();
  if (!openId) throw httpError(400, '缺少华为账号标识');
  const unionId = String(p.unionId || '').trim().slice(0, 128);
  const nickname = String(p.nickname || '').trim().slice(0, 32);
  const avatar = String(p.avatar || '').trim().slice(0, 512);

  const cur = store.load();
  // OpenID 按应用隔离；UnionID 跨应用一致，换端（鸿蒙 ↔ 网页）能认出同一个人
  let user = cur.users.find((u) => u.hwOpenid === openId) || null;
  if (!user && unionId) user = cur.users.find((u) => u.hwUnionid === unionId) || null;

  if (!user) {
    if (cur.users.length >= auth.MAX_USERS) throw httpError(429, '注册人数已达上限');
    const created = await store.commit((draft) => {
      const u = {
        id: auth.nextID(draft),
        name: wxName(draft),          // 与微信同款「币友XXXX」，不让渠道一眼可辨
        role: 'user',
        salt: '',
        hash: '',
        hwOpenid: openId,
        hwUnionid: unionId,
        hwAvatar: avatar,
        nickname: nickname,
        createdAt: new Date().toISOString(),
        lastLogin: new Date().toISOString(),
        ...regIpFields(draft, ip)
      };
      draft.users.push(u);
      draft.holdings[u.id] = [];      // 华为新用户从空账本开始
      if (u.regIpDup) console.log('[huawei] 同 IP 重复注册，已标记 ' + u.name + '（' + u.id + '）' + ' IP=' + u.regIp);
      return u;
    });
    console.log('[huawei] 新建华为用户 ' + created.name + '（' + created.id + '）');
    return { user: created, isNew: true };
  }

  await store.commit((draft) => {
    const t = auth.findByID(draft, user.id);
    if (!t) return;
    t.lastLogin = new Date().toISOString();
    // 早期可能只按 unionid 关联过，这次拿到的 openid 补上
    t.hwOpenid = openId;
    if (unionId && !t.hwUnionid) t.hwUnionid = unionId;
    if (avatar) t.hwAvatar = avatar;             // 华为头像会过期，每次登录刷新
    if (nickname && !t.nickname) t.nickname = nickname;   // 不覆盖用户自己设的昵称
  });

  return { user: auth.findByID(store.load(), user.id) || user, isNew: false };
}

/**
 * 把华为身份绑到当前已登录账号上（重复绑自己是幂等的）。
 *
 * @param {string} uid 本站账号 ID
 * @param {object} profile 华为身份
 * @returns {Promise<void>} 失败抛 409 / 400
 */
async function huaweiAttach(uid, profile) {
  const p = profile || {};
  const openId = String(p.openId || '').trim();
  if (!openId) throw httpError(400, '缺少华为账号标识');
  const unionId = String(p.unionId || '').trim();
  const users = store.load().users;

  const owner = users.find((u) => u.hwOpenid === openId);
  if (owner && owner.id !== uid) throw httpError(409, '这个华为账号已经绑定过其他账号了');
  if (unionId) {
    const uOwner = users.find((u) => u.hwUnionid === unionId && u.id !== uid);
    if (uOwner) throw httpError(409, '这个华为账号已经绑定过其他账号了');
  }

  await store.commit((draft) => {
    const t = auth.findByID(draft, uid);
    if (!t) throw httpError(404, '账号不存在');
    t.hwOpenid = openId;
    if (unionId) t.hwUnionid = unionId;
    if (p.avatar) t.hwAvatar = String(p.avatar).slice(0, 512);
    if (p.nickname && !t.nickname) t.nickname = String(p.nickname).slice(0, 32);
  });
}

/**
 * 用华为身份换本站会话（登录成功的统一出口）。
 *
 * @param {object} profile 华为身份
 * @param {boolean} secure 是否 HTTPS
 * @param {string} ip 注册来源 IP（仅用于同 IP 多账号标记，不做限制）
 * @returns {Promise<{body: object, cookie: string}>} 响应体与会话 Cookie
 */
async function huaweiSession(profile, secure, ip) {
  const r = await huaweiUpsert(profile, ip);
  const token = auth.issueToken(r.user);
  return {
    body: {
      ok: true,
      token: token,
      user: auth.publicUser(r.user),
      isAdmin: r.user.role === 'admin',
      isNew: r.isNew
    },
    cookie: auth.sessionCookie(token, { secure })
  };
}

/**
 * 华为账号登录（鸿蒙等客户端传 authorizationCode）。
 *
 * @param {{code?: string}} body 请求体
 * @param {boolean} secure 是否 HTTPS
 * @param {string} ip 注册来源 IP（仅用于同 IP 多账号标记，不做限制）
 * @returns {Promise<{body: object, cookie: string}>} 响应体与会话 Cookie
 */
async function huaweiLogin(body, secure, ip) {
  const code = String(body.code || '').trim();
  if (!code) throw httpError(400, '缺少华为账号授权码');
  let profile;
  try {
    // 客户端签发的 code 没有回跳地址，换 token 时不带 redirect_uri
    profile = await huawei.resolveIdentity(code);
  } catch (e) {
    throw httpError(e.status || 502, e.message, { hwCode: e.code || 0 });
  }
  return huaweiSession(profile, secure, ip);
}

/** 绑定华为账号 */
async function huaweiBind(uid, body) {
  const code = String((body && body.code) || '').trim();
  if (!code) throw httpError(400, '缺少华为账号授权码');
  let profile;
  try {
    profile = await huawei.resolveIdentity(code);
  } catch (e) {
    throw httpError(e.status || 502, e.message, { hwCode: e.code || 0 });
  }
  await huaweiAttach(uid, profile);
  const fresh = auth.findByID(store.load(), uid);
  return { ok: true, user: auth.publicUser(fresh) };
}

/** 解绑华为账号：只清华为字段，密码/微信/收藏都不动 */
async function huaweiUnbind(uid) {
  await store.commit((draft) => {
    const t = auth.findByID(draft, uid);
    if (!t) return;
    t.hwOpenid = '';
    t.hwUnionid = '';
    t.hwAvatar = '';
  });
  const fresh = auth.findByID(store.load(), uid);
  return { ok: true, user: auth.publicUser(fresh) };
}

/**
 * 退出登录：下发一个立即过期的会话 Cookie。
 *
 * @param {boolean} secure 是否 HTTPS
 * @returns {{body: object, cookie: string}} 响应体与清除用 Cookie
 */
/**
 * 注销账号：删除账号行与账本。cl_holdings 有外键 CASCADE，随账号一起清掉。
 * 最后一个管理员不允许注销，避免后台锁死。
 *
 * @param {object} me 当前用户
 * @param {boolean} secure 是否 HTTPS（决定清 Cookie 的属性）
 * @returns {Promise<{body: object, cookie: string}>}
 */
async function deleteAccount(me, secure) {
  const d = store.load();
  const admins = d.users.filter((u) => u.role === 'admin');
  if (me.role === 'admin' && admins.length <= 1) {
    throw httpError(400, '唯一的管理员账号不能注销');
  }
  await store.commit((draft) => {
    draft.users = draft.users.filter((u) => u.id !== me.id);
    if (draft.holdings) delete draft.holdings[me.id];
    if (Array.isArray(draft.shares)) {
      draft.shares = draft.shares.filter((s) => !s || s.uid !== me.id);
    }
    return true;
  });
  return {
    body: { ok: true },
    cookie: auth.sessionCookie('', { clear: true, secure })
  };
}

function logout(secure) {  return {
    body: { ok: true },
    cookie: auth.sessionCookie('', { clear: true, secure })
  };
}

/**
 * 修改密码。微信建号没有密码时允许首次直接设置，之后改密码仍需验证原密码。
 *
 * @param {object} me 当前用户
 * @param {{oldPassword?: string, newPassword?: string}} body 请求体
 * @returns {Promise<object>} 响应体
 */
async function changePassword(me, body) {
  if (me.hash && !auth.verifyPassword(body.oldPassword, me.salt, me.hash)) {
    throw httpError(400, '原密码不正确');
  }
  const np = String(body.newPassword || '');
  if (np.length < auth.MIN_PW) throw httpError(400, `新密码至少 ${auth.MIN_PW} 位`);
  if (/^\d+$/.test(np)) throw httpError(400, '新密码不能是纯数字');

  const { salt, hash } = auth.hashPassword(np);
  await store.commit((draft) => {
    const t = auth.findByID(draft, me.id);
    if (t) { t.salt = salt; t.hash = hash; }
  });
  return { ok: true };
}

/**
 * 改用户名（登录名）。
 *
 * 规则：不能重名、只能改一次（改过之后 nameChangedAt 非空，接口直接拒绝）。
 * 昵称不占这个名额 —— 昵称随时可改，那个走 /api/me/profile。
 *
 * @param {object} me 当前用户
 * @param {{name?: string}} body 请求体
 * @returns {Promise<object>} 响应体
 */
async function rename(me, body) {
  const d = store.load();
  const v = auth.validateName(body.name);
  if (!v.ok) throw httpError(400, v.error);

  // 和现在一样就直接返回，别白占一次改名机会
  if (v.name === me.name) return { ok: true, user: auth.publicUser(me) };
  if (me.nameChangedAt) throw httpError(400, '用户名只能修改一次');

  // 大小写也算重复：MySQL 的 uk_name 是大小写不敏感的，这里对齐，免得报数据库错
  const lower = v.name.toLowerCase();
  const dup = (d.users || []).filter((u) => u.id !== me.id && String(u.name || '').toLowerCase() === lower)[0];
  if (dup) throw httpError(400, '该用户名已被占用');

  const now = new Date().toISOString();
  await store.commit((draft) => {
    const t = auth.findByID(draft, me.id);
    if (t) { t.name = v.name; t.nameChangedAt = now; }
  });
  const fresh = await store.load();
  const mine = auth.findByID(fresh, me.id);
  return { ok: true, user: auth.publicUser(mine) };
}

/**
 * 修改资料：昵称（过内容安全）+ 头像（base64 落盘，≤1MB）。
 *
 * @param {object} me 当前用户
 * @param {{nickname?: string, avatar?: string}} body 请求体
 * @returns {Promise<object>} 响应体
 */
async function updateProfile(me, body) {
  const patch = {};

  if (typeof body.nickname === 'string') {
    const nick = body.nickname.trim().slice(0, 16);
    if (nick && nick.length < 2) throw httpError(400, '昵称至少 2 个字');
    if (nick) {
      const chk = await wxsec.checkText(nick, me.wxOpenid || '');
      if (!chk.ok) throw httpError(400, '这个昵称不太合适，换一个吧');
    }
    patch.nickname = nick;
  }

  /**
   * 头像清除必须显式说清楚（avatarClear: true）。
   * 历史坑：老客户端「只改昵称」时也会带 avatar:''，服务端把它当清除指令，
   * 于是点一次保存本站头像就没了。所以 avatar:'' 现在一律忽略，不再当清除。
   */
  if (body.avatarClear === true) {
    if (me.avatar) {
      try { fs.unlinkSync(path.join(PUBLIC_DIR, 'avatar', me.avatar)); } catch (e) { /* ignore */ }
    }
    patch.avatar = '';
  } else if (typeof body.avatar === 'string' && body.avatar) {
    const m = /^data:image\/(jpeg|jpg|png);base64,([A-Za-z0-9+/=]+)$/.exec(body.avatar);
    if (!m) throw httpError(400, '头像只支持 JPEG / PNG');
    const buf = Buffer.from(m[2], 'base64');
    if (!buf.length || buf.length > 1024 * 1024) throw httpError(400, '头像不能超过 1MB');

    const dir = path.join(PUBLIC_DIR, 'avatar');
    fs.mkdirSync(dir, { recursive: true });
    const name = me.id + '-' + Date.now().toString(36) + '.jpg';
    fs.writeFileSync(path.join(dir, name), buf);
    // 删掉旧头像文件，避免堆积
    if (me.avatar) {
      try { fs.unlinkSync(path.join(dir, me.avatar)); } catch (e) { /* 旧文件可能已不在 */ }
    }
    patch.avatar = name;
  }

  if (!Object.keys(patch).length) throw httpError(400, '没有要保存的内容');

  const updated = await store.commit((draft) => {
    const u = auth.findByID(draft, me.id);
    if (u) Object.assign(u, patch);
    return auth.publicUser(auth.findByID(draft, me.id));
  });
  return { ok: true, user: updated };
}

module.exports = {
  regIpFields: regIpFields,
  code2Session: code2Session,
  currentUser: currentUser,
  me: me,
  register: register,
  login: login,
  wxLogin: wxLogin,
  wxBind: wxBind,
  wxUnbind: wxUnbind,
  huaweiUpsert: huaweiUpsert,
  huaweiAttach: huaweiAttach,
  huaweiSession: huaweiSession,
  huaweiLogin: huaweiLogin,
  huaweiBind: huaweiBind,
  huaweiUnbind: huaweiUnbind,
  deleteAccount: deleteAccount,
  logout: logout,
  changePassword: changePassword,
  rename: rename,
  updateProfile: updateProfile
};
