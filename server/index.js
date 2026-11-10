'use strict';
/**
 * 藏币录后端 · 多用户版
 *   - REST API（/api/*）
 *   - 静态托管（public/，生产环境由 Nginx 接管，这里便于本地直跑）
 *   - 口令注册/登录，持仓按用户隔离，行情全局共享
 */
const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const url = require('url');
const https = require('https');

const store = require('./store');
const auth = require('./auth');
const feedback = require('./feedback');
const visitors = require('./visitors');
const wxsec = require('./wxsec');
const reminders = require('./reminders');
const seriesSvc = require('./series');
const guard = require('./guard');

const VERSION = require('../package.json').version || '1.0.0';
const PORT = Number(process.env.PORT || 3100);
const HOST = process.env.HOST || '127.0.0.1';
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const SEED_FILE = path.join(PUBLIC_DIR, 'data', 'coins.json');
const START_AT = Date.now();

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
let IMG_SET = [];
let IMG_REAL = [];   // 有官方实拍图的品种编号
let GALLERY = {};    // 品种 → 多图（正面 / 背面 / 整套）
let GALLERY_VER = ''; // gallery.json 的 mtime，用来给图片 URL 加 ?v= 破缓存
let DESC = {};       // 品种官方介绍（摘自央行发行公告）
let PLAN = { years: [] };  // 普通纪念币年度发行计划（public/data/plan.json）

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
    PLAN = JSON.parse(fs.readFileSync(path.join(PUBLIC_DIR, 'data', 'plan.json'), 'utf8'));
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
    if (!COIN_BY_NAME.has(name)) throw badRequest(`未知品种：${name}`);
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
      sep: !!h.sep
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

const GALLERY_FILE = path.join(__dirname, '..', 'public', 'data', 'gallery.json');

