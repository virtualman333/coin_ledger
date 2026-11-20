'use strict';
/**
 * 回归测试：藏品广场改造
 * - 我的藏品多选模式：勾选 / 全选 / 多选态下点卡片不跳详情
 * - 批量分享：选中持仓映射为 /api/shares/batch 的 items（名称+号码+图片+形态）
 * - 评论：首次展开状态写回、删除自己评论后条目与计数同步
 * 运行：node --test tests/mp-plaza-multiselect.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const MP = path.join(__dirname, '..', 'miniprogram');
const HOLDINGS = [
  { id: 'h1', name: '生肖币A', serials: ['J12345678'], images: ['/collection/a.jpg'], form: 'single' },
  { id: 'h2', name: '纪念钞B', serials: [], images: [], form: 'set' },
  { id: 'h3', name: '贵金属C', serials: [], images: [], form: '' },
];
let posts = [];

function install(file, exportsObj) {
  const p = path.join(MP, file);
  delete require.cache[require.resolve(p)];
  require.cache[require.resolve(p)] = { id: p, filename: p, loaded: true, exports: exportsObj };
}

function setupWx(loggedIn) {
  posts = [];
  global.wx = {
    getStorageSync: () => '', setStorageSync() {}, removeStorageSync() {},
    showToast() {}, showModal(o) { if (o && o.success) o.success({ confirm: true }); },
    showLoading() {}, hideLoading() {}, vibrateShort() {},
    navigateTo() {}, switchTab() {}, navigateBack() {},
    request: (o) => {
      const url = String(o.url || '');
      if (o.method === 'POST' && url.indexOf('/api/shares/batch') >= 0) {
        posts.push(JSON.parse(o.data || '{}'));
        if (o.success) o.success({ statusCode: 200, data: { ok: true, ids: ['x'], count: (posts[posts.length - 1].items || []).length } });
      } else if (o.method === 'POST' && url.indexOf('/api/shares') >= 0) {
        if (o.success) o.success({ statusCode: 200, data: { ok: true, id: 'x' } });
      } else if (o.method === 'DELETE' && url.indexOf('/comments/') >= 0) {
        if (o.success) o.success({ statusCode: 200, data: { ok: true } });
      } else if (o.success) {
        o.success({ statusCode: 200, data: { ok: true, items: [] } });
      }
    },
  };
  global.getCurrentPages = () => [];
  global.App = () => {};
  global.getApp = () => ({ globalData: {} });
  global.Page = (c) => { captured = c; };
  install('utils/api.js', {
    BASE: 'https://example.test',
    post: (path, data) => {
      posts.push({ path, data });
      if (path.indexOf('/api/shares/batch') >= 0) return Promise.resolve({ ok: true, ids: ['x'], count: (data.items || []).length });
      return Promise.resolve({ ok: true, id: 'x' });
    },
    get: () => Promise.resolve({ ok: true, items: [] }),
    del: () => Promise.resolve({ ok: true }),
  });
  install('utils/catalog.js', {
    byName: {}, coins: [], seriesList: [],
    money: (n) => String(n), aiPriceOf: () => 0, round2: (n) => n,
    stats: () => ({}),
  });
  install('utils/store.js', {
    isLogin: () => loggedIn,
    getState: () => ({ user: loggedIn ? { id: 'u1', name: '我' } : null, holdings: HOLDINGS }),
    state: { user: loggedIn ? { id: 'u1' } : null, holdings: HOLDINGS },
    stats: () => ({}),
  });
  install('utils/share.js', { COVER: '/c.png', appMessage: () => ({}), timeline: () => ({}) });
}
let captured = null;

function loadHoldings() {
  const f = path.join(MP, 'pages/holdings/holdings.js');
  delete require.cache[require.resolve(f)];
  require(f);
  const inst = Object.assign({}, captured);
  inst.data = JSON.parse(JSON.stringify(captured.data || {}));
  inst.setData = function (patch, cb) {
    Object.keys(patch).forEach((k) => { this.data[k] = patch[k]; });
    if (typeof cb === 'function') cb();
  };
  inst.data.groups = [{ name: '组', items: HOLDINGS.map((h) => ({ id: h.id, name: h.name })) }];
  return inst;
}

test('多选模式：点卡片改为勾选，取消后再点进详情', () => {
  setupWx(true);
  const p = loadHoldings();
  p.setData({ selectMode: true });
  let navigated = 0;
  global.wx.navigateTo = () => { navigated++; };
  p.goDetail({ currentTarget: { dataset: { hold: 'h1', id: 1 } } });
  assert.equal(p.data.selectedCount, 1);
  assert.equal(p.data.selected.h1, true);
  assert.equal(navigated, 0, '多选态不应跳详情');
  p.goDetail({ currentTarget: { dataset: { hold: 'h1', id: 1 } } });
  assert.equal(p.data.selectedCount, 0, '再次点击取消勾选');
  p.setData({ selectMode: false });
  p.goDetail({ currentTarget: { dataset: { hold: 'h1', id: 1 } } });
  assert.equal(navigated, 1, '普通态应跳详情');
});

test('多选模式：全选覆盖所有持仓', () => {
  setupWx(true);
  const p = loadHoldings();
  p.setData({ selectMode: true });
  p.selectAll();
  assert.equal(p.data.selectedCount, 3);
  assert.equal(p.data.selected.h3, true);
});

test('批量分享：选中持仓映射为 batch items，含号码/图片/形态', async () => {
  setupWx(true);
  const p = loadHoldings();
  p.setData({ selectMode: true, selected: { h1: true, h2: true }, selectedCount: 2 });
  p.batchShareToPlaza();
  await new Promise((r) => setTimeout(r, 20));
  const call = posts.filter((x) => x.path === '/api/shares/batch')[0];
  assert.ok(call, '应调用批量接口');
  assert.equal(call.data.items.length, 2);
  assert.equal(call.data.items[0].holdingName, '生肖币A');
  assert.deepEqual(call.data.items[0].serials, ['J12345678']);
  assert.deepEqual(call.data.items[0].images, ['/collection/a.jpg']);
  assert.equal(call.data.items[0].form, 'single');
  assert.equal(call.data.items[1].form, 'set');
  assert.equal(call.data.items[1].serials.length, 0);
});

test('广场评论：首次展开状态写回 cmts[id]，删除后条目与计数同步', async () => {
  setupWx(true);
  const f = path.join(MP, 'pages/plaza/plaza.js');
  delete require.cache[require.resolve(f)];
  require(f);
  const p = Object.assign({}, captured);
  p.data = JSON.parse(JSON.stringify(captured.data || {}));
  p.setData = function (patch, cb) {
    Object.keys(patch).forEach((k) => { this.data[k] = patch[k]; });
    if (typeof cb === 'function') cb();
  };
  p.data.items = [{ id: 's1', author: '藏友', comments: 1, mine: false }];
  // 首次点开评论：cmts 为空也应写入 open 状态
  p.toggleComments({ currentTarget: { dataset: { id: 's1' } } });
  assert.equal(p.data.cmts.s1.open, true, '首次展开必须写回状态');
  await new Promise((r) => setTimeout(r, 10)); // 等首次 loadComments 的异步返回，避免覆盖后续数据
  // 模拟已加载的评论（含自己的一条）
  const cmts = Object.assign({}, p.data.cmts);
  cmts.s1 = { open: true, list: [
    { id: 'c1', author: '别人', text: '好币', mine: false },
    { id: 'c2', author: '我', text: '我的评论', mine: true },
  ] };
  p.setData({ cmts });
  p.delComment({ currentTarget: { dataset: { id: 's1', cid: 'c2' } } });
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(p.data.cmts.s1.list.length, 1, '自己的评论应被移除');
  assert.equal(p.data.cmts.s1.list[0].id, 'c1');
  assert.equal(p.data.items[0].comments, 0, '评论计数应减 1');
});
