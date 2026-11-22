'use strict';
/**
 * 华为账号登录回归测试。
 *
 * 覆盖三块最容易出错、又不需要连华为服务器的地方：
 *   1. state 签名/过期/篡改 —— 这是网页流程唯一的 CSRF 防线；
 *   2. id_token 昵称头像的兜底解析；
 *   3. 建号/二次登录/跨端 unionid/绑定冲突/解绑 —— 与微信一致的那套账号口径。
 *
 * 账号逻辑用内存假 store 驱动（store 导出的就是普通对象，替换 load/commit 即可），
 * 因此不发网络请求、不碰 MySQL。
 *
 * 运行：npm test
 */
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'test-secret-for-huawei-state';

const store = require('../server/store');
const auth = require('../server/auth');
const huawei = require('../server/huawei');

/* ---------------- 内存 store ---------------- */

function blankDoc(users) {
  return {
    users: users || [],
    holdings: {},
    prices: {},
    visits: { total: 0, days: {} },
    rev: 0
  };
}

function useDoc(doc) {
  store.load = () => doc;
  store.commit = async (mutator) => {
    const result = mutator(doc);
    doc.rev = (doc.rev || 0) + 1;
    return result;
  };
}

const authService = require('../server/services/auth.service');

/* ---------------- state ---------------- */

test('state：新签发的可以通过校验', () => {
  const st = huawei.newState();
  // 格式兼容两版：旧 3 段 nonce.exp.sig，新 4 段 nonce.exp.mode.sig（绑定态）
  assert.ok([3, 4].indexOf(st.state.split('.').length) >= 0);
  const verified = huawei.verifyState(st.state);
  assert.equal(verified.ok, true);
  if (verified.mode) assert.equal(verified.mode, 'login');
});

test('state：改一个字符就失败', () => {
  const st = huawei.newState();
  const parts = st.state.split('.');
  parts[2] = (parts[2][0] === 'A' ? 'B' : 'A') + parts[2].slice(1);
  assert.equal(huawei.verifyState(parts.join('.')).ok, false);
});

test('state：过期失败（签名仍然正确）', () => {
  const st = huawei.newState();
  const realNow = Date.now;
  try {
    // 往前拨 11 分钟：签名没坏，只是超出 10 分钟窗口
    Date.now = () => realNow() + 11 * 60 * 1000;
    const r = huawei.verifyState(st.state);
    assert.equal(r.ok, false);
    assert.equal(r.reason, 'expired');
  } finally {
    Date.now = realNow;
  }
});

test('state：格式不对直接拒绝', () => {
  assert.equal(huawei.verifyState('abc').reason, 'malformed');
  assert.equal(huawei.verifyState('').ok, false);
});

test('state：bind 模式能带回来，且不能被改成 login', () => {
  const st = huawei.newState('bind');
  const r = huawei.verifyState(st.state);
  assert.equal(r.ok, true);
  assert.equal(r.mode, 'bind');

  // 把 mode 换成 login：签名对不上，必须拒绝（否则绑定会被当成登录换号）
  const p = st.state.split('.');
  p[2] = 'login';
  assert.equal(huawei.verifyState(p.join('.')).ok, false);
});

test('state：默认是 login 模式', () => {
  assert.equal(huawei.verifyState(huawei.newState().state).mode, 'login');
  assert.equal(huawei.verifyState(huawei.newState('whatever').state).mode, 'login');
});

test('state：兼容旧的 3 段格式（部署瞬间停在授权页的用户）', () => {
  const nonce = 'abc123';
  const exp = Date.now() + 60 * 1000;
  const legacy = nonce + '.' + exp + '.' + huawei.signState(nonce, exp);
  const r = huawei.verifyState(legacy);
  assert.equal(r.ok, true);
  assert.equal(r.mode, 'login');
});

/* ---------------- id_token 兜底 ---------------- */

function fakeJwt(payload) {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return b64({ alg: 'RS256', typ: 'JWT' }) + '.' + b64(payload) + '.sig';
}

test('id_token：解出昵称与头像', () => {
  const p = huawei.profileFromIdToken(fakeJwt({
    sub: 'x', display_name: '华为用户', picture: 'https://example.com/a.png'
  }));
  assert.equal(p.nickname, '华为用户');
  assert.equal(p.avatar, 'https://example.com/a.png');
});

test('id_token：坏 token 返回空对象而不是抛错', () => {
  assert.deepEqual(huawei.profileFromIdToken('not-a-jwt'), { nickname: '', avatar: '' });
  assert.deepEqual(huawei.profileFromIdToken(''), { nickname: '', avatar: '' });
});

/* ---------------- 授权地址 ---------------- */

test('授权地址：带齐 response_type / client_id / redirect_uri / scope / state', () => {
  const url = huawei.authorizeUrl({ state: 'st123' });
  assert.ok(url.indexOf('/oauth2/v3/authorize?') > 0);
  const q = new URL(url).searchParams;
  assert.equal(q.get('response_type'), 'code');
  assert.equal(q.get('state'), 'st123');
  assert.equal(q.get('scope'), 'openid profile');
  assert.ok(q.get('redirect_uri'));
});

/* ---------------- 账号口径 ---------------- */

