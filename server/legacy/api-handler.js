'use strict';
/**
 * 老 API 处理器（绞杀者阶段的兜底实现）
 *
 * 本文件是 server/index.js 的 handleApi 及其全部依赖「原样裁出」的结果：
 * 50 个 (method, path) 处理器、状态码、错误文案、bodyLimit 逐字未改。
 * T01 只做搬家，不做重构 —— 任何行为变化都算回归（G2 契约零破坏）。
 *
 * 只有两处机械改动：
 *   1. 路径常量改从 server/config.js 取（文件下移一级，__dirname 变了）；
 *   2. loadSeed() 结束时把 SEED/DESC 注入 legacy/page-render。
 *
 * 迁移进度：T03 起按域逐个替换成 routes/* + services/*，本文件逐步缩小，
 * 最终只剩蜜罐 /api/__trap 与少量未迁移分支。
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const url = require('url');
const https = require('https');

const store = require('../store');
const auth = require('../auth');
const feedback = require('../feedback');
const visitors = require('../visitors');
const wxsec = require('../wxsec');
const reminders = require('../reminders');
const seriesSvc = require('../series');
const guard = require('../guard');
const audit = require('../audit');

const config = require('../config');
const pageRender = require('./page-render');

const VERSION = config.VERSION;
const PORT = config.PORT;
const HOST = config.HOST;
const PUBLIC_DIR = config.PUBLIC_DIR;
const SEED_FILE = config.SEED_FILE;
const START_AT = config.START_AT;

const SUPERADMIN_NAME = process.env.SUPERADMIN_NAME || 'virtualman';

/** 首次建超管用的口令：只从环境变量取；没配就随机生成并打印一次，
 *  避免把口令写死在仓库里（硬编码的口令一旦进 git 历史就再也擦不掉）。 */
function superadminPassword() {
  if (process.env.SUPERADMIN_PASSWORD) return process.env.SUPERADMIN_PASSWORD;
  const pw = crypto.randomBytes(12).toString('base64').replace(/[^A-Za-z0-9]/g, '').slice(0, 12);
  console.log(`[boot] 未设置 SUPERADMIN_PASSWORD，本次生成超管口令：${pw}（登录后请立即修改）`);
  return pw;
}

/* ---------------------------------------------------------
   基础数据（发行清单）
   --------------------------------------------------------- */
let SEED = { coins: [], series: {}, defaults: [] };
let COIN_BY_NAME = new Map();
let PM_BY_NAME = new Map();  // 贵金属可收藏：名称白名单
let IMG_SET = [];
let IMG_REAL = [];   // 有官方实拍图的品种编号
let GALLERY = {};    // 品种 → 多图（正面 / 背面 / 整套）
let GALLERY_VER = ''; // gallery.json 的 mtime，用来给图片 URL 加 ?v= 破缓存
let DESC = {};       // 品种官方介绍（摘自央行发行公告）
let PLAN = { years: [] };  // 普通纪念币年度发行计划（public/data/plan.json）
const PLAN_FILE = config.PLAN_FILE;

function loadSeed() {
  const raw = fs.readFileSync(SEED_FILE, 'utf8');
  SEED = JSON.parse(raw);
  COIN_BY_NAME = new Map(SEED.coins.map((c) => [c.name, c]));
  const imgDir = path.join(PUBLIC_DIR, 'img');
  try {
    IMG_SET = fs.readdirSync(imgDir)
      .filter((f) => /^\d{3}\.jpg$/i.test(f))
      .map((f) => parseInt(f.slice(0, 3), 10))
      .sort((a, b) => a - b);
  } catch {
    IMG_SET = [];
  }
  // 实拍 / 示意图 归属（tools/fill_images.py 生成）
  try {
    const m = JSON.parse(fs.readFileSync(path.join(PUBLIC_DIR, 'data', 'images.json'), 'utf8'));
    IMG_REAL = Array.isArray(m.real) ? m.real : [];
  } catch {
    IMG_REAL = [];
  }
  try {
    DESC = JSON.parse(fs.readFileSync(path.join(PUBLIC_DIR, 'data', 'descriptions.json'), 'utf8'));
  } catch {
    DESC = {};
  }
  try {
    PLAN = JSON.parse(fs.readFileSync(PLAN_FILE, 'utf8'));
    const planN = (PLAN.years || []).reduce((a, y) => a + (y.items || []).length, 0);
    console.log(`[boot] 发行计划 ${(PLAN.years || []).length} 个年度 / ${planN} 个项目`);
  } catch {
    PLAN = { years: [] };
  }
  try {
    const gpath = path.join(PUBLIC_DIR, 'data', 'gallery.json');
    const g = JSON.parse(fs.readFileSync(gpath, 'utf8'));
    GALLERY = g && g.coins ? g.coins : {};
    // 图片地址带 ?v=<gallery mtime>：换图后 URL 变化，绕开 /img/ 的 7 天强缓存
    GALLERY_VER = String(Math.round(fs.statSync(gpath).mtimeMs)).slice(-8);
  } catch {
    GALLERY = {};
    GALLERY_VER = '';
  }
  const galCount = Object.keys(GALLERY).reduce((a, k) => a + (GALLERY[k] || []).length, 0);
  console.log(`[boot] 发行清单 ${SEED.coins.length} 个品种，图片 ${IMG_SET.length} 张（实拍 ${IMG_REAL.length}），多图 ${galCount} 张，官方介绍 ${Object.keys(DESC).length} 条`);
  // 页面渲染模块与这里共用同一份 SEED/DESC 对象（渲染代码逐字保留，不做改写）
  pageRender.setData({ seed: SEED, desc: DESC });
}

/* ---------------------------------------------------------
   初始化：超管 + 旧数据认领
   --------------------------------------------------------- */
function defaultHoldings() {
  return (SEED.defaults || []).map((x, i) => ({
    id: 'h' + (i + 1),
    name: x.name,
    rolls: x.rolls,
    cost: x.cost,
    market: x.market,
    group: x.group || '独立藏品',
    sep: !!x.sep
  }));
}

async function ensureSuperadmin() {
  const d = store.load();
  const admin = auth.findByName(d, SUPERADMIN_NAME);

  if (!admin) {
    const { salt, hash } = auth.hashPassword(superadminPassword());
    await store.commit((draft) => {
      const u = {
        id: auth.nextID(draft),
        name: SUPERADMIN_NAME,
        role: 'admin',
        salt, hash,
        createdAt: new Date().toISOString(),
        lastLogin: null
      };
      draft.users.push(u);
      // 旧版单用户数据认领给超管
      if (Array.isArray(draft.holdings._legacy)) {
        draft.holdings[u.id] = draft.holdings._legacy;
        delete draft.holdings._legacy;
      } else if (!Array.isArray(draft.holdings[u.id])) {
        draft.holdings[u.id] = defaultHoldings();
      }
      return u;
    });
    console.log(`[boot] 已创建超级管理员「${SUPERADMIN_NAME}」并接管初始藏品`);
    return;
  }

  if (Array.isArray(d.holdings._legacy)) {
    await store.commit((draft) => {
      draft.holdings[admin.id] = draft.holdings._legacy;
      delete draft.holdings._legacy;
    });
    console.log('[boot] 旧持仓已归属超管');
  }
}

/* ---------------------------------------------------------
   数据拼装
   --------------------------------------------------------- */
function buildBootstrap(req) {
  const d = store.load();
  const me = auth.currentUser(req, d);
  const prices = d.prices || {};
  const coins = SEED.coins.map((c) => {
    const p = prices[String(c.i)];
    return typeof p === 'number' ? Object.assign({}, c, { est: p }) : c;
  });
  const holdings = me && Array.isArray(d.holdings[me.id]) ? d.holdings[me.id] : [];
  return {
    version: VERSION,
    rev: d.rev || 0,
    serverTime: new Date().toISOString(),
    user: auth.publicUser(me),
    isAdmin: !!(me && me.role === 'admin'),
    coins,
    series: SEED.series,
    sets: SEED.sets || {},
    defaults: SEED.defaults,
    holdings,
    imgSet: IMG_SET,
    imgReal: IMG_REAL,
    gallery: GALLERY,
    galleryVer: GALLERY_VER,
    plan: PLAN,
    seriesMeta: seriesSvc.listWithCount(SEED.coins),
    desc: DESC,
    userCount: d.users.length
  };
}

