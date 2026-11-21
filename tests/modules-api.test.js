'use strict';
/**
 * 后端分层回归：auth / account / feedback / visitors / reminders / admin 各域路由。
 *
 * 与其它集成测试的区别：**不连数据库、不起端口**。
 *   - 用 require.cache 注入 store 桩（内存文档），路由照常走真实 service；
 *   - 用 Fastify 的 inject 发请求，真实经过 body 插件 → 路由 → 错误出口。
 *
 * 这样跑得快（<1s），也不需要生产 MySQL，专门守两类东西：
 *   1. 分层拆分后每条接口的路径、鉴权、状态码、错误文案有没有变；
 *   2. 拆文件时最容易漏的东西 —— 响应字段名与顺序、Set-Cookie。
 *
 * 运行：node --test tests/modules-api.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'cl-modules-api-'));

// 必须在任何业务模块 require 之前设好：feedback / visitors / reminders / audit 都在加载时读它
process.env.COIN_DATA_DIR = DATA_DIR;
process.env.SESSION_SECRET = 'test-secret';
process.env.WX_APPSECRET = '';

/** 深拷贝（store 桩用） */
function clone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

/* ---------------- store 桩：一份内存文档 ---------------- */
const doc = {
  rev: 0,
  users: [
    { id: 'u1', name: 'admin', role: 'admin', salt: '', hash: '', createdAt: '2026-01-01T00:00:00.000Z' },
    { id: 'u2', name: 'alice', role: 'user', salt: '', hash: '', createdAt: '2026-01-02T00:00:00.000Z' }
  ],
  holdings: { u1: [], u2: [{ id: 'h1', name: '测试币A', rolls: 1, cost: 10, market: 12 }] },
  prices: {},
  visits: { total: 0, days: {} }
};

const storeStub = {
  MODE: 'mysql',
  load: function () { return doc; },
  snapshot: function () { return clone(doc); },
  commit: async function (mutator) {
    const draft = clone(doc);
    const result = mutator(draft);
    draft.rev = (doc.rev || 0) + 1;
    Object.keys(doc).forEach((k) => { delete doc[k]; });
    Object.assign(doc, draft);
    return result;
  },
  flush: async function () {},
  close: async function () {},
  info: function () { return { mode: 'stub' }; }
};

/**
 * 用桩替换某个模块（必须在它被 require 之前）。
 *
 * @param {string} rel 相对仓库根的路径
 * @param {object} exportsObj 替换后的导出
 * @returns {void}
 */
function inject(rel, exportsObj) {
  const p = path.join(ROOT, rel);
  const r = require.resolve(p);
  delete require.cache[r];
  require.cache[r] = { id: p, filename: p, loaded: true, exports: exportsObj };
}

inject('server/store.js', storeStub);

const Fastify = require('fastify');
const bodyPlugin = require('../server/plugins/body');
const authPlugin = require('../server/plugins/auth');
const errorsPlugin = require('../server/plugins/errors');
const catalogState = require('../server/state/catalog');

const authRoutes = require('../server/routes/auth');
const accountRoutes = require('../server/routes/account');
const feedbackRoutes = require('../server/routes/feedback');
const visitorRoutes = require('../server/routes/visitors');
const reminderRoutes = require('../server/routes/reminders');
const adminUsersRoutes = require('../server/routes/admin/users');
const adminGuardRoutes = require('../server/routes/admin/guard');
const adminFeedbackRoutes = require('../server/routes/admin/feedback');
const adminVisitorsRoutes = require('../server/routes/admin/visitors');
const honeypotRoutes = require('../server/routes/honeypot');
const fallbackRoutes = require('../server/routes/fallback');

let app = null;
let adminCookie = '';
let userCookie = '';

/** 发一个请求并把 JSON 响应解出来 */
async function req(method, url, payload, cookie) {
  const headers = {};
  if (cookie) headers.cookie = cookie;
  const res = await app.inject({ method, url, payload, headers });
  let json = null;
  try { json = JSON.parse(res.payload); } catch (e) { json = null; }
  return { status: res.statusCode, body: json, headers: res.headers };
}

