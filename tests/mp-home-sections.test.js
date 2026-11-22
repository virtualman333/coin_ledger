'use strict';
/**
 * 回归测试：小程序首页内容板块（今日金银价）。
 * - 行情字段格式化、时间本地化、失败整块隐藏
 * - 行情卡跳转贵金属目录
 *
 * 首页的「同好晒单」随收藏广场一并下线（2026-11-22）。
 * 运行：npm test
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const MP = path.join(__dirname, '..', 'miniprogram');
const mem = {};
let captured = null;

function mp(file) {
  return path.join(MP, file);
}

function install(file, exportsObj) {
  const p = mp(file);
  delete require.cache[require.resolve(p)];
  require.cache[require.resolve(p)] = {
    id: p, filename: p, loaded: true, exports: exportsObj,
  };
}

function setupWx() {
  for (const k of Object.keys(mem)) delete mem[k];
  global.wx = {
    getStorageSync: (k) => (k in mem ? mem[k] : ''),
    setStorageSync: (k, v) => { mem[k] = v; },
    removeStorageSync: (k) => { delete mem[k]; },
    switchTab() {}, navigateTo() {},
    showToast() {}, stopPullDownRefresh() {},
  };
  global.getCurrentPages = () => [];
  global.App = () => {};
  global.getApp = () => ({ globalData: {} });
  captured = null;
  global.Page = (c) => { captured = c; };
}

let mockGet = () => Promise.resolve({});

function loadHomePage() {
  install('utils/catalog.js', {
    total: 137, descCount: 1, seriesList: [], coins: [],
    money: (n) => String(n), signed: (n) => String(n),
  });
  install('utils/store.js', {
    stats: () => ({ face: 0, cost: 0, market: 0, profit: 0, rolls: 0, kinds: 0 }),
    ownedNames: () => ({}),
    setPriceOf: () => 0,
    getState: () => ({ user: null, synced: true }),
    refresh: () => Promise.resolve(),
  });
  install('utils/share.js', { appMessage: () => ({}), timeline: () => ({}) });
  install('utils/api.js', {
    BASE: 'https://example.test',
    get: (p) => mockGet(p),
  });
  const file = mp('views/home/home.logic.js');
  delete require.cache[require.resolve(file)];
  require(file);
  if (!captured) captured = require(file);
  const inst = Object.assign({}, captured);
  inst.data = JSON.parse(JSON.stringify(captured.data || {}));
  inst.setData = function (patch) {
    Object.keys(patch).forEach((k) => { this.data[k] = patch[k]; });
  };
  // 视图里的跨 tab 跳转改成 triggerEvent（由宿主页接），测试里补个空实现
  inst.triggerEvent = function () {};
  return inst;
}

test('行情板块：格式化金/银价与更新时间', async () => {
  setupWx();
  mockGet = () => Promise.resolve({
    ok: true,
    fetchedAt: '2026-11-20T09:05:00.000Z',
    stale: false,
    quotes: {
      XAU: { name: '黄金', cnyPerGram: 770.512 },
      XAG: { name: '白银', cnyPerGram: 9.134 },
    },
  });
  const p = loadHomePage();
  await p.loadMetal();
  assert.equal(p.data.metal.gold, '770.51');
  assert.equal(p.data.metal.silver, '9.13');
  assert.equal(p.data.metal.stale, false);
  assert.ok(/更新$/.test(p.data.metal.timeText));
});

test('行情板块：延时行情带标记', async () => {
  setupWx();
  mockGet = () => Promise.resolve({
    ok: true, stale: true, fetchedAt: '2026-11-20T09:05:00.000Z',
    quotes: { XAU: { cnyPerGram: 700 }, XAG: { cnyPerGram: 8 } },
  });
  const p = loadHomePage();
  await p.loadMetal();
  assert.equal(p.data.metal.stale, true);
  assert.ok(/更新$/.test(p.data.metal.timeText));
});

test('行情板块：接口失败整块隐藏', async () => {
  setupWx();
  mockGet = () => Promise.reject(new Error('offline'));
  const p = loadHomePage();
  p.data.metal = { gold: '1', silver: '2' };
  await p.loadMetal();
  assert.equal(p.data.metal, null);
});

test('行情卡跳转贵金属目录', () => {
  setupWx();
  const p = loadHomePage();
  const tabEvents = [];
  const navUrls = [];
  // 切 tab 不再走 wx.switchTab，改成向宿主页发 switchtab 事件
  p.triggerEvent = (name, detail) => {
    if (name === 'switchtab') tabEvents.push(detail.index);
  };
  global.wx.navigateTo = (o) => navUrls.push(o.url);
  p.goMetal();
  assert.equal(tabEvents[0], 2, '贵金属目录应该切到「全套清单」tab');
  assert.deepEqual(mem['cl_pending_series'], { code: '', category: 'pm' });
});