/* ---------------------------------------------------------
   校验
   --------------------------------------------------------- */
const MAX_HOLDINGS = 300;
function badRequest(msg) { const e = new Error(msg); e.status = 400; return e; }

function normalizeHoldings(input) {
  if (!Array.isArray(input)) throw badRequest('holdings 必须是数组');
  if (input.length > MAX_HOLDINGS) throw badRequest(`持仓条目不能超过 ${MAX_HOLDINGS}`);
  const seen = new Set();
  return input.map((h, idx) => {
    if (!h || typeof h !== 'object') throw badRequest(`第 ${idx + 1} 条格式错误`);
    const name = String(h.name || '').trim();
    if (!COIN_BY_NAME.has(name) && !PM_BY_NAME.has(name)) throw badRequest(`未知品种：${name}`);
    if (seen.has(name)) throw badRequest(`品种重复：${name}`);
    seen.add(name);
    const rolls = Number(h.rolls);
    const cost = Number(h.cost);
    const market = Number(h.market);
    if (!Number.isFinite(rolls) || rolls < 0 || rolls > 999) throw badRequest(`${name} 的数量不合法`);
    if (!Number.isFinite(cost) || cost < 0 || cost > 1e8) throw badRequest(`${name} 的成本不合法`);
    if (!Number.isFinite(market) || market < 0 || market > 1e8) throw badRequest(`${name} 的市价不合法`);
    return {
      id: String(h.id || 'h' + (idx + 1)),
      name,
      rolls: Math.round(rolls),
      cost: Math.round(cost * 100) / 100,
      market: Math.round(market * 100) / 100,
      group: String(h.group || '独立藏品').slice(0, 24),
      sep: !!h.sep,
      category: ['coin','note','pm'].indexOf(h.category) >= 0 ? h.category : 'coin',
      // 贵金属缩略图与「按单枚记」口径（migration 007）。
      // thumb 允许相对路径或 http(s) URL，限制长度即可；unit 白名单 piece，其余按套处理。
      thumb: String(h.thumb || '').slice(0, 512),
      unit: h.unit === 'piece' ? 'piece' : ''
    };
  });
}

/* ---------------------------------------------------------
   工具
   --------------------------------------------------------- */
function sendJSON(res, status, body, extraHeaders) {
  const payload = JSON.stringify(body);
  res.writeHead(status, Object.assign({
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff'
  }, extraHeaders || {}));
  res.end(payload);
}

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

function clientIP(req) {
  const xf = req.headers['x-forwarded-for'];
  if (xf) return String(xf).split(',')[0].trim();
  return req.socket.remoteAddress || '-';
}

/* ---------------- 微信小程序登录 ---------------- */
const WX_APPID = process.env.WX_APPID || 'wx905c4968911fa23d';

/** 用 wx.login 拿到的 code 换 openid。secret 只从环境变量读，永不落盘、不入库。 */

/** 校验并应用某品种的可改字段；返回实际生效的字段，非法字段直接忽略 */
function applyCoinPatch(coin, patch) {
  const NUM_FIELDS = { year: 1, face: 1, est: 1, mintage: 1, pieces: 1 };
  const TXT_FIELDS = { material: 1, dia: 1, series: 1, set: 1, kind: 1 };
  const applied = {};
  Object.keys(patch || {}).forEach((k) => {
    const v = patch[k];
    if (NUM_FIELDS[k]) {
      const n = Number(v);
      if (!isFinite(n) || n < 0) return;
      coin[k] = (k === 'year' || k === 'pieces') ? Math.round(n) : n;
      applied[k] = coin[k];
    } else if (TXT_FIELDS[k]) {
      const str = String(v == null ? '' : v).trim();
      if (k === 'series' && !SEED.series[str]) return;
      if (k === 'set' && str !== 'single' && !(SEED.sets || {})[str]) return;
      if (k === 'kind' && str !== 'coin' && str !== 'note') return;
      if (k === 'dia' && str.length > 8) return;
      if (k === 'material' && str.length > 24) return;
      coin[k] = str;
      applied[k] = str;
    }
  });
  return applied;
}