/** 从 Set-Cookie 里取 cl_session=... */
function cookieOf(res) {
  const raw = res.headers['set-cookie'];
  const list = Array.isArray(raw) ? raw : (raw ? [raw] : []);
  return list.map((s) => s.split(';')[0]).join('; ');
}

test.before(async function () {
  // 目录数据（coins.json / gallery.json / descriptions.json）是真实文件，本地就有
  catalogState.loadSeed();

  app = Fastify({ logger: false, bodyLimit: 8 * 1024 * 1024 });
  await app.register(bodyPlugin);
  await app.register(authPlugin);
  await app.register(errorsPlugin);
  await app.register(authRoutes);
  await app.register(accountRoutes);
  await app.register(feedbackRoutes);
  await app.register(visitorRoutes);
  await app.register(reminderRoutes);
  await app.register(adminUsersRoutes);
  await app.register(adminGuardRoutes);
  await app.register(adminFeedbackRoutes);
  await app.register(adminVisitorsRoutes);
  await app.register(honeypotRoutes);
  await app.register(fallbackRoutes);
  await app.ready();
});

test.after(async function () {
  if (app) await app.close();
  try { fs.rmSync(DATA_DIR, { recursive: true, force: true }); } catch (e) { /* ignore */ }
});

test('未登录访问受保护接口：401 + needLogin', async function () {
  const r = await req('GET', '/api/reminders');
  assert.equal(r.status, 401);
  assert.deepEqual(r.body, { ok: false, error: '请先登录', needLogin: true });
});

test('注册：200 且下发会话 Cookie', async function () {
  const r = await req('POST', '/api/auth/register', { name: 'bob', password: 'Passw0rdX' });
  assert.equal(r.status, 200);
  assert.equal(r.body.ok, true);
  assert.ok(r.body.token);
  assert.equal(r.body.user.name, 'bob');
  assert.match(cookieOf(r), /^cl_session=/);
});

test('注册重名：409', async function () {
  const r = await req('POST', '/api/auth/register', { name: 'bob', password: 'Passw0rdX' });
  assert.equal(r.status, 409);
  assert.equal(r.body.error, '该用户名已被占用');
});

test('登录失败：401 文案不变；成功：200 + Cookie', async function () {
  const bad = await req('POST', '/api/auth/login', { name: 'alice', password: 'nope-nope' });
  assert.equal(bad.status, 401);
  assert.equal(bad.body.error, '用户名或密码不正确');

  // alice 在桩数据里没有口令哈希，先设置一个再登录
  const { salt, hash } = require('../server/auth').hashPassword('Passw0rdY');
  doc.users[1].salt = salt;
  doc.users[1].hash = hash;

  const ok = await req('POST', '/api/auth/login', { name: 'alice', password: 'Passw0rdY' });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.isAdmin, false);
  userCookie = cookieOf(ok);
  assert.match(userCookie, /^cl_session=/);
});

test('管理员登录后拿到管理员 Cookie', async function () {
  const { salt, hash } = require('../server/auth').hashPassword('Passw0rdZ');
  doc.users[0].salt = salt;
  doc.users[0].hash = hash;

  const r = await req('POST', '/api/auth/login', { name: 'admin', password: 'Passw0rdZ' });
  assert.equal(r.status, 200);
  assert.equal(r.body.isAdmin, true);
  adminCookie = cookieOf(r);
});

test('GET /api/auth/me：带 Cookie 能取回自己', async function () {
  const r = await req('GET', '/api/auth/me', null, userCookie);
  assert.equal(r.status, 200);
  assert.equal(r.body.user.name, 'alice');
  assert.equal(r.body.isAdmin, false);
});

test('GET /api/state：返回自己的持仓与 rev', async function () {
  const r = await req('GET', '/api/state', null, userCookie);
  assert.equal(r.status, 200);
  assert.equal(r.body.user.name, 'alice');
  assert.equal(r.body.holdings.length, 1);
  assert.equal(typeof r.body.rev, 'number');
});