test('首次华为登录：自动建号、空账本、随机「币友」登录名', async () => {
  const doc = blankDoc([]);
  useDoc(doc);
  const r = await authService.huaweiUpsert({ openId: 'hw-open-1', unionId: 'hw-union-1', nickname: '阿华', avatar: 'https://a/b.png' });
  assert.equal(r.isNew, true);
  assert.equal(doc.users.length, 1);
  const u = doc.users[0];
  assert.equal(u.hwOpenid, 'hw-open-1');
  assert.equal(u.hwUnionid, 'hw-union-1');
  assert.equal(u.nickname, '阿华');
  assert.equal(u.hwAvatar, 'https://a/b.png');
  assert.match(u.name, /^币友[0-9A-Z]{4}$/);
  assert.deepEqual(doc.holdings[u.id], []);
  assert.equal(u.salt, '');
  assert.equal(u.hash, '');
});

test('二次登录：不新建账号，只刷新 lastLogin', async () => {
  const doc = blankDoc([]);
  useDoc(doc);
  const first = await authService.huaweiUpsert({ openId: 'hw-open-2' });
  const before = doc.users[0].lastLogin;

  const second = await authService.huaweiUpsert({ openId: 'hw-open-2' });
  assert.equal(second.isNew, false);
  assert.equal(doc.users.length, 1);
  assert.equal(second.user.id, first.user.id);
  assert.ok(doc.users[0].lastLogin >= before);
});

test('跨端：openid 变了但 unionid 命中，仍认成同一个账号', async () => {
  const doc = blankDoc([]);
  useDoc(doc);
  const first = await authService.huaweiUpsert({ openId: 'web-open', unionId: 'shared-union' });
  // 鸿蒙端签发的 openid 与网页端不同，但 unionid 一致
  const second = await authService.huaweiUpsert({ openId: 'harmony-open', unionId: 'shared-union' });
  assert.equal(second.isNew, false);
  assert.equal(second.user.id, first.user.id);
  assert.equal(doc.users.length, 1);
  assert.equal(doc.users[0].hwOpenid, 'harmony-open');
});

test('老用户自己改过昵称，不被华为昵称覆盖', async () => {
  const doc = blankDoc([{
    id: 'u1', name: '老藏家', role: 'user', salt: '', hash: '',
    hwOpenid: 'hw-open-3', nickname: '我自己的名字',
    createdAt: new Date().toISOString(), lastLogin: null
  }]);
  useDoc(doc);
  await authService.huaweiUpsert({ openId: 'hw-open-3', nickname: '华为昵称' });
  assert.equal(doc.users[0].nickname, '我自己的名字');
});

test('绑定：华为账号被别的账号占用时返回 409', async () => {
  const doc = blankDoc([
    { id: 'u1', name: '甲', role: 'user', salt: '', hash: '', hwOpenid: 'taken-open', createdAt: new Date().toISOString() },
    { id: 'u2', name: '乙', role: 'user', salt: '', hash: '', createdAt: new Date().toISOString() }
  ]);
  useDoc(doc);
  await assert.rejects(
    () => authService.huaweiAttach('u2', { openId: 'taken-open' }),
    (e) => e.status === 409
  );
});

test('绑定：同一账号换绑自己的华为号是幂等的', async () => {
  const doc = blankDoc([
    { id: 'u1', name: '甲', role: 'user', salt: '', hash: '', createdAt: new Date().toISOString() }
  ]);
  useDoc(doc);
  await authService.huaweiAttach('u1', { openId: 'mine', unionId: 'mine-union', nickname: '甲' });
  await authService.huaweiAttach('u1', { openId: 'mine', unionId: 'mine-union' });
  assert.equal(doc.users[0].hwOpenid, 'mine');
  assert.equal(doc.users[0].hwUnionid, 'mine-union');
});

test('解绑：只清华为字段，密码与微信不动', async () => {
  const doc = blankDoc([{
    id: 'u1', name: '甲', role: 'user', salt: 's', hash: 'h',
    wxOpenid: 'wx-open', hwOpenid: 'hw-open', hwUnionid: 'hw-union', hwAvatar: 'https://a/b.png',
    createdAt: new Date().toISOString()
  }]);
  useDoc(doc);
  await authService.huaweiUnbind('u1');
  const u = doc.users[0];
  assert.equal(u.hwOpenid, '');
  assert.equal(u.hwUnionid, '');
  assert.equal(u.hwAvatar, '');
  assert.equal(u.wxOpenid, 'wx-open');
  assert.equal(u.hash, 'h');
});

test('人数上限：达到 MAX_USERS 时不再建号', async () => {
  const users = [];
  for (let i = 0; i < auth.MAX_USERS; i += 1) {
    users.push({ id: 'u' + i, name: 'u' + i, role: 'user', salt: '', hash: '', createdAt: new Date().toISOString() });
  }
  const doc = blankDoc(users);
  useDoc(doc);
  await assert.rejects(
    () => authService.huaweiUpsert({ openId: 'new-open' }),
    (e) => e.status === 429
  );
});

test('publicUser：暴露华为绑定状态与头像外链，但不泄露 openid', () => {
  const p = auth.publicUser({
    id: 'u1', name: '甲', role: 'user', hwOpenid: 'open-id-secret',
    hwAvatar: 'https://a/b.png', createdAt: new Date().toISOString()
  });
  assert.equal(p.hw, true);
  assert.equal(p.hwAvatar, 'https://a/b.png');
  assert.equal(p.hwOpenid, undefined);
  assert.equal(JSON.stringify(p).indexOf('open-id-secret'), -1);
});