function wxCode2Session(code) {
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

/** 给微信新用户起一个不冲突的昵称 */
function wxName(doc) {
  for (let i = 0; i < 50; i += 1) {
    const name = '藏友' + Math.random().toString(36).slice(2, 6).toUpperCase();
    if (!auth.findByName(doc, name)) return name;
  }
  return '藏友' + Date.now().toString(36).slice(-4).toUpperCase();
}

const GALLERY_FILE = config.GALLERY_FILE;

/** 把内存里的图库写回文件（后台改图后调用） */
function writeGallery() {
  const doc = { updated: new Date().toISOString().slice(0, 10), coins: GALLERY };
  fs.writeFileSync(GALLERY_FILE, JSON.stringify(doc) + '\n', 'utf8');
  // 关键：galleryVer 原本只在服务启动时算一次，管理端换图后它不变，
  // 前台 /img/ 的 7 天缓存就会一直显示旧图（比如换了正面仍显示背面）。
  // 每次写 gallery 同步刷新内存版本号，图片 URL 的 ?v= 立即失效。
  GALLERY_VER = String(Date.now()).slice(-8);
}

function isSecure(req) {
  if (req.socket.encrypted) return true;
  return String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https';
}

function requireLogin(req, res, d) {
  const me = auth.currentUser(req, d);
  if (!me) { sendJSON(res, 401, { ok: false, error: '请先登录', needLogin: true }); return null; }
  return me;
}



/** 校验发行计划：结构完整、项目 key 全局唯一、必填字段非空 */
function validatePlan(plan) {
  if (!plan || typeof plan !== 'object') return '计划数据不合法';
  if (!Array.isArray(plan.years)) return '缺少 years 数组';
  const keys = new Set();
  for (const y of plan.years) {
    if (!y || !Number.isFinite(Number(y.year))) return '年度缺少合法 year';
    if (!Array.isArray(y.items)) return y.year + ' 年缺少 items 数组';
    for (const it of y.items) {
      if (!it || typeof it.key !== 'string' || !it.key.trim()) return '项目缺少 key';
      if (keys.has(it.key)) return '项目 key 重复：' + it.key;
      keys.add(it.key);
      if (!String(it.name || '').trim()) return '项目 ' + it.key + ' 缺少名称';
    }
  }
  return '';
}

/** 表单里数字常被提交成字符串，落盘前统一收敛类型 */
function normalizePlan(plan) {
  if (!plan || typeof plan !== 'object') return plan;
  const NUM = ['face', 'mintage', 'limit', 'coinNo', 'proxy'];
  (plan.years || []).forEach((y) => {
    if (!Array.isArray(y.items)) return;
    y.items.forEach((it) => {
      NUM.forEach((k) => {
        if (it[k] === '') delete it[k];
        else if (it[k] !== undefined && it[k] !== null) it[k] = Number(it[k]) || 0;
      });
      if (it.extra !== undefined) it.extra = it.extra === true || it.extra === 'true' || it.extra === 1;
      if (Array.isArray(it.schedule)) {
        it.schedule = it.schedule.filter((s) => s && (String(s.k || '').trim() || String(s.v || '').trim()));
      }
    });
  });
  return plan;
}

/** 从发行计划里按 key 找项目 */
function findPlanItem(key) {
  const plan = (PLAN && PLAN.years) ? PLAN : null;
  if (!plan) return null;
  for (const y of plan.years) {
    const hit = (y.items || []).filter((it) => it.key === key)[0];
    if (hit) return Object.assign({ year: y.year, publishedAt: y.publishedAt }, hit);
  }
  return null;
}


function requireAdmin(req, res, d) {
  const me = requireLogin(req, res, d);
  if (!me) return null;
  if (me.role !== 'admin') { sendJSON(res, 403, { ok: false, error: '需要管理员权限' }); return null; }
  return me;
}


/* ---------------------------------------------------------
   路由
   --------------------------------------------------------- */
async function handleApi(req, res, pathname) {
  const method = req.method;
  const ip = clientIP(req);
  const d = store.load();

  if (pathname === '/api/health' && method === 'GET') {
    return sendJSON(res, 200, {
      ok: true, version: VERSION,
      uptime: Math.floor((Date.now() - START_AT) / 1000),
      coins: SEED.coins.length, images: IMG_SET.length,
      users: d.users.length, rev: d.rev || 0,
      storage: store.info(),
      guard: guard.stats()
    });
  }

  if (pathname === '/api/bootstrap' && method === 'GET') {
    return sendJSON(res, 200, buildBootstrap(req));
  }

  /* 轻量状态接口：小程序已内置品种目录，只需账号 / 持仓 / 行情 */

  /* ---------------- 我的资料：昵称 + 头像 ---------------- */
  if (pathname === '/api/me/profile' && method === 'POST') {
    const me = requireLogin(req, res, d);
    if (!me) return;
    const body = await readBody(req, 6 * 1024 * 1024);

    const patch = {};
    if (typeof body.nickname === 'string') {
      const nick = body.nickname.trim().slice(0, 16);
      if (nick && nick.length < 2) return sendJSON(res, 400, { ok: false, error: '昵称至少 2 个字' });
      if (nick) {
        const chk = await wxsec.checkText(nick, me.wxOpenid || '');
        if (!chk.ok) return sendJSON(res, 400, { ok: false, error: '这个昵称不太合适，换一个吧' });
      }
      patch.nickname = nick;
    }

    if (body.avatar === '') {
      // 显式传空 = 清除头像
      if (me.avatar) {
        try { fs.unlinkSync(path.join(PUBLIC_DIR, 'avatar', me.avatar)); } catch (e) { /* ignore */ }
      }
      patch.avatar = '';
    } else if (typeof body.avatar === 'string' && body.avatar) {
      const m = /^data:image\/(jpeg|jpg|png);base64,([A-Za-z0-9+/=]+)$/.exec(body.avatar);
      if (!m) return sendJSON(res, 400, { ok: false, error: '头像只支持 JPEG / PNG' });
      const buf = Buffer.from(m[2], 'base64');
      if (!buf.length || buf.length > 1024 * 1024) {
        return sendJSON(res, 400, { ok: false, error: '头像不能超过 1MB' });
      }
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

    if (!Object.keys(patch).length) return sendJSON(res, 400, { ok: false, error: '没有要保存的内容' });

    const updated = await store.commit((draft) => {
      const u = auth.findByID(draft, me.id);
      if (u) Object.assign(u, patch);
      return auth.publicUser(auth.findByID(draft, me.id));
    });
    return sendJSON(res, 200, { ok: true, user: updated });
  }

  if (pathname === '/api/state' && method === 'GET') {
    const d2 = store.load();
    const me = auth.currentUser(req, d2);
    return sendJSON(res, 200, {
      ok: true,
      rev: d2.rev || 0,
      user: auth.publicUser(me),
      isAdmin: !!(me && me.role === 'admin'),
      holdings: me && Array.isArray(d2.holdings[me.id]) ? d2.holdings[me.id] : [],
      prices: d2.prices || {},
      userCount: d2.users.length
    });
  }

  /* ---------------- 访问统计（匿名，不存 IP） ---------------- */
  if (pathname === '/api/visit' && method === 'POST') {
    const today = new Date().toISOString().slice(0, 10);
    // 兼容旧版前端（不带 body）：总数照记，明细只在带会话 ID 时写
    let vbody = {};
    try { vbody = await readBody(req, 4096); } catch (e) { vbody = {}; }
    const sid = String(vbody.sid || '').slice(0, 40);
    const vtab = String(vbody.tab || 'home').slice(0, 24);
    const vclient = vbody.client === 'mp' ? 'mp' : 'web';
    if (/^[A-Za-z0-9_-]{8,40}$/.test(sid) && !visitors.recentlySeen(sid, vtab, 30, vclient)) {
      const vme = auth.currentUser(req, d);
      const xff = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
      visitors.add({
        sid,
        tab: vtab,
        client: vclient,
        path: String(vbody.path || '').slice(0, 160),
        ip: String(req.headers['x-real-ip'] || xff || req.socket.remoteAddress || '').slice(0, 64),
        ua: String(req.headers['user-agent'] || '').slice(0, 240),
        uid: vme ? vme.id : '',
        userName: vme ? vme.name : '',
      });
    }
    const total = await store.commit((draft) => {
      if (!draft.visits) draft.visits = { total: 0, days: {} };
      if (!draft.visits.days) draft.visits.days = {};
      draft.visits.total = (draft.visits.total || 0) + 1;
      draft.visits.days[today] = (draft.visits.days[today] || 0) + 1;
      return draft.visits.total;
    });
    return sendJSON(res, 200, { ok: true, total, today: store.load().visits.days[today] || 1 });
  }

  if (pathname === '/api/visit' && method === 'GET') {
    const v = d.visits || { total: 0, days: {} };
    const today = new Date().toISOString().slice(0, 10);
    return sendJSON(res, 200, { ok: true, total: v.total || 0, today: (v.days && v.days[today]) || 0 });
  }

  /* ---------------- 认证 ---------------- */
  if (pathname === '/api/auth/me' && method === 'GET') {
    const me = auth.currentUser(req, d);
    return sendJSON(res, 200, { ok: true, user: auth.publicUser(me), isAdmin: !!(me && me.role === 'admin') });
  }

  if (pathname === '/api/auth/register' && method === 'POST') {
    if (d.users.length >= auth.MAX_USERS) {
      return sendJSON(res, 429, { ok: false, error: '注册人数已达上限' });
    }
    const body = await readBody(req, 4096);
    const v = auth.validateRegister(body.name, body.password);
    if (!v.ok) return sendJSON(res, 400, { ok: false, error: v.error });
    if (auth.findByName(d, v.name)) return sendJSON(res, 409, { ok: false, error: '该用户名已被占用' });

    const { salt, hash } = auth.hashPassword(v.password);
    const created = await store.commit((draft) => {
      const u = {
        id: auth.nextID(draft),
        name: v.name,
        role: 'user',
        salt, hash,
        createdAt: new Date().toISOString(),
        lastLogin: new Date().toISOString()
      };
      draft.users.push(u);
      draft.holdings[u.id] = [];       // 新用户从空账本开始
      return u;
    });
    const token = auth.issueToken(created);
    return sendJSON(res, 200,
      { ok: true, token, user: auth.publicUser(created), isAdmin: false },
      { 'Set-Cookie': auth.sessionCookie(token, { secure: isSecure(req) }) });
  }

  if (pathname === '/api/auth/login' && method === 'POST') {
    if (auth.ipFails(ip) >= auth.MAX_FAIL) {
      return sendJSON(res, 429, { ok: false, error: '尝试次数过多，请 10 分钟后再试' });
    }
    const body = await readBody(req, 4096);
    const name = String(body.name || '').trim();
    const u = auth.findByName(d, name);
    if (!u || !auth.verifyPassword(body.password, u.salt, u.hash)) {
      auth.markFail(ip);
      return sendJSON(res, 401, { ok: false, error: '用户名或密码不正确' });
    }
    auth.clearFail(ip);
    if (u.disabled) {
      return sendJSON(res, 403, { ok: false, error: '账号已被禁用，请联系管理员' });
    }
    await store.commit((draft) => {
      const t = auth.findByID(draft, u.id);
      if (t) t.lastLogin = new Date().toISOString();
    });
    const token = auth.issueToken(u);
    return sendJSON(res, 200,
      { ok: true, token, user: auth.publicUser(u), isAdmin: u.role === 'admin' },
      { 'Set-Cookie': auth.sessionCookie(token, { secure: isSecure(req) }) });
  }

  /* ---------------- 微信一键登录 ---------------- */
  if (pathname === '/api/auth/wx/login' && method === 'POST') {
    const body = await readBody(req, 4096);
    const code = String(body.code || '').trim();
    if (!code) return sendJSON(res, 400, { ok: false, error: '缺少微信登录凭证' });

    let sess;
    try {
      sess = await wxCode2Session(code);
    } catch (e) {
      return sendJSON(res, e.status || 400, { ok: false, error: e.message, wxCode: e.wxCode || 0 });
    }

    const cur = store.load();
    let u = cur.users.filter((x) => x.wxOpenid === sess.openid)[0] || null;
    let isNew = false;

    if (!u) {
      if (cur.users.length >= auth.MAX_USERS) {
        return sendJSON(res, 429, { ok: false, error: '注册人数已达上限' });
      }
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
          lastLogin: new Date().toISOString()
        };
        draft.users.push(created);
        draft.holdings[created.id] = [];      // 微信新用户从空账本开始
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
    return sendJSON(res, 200,
      { ok: true, token, user: auth.publicUser(u), isAdmin: u.role === 'admin', isNew },
      { 'Set-Cookie': auth.sessionCookie(token, { secure: isSecure(req) }) });
  }

  if (pathname === '/api/auth/wx/bind' && method === 'POST') {
    const me = requireLogin(req, res, d);
    if (!me) return;
    const body = await readBody(req, 4096);
    const code = String(body.code || '').trim();
    if (!code) return sendJSON(res, 400, { ok: false, error: '缺少微信登录凭证' });

    let sess;
    try {
      sess = await wxCode2Session(code);
    } catch (e) {
      return sendJSON(res, e.status || 400, { ok: false, error: e.message, wxCode: e.wxCode || 0 });
    }

    const owner = store.load().users.filter((x) => x.wxOpenid === sess.openid)[0];
    if (owner && owner.id !== me.id) {
      return sendJSON(res, 409, { ok: false, error: '这个微信已经绑定过其他账号了' });
    }
    await store.commit((draft) => {
      const t = auth.findByID(draft, me.id);
      if (t) t.wxOpenid = sess.openid;
    });
    return sendJSON(res, 200, { ok: true });
  }

  if (pathname === '/api/auth/wx/unbind' && method === 'POST') {
    const me = requireLogin(req, res, d);
    if (!me) return;
    await store.commit((draft) => {
      const t = auth.findByID(draft, me.id);
      if (t) { t.wxOpenid = ''; t.wxUnionid = ''; }
    });
    return sendJSON(res, 200, { ok: true });
  }

  if (pathname === '/api/auth/logout' && method === 'POST') {
    return sendJSON(res, 200, { ok: true },
      { 'Set-Cookie': auth.sessionCookie('', { clear: true, secure: isSecure(req) }) });
  }

  if (pathname === '/api/auth/password' && method === 'POST') {
    const me = requireLogin(req, res, d);
    if (!me) return;
    const body = await readBody(req, 4096);
    // 微信建号没有密码：允许首次直接设置，之后改密码仍需验证原密码
    if (me.hash && !auth.verifyPassword(body.oldPassword, me.salt, me.hash)) {
      return sendJSON(res, 400, { ok: false, error: '原密码不正确' });
    }
    const np = String(body.newPassword || '');
    if (np.length < auth.MIN_PW) return sendJSON(res, 400, { ok: false, error: `新密码至少 ${auth.MIN_PW} 位` });
    if (/^\d+$/.test(np)) return sendJSON(res, 400, { ok: false, error: '新密码不能是纯数字' });
    const { salt, hash } = auth.hashPassword(np);
    await store.commit((draft) => {
      const t = auth.findByID(draft, me.id);
      if (t) { t.salt = salt; t.hash = hash; }
    });
    return sendJSON(res, 200, { ok: true });
  }

  /* ---------------- 持仓（按用户隔离） ---------------- */
  if (pathname === '/api/holdings' && method === 'PUT') {
    const me = requireLogin(req, res, d);
    if (!me) return;
    const body = await readBody(req);
    const holdings = normalizeHoldings(body.holdings);
    const rev = await store.commit((draft) => {
      draft.holdings[me.id] = holdings;
      return draft.rev + 1;
    });
    return sendJSON(res, 200, { ok: true, rev, count: holdings.length });
  }

  if (pathname === '/api/holdings/reset' && method === 'POST') {
    const me = requireLogin(req, res, d);
    if (!me) return;
    const rev = await store.commit((draft) => {
      draft.holdings[me.id] = defaultHoldings();
      return draft.rev + 1;
    });
    return sendJSON(res, 200, { ok: true, rev, holdings: store.load().holdings[me.id] });
  }

  /* ---------------- 行情（全局，仅管理员） ---------------- */
  if (pathname === '/api/prices' && method === 'PUT') {
    const me = requireAdmin(req, res, d);
    if (!me) return;
    const body = await readBody(req);
    const input = body.prices;
    if (!input || typeof input !== 'object') throw badRequest('prices 必须是对象');
    const prices = {};
    Object.keys(input).forEach((k) => {
      const i = Number(k);
      const v = Number(input[k]);
      if (!Number.isInteger(i) || i < 0 || i >= SEED.coins.length) throw badRequest(`未知品种编号 ${k}`);
      if (!Number.isFinite(v) || v < 0 || v > 1e7) throw badRequest(`编号 ${k} 的价格不合法`);
      prices[String(i)] = Math.round(v * 100) / 100;
    });
    const rev = await store.commit((draft) => {
      draft.prices = Object.assign({}, draft.prices, prices);
      return draft.rev + 1;
    });
    return sendJSON(res, 200, { ok: true, rev, count: Object.keys(prices).length });
  }

  /* ---------------- 管理端 ---------------- */
  /* 反爬封禁：误伤时可自查、可解封，不必等封禁过期或重启服务 */
  if (pathname === '/api/admin/guard/bans' && method === 'GET') {
    const me = requireAdmin(req, res, d);
    if (!me) return;
    return sendJSON(res, 200, { ok: true, bans: guard.listBans(), stats: guard.stats() });
  }

  if (pathname === '/api/admin/guard/unban' && method === 'POST') {
    const me = requireAdmin(req, res, d);
    if (!me) return;
    const body = await readBody(req);
    const ip = String(body.ip || '').trim();
    if (!ip) throw badRequest('缺少 ip');
    const removed = guard.unban(ip);
    audit.log(me.name, 'guard.unban', ip, removed ? '已解封' : '未找到封禁', clientIP(req));
    return sendJSON(res, 200, { ok: true, removed });
  }

  /* ---------------- 用户管理（分页 / 搜索 / 批量 / 角色 / 禁用 / 审计） ---------------- */
  const adminQuery = url.parse(req.url, true).query;

  if (pathname === '/api/admin/users' && method === 'GET') {
    const me = requireAdmin(req, res, d);
    if (!me) return;
    const kw = String(adminQuery.q || '').trim().toLowerCase();
    const role = String(adminQuery.role || 'all');
    const status = String(adminQuery.status || 'all');
    const sort = String(adminQuery.sort || '-createdAt');
    const page = Math.max(1, Number(adminQuery.page) || 1);
    const size = Math.min(200, Math.max(1, Number(adminQuery.size) || 20));

    let list = d.users.map((u) => Object.assign(auth.publicUser(u), {
      holdings: Array.isArray(d.holdings[u.id]) ? d.holdings[u.id].length : 0
    }));
    const stats = {
      total: list.length,
      admins: list.filter((u) => u.role === 'admin').length,
      tests: list.filter((u) => u.isTest).length,
      disabled: list.filter((u) => u.disabled).length
    };
    if (kw) list = list.filter((u) =>
      [u.id, u.name, u.nickname].some((v) => String(v || '').toLowerCase().includes(kw)));
    if (role === 'admin' || role === 'user') list = list.filter((u) => u.role === role);
    if (status === 'active') list = list.filter((u) => !u.disabled && !u.isTest);
    else if (status === 'disabled') list = list.filter((u) => u.disabled);
    else if (status === 'test') list = list.filter((u) => u.isTest);

    const desc = sort.charAt(0) === '-';
    const key = desc ? sort.slice(1) : sort;
    list.sort((a, b) => {
      const av = a[key] == null ? '' : a[key];
      const bv = b[key] == null ? '' : b[key];
      const n = (typeof av === 'number' && typeof bv === 'number')
        ? av - bv
        : String(av).localeCompare(String(bv), 'zh-CN');
      return desc ? -n : n;
    });
    return sendJSON(res, 200, {
      ok: true,
      users: list.slice((page - 1) * size, page * size),
      total: list.length, page, size, stats
    });
  }

  if (pathname === '/api/admin/audit' && method === 'GET') {
    const me = requireAdmin(req, res, d);
    if (!me) return;
    return sendJSON(res, 200, Object.assign({ ok: true }, audit.query(adminQuery)));
  }

  const holdMatch = pathname.match(/^\/api\/admin\/users\/([A-Za-z0-9_]+)\/holdings$/);
  if (holdMatch && method === 'GET') {
    const me = requireAdmin(req, res, d);
    if (!me) return;
    const target = auth.findByID(d, holdMatch[1]);
    if (!target) return sendJSON(res, 404, { ok: false, error: '用户不存在' });
    const items = Array.isArray(d.holdings[target.id]) ? d.holdings[target.id] : [];
    return sendJSON(res, 200, { ok: true, user: auth.publicUser(target), holdings: items });
  }

  const userMatch = pathname.match(/^\/api\/admin\/users\/([A-Za-z0-9_]+)$/);

  if (userMatch && method === 'GET') {
    const me = requireAdmin(req, res, d);
    if (!me) return;
    const target = auth.findByID(d, userMatch[1]);
    if (!target) return sendJSON(res, 404, { ok: false, error: '用户不存在' });
    return sendJSON(res, 200, {
      ok: true,
      user: Object.assign(auth.publicUser(target), {
        holdings: Array.isArray(d.holdings[target.id]) ? d.holdings[target.id].length : 0
      })
    });
  }

  if (pathname === '/api/admin/users/batch' && method === 'POST') {
    const me = requireAdmin(req, res, d);
    if (!me) return;
    const body = await readBody(req, 16384);
    const ids = Array.isArray(body.ids) ? body.ids.map(String) : [];
    const action = String(body.action || '');
    const ALLOWED = { markTest: 1, unmarkTest: 1, disable: 1, enable: 1, delete: 1 };
    if (!ids.length || !ALLOWED[action]) return sendJSON(res, 400, { ok: false, error: '参数不合法' });
    if (ids.length > 100) return sendJSON(res, 400, { ok: false, error: '一次最多操作 100 个账号' });
    let affected = 0;
    await store.commit((draft) => {
      ids.forEach((id) => {
        if (id === me.id) return;
        const u = auth.findByID(draft, id);
        if (!u) return;
        if (action === 'delete') {
          if (u.role === 'admin') return;
          draft.users = draft.users.filter((x) => x.id !== id);
          delete draft.holdings[id];
        } else if (action === 'markTest') u.isTest = true;
        else if (action === 'unmarkTest') u.isTest = false;
        else if (action === 'disable') u.disabled = true;
        else if (action === 'enable') u.disabled = false;
        affected += 1;
      });
    });
    audit.log(me.name, 'user.batch.' + action, ids.join(','), '成功 ' + affected + ' 个', clientIP(req));
    return sendJSON(res, 200, { ok: true, affected });
  }

  if (userMatch && method === 'PATCH') {
    const me = requireAdmin(req, res, d);
    if (!me) return;
    const target = auth.findByID(d, userMatch[1]);
    if (!target) return sendJSON(res, 404, { ok: false, error: '用户不存在' });
    const body = await readBody(req, 4096);
    const patch = {};
    if (typeof body.isTest === 'boolean') patch.isTest = body.isTest;
    if (typeof body.disabled === 'boolean') patch.disabled = body.disabled;
    if (body.role === 'admin' || body.role === 'user') patch.role = body.role;
    if (!Object.keys(patch).length) return sendJSON(res, 400, { ok: false, error: '没有可修改的字段' });
    if (target.id === me.id) return sendJSON(res, 400, { ok: false, error: '不能修改自己的账号状态' });
    if (patch.role && target.role === 'admin' && patch.role !== 'admin'
        && d.users.filter((u) => u.role === 'admin').length <= 1) {
      return sendJSON(res, 400, { ok: false, error: '至少保留一个管理员' });
    }
    await store.commit((draft) => {
      const u = auth.findByID(draft, target.id);
      if (u) Object.assign(u, patch);
    });
    audit.log(me.name, 'user.patch', target.name, JSON.stringify(patch), clientIP(req));
    return sendJSON(res, 200, Object.assign({ ok: true }, patch));
  }

  if (userMatch && method === 'DELETE') {
    const me = requireAdmin(req, res, d);
    if (!me) return;
    const target = auth.findByID(d, userMatch[1]);
    if (!target) return sendJSON(res, 404, { ok: false, error: '用户不存在' });
    if (target.id === me.id) return sendJSON(res, 400, { ok: false, error: '不能删除自己' });
    if (target.role === 'admin' && d.users.filter((u) => u.role === 'admin').length <= 1) {
      return sendJSON(res, 400, { ok: false, error: '至少保留一个管理员' });
    }
    await store.commit((draft) => {
      draft.users = draft.users.filter((u) => u.id !== target.id);
      delete draft.holdings[target.id];
    });
    audit.log(me.name, 'user.delete', target.name, '账号及藏品已删除', clientIP(req));
    return sendJSON(res, 200, { ok: true });
  }


  /* ---------------- 发行预约提醒（订阅消息） ---------------- */
  if (pathname === '/api/reminders' && method === 'GET') {
    const me = requireLogin(req, res, d);
    if (!me) return;
    return sendJSON(res, 200, {
      ok: true,
      templateId: reminders.TEMPLATE_ID,
      wxBound: !!me.wxOpenid,
      items: reminders.listOf(me.id),
    });
  }

  if (pathname === '/api/reminders' && method === 'POST') {
    const me = requireLogin(req, res, d);
    if (!me) return;
    if (!me.wxOpenid) {
      return sendJSON(res, 400, { ok: false, error: '订阅提醒需要微信登录后才能收到通知' });
    }
    const body = await readBody(req, 4096);
    const key = String(body.key || '').trim();
    const item = findPlanItem(key);
    if (!item) return sendJSON(res, 400, { ok: false, error: '这个发行项目不存在' });
    const r = reminders.upsert(me, item, { note: body.note, platform: body.platform });
    if (!r.ok) return sendJSON(res, 400, { ok: false, error: r.error });
    return sendJSON(res, 200, {
      ok: true,
      item: { id: r.item.id, key: r.item.key, name: r.item.name, remindAt: r.item.remindAt },
      remindText: reminders.timeText(new Date(r.item.remindAt)),
      items: reminders.listOf(me.id),
    });
  }

  if (pathname === '/api/reminders' && method === 'DELETE') {
    const me = requireLogin(req, res, d);
    if (!me) return;
    const body = await readBody(req, 4096);
    const id = String(body.id || body.key || '').trim();
    if (!id) return sendJSON(res, 400, { ok: false, error: '缺少要取消的提醒' });
    reminders.cancel(me.id, id);
    return sendJSON(res, 200, { ok: true, items: reminders.listOf(me.id) });
  }



  /* ---------------- 访客明细（管理端） ---------------- */
  if (pathname === '/api/admin/visitors' && method === 'GET') {
    const me = requireAdmin(req, res, d);
    if (!me) return;
    const vq = url.parse(req.url, true).query;
    const client = ['web', 'mp'].indexOf(String(vq.client || '')) >= 0 ? String(vq.client) : 'all';
    const range = ['today', 'week', 'month', 'year', 'all'].indexOf(String(vq.range || '')) >= 0 ? String(vq.range) : 'all';
    const items = visitors.load().items;
    return sendJSON(res, 200, Object.assign({ ok: true }, visitors.stats(items, { client, range })));
  }

  /* 管理员查看某个 IP / 会话的访问明细 */
  if (pathname === '/api/admin/visitors/detail' && method === 'GET') {
    const me = requireAdmin(req, res, d);
    if (!me) return;
    const dq = url.parse(req.url, true).query;
    const ip = String(dq.ip || '').slice(0, 80);
    const sid = String(dq.sid || '').slice(0, 40);
    const range = ['today', 'week', 'month', 'year', 'all'].indexOf(String(dq.range || '')) >= 0 ? String(dq.range) : 'all';
    if (!ip && !sid) return sendJSON(res, 400, { ok: false, error: '缺少 ip 或 sid' });
    const scoped = visitors.filterByRange(visitors.load().items, range);
    return sendJSON(res, 200, Object.assign({ ok: true }, visitors.detail(scoped, { ip, sid })));
  }

  /* ---------------- 功能建议（更多功能页） ---------------- */
  if (pathname === '/api/feature-request' && method === 'POST') {
    const me = requireLogin(req, res, d);
    if (!me) return;
    if (me.isTest) return sendJSON(res, 403, { ok: false, error: '这个入口对测试账号不开放' });
    const body = await readBody(req, 8192);
    const text = String(body.text || '').trim();
    if (text.length < 4) return sendJSON(res, 400, { ok: false, error: '多写几个字，我们才知道你想要的' });
    if (text.length > 400) return sendJSON(res, 400, { ok: false, error: '最多 400 字' });

    const mine = feedback.list('all').filter((x) => x.uid === me.id && x.kind === 'feature');
    const today = new Date().toISOString().slice(0, 10);
    if (mine.filter((x) => String(x.createdAt).slice(0, 10) === today).length >= 3) {
      return sendJSON(res, 429, { ok: false, error: '今天已经提了 3 条，明天再来' });
    }

    const chk = await wxsec.checkText(text, me.wxOpenid || '');
    if (!chk.ok) return sendJSON(res, 400, { ok: false, error: '内容里有不适合发布的信息，请修改后再提交' });

    const rec = feedback.add({ kind: 'feature', uid: me.id, userName: me.name, text });
    console.log('[feature] ' + me.name + ' 提需求：' + text.slice(0, 40));
    return sendJSON(res, 200, { ok: true, id: rec.id });
  }

  /* 用户查自己的反馈与管理员回复 */
  if (pathname === '/api/feedback/mine' && method === 'GET') {
    const me = requireLogin(req, res, d);
    if (!me) return;
    const items = feedback.listByUser(me.id);
    return sendJSON(res, 200, { ok: true, items, open: items.filter((x) => x.status === 'open').length });
  }

  /* ---------------- 纠错反馈 ---------------- */
  if (pathname === '/api/feedback' && method === 'POST') {
    const me = requireLogin(req, res, d);
    if (!me) return;
    const body = await readBody(req, 8 * 1024 * 1024);
    const text = String(body.text || '').trim();
    if (text.length < 4) return sendJSON(res, 400, { ok: false, error: '请把问题写清楚一点（至少 4 个字）' });
    if (text.length > 800) return sendJSON(res, 400, { ok: false, error: '反馈内容最多 800 字' });
    if (feedback.todayCount(me.id) >= 10) {
      return sendJSON(res, 429, { ok: false, error: '今天提交得有点多，明天再来吧' });
    }
    // UGC 必须过内容安全检测（微信审核硬性要求）
    const textCheck = await wxsec.checkText(text, me.wxOpenid || '');
    if (!textCheck.ok) {
      console.log('[feedback] 文本未通过内容安全 uid=' + me.id + ' reason=' + textCheck.reason);
      return sendJSON(res, 400, { ok: false, error: '内容里有不适合发布的信息，请修改后再提交' });
    }

    const coinId = Number(body.coinId) || 0;
    const coin = SEED.coins.filter((c) => Number(c.i) + 1 === coinId)[0];
    const rawImgs = Array.isArray(body.images) ? body.images.slice(0, 3) : [];
    const bufs = rawImgs.map((d) => feedback.decodeImage(d)).filter(Boolean);
    const images = [];
    for (const buf of bufs) {
      const imgCheck = await wxsec.checkImage(buf);
      if (!imgCheck.ok) {
        console.log('[feedback] 图片未通过内容安全 uid=' + me.id + ' reason=' + imgCheck.reason);
        return sendJSON(res, 400, { ok: false, error: '图片里有不适合发布的内容，请换一张' });
      }
      const name = feedback.saveBuffer(buf);
      if (name) images.push(name);
    }
    const saved = feedback.add({
      uid: me.id,
      userName: me.name,
      coinId,
      coinName: coin ? coin.name : '',
      text,
      images
    });
    console.log('[feedback] ' + me.name + ' → #' + coinId + ' ' + text.slice(0, 30));
    return sendJSON(res, 200, { ok: true, id: saved.id });
  }

  if (pathname === '/api/admin/feedback' && method === 'GET') {
    const me = requireAdmin(req, res, d);
    if (!me) return;
    const q = url.parse(req.url, true).query;
    const items = feedback.list(q.status || 'all');
    const open = feedback.list('open').length;
    return sendJSON(res, 200, { ok: true, items, open });
  }

  const fbMatch = pathname.match(/^\/api\/admin\/feedback\/([A-Za-z0-9]+)$/);
  if (fbMatch && method === 'PATCH') {
    const me = requireAdmin(req, res, d);
    if (!me) return;
    const body = await readBody(req, 4096);
    const hit = feedback.update(fbMatch[1], body);
    if (!hit) return sendJSON(res, 404, { ok: false, error: '反馈不存在' });
    audit.log(me.name, 'feedback.' + (body.status === 'done' ? 'done' : 'reopen'), fbMatch[1], '', clientIP(req));
    return sendJSON(res, 200, { ok: true, item: hit });
  }

  if (fbMatch && method === 'DELETE') {
    const me = requireAdmin(req, res, d);
    if (!me) return;
    const hit = feedback.remove(fbMatch[1]);
    if (!hit) return sendJSON(res, 404, { ok: false, error: '反馈不存在' });
    audit.log(me.name, 'feedback.delete', fbMatch[1], '', clientIP(req));
    return sendJSON(res, 200, { ok: true });
  }


  /* ---------------- 系列（公开读取） ---------------- */
  if (pathname === '/api/series' && method === 'GET') {
    return sendJSON(res, 200, { ok: true, items: seriesSvc.listWithCount(SEED.coins) });
  }

  /* ---------------- 系列管理 ---------------- */
  /* ---------------- 发行计划管理 ---------------- */
  if (pathname === '/api/admin/plan' && method === 'GET') {
    const me = requireAdmin(req, res, d);
    if (!me) return;
    return sendJSON(res, 200, { ok: true, plan: PLAN });
  }

  if (pathname === '/api/admin/plan' && method === 'PUT') {
    const me = requireAdmin(req, res, d);
    if (!me) return;
    const body = await readBody(req, 512 * 1024);
    const next = normalizePlan(body && body.plan ? body.plan : body);
    const bad = validatePlan(next);
    if (bad) return sendJSON(res, 400, { ok: false, error: bad });
    fs.writeFileSync(PLAN_FILE, JSON.stringify(next, null, 1) + '\n', 'utf8');
    PLAN = next;   // /api/bootstrap 立即下发新计划，无需重启
    const years = (next.years || []).length;
    const items = (next.years || []).reduce((a, y) => a + (y.items || []).length, 0);
    audit.log(me.name, 'plan.update', '', years + ' 个年度 / ' + items + ' 个项目', clientIP(req));
    console.log('[admin] 更新发行计划：' + years + ' 个年度 / ' + items + ' 个项目');
    return sendJSON(res, 200, { ok: true, years, items });
  }

  /* 批量设置某系列的成员（整份替换）：一次请求完成增减，避免逐条 PATCH 被限流打断 */
  if (pathname === '/api/admin/series/members' && method === 'POST') {
    const me = requireAdmin(req, res, d);
    if (!me) return;
    const body = await readBody(req, 65536);
    const key = String(body.key || '').trim();
    if (!seriesSvc.load().items.some((seriesItem) => seriesItem.key === key)) {
      return sendJSON(res, 400, { ok: false, error: '系列不存在' });
    }
    if (!Array.isArray(body.ids)) return sendJSON(res, 400, { ok: false, error: '缺少 ids 数组' });
    const want = new Set(body.ids.map(Number));
    let changed = 0;
    SEED.coins.forEach((c) => {
      const id = Number(c.i) + 1;
      const cur = Array.isArray(c.seriesKeys) ? c.seriesKeys.slice() : (c.series ? [c.series] : []);
      const has = cur.indexOf(key) >= 0;
      const should = want.has(id);
      if (has === should) return;
      const next = has ? cur.filter((k) => k !== key) : cur.concat([key]);
      // 同步主系列字段：移出后不再把该系列当主系列，加入时可补上，
      // 否则 seriesSvc.listWithCount 会在 seriesKeys 为空时回退到 series 而算错数量。
      if (c.series === key && !should) c.series = next[0] || '';
      if (!c.series && should) c.series = key;
      c.seriesKeys = next;
      changed += 1;
    });
    if (changed) {
      fs.writeFileSync(SEED_FILE, JSON.stringify(SEED) + '\n', 'utf8');
      audit.log(me.name, 'series.members', key,
        '变更 ' + changed + ' 个品种 / 现有 ' + want.size + ' 个成员', clientIP(req));
      console.log('[admin] 系列 ' + key + ' 成员更新：变更 ' + changed + ' 个品种');
    }
    return sendJSON(res, 200, {
      ok: true, key, count: want.size, changed,
      series: seriesSvc.listWithCount(SEED.coins)
    });
  }

  if (pathname === '/api/admin/series' && method === 'POST') {
    const me = requireAdmin(req, res, d);
    if (!me) return;
    const body = await readBody(req, 16384);
    const r = seriesSvc.create(body);
    if (!r.ok) return sendJSON(res, 400, { ok: false, error: r.error });
    console.log('[series] 新建系列 ' + r.item.key + ' ' + r.item.name);
    audit.log(me.name, 'series.create', r.item.key, r.item.name, clientIP(req));
    return sendJSON(res, 200, { ok: true, item: r.item, items: seriesSvc.listWithCount(SEED.coins) });
  }

  if (pathname === '/api/admin/series/image' && method === 'POST') {
    const me = requireAdmin(req, res, d);
    if (!me) return;
    const body = await readBody(req, 6 * 1024 * 1024);
    const key = String(body.key || '').trim();
    if (!key) return sendJSON(res, 400, { ok: false, error: '缺少系列 key' });
    const r = seriesSvc.saveImage(key, body.data);
    if (!r.ok) return sendJSON(res, 400, { ok: false, error: r.error });
    seriesSvc.update(key, { img: r.img });
    audit.log(me.name, 'series.image', key, r.img, clientIP(req));
    return sendJSON(res, 200, { ok: true, img: r.img, items: seriesSvc.listWithCount(SEED.coins) });
  }

  const serieMatch = pathname.match(/^\/api\/admin\/series\/([A-Za-z0-9_]+)$/);
  if (serieMatch && method === 'PATCH') {
    const me = requireAdmin(req, res, d);
    if (!me) return;
    const body = await readBody(req, 16384);
    const r = seriesSvc.update(serieMatch[1], body);
    if (!r.ok) return sendJSON(res, 404, { ok: false, error: r.error });
    audit.log(me.name, 'series.update', serieMatch[1], JSON.stringify(body), clientIP(req));
    return sendJSON(res, 200, { ok: true, item: r.item, items: seriesSvc.listWithCount(SEED.coins) });
  }

  if (serieMatch && method === 'DELETE') {
    const me = requireAdmin(req, res, d);
    if (!me) return;
    const r = seriesSvc.remove(serieMatch[1], SEED.coins);
    if (!r.ok) return sendJSON(res, 404, { ok: false, error: r.error });
    fs.writeFileSync(SEED_FILE, JSON.stringify(SEED) + '\n', 'utf8');
    console.log('[series] 删除系列 ' + serieMatch[1] + '，清理成员 ' + r.touched + ' 个');
    audit.log(me.name, 'series.delete', serieMatch[1], '清理 ' + r.touched + ' 个品种', clientIP(req));
    return sendJSON(res, 200, { ok: true, touched: r.touched, items: seriesSvc.listWithCount(SEED.coins) });
  }

  /* ---------------- 参数与图片管理 ---------------- */
  if (pathname === '/api/admin/coins' && method === 'GET') {
    const me = requireAdmin(req, res, d);
    if (!me) return;
    return sendJSON(res, 200, { ok: true, coins: SEED.coins, series: SEED.series, sets: SEED.sets || {}, gallery: GALLERY });
  }


  if (pathname === '/api/admin/coins' && method === 'PATCH') {
    const me = requireAdmin(req, res, d);
    if (!me) return;
    const body = await readBody(req, 512 * 1024);
    const items = Array.isArray(body.items) ? body.items : [];
    if (!items.length) return sendJSON(res, 400, { ok: false, error: '没有要保存的内容' });
    if (items.length > 300) return sendJSON(res, 400, { ok: false, error: '一次最多保存 300 条' });
    const done = [];
    const failed = [];
    items.forEach((it) => {
      const id = Number(it && it.id);
      const coin = SEED.coins.filter((c) => Number(c.i) + 1 === id)[0];
      if (!coin) { failed.push({ id: id, error: '品种不存在' }); return; }
      const applied = applyCoinPatch(coin, (it && it.patch) || {});
      if (!Object.keys(applied).length) { failed.push({ id: id, error: '没有可保存的字段' }); return; }
      done.push({ id: id, applied: applied });
    });
    if (done.length) {
      fs.writeFileSync(SEED_FILE, JSON.stringify(SEED) + '\n', 'utf8');
      console.log('[admin] 批量修改 ' + done.length + ' 个品种');
      audit.log(me.name, 'coins.batchUpdate', '', '修改 ' + done.length + ' 个品种', clientIP(req));
    }
    return sendJSON(res, 200, { ok: failed.length === 0, saved: done.length, failed: failed });
  }

  if (pathname === '/api/admin/coin' && method === 'PATCH') {
    const me = requireAdmin(req, res, d);
    if (!me) return;
    const body = await readBody(req, 16384);
    const id = Number(body.id);
    const coin = SEED.coins.filter((c) => Number(c.i) + 1 === id)[0];
    if (!coin) return sendJSON(res, 404, { ok: false, error: '品种不存在' });
    const patch = body.patch || {};
    const NUM_FIELDS = { year: 1, face: 1, est: 1, mintage: 1, pieces: 1, setSize: 1 };
    const TXT_FIELDS = { material: 1, dia: 1, series: 1, set: 1, kind: 1 };
    const seriesKeys = Array.isArray(patch.seriesKeys) ? patch.seriesKeys : null;
    const applied = {};
    Object.keys(patch).forEach((k) => {
      const v = patch[k];
      if (NUM_FIELDS[k]) {
        const n = Number(v);
        if (!isFinite(n) || n < 0) return;
        coin[k] = (k === 'year' || k === 'pieces' || k === 'setSize') ? Math.round(n) : n;
        applied[k] = coin[k];
      } else if (TXT_FIELDS[k]) {
        const str = String(v == null ? '' : v).trim();
        if (k === 'series' && !SEED.series[str]) return;
        if (k === 'set' && str !== 'single' && !(SEED.sets || {})[str]) return;
        if (k === 'kind' && str !== 'coin' && str !== 'note') return;
        if (k === 'dia' && str.length > 8) return;
        if (k === 'material' && str.length > 24) return;
        if (k === 'series' && str !== coin.series) {
          const extras = (coin.seriesKeys || []).filter((x) => x !== coin.series && x !== str);
          coin.seriesKeys = [str].concat(extras);
        }
        coin[k] = str;
        applied[k] = str;
      }
    });
    if (seriesKeys) {
      const valid = seriesKeys
        .map((k) => String(k).trim())
        .filter((k) => seriesSvc.load().items.some((s2) => s2.key === k));
      coin.seriesKeys = Array.from(new Set(valid));
      if (!coin.seriesKeys.length && coin.series) coin.seriesKeys = [coin.series];
      applied.seriesKeys = coin.seriesKeys;
    }
    if (!Object.keys(applied).length) return sendJSON(res, 400, { ok: false, error: '没有可保存的字段' });
    fs.writeFileSync(SEED_FILE, JSON.stringify(SEED) + '\n', 'utf8');
    console.log('[admin] 修改品种 ' + id + ' ' + coin.name + '：' + JSON.stringify(applied));
    audit.log(me.name, 'coin.update', String(id), JSON.stringify(applied), clientIP(req));
    return sendJSON(res, 200, { ok: true, coin, applied });
  }

  if (pathname === '/api/admin/gallery' && method === 'POST') {
    const me = requireAdmin(req, res, d);
    if (!me) return;
    const body = await readBody(req, 32768);
    const id = String(Number(body.id));
    const list = Array.isArray(body.images) ? body.images : [];
    const KINDS = { main: 1, obverse: 1, reverse: 1, set: 1 };
    const clean = [];
    for (const it of list) {
      if (!it || !KINDS[it.k] || typeof it.f !== 'string') continue;
      if (clean.some((x) => x.k === it.k)) continue;
      if (!fs.existsSync(path.join(PUBLIC_DIR, 'img', it.f))) continue;
      clean.push({ f: it.f, k: it.k });
    }
    if (clean.length) GALLERY[id] = clean;
    else delete GALLERY[id];
    writeGallery();
    audit.log(me.name, 'gallery.update', String(id), clean.length + ' 张图', clientIP(req));
    return sendJSON(res, 200, { ok: true, images: GALLERY[id] || [] });
  }

  if (pathname === '/api/admin/image' && method === 'POST') {
    const me = requireAdmin(req, res, d);
    if (!me) return;
    const body = await readBody(req, 6 * 1024 * 1024);
    const id = Number(body.id);
    const kind = String(body.kind || '');
    const SUFFIX = { main: '', obverse: '-f', reverse: '-b', set: '-s' };
    if (!(kind in SUFFIX)) return sendJSON(res, 400, { ok: false, error: '图片类型不合法' });
    const coin = SEED.coins.filter((c) => Number(c.i) + 1 === id)[0];
    if (!coin) return sendJSON(res, 404, { ok: false, error: '品种不存在' });
    const raw = String(body.data || '');
    const m = /^data:image\/(jpeg|jpg|png);base64,([A-Za-z0-9+/=]+)$/.exec(raw);
    if (!m) return sendJSON(res, 400, { ok: false, error: '只支持 JPEG / PNG' });
    const buf = Buffer.from(m[2], 'base64');
    if (!buf.length) return sendJSON(res, 400, { ok: false, error: '图片内容为空' });
    if (buf.length > 4 * 1024 * 1024) return sendJSON(res, 413, { ok: false, error: '图片超过 4MB，请先压缩' });
    const fname = String(id).padStart(3, '0') + SUFFIX[kind] + '.jpg';
    fs.writeFileSync(path.join(PUBLIC_DIR, 'img', fname), buf);

    // 主图上传时，前端会附带两张按内容裁切好的方形缩略图（480 / 160）。
    // 站点列表与小图直接读 /img/th/NNN.jpg 和 /img/th/s/NNN.jpg。
    if (kind === 'main') {
      [['thumb480', ''], ['thumb160', 's']].forEach((pair) => {
        const tm = /^data:image\/(?:jpeg|jpg);base64,([A-Za-z0-9+/=]+)$/.exec(String(body[pair[0]] || ''));
        if (!tm) return;
        const thumb = Buffer.from(tm[1], 'base64');
        if (!thumb.length || thumb.length > 2 * 1024 * 1024) return;
        const dir = path.join(PUBLIC_DIR, 'img', 'th', pair[1]);
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, fname), thumb);
      });
    }

    const list = (GALLERY[String(id)] || []).filter((it) => it.k !== kind);
    list.push({ f: fname, k: kind });
    GALLERY[String(id)] = list;
    writeGallery();
    console.log('[admin] 上传图片 ' + fname + '（' + Math.round(buf.length / 1024) + 'KB）');
    audit.log(me.name, 'image.upload', fname, kind, clientIP(req));
    return sendJSON(res, 200, { ok: true, file: fname, images: list });
  }

  if (pathname === '/api/admin/image' && method === 'DELETE') {
    const me = requireAdmin(req, res, d);
    if (!me) return;
    const q = url.parse(req.url, true).query;
    const id = String(Number(q.id));
    const kind = String(q.kind || '');
    const list = GALLERY[id] || [];
    const hit = list.filter((it) => it.k === kind)[0];
    if (!hit) return sendJSON(res, 404, { ok: false, error: '没有这张图' });
    const rest = list.filter((it) => it.k !== kind);
    if (rest.length) GALLERY[id] = rest;
    else delete GALLERY[id];
    try { fs.unlinkSync(path.join(PUBLIC_DIR, 'img', hit.f)); } catch (e) { /* 文件可能已不在 */ }
    if (kind === 'main') {
      try { fs.unlinkSync(path.join(PUBLIC_DIR, 'img', 'th', hit.f)); } catch (e) { /* 可能没有 */ }
      try { fs.unlinkSync(path.join(PUBLIC_DIR, 'img', 'th', 's', hit.f)); } catch (e) { /* 可能没有 */ }
    }
    writeGallery();
    audit.log(me.name, 'image.delete', id + ':' + kind, hit.f, clientIP(req));
    return sendJSON(res, 200, { ok: true, images: rest });
  }

  // 蜜罐：仅作诱饵。一次误点只记录，反复命中才短封（见 server/guard.js）
  if (pathname === '/api/__trap') {
    const t = guard.trap(ip, req);
    const detail = t.ignored ? '可信来源，忽略'
      : t.banned ? `第 ${t.hits} 次，已封禁 ${t.banMs}ms`
        : `第 ${t.hits} 次，未达阈值 ${t.threshold}`;
    console.log(`[guard] 蜜罐命中 ${ip}：${detail}`);
    return sendJSON(res, 404, { ok: false, error: '接口不存在' });
  }

  return sendJSON(res, 404, { ok: false, error: '接口不存在' });
}

