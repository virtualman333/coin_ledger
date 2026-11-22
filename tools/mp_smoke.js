'use strict';
/**
 * 小程序数据层冒烟测试：用真实的 utils/api.js + utils/store.js，
 * 把 wx.* 换成 Node 实现，跑一遍注册 → 收藏增删改 → 清理。
 *
 *   node tools/mp_smoke.js
 */
const https = require('https');
const fsx = require('fs');

/** 管理员口令：优先环境变量，其次本地 .secrets（已在 .gitignore 里，不进仓库） */
function readAdminPw() {
  if (process.env.ADMIN_PASSWORD) return process.env.ADMIN_PASSWORD;
  try {
    return fsx.readFileSync(path.join(__dirname, '..', '.secrets', 'admin-password.txt'), 'utf8').trim();
  } catch (e) {
    return '';
  }
}
const path = require('path');
const { URL } = require('url');

const mem = {};
let BASE = 'https://coin.virtualman.top';
const setBase = process.env.MP_BASE || '';

global.wx = {
  getStorageSync: (k) => (k in mem ? mem[k] : ''),
  setStorageSync: (k, v) => { mem[k] = v; },
  removeStorageSync: (k) => { delete mem[k]; },
  request(opts) {
    const url = new URL(opts.url);
    const body = opts.data === undefined ? null : JSON.stringify(opts.data);
    const req = https.request({
      hostname: url.hostname,
      port: 443,
      path: url.pathname + url.search,
      method: opts.method || 'GET',
      headers: Object.assign({ 'content-type': 'application/json', 'Content-Length': body ? Buffer.byteLength(body) : 0 }, opts.header || {}),
      timeout: 15000,
    }, (res) => {
      let raw = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { raw += c; });
      res.on('end', () => {
        let data = raw;
        try { data = JSON.parse(raw); } catch (e) { /* 非 JSON 原样返回 */ }
        opts.success && opts.success({ statusCode: res.statusCode, data, header: res.headers });
      });
    });
    req.on('error', (err) => {
      opts.fail && opts.fail({ errMsg: err.message });
    });
    req.on('timeout', () => { req.destroy(new Error('timeout')); });
    if (body) req.write(body);
    req.end();
  },
};

const MP = path.join(__dirname, '..', 'miniprogram');
const api = require(path.join(MP, 'utils/api.js'));
const store = require(path.join(MP, 'utils/store.js'));
const cat = require(path.join(MP, 'utils/catalog.js'));

let pass = 0;
let fail = 0;
function ok(cond, label, extra) {
  if (cond) { pass += 1; console.log('  ✓ ' + label); }
  else { fail += 1; console.log('  ✗ ' + label + (extra ? '  → ' + extra : '')); }
}

const SUFFIX = Date.now().toString(36).slice(-5);
const TEMP_USER = 'mpsmoke' + SUFFIX;
const TEMP_PW = 'Smoke2026pw';