test('PUT /api/holdings：未知品种 400；合法数组 200 并计数', async function () {
  const bad = await req('PUT', '/api/holdings', { holdings: [{ name: '不存在的币', rolls: 1, cost: 1, market: 1 }] }, userCookie);
  assert.equal(bad.status, 400);
  assert.match(bad.body.error, /^未知品种：/);

  const coinName = catalogState.state().seed.coins[0].name;
  const ok = await req('PUT', '/api/holdings', {
    holdings: [{ name: coinName, rolls: 2, cost: 20, market: 24, serials: ['J12345678'] }]
  }, userCookie);
  assert.equal(ok.status, 200);
  assert.equal(ok.body.count, 1);
  assert.equal(typeof ok.body.rev, 'number');
});

test('POST /api/holdings/reset：回到默认持仓结构', async function () {
  const r = await req('POST', '/api/holdings/reset', null, userCookie);
  assert.equal(r.status, 200);
  assert.equal(r.body.ok, true);
  assert.ok(Array.isArray(r.body.holdings));
});

test('PUT /api/prices：非管理员 403，管理员 200', async function () {
  const denied = await req('PUT', '/api/prices', { prices: { 0: 11 } }, userCookie);
  assert.equal(denied.status, 403);
  assert.equal(denied.body.error, '需要管理员权限');

  const ok = await req('PUT', '/api/prices', { prices: { 0: 11.237 } }, adminCookie);
  assert.equal(ok.status, 200);
  assert.equal(ok.body.count, 1);
  assert.equal(doc.prices['0'], 11.24);
});

test('GET /api/admin/users：分页 + 统计字段齐全', async function () {
  const r = await req('GET', '/api/admin/users?page=1&size=10', null, adminCookie);
  assert.equal(r.status, 200);
  assert.ok(Array.isArray(r.body.users));
  assert.equal(r.body.stats.total, doc.users.length);
  assert.equal(r.body.page, 1);
  assert.equal(r.body.size, 10);
  assert.equal(typeof r.body.total, 'number');
});

test('GET /api/admin/users/:id/holdings：返回目标用户持仓', async function () {
  const r = await req('GET', '/api/admin/users/u2/holdings', null, adminCookie);
  assert.equal(r.status, 200);
  assert.equal(r.body.user.name, 'alice');
  assert.ok(Array.isArray(r.body.holdings));
});

test('PATCH /api/admin/users/:id：不能改自己', async function () {
  const r = await req('PATCH', '/api/admin/users/u1', { disabled: true }, adminCookie);
  assert.equal(r.status, 400);
  assert.equal(r.body.error, '不能修改自己的账号状态');
});

test('POST /api/admin/users/batch：参数不合法 400；删除成功 200', async function () {
  const bad = await req('POST', '/api/admin/users/batch', { ids: [], action: 'delete' }, adminCookie);
  assert.equal(bad.status, 400);
  assert.equal(bad.body.error, '参数不合法');

  const extra = { id: 'u9', name: 'temp', role: 'user', salt: '', hash: '', createdAt: '2026-01-03T00:00:00.000Z' };
  doc.users.push(extra);
  doc.holdings.u9 = [];

  const ok = await req('POST', '/api/admin/users/batch', { ids: ['u9'], action: 'delete' }, adminCookie);
  assert.equal(ok.status, 200);
  assert.equal(ok.body.affected, 1);
  assert.equal(doc.users.some((u) => u.id === 'u9'), false);
});

test('GET /api/admin/audit：能读到上面几次操作的审计', async function () {
  const r = await req('GET', '/api/admin/audit', null, adminCookie);
  assert.equal(r.status, 200);
  assert.equal(r.body.ok, true);
});

test('GET /api/admin/guard/bans：返回 bans 与 stats', async function () {
  const r = await req('GET', '/api/admin/guard/bans', null, adminCookie);
  assert.equal(r.status, 200);
  assert.ok(Array.isArray(r.body.bans));
  assert.equal(typeof r.body.stats, 'object');
});

