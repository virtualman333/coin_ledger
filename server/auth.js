'use strict';
/**
 * 多用户口令认证 + 无状态签名会话。
 * 口令以 scrypt(随机盐) 存储，会话是 HMAC-SHA256 签名的 Cookie。
 */
const crypto = require('crypto');

const COOKIE = 'cl_session';
const TTL_MS = 1000 * 60 * 60 * 24 * 7;   // 7 天
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');

const NAME_RE = /^[A-Za-z0-9_\u4e00-\u9fa5]{2,20}$/;   // 2–20 位：字母/数字/下划线/中文
const MIN_PW = 8;
const MAX_PW = 64;
const MAX_USERS = 500;

/* ---------------- 口令 ---------------- */
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(password), salt, 64).toString('hex');
  return { salt, hash };
}

function verifyPassword(password, salt, hash) {
  if (!salt || !hash) return false;
  try {
    const calc = crypto.scryptSync(String(password), salt, 64);
    const expect = Buffer.from(hash, 'hex');
    if (calc.length !== expect.length) return false;
    return crypto.timingSafeEqual(calc, expect);
  } catch {
    return false;
  }
}

/* ---------------- 用户 ---------------- */
function findByName(doc, name) {
  const key = String(name || '').trim().toLowerCase();
  return doc.users.find((u) => u.name.toLowerCase() === key) || null;
}

function findByID(doc, id) {
  return doc.users.find((u) => u.id === id) || null;
}

function publicUser(u) {
  if (!u) return null;
  return {
    id: u.id,
    name: u.name,
    role: u.role,
    createdAt: u.createdAt,
    lastLogin: u.lastLogin || null,
    wx: !!u.wxOpenid,          // 是否绑定微信
    hw: !!u.hwOpenid,          // 是否绑定华为账号
    isTest: !!u.isTest,        // 测试账号
    disabled: !!u.disabled,    // 被管理员禁用（禁用后会话立即失效）
    nickname: u.nickname || '',           // 显示昵称，没设就用登录名
    avatar: u.avatar ? '/avatar/' + u.avatar : '',
    // 华为头像是外链（会随用户换头像失效），只作展示兜底；本站 avatar 永远优先
    hwAvatar: u.hwAvatar || '',
    hasPassword: !!u.hash,
    nameChanged: !!u.nameChangedAt        // 用户名是否已经用过改名机会
  };
}

function validateRegister(name, password) {
  const n = String(name || '').trim();
  if (!NAME_RE.test(n)) return { ok: false, error: '用户名需 2–20 位，仅限中文、字母、数字、下划线' };
  if (n.toLowerCase() === 'admin' || n.toLowerCase() === 'root') return { ok: false, error: '该用户名不可用' };
  const p = String(password || '');
  if (p.length < MIN_PW) return { ok: false, error: `密码至少 ${MIN_PW} 位` };
  if (p.length > MAX_PW) return { ok: false, error: `密码最多 ${MAX_PW} 位` };
  if (/^\d+$/.test(p)) return { ok: false, error: '密码不能是纯数字' };
  return { ok: true, name: n, password: p };
}

/**
 * 只校验用户名（改名的接口复用注册那套规则，但不碰密码）。
 * 注册和改名共用同一套规则，避免两边限制不一致。
 */
function validateName(name) {
  const n = String(name || '').trim();
  if (!NAME_RE.test(n)) return { ok: false, error: '用户名需 2–20 位，仅限中文、字母、数字、下划线' };
  if (n.toLowerCase() === 'admin' || n.toLowerCase() === 'root') return { ok: false, error: '该用户名不可用' };
  return { ok: true, name: n };
}

/** 生成不与现有冲突的用户 ID（u1, u2, ...） */
function nextID(doc) {
  let n = 1;
  const used = new Set(doc.users.map((u) => u.id));
  while (used.has('u' + n)) n += 1;
  return 'u' + n;
}

/* ---------------- 会话 ---------------- */
function b64u(buf) {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function unb64u(str) {
  return Buffer.from(String(str).replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}
function sign(payloadStr) {
  return b64u(crypto.createHmac('sha256', SESSION_SECRET).update(payloadStr).digest());
}

function issueToken(user) {
  const payload = Buffer.from(JSON.stringify({ u: user.id, r: user.role, exp: Date.now() + TTL_MS })).toString('base64');
  return b64u(payload) + '.' + sign(payload);
}

function verifyToken(token) {
  if (!token || typeof token !== 'string') return null;
  const [p, s] = token.split('.');
  if (!p || !s) return null;
  let payloadB64;
  try {
    payloadB64 = unb64u(p).toString('utf8');
  } catch { return null; }
  const expect = sign(payloadB64);
  const a = Buffer.from(expect);
  const b = Buffer.from(s);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  let obj;
  try {
    obj = JSON.parse(Buffer.from(payloadB64, 'base64').toString('utf8'));
  } catch { return null; }
  if (!obj || !obj.u || !obj.exp || Date.now() > obj.exp) return null;
  return { id: obj.u, role: obj.r };
}

function parseCookies(req) {
  const raw = req.headers.cookie || '';
  const out = {};
  raw.split(';').forEach((kv) => {
    const i = kv.indexOf('=');
    if (i < 0) return;
    out[kv.slice(0, i).trim()] = decodeURIComponent(kv.slice(i + 1).trim());
  });
  return out;
}

/** 从请求里解出当前用户（会核对用户是否仍存在）
 *  小程序等非浏览器客户端走 `Authorization: Bearer <token>`，浏览器仍用 Cookie。 */
function requestToken(req) {
  const bearer = /^Bearer\s+([^\s]+)$/i.exec(String(req.headers.authorization || '').trim());
  if (bearer) return bearer[1];
  return parseCookies(req)[COOKIE];
}

function currentUser(req, doc) {
  const payload = verifyToken(requestToken(req));
  if (!payload) return null;
  const u = findByID(doc, payload.id);
  if (!u) return null;
  if (u.disabled) return null;   // 禁用后已签发的会话也立即失效
  return u;
}

function sessionCookie(token, { clear = false, secure = false } = {}) {
  const attrs = `Path=/; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}`;
  return clear
    ? `${COOKIE}=; ${attrs}; Max-Age=0`
    : `${COOKIE}=${encodeURIComponent(token)}; ${attrs}; Max-Age=${Math.floor(TTL_MS / 1000)}`;
}

/* ---------------- 登录失败限流 ---------------- */
const fails = new Map();
const MAX_FAIL = 8;
const LOCK_MS = 1000 * 60 * 10;

function ipFails(ip) {
  const v = fails.get(ip);
  if (!v) return 0;
  if (Date.now() > v.until) { fails.delete(ip); return 0; }
  return v.count;
}
function markFail(ip) {
  const cur = fails.get(ip) || { count: 0, until: 0 };
  cur.count += 1;
  cur.until = Date.now() + LOCK_MS;
  fails.set(ip, cur);
}
function clearFail(ip) { fails.delete(ip); }

module.exports = {
  COOKIE, TTL_MS, MIN_PW, MAX_USERS,
  hashPassword, verifyPassword,
  findByName, findByID, publicUser, validateRegister, validateName, nextID,
  issueToken, verifyToken, currentUser, sessionCookie,
  ipFails, markFail, clearFail, MAX_FAIL
};