/** 把内存里的图库写回文件（后台改图后调用） */
function writeGallery() {
  const doc = { updated: new Date().toISOString().slice(0, 10), coins: GALLERY };
  fs.writeFileSync(GALLERY_FILE, JSON.stringify(doc) + '\n', 'utf8');
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
   前端路由（真实路径）+ 页面级 meta 注入
   /coin/12、/all 这类地址没有对应文件，落到这里回 index.html；
   抓取端不跑 JS，标题/描述只能在这一层按路由换掉，否则全站一个标题。
   --------------------------------------------------------- */
const SITE = 'https://coin.virtualman.top';
const SPA_TABS = new Set(['home', 'plan', 'overview', 'series', 'holdings', 'cost', 'all', 'sitemap', 'account', 'admin']);
/* 标题/描述里不要再写死数字：{n}=品种数 {s}=系列数，渲染时按 coins.json 现算。
   之前 /all 的描述一直是「135 个普通纪念币」（数据早已 136），
   因为上一轮的兜底替换只认「N 个品种」这个句式，抓不到「N 个普通纪念币」。 */
const TAB_SEO = {
  sitemap: ['站点地图 | 藏币录',
    '藏币录全部页面与 136 个纪念币／纪念钞品种的索引，按系列分类，可直接进入任一品种详情。'],
  plan: ['发行计划 | 藏币录',
    '中国人民银行普通纪念币（钞）年度发行计划：哪些已发行、哪些待发行，含预约与发行日期、面额与发行量。'],
  home: ['藏币录 · 1984—2026 纪念币收藏管理与发行清单',
    '1984—2026 年中国普通纪念币与纪念钞全景档案：{n} 个品种的发行信息、币面实物图、套系进度，以及属于你自己的收藏账本。'],
  all: ['全套发行清单 · 1984—2026 普通纪念币与纪念钞 | 藏币录',
    '按年份排列的 {n} 个普通纪念币、纪念钞品种清单，含面额、发行量、材质与单枚／整套参考市价。'],
  series: ['按系列看套系进度 | 藏币录', '把 {n} 个品种归入 {s} 个系列，一眼看出每个系列还差哪几枚。'],
  overview: ['收藏概览 | 藏币录', '品种数、套系完成度、成本与盈亏的汇总视图。'],
  cost: ['收齐成本估算 | 藏币录', '按单枚与整套两种口径，估算把全套收齐需要多少钱。'],
  holdings: ['我的藏品 | 藏币录', '记录持仓数量、成本与市值，自动算浮动盈亏。'],
  account: ['账户 | 藏币录', '登录、注册与账户设置。'],
  admin: ['用户管理 | 藏币录', '管理员后台。']
};

let INDEX_TPL = '';
let INDEX_MTIME = 0;
/** 首页模板按 mtime 缓存，改完 index.html 不用重启 */
function indexTemplate() {
  const f = path.join(PUBLIC_DIR, 'index.html');
  try {
    const st = fs.statSync(f);
    if (st.mtimeMs !== INDEX_MTIME) {
      INDEX_TPL = fs.readFileSync(f, 'utf8');
      INDEX_MTIME = st.mtimeMs;
    }
  } catch { /* 读不到就沿用上一份 */ }
  return INDEX_TPL;
}
function escHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function fmMint(w) {
  const n = Number(w) || 0;
  if (n >= 10000) return (Math.round((n / 10000) * 10) / 10) + '亿';
  return n + '万';
}
/** 与前端 setSizeOf 同口径：限额 > 套系件数 > 20 */
function setSize(d) {
  if (!d) return 20;
  if (d.limit > 0) return d.limit;
  const meta = SEED.sets && SEED.sets[d.set];
  return (meta && meta.size) ? meta.size : 20;
}
/** 命中前端路由就返回 { tab, i }，否则 null（→ 正常 404） */
function spaRoute(pathname) {
  const p = String(pathname || '/').replace(/\/{2,}/g, '/').replace(/\/+$/, '');
  const m = /^\/coin\/(\d{1,3})$/.exec(p);
  if (m) {
    const i = Number(m[1]) - 1;
    return (i >= 0 && i < SEED.coins.length) ? { tab: 'coin', i } : null;
  }
  const name = p.replace(/^\//, '');
  if (!name) return { tab: 'home', i: null };
  if (SPA_TABS.has(name)) return { tab: name, i: null };
  return null;
}
/* ---------------------------------------------------------
   品种页静态正文（给不跑 JS 的抓取端）
   前端是纯 JS 渲染，/coin/N 返回的 HTML 原本与首页一字不差 —— 136 个品种页
   在抓取端就是 136 张「标题不同、正文相同」的重复页，这是收录不进来的主因。
   这里用 coins.json 的既有事实拼一段真正文（面额/材质/发行量/币面图案/同套系内链），
   内容与详情页完全一致，只是排版简陋；app.js 装配完成后会把它整块移除，
   用户看到的仍是原来的详情页，所以不存在「给爬虫看另一套内容」。
   --------------------------------------------------------- */
const SX_CSS = '<style>'
  + '.sx{max-width:760px;margin:26px auto 40px;padding:22px 20px 18px;border-radius:14px;'
  + 'background:#fff;color:#242424;font:15px/1.78 -apple-system,"PingFang SC","Microsoft YaHei",sans-serif;'
  + 'box-shadow:0 1px 3px rgba(0,0,0,.07)}'
  + '.sx a{color:#8a6314}'
  + '.sx-crumb{font-size:12px;color:#777;margin-bottom:10px}'
  + '.sx-crumb a{color:#777}'
  + '.sx h1{font-size:23px;line-height:1.45;margin:0 0 10px;font-family:"Songti SC","Noto Serif SC",serif}'
  + '.sx h2{font-size:16px;margin:22px 0 8px;padding-top:14px;border-top:1px solid #ececec}'
  + '.sx h3{font-size:14px;margin:12px 0 4px;color:#555}'
  + '.sx p{margin:0 0 10px}'
  + '.sx-facts{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:8px 18px;margin:14px 0 4px}'
  + '.sx-facts div{font-size:13px;border-bottom:1px dotted #ececec;padding-bottom:5px}'
  + '.sx-facts span{color:#888;margin-right:8px}'
  + '.sx-fig{float:right;width:190px;margin:0 0 12px 16px}'
  + '.sx-fig img{width:100%;height:auto;border-radius:10px;display:block;background:#f4f1ea}'
  + '.sx-links{margin:6px 0 0;padding-left:18px;font-size:14px;line-height:1.9}'
  + '.sx-note{font-size:12px;color:#888;margin-top:10px}'
  + '.sx-cta{margin-top:16px;padding:12px 14px;background:#faf6ec;border-radius:10px;font-size:14px}'
  + '@media (prefers-color-scheme:dark){.sx{background:#15181e;color:#e6e3db}'
  + '.sx h1,.sx h2{color:#f2eee4}.sx-facts div{border-color:#2a2f38}'
  + '.sx h2{border-color:#262b33}.sx-cta{background:#1d2128}.sx a{color:#d8b062}}'
  + '@media (max-width:640px){.sx{margin:14px 12px 30px;padding:16px 14px}'
  + '.sx h1{font-size:20px}.sx-fig{float:none;width:auto;max-width:260px;margin:0 0 12px}}'
  + '</style>';

function ssrCoinBlock(c, idx) {
  const isNote = c.kind === 'note';
  const unit = isNote ? '张' : '枚';
  const no = String(idx + 1).padStart(3, '0');
  const seriesName = (SEED.series && SEED.series[c.series]) || '';
  const setMeta = (c.set && SEED.sets) ? SEED.sets[c.set] : null;
  const setUnit = (setMeta && setMeta.unit) || unit;
  const n = setSize(c);
  const est = Number(c.est) || 0;
  const diaLabel = isNote ? '票幅' : '直径';
  const diaVal = isNote
    ? (c.size ? String(c.size).replace('×', ' × ') + ' 毫米' : '')
    : (c.dia && String(c.dia) !== '—' ? String(c.dia) + ' 毫米' : '');

  const facts = [['面额', c.face + ' 元']];
  if (c.material) facts.push(['材质', c.material]);
  if (diaVal) facts.push([diaLabel, diaVal]);
  if (c.mintage) facts.push(['发行量', fmMint(c.mintage) + unit]);
  if (c.thickness) facts.push(['厚度', c.thickness + (c.specFrom ? '（推定）' : '')]);
  if (c.weight) facts.push(['重量', c.weight + (c.specFrom ? '（推定）' : '')]);
  if (c.caster) facts.push(['铸造单位', String(c.caster).replace(/造币$/, '')]);
  if (c.edge) facts.push(['边齿', c.edge]);
  facts.push(['发行年份', c.year + ' 年']);
  if (seriesName) facts.push(['系列', seriesName]);
  if (setMeta) facts.push(['所属套系', setMeta.name + '（全套 ' + setMeta.total + ' ' + setUnit + '）']);

  const members = (setMeta && setMeta.members > 1)
    ? SEED.coins.filter((x) => x.set === c.set && x.i !== c.i) : [];
  /* 同套系多半就落在同系列里，两段列出同一批链接既啰嗦又浪费内链位 */
  const memberI = new Set(members.map((x) => x.i));
  const sibs = SEED.coins
    .filter((x) => x.series === c.series && x.i !== c.i && !memberI.has(x.i))
    .slice(-24).sort((a, b) => Math.abs(a.i - c.i) - Math.abs(b.i - c.i)).slice(0, 6);

  const link = (x) => '<li><a href="/coin/' + (x.i + 1) + '">'
    + escHtml(x.name) + '（' + x.year + '）</a></li>';

  let html = '<article class="sx" id="ssrCoin">'
    + '<nav class="sx-crumb"><a href="/">藏币录</a> › <a href="/all">全套发行清单</a>'
    + (seriesName ? ' › <a href="/series">' + seriesName + '</a>' : '')
    + ' › <span>' + escHtml(c.name) + '</span></nav>'
    + '<div class="sx-fig"><img src="/img/th/' + no + '.jpg" alt="'
    + escHtml(c.name) + ' ' + (isNote ? '纪念钞' : '纪念币') + ' 实物图" width="480" height="480"></div>'
    + '<h1>' + escHtml(c.name) + '（' + c.year + ' 年' + (isNote ? '纪念钞' : '普通纪念币') + '）</h1>'
    + '<p>' + c.year + ' 年，中国人民银行发行' + (isNote ? '纪念钞' : '普通纪念币') + '「'
    + escHtml(c.name) + '」，面额 ' + c.face + ' 元，'
    + (c.material ? escHtml(c.material) + '材质，' : '')
    + (diaVal ? diaLabel + ' ' + diaVal + '，' : '')
    + '发行量 ' + fmMint(c.mintage) + unit + '。'
    + (setMeta ? '该品种属于「' + escHtml(setMeta.name) + '」套系，全套 ' + setMeta.total + ' '
      + setUnit + '，本站已收录其中 ' + setMeta.members + ' 个品种。' : '')
    + (seriesName ? '按发行口径归入「' + seriesName + '」系列。' : '')
    + '</p>';

  html += '<div class="sx-facts">'
    + facts.map((f) => '<div><span>' + f[0] + '</span>' + escHtml(f[1]) + '</div>').join('')
    + '</div>';

  if (c.obverse || c.reverse) {
    html += '<h2>币面图案</h2>';
    if (c.obverse) html += '<h3>正面</h3><p>' + escHtml(c.obverse) + '</p>';
    if (c.reverse) html += '<h3>背面</h3><p>' + escHtml(c.reverse) + '</p>';
  }

  /* 央行发行公告原文（descriptions.json，127 个品种有）。详情页本来就展示它，
     这里一并给抓取端 —— 公告原文是最有分量的一段独有内容，顺带带上公告链接。 */
  const nt = DESC[String(idx + 1)];
  if (nt && nt.text) {
    html += '<h2>央行发行公告</h2>';
    if (nt.title) {
      html += '<p class="sx-note">' + escHtml(nt.title) + (nt.date ? '（' + escHtml(nt.date) + '）' : '')
        + (nt.url ? '，<a href="' + escHtml(nt.url) + '" target="_blank" rel="noopener">查看公告原文</a>' : '')
        + '</p>';
    }
    html += '<p>' + escHtml(nt.text) + '</p>';
  }

  html += '<h2>收藏参考</h2><p>按当前参考估值，单' + unit + '约 ' + est + ' 元'
    + (setMeta && n > 1 ? '；一套（' + n + ' ' + setUnit + '）约 ' + est * n + ' 元' : '')
    + '。估值随行情浮动，仅供参考，不是官方定价。</p>'
    + '<p>记账口径上，藏币录按「' + (isNote ? '刀' : '卷') + '」记录数量：1 '
    + (isNote ? '刀' : '卷') + ' = ' + n + ' ' + unit + '，成本与市值都按整' + (isNote ? '刀' : '卷')
    + '录入后自动折算成单' + unit + '与浮动盈亏。</p>';

  if (members.length || sibs.length) {
    html += '<h2>相关的' + (isNote ? '纪念钞' : '纪念币') + '</h2>';
    if (members.length) html += '<h3>同套系</h3><ul class="sx-links">'
      + members.slice(0, 12).map(link).join('') + '</ul>';
    if (sibs.length) html += '<h3>同系列（' + seriesName + '）</h3><ul class="sx-links">'
      + sibs.map(link).join('') + '</ul>';
  }

  html += '<p class="sx-cta"><a href="/account">免费注册</a>，把这枚币记进你的收藏账本：'
    + '按' + (isNote ? '刀' : '卷') + '记录数量与买入成本，自动算出市值和浮动盈亏。'
    + '也可以先<a href="/all">看全套发行清单</a>，确认自己还差哪几枚。</p>'
    + (c.specFrom ? '<p class="sx-note">注：该品种央行公告未公布厚度与重量，此处按同系列同规格推定。</p>' : '')
    + '<p class="sx-note">数据来源：中国人民银行发行公告及公开收藏资料；本站逐条核对面额、材质、发行量与票幅／直径。</p>'
    + '</article>';

  return html;
}

/* /sitemap 的正文由前端 JS 渲染，抓取端看不到那些链接 —— 服务端补一份纯 HTML 的，
   前端 renderSitemap() 会用更漂亮的网格覆盖它。两边内容一致，只是排版不同。 */
function sitemapStaticBlock() {
  const bySeries = {};
  SEED.coins.forEach((c) => { (bySeries[c.series] = bySeries[c.series] || []).push(c); });
  let html = '<nav class="sm-static">';
  Object.keys(bySeries).forEach((k) => {
    html += `<h3>${escHtml(SEED.series[k] || '其他')}</h3><ul>`;
    bySeries[k]
      .slice()
      .sort((a, b) => Number(a.year) - Number(b.year))
      .forEach((c) => { html += `<li><a href="/coin/${Number(c.i) + 1}">${escHtml(c.name)}</a></li>`; });
    html += '</ul>';
  });
  return html + '</nav>';
}

function renderIndex(route) {
  const tpl = indexTemplate();
  if (!tpl) return null;
  const total = SEED.coins.length;
  /* 系列页按套系分组展示，这里用同一个口径，免得首页写 18、点进去是 21 */
  const seriesN = Object.keys(SEED.sets || {}).length;
  const fill = (s) => String(s).replace(/\{n\}/g, total).replace(/\{s\}/g, seriesN);
  const c = route.tab === 'coin' ? SEED.coins[route.i] : null;
  let title, desc, path;
  if (c) {
    const isNote = c.kind === 'note';
    const unit = isNote ? '张' : '枚';
    const n = setSize(c);
    const est = Number(c.est) || 0;
    path = '/coin/' + (route.i + 1);
    title = `${c.name}（${c.year} ${isNote ? '纪念钞' : '纪念币'}）面额 ${c.face} 元 · 发行量 ${fmMint(c.mintage)}${unit} | 藏币录`;
    desc = `${c.year} 年发行的${isNote ? '纪念钞' : '普通纪念币'}「${c.name}」，面额 ${c.face} 元／${unit}，`
         + `${c.material}，${isNote ? '票幅' : '直径'} ${isNote ? (c.size ? String(c.size).replace('×', ' × ') + ' 毫米' : '—') : (c.dia === '—' ? '—' : c.dia + ' 毫米')}，发行量 ${fmMint(c.mintage)}${unit}。`
         + `单${unit}参考市价约 ${est} 元，一套（${n} ${unit}）约 ${est * n} 元。`;
  } else {
    const pair = TAB_SEO[route.tab] || TAB_SEO.home;
    path = route.tab === 'home' ? '/' : '/' + route.tab;
    title = fill(pair[0]);
    desc = fill(pair[1]);
  }
  const url = SITE + path;

  /* 品种页给搜索引擎一份结构化数据：
     - BreadcrumbList：百度/Google 会把层级显示在结果里（首页 › 清单 › 品种名）
     - Product（不带 offers）：面额/年份/发行量/材质作为 additionalProperty。
       故意不给 price —— 我们的是参考估值，不是真实售价，标成 Offer 容易被判作弊。 */
  let ld = '';
  if (c) {
    const isNote = c.kind === 'note';
    const unit = isNote ? '张' : '枚';
    const no = String(route.i + 1).padStart(3, '0');
    const product = {
      '@context': 'https://schema.org',
      '@type': 'Product',
      name: c.name,
      image: `${SITE}/img/${no}.jpg`,
      description: desc,
      category: isNote ? '纪念钞' : '普通纪念币',
      brand: { '@type': 'Organization', name: '中国人民银行' },
      additionalProperty: [
        { '@type': 'PropertyValue', name: '面额', value: `${c.face} 元` },
        { '@type': 'PropertyValue', name: '发行年份', value: String(c.year) },
        { '@type': 'PropertyValue', name: '发行量', value: `${fmMint(c.mintage)}${unit}` },
        { '@type': 'PropertyValue', name: '材质', value: c.material }
      ]
    };
    const crumb = {
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: '首页', item: `${SITE}/` },
        { '@type': 'ListItem', position: 2, name: '发行清单', item: `${SITE}/all` },
        { '@type': 'ListItem', position: 3, name: c.name, item: url }
      ]
    };
    ld = `<script type="application/ld+json">${JSON.stringify(product)}</script>\n`
       + `<script type="application/ld+json">${JSON.stringify(crumb)}</script>\n`;
  }

  let head = ld;
  let out = tpl
    .replace(/<title>[\s\S]*?<\/title>/, `<title>${escHtml(title)}</title>`)
    .replace(/(<meta name="description" content=")[\s\S]*?(">)/, `$1${escHtml(desc)}$2`)
    .replace(/(<meta property="og:title" content=")[\s\S]*?(">)/, `$1${escHtml(title)}$2`)
    .replace(/(<meta property="og:description" content=")[\s\S]*?(">)/, `$1${escHtml(desc)}$2`)
    .replace(/(<meta property="og:url" content=")[^"]*(")/, `$1${url}$2`)
    .replace(/(<link rel="canonical" href=")[^"]*(")/, `$1${url}$2`);

  /* 首页里的品种数/系列数是写死在 HTML 里的（数据涨到 136 条后还停在 135）。
     按元素 id 定位替换而不是替换固定数字，数据再涨也不用回来改这里。
     注意：站点根路径 / 由 nginx 直接吐静态文件、不经过这层，index.html 里也要写对。 */
  out = out
    .replace(/(id="coinTotalA">)\d+(<)/g, `$1${total}$2`)
    .replace(/(id="coinTotalB">)\d+(<)/g, `$1${total}$2`)
    .replace(/(id="filterCount">)\d+(<)/g, `$1${total}$2`)
    .replace(/(id="cntAll">)\d+(<)/g, `$1${total}$2`)
    .replace(/(data-copy="total">)\d+(<)/g, `$1${total}$2`)
    .replace(/\d+ 个品种/g, `${total} 个品种`)
    .replace(/\d+ 个系列/g, `${seriesN} 个系列`);

  if (c) {
    out = out.replace('<main class="wrap" id="main" tabindex="-1">',
      '<main class="wrap" id="main" tabindex="-1">' + ssrCoinBlock(c, route.i));
    head += SX_CSS;
  }
  if (route.tab === 'sitemap') {
    out = out.replace('<div id="sitemapBody"></div>', '<div id="sitemapBody">' + sitemapStaticBlock() + '</div>');
  }
  return out.replace('</head>', head + '</head>');
}
function sendIndex(res, route) {
  const html = renderIndex(route);
  if (!html) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('404 Not Found'); return; }
  res.writeHead(200, {
    'Content-Type': 'text/html; charset=utf-8',
    'Content-Length': Buffer.byteLength(html),
    'Cache-Control': 'no-cache'
    // 安全头由 Nginx 统一加（这里再加会出现重复头）
  });
  res.end(html);
}

/* ---------------------------------------------------------
   静态资源
   --------------------------------------------------------- */
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

function serveStatic(req, res, pathname) {
  let rel = decodeURIComponent(pathname);
  if (rel === '/' || rel === '' || rel === '/index.html') { sendIndex(res, { tab: 'home', i: null }); return; }
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
      const route = spaRoute(rel);
      if (route) { sendIndex(res, route); return; }
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
    if (/^[A-Za-z0-9_-]{8,40}$/.test(sid) && !visitors.recentlySeen(sid, vtab, 30)) {
      const vme = auth.currentUser(req, d);
      const xff = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
      visitors.add({
        sid,
        tab: vtab,
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
  if (pathname === '/api/admin/users' && method === 'GET') {
    const me = requireAdmin(req, res, d);
    if (!me) return;
    const list = d.users.map((u) => Object.assign(auth.publicUser(u), {
      holdings: Array.isArray(d.holdings[u.id]) ? d.holdings[u.id].length : 0
    }));
    return sendJSON(res, 200, { ok: true, users: list });
  }

  /* 超管查看某个用户的藏品明细 */
  const holdMatch = pathname.match(/^\/api\/admin\/users\/([A-Za-z0-9_]+)\/holdings$/);
  if (holdMatch && method === 'GET') {
    const me = requireAdmin(req, res, d);
    if (!me) return;
    const target = auth.findByID(d, holdMatch[1]);
    if (!target) return sendJSON(res, 404, { ok: false, error: '用户不存在' });
    const items = Array.isArray(d.holdings[target.id]) ? d.holdings[target.id] : [];
    return sendJSON(res, 200, { ok: true, user: auth.publicUser(target), holdings: items });
  }

  const delMatch = pathname.match(/^\/api\/admin\/users\/([A-Za-z0-9_]+)$/);
  const userMatch = delMatch;

  /* 标记 / 取消「测试账号」 */
  if (userMatch && method === 'PATCH') {
    const me = requireAdmin(req, res, d);
    if (!me) return;
    const target = auth.findByID(d, userMatch[1]);
    if (!target) return sendJSON(res, 404, { ok: false, error: '用户不存在' });
    const body = await readBody(req, 4096);
    if (typeof body.isTest !== 'boolean') {
      return sendJSON(res, 400, { ok: false, error: '缺少 isTest 字段（true / false）' });
    }
    if (target.id === me.id) return sendJSON(res, 400, { ok: false, error: '不能改自己的账号类型' });
    await store.commit((draft) => {
      const u = auth.findByID(draft, target.id);
      if (u) u.isTest = body.isTest;
    });
    console.log('[admin] ' + (body.isTest ? '标记测试账号' : '取消测试账号') + '：' + target.name);
    return sendJSON(res, 200, { ok: true, isTest: body.isTest });
  }

  if (delMatch && method === 'DELETE') {
    const me = requireAdmin(req, res, d);
    if (!me) return;
    const target = auth.findByID(d, delMatch[1]);
    if (!target) return sendJSON(res, 404, { ok: false, error: '用户不存在' });
    if (target.id === me.id) return sendJSON(res, 400, { ok: false, error: '不能删除自己' });
    if (target.role === 'admin') return sendJSON(res, 400, { ok: false, error: '不能删除管理员账号' });
    if (!target.isTest) {
      return sendJSON(res, 403, {
        ok: false,
        error: '只有「测试账号」可以删除。这是真实账号，先标记为测试账号再删。',
      });
    }
    await store.commit((draft) => {
      draft.users = draft.users.filter((u) => u.id !== target.id);
      delete draft.holdings[target.id];
    });
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
    const items = visitors.load().items;
    return sendJSON(res, 200, Object.assign({ ok: true }, visitors.stats(items)));
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
    return sendJSON(res, 200, { ok: true, item: hit });
  }

  if (fbMatch && method === 'DELETE') {
    const me = requireAdmin(req, res, d);
    if (!me) return;
    const hit = feedback.remove(fbMatch[1]);
    if (!hit) return sendJSON(res, 404, { ok: false, error: '反馈不存在' });
    return sendJSON(res, 200, { ok: true });
  }


  /* ---------------- 系列（公开读取） ---------------- */
  if (pathname === '/api/series' && method === 'GET') {
    return sendJSON(res, 200, { ok: true, items: seriesSvc.listWithCount(SEED.coins) });
  }

  /* ---------------- 系列管理 ---------------- */
  if (pathname === '/api/admin/series' && method === 'POST') {
    const me = requireAdmin(req, res, d);
    if (!me) return;
    const body = await readBody(req, 16384);
    const r = seriesSvc.create(body);
    if (!r.ok) return sendJSON(res, 400, { ok: false, error: r.error });
    console.log('[series] 新建系列 ' + r.item.key + ' ' + r.item.name);
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
    return sendJSON(res, 200, { ok: true, img: r.img, items: seriesSvc.listWithCount(SEED.coins) });
  }

  const serieMatch = pathname.match(/^\/api\/admin\/series\/([A-Za-z0-9_]+)$/);
  if (serieMatch && method === 'PATCH') {
    const me = requireAdmin(req, res, d);
    if (!me) return;
    const body = await readBody(req, 16384);
    const r = seriesSvc.update(serieMatch[1], body);
    if (!r.ok) return sendJSON(res, 404, { ok: false, error: r.error });
    return sendJSON(res, 200, { ok: true, item: r.item, items: seriesSvc.listWithCount(SEED.coins) });
  }

  if (serieMatch && method === 'DELETE') {
    const me = requireAdmin(req, res, d);
    if (!me) return;
    const r = seriesSvc.remove(serieMatch[1], SEED.coins);
    if (!r.ok) return sendJSON(res, 404, { ok: false, error: r.error });
    fs.writeFileSync(SEED_FILE, JSON.stringify(SEED) + '\n', 'utf8');
    console.log('[series] 删除系列 ' + serieMatch[1] + '，清理成员 ' + r.touched + ' 个');
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
    const list = (GALLERY[String(id)] || []).filter((it) => it.k !== kind);
    list.push({ f: fname, k: kind });
    GALLERY[String(id)] = list;
    writeGallery();
    console.log('[admin] 上传图片 ' + fname + '（' + Math.round(buf.length / 1024) + 'KB）');
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
    writeGallery();
    return sendJSON(res, 200, { ok: true, images: rest });
  }

  // 蜜罐：正常用户不会访问这里（页面上是个视觉隐藏的诱饵链接）
  if (pathname === '/api/__trap') {
    guard.trap(ip);
    console.log(`[guard] 蜜罐命中，已封禁 ${ip}`);
    return sendJSON(res, 404, { ok: false, error: '接口不存在' });
  }

  return sendJSON(res, 404, { ok: false, error: '接口不存在' });
}

/* ---------------------------------------------------------
   服务
   --------------------------------------------------------- */
const server = http.createServer(async (req, res) => {
  const started = Date.now();
  const { pathname } = url.parse(req.url);

  res.on('finish', () => {
    const ms = Date.now() - started;
    console.log(`${new Date().toISOString()} ${req.method} ${pathname} ${res.statusCode} ${ms}ms ${clientIP(req)}`);
  });

  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'same-origin');

  try {
    const ip = clientIP(req);
    const cls = pathname === '/api/auth/login' ? 'login'
      // 管理端批量保存会连发多次写请求，单独给一个更宽的桶，避免保存到一半被限流
      : (pathname.startsWith('/api/admin/') && req.method !== 'GET') ? 'adminWrite'
      : pathname.startsWith('/api/') ? (req.method === 'GET' ? 'read' : 'write')
      : 'static';
    const blocked = guard.inspect(req, { ip: ip, cls: cls });
    if (blocked) {
      const heads = Object.assign({
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store'
      }, blocked.headers || {});
      res.writeHead(blocked.status, heads);
      res.end(JSON.stringify({ ok: false, error: blocked.message }));
      return;
    }

    if (pathname.startsWith('/api/')) {
      await handleApi(req, res, pathname);
      return;
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { 'Content-Type': 'text/plain; charset=utf-8' }).end('405 Method Not Allowed');
      return;
    }
    serveStatic(req, res, pathname);
  } catch (e) {
    const status = e.status || 500;
    if (status >= 500) console.error('[error]', e);
    if (!res.headersSent) sendJSON(res, status, { ok: false, error: e.message || '服务器错误' });
    else res.end();
  }
});

function shutdown(sig) {
  console.log(`[shutdown] 收到 ${sig}，正在关闭…`);
  server.close(() => {
    Promise.resolve()
      .then(() => store.flush())
      .then(() => store.close())
      .catch(() => {})
      .then(() => process.exit(0));
  });
  setTimeout(() => process.exit(0), 3000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

async function boot() {
  /* 存储后端要先连上并拉回内存镜像，之后所有 route 才能同步读 doc */
  try {
    await store.init();
  } catch (e) {
    console.error('[boot] 存储初始化失败：' + e.message);
    process.exit(1);
  }
  const st = store.info();
  console.log(`[boot] 存储后端 ${st.mode}` +
    (st.mode === 'mysql' ? ` ${st.host}:${st.port}/${st.database}（账号 ${st.user}）` : ` ${st.file}`));

  loadSeed();
  await ensureSuperadmin();
  server.listen(PORT, HOST, () => {
    console.log(`[ready] 藏币录后端 v${VERSION} 监听 http://${HOST}:${PORT}`);
    reminders.start();          // 预约提醒定时器
  });
}

boot().catch((e) => {
  console.error('[boot] 启动失败：', e);
  process.exit(1);
});