/* ---------------------------------------------------------
   对外暴露（index.js 薄壳 / app.js / 静态层用）
   --------------------------------------------------------- */
/** T03：图库服务写文件后调用，刷新内存里的 galleryVer（与旧 writeGallery 同一函数）。 */
function touchGallery() { writeGallery(); }

/** T03：发行计划服务整份替换后调用，让老 reminders 分支立即看到新计划。 */
function setPlan(next) { PLAN = next; }

/** 启动时从数据库装载贵金属名称白名单（唯一可收藏的 pm 品种） */
async function loadPmNames(pool) {
  try {
    const [rows] = await pool.query('SELECT code, name FROM cl_ecgci_pm');
    PM_BY_NAME = new Map(rows.map((r) => [r.name, r]));
    return PM_BY_NAME.size;
  } catch (e) {
    PM_BY_NAME = new Map();
    return 0;
  }
}

module.exports = {
  // 生命周期
  loadSeed: loadSeed,
  loadPmNames: loadPmNames,
  ensureSuperadmin: ensureSuperadmin,
  START_AT: START_AT,
  VERSION: VERSION,
  PUBLIC_DIR: PUBLIC_DIR,
  SEED_FILE: SEED_FILE,
  PLAN_FILE: PLAN_FILE,

  // 请求处理
  handleApi: handleApi,
  sendJSON: sendJSON,
  readBody: readBody,
  clientIP: clientIP,
  buildBootstrap: buildBootstrap,
  defaultHoldings: defaultHoldings,

  // 只读视图（health / 分层实现取数用；不要在这些对象上原地改业务字段）
  touchGallery: touchGallery,
  setPlan: setPlan,

  state: function () {
    return {
      seed: SEED,
      desc: DESC,
      plan: PLAN,
      gallery: GALLERY,
      galleryVer: GALLERY_VER,
      imgSet: IMG_SET,
      imgReal: IMG_REAL
    };
  }
};
