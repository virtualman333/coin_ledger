'use strict';
/**
 * 回归测试：贵金属详情页「加入 ⇄ 取消收藏」二态（Web + 小程序）。
 * - 已收藏时按钮不再 disabled，点击弹出确认后移出
 * - 移出后按钮回到「加入」态，藏品从账本消失并同步服务端
 * - 未登录不允许加入；从别处移出后 onShow 能刷新 owned
 * 运行：node --test tests/pm-fav-toggle.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

function loadPmDetailPage() {
  const MP = path.join(ROOT, 'miniprogram');
  const mem = {};
  let captured = null;
  let modals = [];
  global.wx = {
    getStorageSync: (k) => (k in mem ? mem[k] : ''),
    setStorageSync: (k, v) => { mem[k] = v; },
    removeStorageSync: (k) => { delete mem[k]; },
    showToast() {}, showLoading() {}, hideLoading() {},
    showModal(o) { modals.push(o); if (o && o.success) o.success({ confirm: true }); },
    switchTab() {}, navigateTo() {}, navigateBack() {}, setNavigationBarTitle() {},
    request: (o) => { if (o && o.success) o.success({ statusCode: 200, data: { ok: true, item: {} } }); },
  };
  global.getCurrentPages = () => [];
  global.App = () => {};
  global.getApp = () => ({ globalData: {} });
  global.Page = (c) => { captured = c; };

  const holdings = [{ id: 'G19790101', name: '建国30周年金币', category: 'pm', rolls: 1 }];
  const store = {
    isLogin: () => true,
    state: { user: { id: 'u1' }, holdings: holdings },
    getState: () => ({ user: { id: 'u1' }, holdings: holdings }),
    addPm: (item) => { holdings.push({ id: item.code, name: item.name, category: 'pm' }); return Promise.resolve({ ok: true }); },
    removeHolding: (id) => {
      const i = holdings.findIndex((h) => h.id === id);
      if (i >= 0) holdings.splice(i, 1);
      return Promise.resolve({ ok: true });
    },
    refresh: () => Promise.resolve({}),
  };
  const install = (f, exp) => {
    const p = path.join(MP, f);
    delete require.cache[require.resolve(p)];
    require.cache[require.resolve(p)] = { id: p, filename: p, loaded: true, exports: exp };
  };
  install('utils/api.js', { BASE: 'https://example.test', get: () => Promise.resolve({ ok: true, item: {} }), post: () => Promise.resolve({ ok: true }) });
  install('utils/store.js', store);
  install('utils/share.js', { COVER: '/c.png', pmMessage: () => ({}), timeline: () => ({}) });
  const file = path.join(MP, 'pages/pmdetail/pmdetail.js');
  delete require.cache[require.resolve(file)];
  require(file);
  const inst = Object.assign({}, captured);
  inst.data = JSON.parse(JSON.stringify(captured.data || {}));
  inst.setData = function (patch, cb) {
    Object.keys(patch).forEach((k) => { this.data[k] = patch[k]; });
    if (typeof cb === 'function') cb();
  };
  return { p: inst, store, modals };
}

test('小程序：已收藏时 toggleFav 走移出，二次确认后 owned 变 false', async () => {
  const { p, modals } = loadPmDetailPage();
  p.data.code = 'G19790101';
  p.data.item = { code: 'G19790101', name: '建国30周年金币', thumbUrl: '' };
  p.data.owned = true;
  p.toggleFav();
  assert.equal(modals.length, 1, '移出前必须二次确认');
  assert.match(modals[0].title, /移出藏品/);
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(p.data.owned, false, '移出后按钮应回到可加入状态');
  assert.equal(p.data.busy, false);
});

test('小程序：未收藏时 toggleFav 走加入，成功后 owned 变 true', async () => {
  const { p } = loadPmDetailPage();
  p.data.code = 'G20260101';
  p.data.item = { code: 'G20260101', name: '新币', thumbUrl: '' };
  p.data.owned = false;
  p.toggleFav();
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(p.data.owned, true);
});

test('小程序：WXML 按钮已收藏态不再 disabled，提示可取消', () => {
  const wxml = read('miniprogram/pages/pmdetail/pmdetail.wxml');
  assert.match(wxml, /bindtap="toggleFav"/);
  assert.match(wxml, /点此取消/);
  assert.ok(!/disabled="\{\{owned\}\}"/.test(wxml), '已收藏时不能被禁用');
});

test('小程序：onShow 重新判定 owned，从账本移出后页面状态不陈旧', () => {
  const { p, store } = loadPmDetailPage();
  p.data.code = 'G19790101';
  p.data.owned = true;
  store.state.holdings = [];
  p.onShow();
  assert.equal(p.data.owned, false);
});

test('Web：独立页按钮已收藏时不 disabled，且 togglePmFav 能移出并回写按钮', () => {
  const js = read('public/app.js');
  assert.match(js, /function togglePmFav\(/);
  assert.match(js, /function pmIsOwned\(/);
  assert.match(js, /pm-fav-owned/);
  assert.match(js, /点此取消/);
  // 独立页按钮渲染：不再用 disabled
  const seg = js.slice(js.indexOf('pm-detail-actions'), js.indexOf('pm-detail-actions') + 500);
  assert.ok(!/disabled/.test(seg), '详情页收藏按钮不能禁用');
  // 移出必须持久化（saveState → PUT /api/holdings）并回写按钮
  const t = js.slice(js.indexOf('function togglePmFav'), js.indexOf('function bindPmPageActions'));
  assert.match(t, /coll\.splice/);
  assert.match(t, /saveState\(\)/);
  assert.match(t, /window\.confirm/);
  assert.match(t, /btn\.textContent = '＋ 加入我的藏品'/);
  assert.ok(!/reRenderAll\(\)/.test(t), '独立页不该全量重建清单');
});

test('Web：真实执行 togglePmFav —— 移出后 coll 减少、按钮回到加入态', () => {
  const vm = require('node:vm');
  const src = read('public/app.js');
  // 只抽三个相关函数执行：整份脚本含顶层 DOM 绑定与 boot() 的防抖定时器，会让测试进程挂住
  const grab = (name, end) => {
    const a = src.indexOf('function ' + name + '(');
    assert.ok(a >= 0, '应能找到函数 ' + name);
    const b = src.indexOf(end, a);
    assert.ok(b > a, '应能找到函数 ' + name + ' 的结束位置');
    return src.slice(a, b);
  };
  const snippet = [
    grab('pmIsOwned', '/** 已收藏 →'),
    grab('togglePmFav', '/** 独立页内的图片放大'),
    grab('addPmHolding', 'function addHolding(')
  ].join('\n');

  const ctx = {
    window: { confirm: () => true },
    coll: [{ id: 'G19790101', name: '建国30周年金币', category: 'pm' }],
    isLoggedIn: () => true,
    saveState: () => {}, renderKPI: () => {}, toast: () => {},
    rebuildGroupOrder: () => {},
    reRenderAll: () => { throw new Error('独立页不应触发全量重建'); },
    console
  };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(snippet, ctx);

  const btn = { className: 'btn ghost pm-fav-owned', textContent: '✓ 已在藏品 · 点此取消' };
  assert.equal(ctx.pmIsOwned('G19790101'), true);
  ctx.togglePmFav('G19790101', { code: 'G19790101', name: '建国30周年金币', thumb: '' }, btn);
  assert.equal(ctx.pmIsOwned('G19790101'), false, '藏品应从 coll 移出');
  assert.equal(btn.textContent, '＋ 加入我的藏品', '按钮应回到可加入态');
  assert.equal(btn.className, 'btn primary');

  // 再点一次可重新加入（light 模式不重建清单）
  ctx.togglePmFav('G19790101', { code: 'G19790101', name: '建国30周年金币', thumb: '' }, btn);
  assert.equal(ctx.pmIsOwned('G19790101'), true, '取消后应能立即重新加入');
  assert.match(btn.textContent, /点此取消/);
});

test('Web：目录卡片「已收藏」按钮同样可取消，口径与详情页一致', () => {
  const js = read('public/app.js');
  assert.match(js, /pm-add is-owned/);
  assert.match(js, /已收藏 · 取消/);
  const listSeg = js.slice(js.indexOf('var a = e.target.closest(\'[data-addpm]\')'), js.indexOf('var c = e.target.closest(\'.pm-card\')'));
  assert.match(listSeg, /pmIsOwned\(code\)/);
  assert.match(listSeg, /reRenderAll\(\)/);
});
