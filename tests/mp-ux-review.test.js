'use strict';
/**
 * 回归测试：全小程序 UX review 修掉的 P0 / P1。
 * - admin.wxml 反馈弹层闭合，访客统计不再被 wx:if="{{fbDetail}}" 吞掉
 * - store.refresh 有请求序号，慢响应不能覆盖新状态
 * - persist 串行化，且队列为空时同步发起（写操作立即落库语义不变）
 * - 401 清理登录态
 * - 分享落地页 / 失败态页面有回主界面或重试出口
 * 运行：node --test tests/mp-ux-review.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const MP = path.join(ROOT, 'miniprogram');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

test('反馈与访客已拆成独立页面：各自标签闭合，互不牵扯', () => {
  const pages = {
    'admin-feedback': 'miniprogram/pages/admin-feedback/admin-feedback.wxml',
    'admin-visitors': 'miniprogram/pages/admin-visitors/admin-visitors.wxml',
  };
  for (const name of Object.keys(pages)) {
    const clean = read(pages[name]).replace(/<!--[\s\S]*?-->/g, '');
    const stack = [];
    for (const m of clean.matchAll(/<(\/?)(view|block|scroll-view)\b[^>]*?(\/?)>/g)) {
      if (m[3]) continue;
      if (m[1]) { if (stack.length) stack.pop(); } else stack.push(m[2]);
    }
    assert.equal(stack.length, 0, name + ' 标签未闭合');
  }
  // 当年「访客统计被嵌在 fbDetail 条件里」的坑，拆分后结构上不可能再现
  const vs = read(pages['admin-visitors']);
  assert.ok(!vs.includes('fbDetail'), '访客页不该再被反馈弹层的条件牵扯');
  assert.ok(!read(pages['admin-feedback']).includes('tab ==='), '页面里不该再靠 tab 条件切换');
});

test('store.refresh：请求序号防止旧响应覆盖；force 后旧回包作废', async () => {
  const mem = {};
  global.wx = {
    getStorageSync: (k) => (k in mem ? mem[k] : ''),
    setStorageSync: (k, v) => { mem[k] = v; },
    removeStorageSync: (k) => { delete mem[k]; },
    request() {}, showToast() {}, showModal() {},
  };
  const file = path.join(MP, 'utils/store.js');
  const apiFile = path.join(MP, 'utils/api.js');
  delete require.cache[require.resolve(file)];
  delete require.cache[require.resolve(apiFile)];
  const api = require(apiFile);
  const store = require(file);

  let resolveOld;
  let resolveNew;
  const oldP = new Promise((r) => { resolveOld = r; });
  const newP = new Promise((r) => { resolveNew = r; });
  const orig = api.get;
  let n = 0;
  api.get = () => (n++ === 0 ? oldP : newP);
  try {
    const p1 = store.refresh();
    const p2 = store.refresh({ force: true });   // 后发的新请求
    resolveNew({ user: { id: 'new' }, holdings: [{ id: 'n1', name: '新藏品' }], prices: {}, rev: 2 });
    resolveOld({ user: { id: 'old' }, holdings: [], prices: {}, rev: 1 }); // 旧响应晚到
    await Promise.all([p1, p2]);
    assert.deepEqual(store.state.holdings.map((h) => h.name), ['新藏品'], '旧响应不得覆盖新状态');
    assert.equal(store.state.user.id, 'new');
  } finally {
    api.get = orig;
  }
});

test('persist：队列为空时同步发起，并发写按顺序串行', async () => {
  const mem = {};
  global.wx = {
    getStorageSync: (k) => (k in mem ? mem[k] : ''),
    setStorageSync: (k, v) => { mem[k] = v; },
    removeStorageSync: (k) => { delete mem[k]; },
    request() {}, showToast() {},
  };
  const file = path.join(MP, 'utils/store.js');
  const apiFile = path.join(MP, 'utils/api.js');
  delete require.cache[require.resolve(file)];
  delete require.cache[require.resolve(apiFile)];
  const api = require(apiFile);
  const store = require(file);
  const calls = [];
  const orig = api.put;
  let resolveFirst;
  let firstP;
  api.put = (p, body) => {
    calls.push(body.holdings.length);
    if (calls.length === 1) {
      firstP = new Promise((r) => { resolveFirst = r; });
      return firstP;
    }
    return Promise.resolve({ rev: 9 });
  };
  try {
    store.state.user = { id: 'u1' };
    store.state.holdings = [{ id: 'h1', name: 'A', rolls: 1, cost: 0, market: 0 }];
    const p1 = store.persist();
    assert.equal(calls.length, 1, '第一次写必须同步发起，不能拖到微任务');
    store.state.holdings.push({ id: 'h2', name: 'B', rolls: 1, cost: 0, market: 0 });
    const p2 = store.persist();
    assert.equal(calls.length, 1, '第二次写应排队等第一次完成');
    resolveFirst({ rev: 1 });
    await Promise.all([p1, p2]);
    assert.equal(calls.length, 2);
    assert.deepEqual(calls, [1, 2], '服务端应按顺序收到 1 条、2 条的完整快照');
  } finally {
    api.put = orig;
  }
});

test('api.js 401：清 token、清登录态、给可理解的文案', async () => {
  const mem = { cl_token: 'expired' };
  global.wx = {
    getStorageSync: (k) => (k in mem ? mem[k] : ''),
    setStorageSync: (k, v) => { mem[k] = v; },
    removeStorageSync: (k) => { delete mem[k]; },
    showToast() {},
    request({ success }) { success({ statusCode: 401, data: {} }); },
  };
  const apiFile = path.join(MP, 'utils/api.js');
  const storeFile = path.join(MP, 'utils/store.js');
  delete require.cache[require.resolve(apiFile)];
  delete require.cache[require.resolve(storeFile)];
  const api = require(apiFile);
  const store = require(storeFile);
  store.state.user = { id: 'old' };
  store.state.holdings = [{ id: 'h1' }];
  try {
    await api.get('/api/state');
    assert.fail('401 应 reject');
  } catch (e) {
    assert.equal(e.status, 401);
    assert.equal(e.needLogin, true);
    assert.match(e.message, /登录已过期/);
  }
  assert.equal(api.getToken(), '', 'token 应清除');
  assert.equal(store.state.user, null, '缓存里的旧登录态也要清掉');
  assert.equal(store.state.holdings.length, 0, '旧账号藏品不能串号');
});

test('分享落地页与失败态都有明确的出路（重试 / 回首页）', () => {
  const colshare = read('miniprogram/pages/colshare/colshare.wxml');
  assert.match(colshare, /bindtap="goHome"/, 'colshare 必须有回主界面入口');
  const colshareJs = read('miniprogram/pages/colshare/colshare.js');
  // tab 页已并入 pages/shell，回主界面统一走 getApp().goTab(0)
  assert.match(colshareJs, /goTab\(0\)/);

  const pm = read('miniprogram/pages/pmdetail/pmdetail.wxml');
  assert.match(pm, /bindtap="retry"/);
  assert.match(pm, /bindtap="goHome"/);
  const list = read('miniprogram/views/list/list.wxml');
  assert.match(list, /bindtap="retryPmFull"/);
  const myfb = read('miniprogram/pages/myfeedback/myfeedback.wxml');
  assert.match(myfb, /wx:if="\{\{err\}\}"/);
  const plaza = read('miniprogram/pages/plaza/plaza.wxml');
  assert.match(plaza, /bindtap="retry"/);
});

test('隐私授权：count 与 holdings 的 chooseMedia 前置 privacy.ensure()', () => {
  const count = read('miniprogram/pages/count/count.js');
  assert.match(count, /privacy\.ensure\(\)/);
  assert.ok(count.indexOf('privacy.ensure()') < count.indexOf('wx.chooseMedia'), '授权必须在选图之前');
  const holdings = read('miniprogram/pages/holdings/holdings.js');
  assert.match(holdings, /privacy\.ensure\(\)/);
});

test('系列详情：缺 code 时早退，不把全站品种编造成一个系列', () => {
  const js = read('miniprogram/pages/series-detail/series-detail.js');
  assert.match(js, /if \(!code\)/);
  assert.match(js, /缺少系列参数/);
});

test('广场：关注状态回显 + 登录引导 + 评论防重', () => {
  const wxml = read('miniprogram/pages/plaza/plaza.wxml');
  assert.match(wxml, /item\.following \? '已关注'/);
  const js = read('miniprogram/pages/plaza/plaza.js');
  assert.match(js, /goLogin\(\)/);
  assert.match(js, /_sending\[id\]/);
  assert.match(js, /startOffset === 0/);   // 竞态：捕获起始 offset
});