test('POST /api/visit：累计总数；GET /api/visit 可读', async function () {
  const before = (await req('GET', '/api/visit')).body.total;
  const r = await req('POST', '/api/visit', { sid: 'abcdefgh12345678', tab: 'home', client: 'web' });
  assert.equal(r.status, 200);
  assert.equal(r.body.total, before + 1);

  const after = await req('GET', '/api/visit');
  assert.equal(after.body.total, before + 1);
  assert.ok(after.body.today >= 1);
});

test('GET /api/admin/visitors：统计可用；明细缺参数 400', async function () {
  const stats = await req('GET', '/api/admin/visitors?range=today', null, adminCookie);
  assert.equal(stats.status, 200);
  assert.equal(stats.body.ok, true);

  const bad = await req('GET', '/api/admin/visitors/detail', null, adminCookie);
  assert.equal(bad.status, 400);
  assert.equal(bad.body.error, '缺少 ip 或 sid');
});

test('提醒：未绑微信 400；缺 key 400', async function () {
  const r = await req('POST', '/api/reminders', { key: 'whatever' }, userCookie);
  assert.equal(r.status, 400);
  assert.equal(r.body.error, '订阅提醒需要微信登录后才能收到通知');
});

test('反馈：文案太短 400；提交成功 200；我的列表能看到', async function () {
  const bad = await req('POST', '/api/feedback', { text: '短' }, userCookie);
  assert.equal(bad.status, 400);
  assert.equal(bad.body.error, '请把问题写清楚一点（至少 4 个字）');

  const ok = await req('POST', '/api/feedback', { text: '这个品种的发行量写错了，应该是 1000 万枚' }, userCookie);
  assert.equal(ok.status, 200);
  assert.ok(ok.body.id);

  const mine = await req('GET', '/api/feedback/mine', null, userCookie);
  assert.equal(mine.status, 200);
  assert.equal(mine.body.items.length >= 1, true);
  assert.equal(typeof mine.body.open, 'number');
});

test('功能建议：测试账号 403', async function () {
  doc.users[1].isTest = true;
  const r = await req('POST', '/api/feature-request', { text: '希望能加个导出功能' }, userCookie);
  assert.equal(r.status, 403);
  assert.equal(r.body.error, '这个入口对测试账号不开放');
  delete doc.users[1].isTest;
});

test('管理端反馈：列表 / 标记完成 / 删除', async function () {
  const list = await req('GET', '/api/admin/feedback?status=all', null, adminCookie);
  assert.equal(list.status, 200);
  const id = list.body.items[0].id;

  const done = await req('PATCH', '/api/admin/feedback/' + id, { status: 'done' }, adminCookie);
  assert.equal(done.status, 200);
  assert.equal(done.body.item.status, 'done');

  const del = await req('DELETE', '/api/admin/feedback/' + id, null, adminCookie);
  assert.equal(del.status, 200);

  const missing = await req('DELETE', '/api/admin/feedback/' + id, null, adminCookie);
  assert.equal(missing.status, 404);
  assert.equal(missing.body.error, '反馈不存在');
});

test('蜜罐与未知接口：都是 404 + 同一句文案', async function () {
  const trap = await req('GET', '/api/__trap');
  assert.equal(trap.status, 404);
  assert.deepEqual(trap.body, { ok: false, error: '接口不存在' });

  const unknown = await req('GET', '/api/not-a-real-endpoint');
  assert.equal(unknown.status, 404);
  assert.deepEqual(unknown.body, { ok: false, error: '接口不存在' });
});

test('非法 JSON 与空 body：错误文案保持原样', async function () {
  const bad = await req('POST', '/api/auth/login', '{bad', null);
  assert.equal(bad.status, 400);
  assert.equal(bad.body.error, '请求体不是合法 JSON');

  const empty = await req('POST', '/api/auth/register', '', null);
  assert.equal(empty.status, 400);
  assert.match(empty.body.error, /用户名|密码/);
});

test('退出登录：Set-Cookie 立即过期', async function () {
  const r = await req('POST', '/api/auth/logout', null, userCookie);
  assert.equal(r.status, 200);
  assert.match(String(r.headers['set-cookie']), /Max-Age=0/);
});