(async () => {
  console.log('base = ' + (setBase || api.BASE));
  console.log('\n[1] 目录数据');
  ok(cat.total >= 130, '品种数 ' + cat.total);
  ok(cat.coins.every((c) => c.id > 0 && c.name && c.setFace > 0), '每个品种都有编号 / 名称 / 一套面值');
  ok(cat.byId[1] && cat.byId[1].imgUrl.indexOf('/img/001.jpg') > 0, '图片地址拼装正确：' + (cat.byId[1] || {}).imgUrl);
  ok(cat.money(1234567.5) === '1,234,567.5', '金额格式化：' + cat.money(1234567.5));
  ok(cat.seriesList.length >= 10, '系列数 ' + cat.seriesList.length);

  console.log('\n[2] 未登录状态');
  store.hydrate();
  const s0 = await store.refresh();
  ok(s0.user === null, '匿名刷新成功，user 为 null');
  ok(s0.holdings.length === 0, '匿名不返回持仓');
  let needLogin = false;
  try { store.addCoin(cat.byId[1]); } catch (e) { needLogin = !!e.needLogin; }
  ok(needLogin, '未登录时加入收藏被拦住');

  console.log('\n[3] 注册 + Bearer 令牌');
  const reg = await api.post('/api/auth/register', { name: TEMP_USER, password: TEMP_PW });
  ok(!!reg.token, '注册返回 token');
  api.setToken(reg.token);
  ok(api.getToken() === reg.token, 'token 已写入本地存储');
  const me = await api.get('/api/auth/me');
  ok(me.user && me.user.name === TEMP_USER, 'Bearer 令牌能识别身份：' + (me.user && me.user.name));

  console.log('\n[4] 收藏增删改（走服务器数据库）');
  store.hydrate();
  await store.refresh();
  const coin = cat.byId[1];
  await store.addCoin(coin);
  await store.refresh();
  ok(store.getState().holdings.length === 1, '加入后服务器里有 1 条');
  const h = store.getState().holdings[0];
  ok(h && h.name === coin.name, '名称正确：' + (h && h.name));
  ok(h.cost === coin.setFace, '成本 = 一套面值 ' + coin.setFace);
  await store.setRolls(h.id, 3);
  await store.refresh();
  const h2 = store.getState().holdings[0];
  ok(h2.rolls === 3 && Math.abs(h2.cost - coin.setFace * 3) < 0.01, '套数改 3 后成本 ' + h2.cost);
  const st = store.stats();
  ok(st.rolls === 3 && st.kinds === 1, '统计口径一致：' + st.rolls + ' 套 / ' + st.kinds + ' 个品种');
  ok(st.face > 0 && st.cost > 0, '面值 ' + st.face + ' 投入 ' + st.cost);
  await store.removeHolding(h.id);
  await store.refresh();
  ok(store.getState().holdings.length === 0, '移出后服务器里 0 条');

  console.log('\n[4.5] 微信登录接口');
  const wxTry = await fetch(api.BASE + '/api/auth/wx/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code: 'fake-code-for-smoke' }),
  }).then((r) => r.json().then((b) => ({ status: r.status, body: b })));
  ok(wxTry.status !== 404, '接口存在（返回 ' + wxTry.status + '）');
  ok([400, 429, 503].indexOf(wxTry.status) >= 0, '无效 code 被拒：' + (wxTry.body && wxTry.body.error));
  ok(/WX_APPSECRET|凭证|微信/.test(String((wxTry.body || {}).error || '')), '错误信息可读');

  console.log('\n[4.8] 纠错反馈');
  const fb = await api.post('/api/feedback', {
    coinId: 1,
    text: '冒烟测试：这个品种的面额可能写错了，请核对。',
  });
  ok(!!fb.id, '提交反馈成功：' + fb.id);
  const fbShort = await api.post('/api/feedback', { coinId: 1, text: '错' }).catch((e) => ({ error: e.message }));
  ok(!!fbShort.error, '过短反馈被拒：' + fbShort.error);
  const fbAnon = await fetch(api.BASE + '/api/feedback', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ coinId: 1, text: '未登录也能提交吗' }),
  }).then((r) => ({ status: r.status }));
  ok(fbAnon.status === 401, '未登录提交被拒（401）');

  console.log('\n[4.9] 管理端批量保存');
  const adminEarly = await api.post('/api/auth/login', { name: 'virtualman', password: readAdminPw() });
  const before = await fetch(api.BASE + '/api/admin/coins', {
    headers: { authorization: 'Bearer ' + adminEarly.token },
  }).then((r) => r.json());
  const c1 = before.coins[0];
  const c2 = before.coins[1];
  const batch = await fetch(api.BASE + '/api/admin/coins', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', authorization: 'Bearer ' + adminEarly.token },
    body: JSON.stringify({
      items: [
        { id: c1.i + 1, patch: { est: c1.est } },
        { id: c2.i + 1, patch: { est: c2.est } },
        { id: 99999, patch: { est: 1 } },
      ],
    }),
  }).then((r) => r.json());
  ok(batch.saved === 2, '批量保存一次写入 2 条：' + batch.saved);
  ok(batch.failed.length === 1 && batch.failed[0].id === 99999, '无效品种进 failed 而不是整体失败');

  console.log('\n[5] 清理测试账号');
  const admin = await api.post('/api/auth/login', { name: 'virtualman', password: readAdminPw() });
  ok(!!admin.token, '超管可登录');
  const fbs = await fetch(api.BASE + '/api/admin/feedback?status=all', {
    headers: { authorization: 'Bearer ' + admin.token },
  }).then((r) => r.json());
  const mineFb = (fbs.items || []).filter((x) => x.uid === reg.user.id);
  ok(mineFb.length >= 1, '管理员能看到用户反馈：' + mineFb.length + ' 条');
  ok(mineFb.every((x) => x.coinName), '反馈带品种名：' + (mineFb[0] || {}).coinName);
  for (const it of mineFb) {
    await fetch(api.BASE + '/api/admin/feedback/' + it.id, {
      method: 'DELETE',
      headers: { authorization: 'Bearer ' + admin.token },
    });
  }
  api.setToken(admin.token);
  const list = await api.get('/api/admin/users');
  const target = (list.users || []).filter((u) => u.name === TEMP_USER)[0];
  if (target) {
    // 非测试账号禁止删除：先验证这条保护，再把临时账号标记为测试后删除
    const guard = await fetch(api.BASE + '/api/admin/users/' + target.id, {
      method: 'DELETE',
      headers: { authorization: 'Bearer ' + admin.token },
    });
    ok(guard.status === 403, '真实账号禁止删除（返回 ' + guard.status + '）');

    await fetch(api.BASE + '/api/admin/users/' + target.id, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', authorization: 'Bearer ' + admin.token },
      body: JSON.stringify({ isTest: true }),
    });

    await new Promise((resolve) => {
      const https2 = require('https');
      const req = https2.request({
        hostname: 'coin.virtualman.top', path: '/api/admin/users/' + target.id, method: 'DELETE',
        headers: { Authorization: 'Bearer ' + admin.token }, timeout: 15000,
      }, (res) => { res.resume(); res.on('end', resolve); });
      req.on('error', resolve);
      req.end();
    });
    const after = await api.get('/api/admin/users');
    ok(!(after.users || []).some((u) => u.name === TEMP_USER), '测试账号已删除');
  } else {
    ok(false, '没有找到测试账号，未清理');
  }

  console.log('\n结果：' + pass + ' 通过，' + fail + ' 失败');
  process.exit(fail === 0 ? 0 : 1);
})().catch((err) => {
  console.error('冒烟中断：' + err.message);
  process.exit(1);
});
