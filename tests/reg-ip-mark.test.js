'use strict';
/**
 * 回归测试：同 IP 多账号「只标记、不限制」（2026-11-23）。
 *
 * 不连数据库、不起端口：用 require.cache 注入 store / huawei 桩，
 * 走真实 auth 路由 + service，验证：
 *   - 同一 IP 第 2 个及以后账号 regIpDup=true，首个为 false；
 *   - 不同 IP 不打标；回环/占位 IP 不参与判定；
 *   - 用户名注册与华为建号两个入口都打标（微信入口共用同一 regIpFields）；
 *   - 打标不影响注册成功、不额外拦截（状态码仍 200）。
 * 运行：node --test tests/reg-ip-mark.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
process.env.SESSION_SECRET = 'test-secret';
process.env.WX_APPSECRET = '';

function clone(o) { return JSON.parse(JSON.stringify(o)); }

const doc = {
  rev: 0,
  users: [],
  holdings: {},
  prices: {},
  visits: { total: 0, days: {} }
};
const storeStub = {
  MODE: 'mysql',
  load: () => doc,
  snapshot: () => clone(doc),
  commit: async (mutator) => {
    const draft = clone(doc);
    const result = mutator(draft);
    draft.rev = (doc.rev || 0) + 1;
    Object.keys(doc).forEach((k) => { delete doc[k]; });
    Object.assign(doc, draft);
    return result;
  },
  flush: async () => {},
  close: async () => {},
  info: () => ({ mode: 'stub' })
};

// 华为身份桩：code -> 固定 openid，便于连续建号
let hwCodeSeq = 0;
const huaweiStub = {
  enabled: () => true,
  resolveIdentity: async (code) => {
    hwCodeSeq += 1;
    return { openId: 'HW-' + code + '-' + hwCodeSeq, unionId: '', nickname: '', avatar: '' };
  },
  startAuth: () => '',
  buildAuthUrl: () => ''
};

function inject(rel, exportsObj) {
  const p = path.join(ROOT, rel);
  const r = require.resolve(p);
  delete require.cache[r];
  require.cache[r] = { id: p, filename: p, loaded: true, exports: exportsObj };
}
inject('server/store.js', storeStub);
inject('server/huawei.js', huaweiStub);

const Fastify = require('fastify');
const bodyPlugin = require('../server/plugins/body');
const errorsPlugin = require('../server/plugins/errors');
const authRoutes = require('../server/routes/auth');
const authService = require('../server/services/auth.service');

let app;
test('setup', async () => {
  app = Fastify();
  await app.register(bodyPlugin);
  await app.register(errorsPlugin);
  await app.register(authRoutes);
  await app.ready();
});

// XFF 头决定 clientIP
function reg(name, ip) {
  return app.inject({
    method: 'POST',
    url: '/api/auth/register',
    headers: { 'x-forwarded-for': ip },
    payload: { name, password: 'Passw0rd!' }
  });
}

test('regIpFields：回环/占位 IP 不参与判定', () => {
  assert.equal(authService.regIpFields({ users: [] }, '127.0.0.1').regIpDup, false);
  assert.equal(authService.regIpFields({ users: [{ regIp: '127.0.0.1' }] }, '127.0.0.1').regIpDup, false);
  assert.equal(authService.regIpFields({ users: [] }, '').regIpDup, false);
  assert.equal(authService.regIpFields({ users: [{ regIp: '1.2.3.4' }] }, '1.2.3.4').regIpDup, true);
});

test('用户名注册：同 IP 第 1 个不打标，第 2 个打标，不同 IP 不打标', async () => {
  doc.users.length = 0;
  const r1 = await reg('usera', '10.0.0.1');
  const r2 = await reg('userb', '10.0.0.1');
  const r3 = await reg('userc', '10.0.0.2');
  assert.equal(r1.statusCode, 200);
  assert.equal(r2.statusCode, 200);
  assert.equal(r3.statusCode, 200);
  const a = doc.users.find((u) => u.name === 'usera');
  const b = doc.users.find((u) => u.name === 'userb');
  const c = doc.users.find((u) => u.name === 'userc');
  assert.equal(a.regIp, '10.0.0.1');
  assert.equal(a.regIpDup, false, '首个账号保持干净');
  assert.equal(b.regIp, '10.0.0.1');
  assert.equal(b.regIpDup, true, '同 IP 第 2 个打标');
  assert.equal(c.regIpDup, false, '不同 IP 不打标');
});

test('打标不影响注册成功：仍拿到 token 与 user', async () => {
  doc.users.length = 0;
  await reg('first', '9.9.9.9');
  const r = await reg('second', '9.9.9.9');
  assert.equal(r.statusCode, 200);
  const body = r.json();
  assert.equal(body.ok, true);
  assert.ok(body.token, '仍应下发会话 token');
  assert.equal(body.isAdmin, false);
});

test('华为建号入口同样打标（同 IP 第 2 个）', async () => {
  doc.users.length = 0;
  const h1 = await app.inject({
    method: 'POST', url: '/api/auth/huawei/login',
    headers: { 'x-forwarded-for': '8.8.8.8' }, payload: { code: 'A' }
  });
  const h2 = await app.inject({
    method: 'POST', url: '/api/auth/huawei/login',
    headers: { 'x-forwarded-for': '8.8.8.8' }, payload: { code: 'B' }
  });
  assert.equal(h1.statusCode, 200);
  assert.equal(h2.statusCode, 200);
  const marked = doc.users.filter((u) => u.regIpDup);
  assert.equal(marked.length, 1, '两个华为账号里应有 1 个被标记');
  assert.equal(marked[0].regIp, '8.8.8.8');
});

test('历史账号无 regIp：不被误标、也不追溯', async () => {
  doc.users.length = 0;
  doc.users.push({ id: 'old1', name: 'olduser', role: 'user', salt: '', hash: '', createdAt: '2026-01-01T00:00:00.000Z' });
  const r = await reg('newuser', '7.7.7.7');
  assert.equal(r.statusCode, 200);
  const fresh = doc.users.find((u) => u.name === 'newuser');
  assert.equal(fresh.regIpDup, false, '老账号没有 IP，不应让新账号被误标');
  assert.equal(doc.users.find((u) => u.id === 'old1').regIpDup, undefined);
});
