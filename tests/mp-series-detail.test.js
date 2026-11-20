'use strict';
/**
 * 回归测试：独立「系列详情页」+ 所有「点系列卡片」入口改造。
 * - 新页面只展示某一系列品种；coin/note 用本地目录，pm 用 /api/series/detail 聚合接口
 * - list.goSeriesCard / series.goSeries / index.goSeries 都改为 navigateTo 新页面
 * - detail.goPeek 改 navigateTo，保留返回栈
 * - 老格式 cl_pending_series 兼容：推断品类 + 回顺序清单
 * - 号码编辑弹窗样式：无深色主题变量残留
 * 运行：node --test tests/mp-series-detail.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');

const MP = path.join(__dirname, '..', 'miniprogram');
const mem = {};
let navs = [];
let captured = null;

function install(file, exportsObj) {
  const p = path.join(MP, file);
  delete require.cache[require.resolve(p)];
  require.cache[require.resolve(p)] = { id: p, filename: p, loaded: true, exports: exportsObj };
}

function setupWx() {
  for (const k of Object.keys(mem)) delete mem[k];
  navs = [];
  captured = null;
  global.wx = {
    getStorageSync: (k) => (k in mem ? mem[k] : ''),
    setStorageSync: (k, v) => { mem[k] = v; },
    removeStorageSync: (k) => { delete mem[k]; },
    switchTab: (o) => { navs.push({ type: 'switchTab', url: o.url }); },
    navigateTo: (o) => { navs.push({ type: 'navigateTo', url: o.url }); },
    navigateBack() {},
    setNavigationBarTitle() {},
    showToast() {},
    stopPullDownRefresh() {},
  };
  global.getCurrentPages = () => [];
  global.App = () => {};
  global.getApp = () => ({ globalData: {} });
  global.Page = (c) => { captured = c; };
}

function instance() {
  const inst = Object.assign({}, captured);
  inst.data = JSON.parse(JSON.stringify(captured.data || {}));
  inst.setData = function (patch, cb) {
    Object.keys(patch).forEach((k) => { this.data[k] = patch[k]; });
    if (typeof cb === 'function') cb();
  };
  return inst;
}

const COINS = [
  { id: 1, name: '币A', year: 2020, kind: 'coin', series: 's1', seriesKeys: ['s1'], face: 10, faceText: '10 元', setSize: 1, smallUrl: '' },
  { id: 2, name: '钞A', year: 2022, kind: 'note', series: 's2', seriesKeys: ['s2'], face: 100, faceText: '100 元', setSize: 1, smallUrl: '' },
];

function baseCatalog(extra) {
  return Object.assign({
    total: 2,
    coins: COINS,
    seriesList: [
      { code: 's1', name: '币系列', desc: '币系列简介', img: 'img/s1.jpg' },
      { code: 's2', name: '钞系列', desc: '', img: '' },
    ],
    inSeries(code) {
      if (code === 's1') return [COINS[0]];
      if (code === 's2') return [COINS[1]];
      return [];
    },
    categoryOf: (c) => (c.kind === 'note' ? 'commemorative_note' : 'commemorative_coin'),
    seriesName: (code) => (code === 's1' ? '币系列' : ''),
    money: (n) => String(n),
    aiPriceOf: () => 100,
    setSizeOf: (c) => c.setSize || 1,
  }, extra || {});
}

function loadDetailPage(apiStub) {
  install('utils/catalog.js', baseCatalog());
  install('utils/store.js', {
    ownedNames: () => ({ 币A: 1 }),
    getState: () => ({ holdings: [] }),
  });
  install('utils/api.js', Object.assign({ BASE: 'https://example.test' }, apiStub || {}));
  install('utils/share.js', { COVER: '/images/share-cover.png', appMessage: () => ({}), timeline: () => ({}) });
  const file = path.join(MP, 'pages/series-detail/series-detail.js');
  delete require.cache[require.resolve(file)];
  require(file);
  return instance();
}

test('coin 系列详情页：本地目录筛选 + 已藏进度 + 推理价合计', async () => {
  setupWx();
  const p = loadDetailPage();
  p.onLoad({ category: 'coin', code: 's1', name: '币系列' });
  assert.equal(p.data.category, 'coin');
  assert.equal(p.data.code, 's1');
  assert.equal(p.data.series.name, '币系列');
  assert.equal(p.data.series.count, 1);
  assert.equal(p.data.series.own, 1);
  assert.equal(p.data.series.pct, 100);
  assert.equal(p.data.rows.length, 1);
  assert.equal(p.data.rows[0].name, '币A');
  assert.equal(p.data.rows[0].priceText, '¥100');
  assert.equal(p.data.loaded, true);
});

test('note 系列详情页：category 由入参决定', async () => {
  setupWx();
  const p = loadDetailPage();
  p.onLoad({ category: 'note', code: 's2' });
  assert.equal(p.data.category, 'note');
  assert.equal(p.data.rows[0].name, '钞A');
});

test('系列标题乱码：URL 参数被 encodeURIComponent 编码时正确解码（导航栏 + hero 一致）', async () => {
  setupWx();
  let navTitle = '';
  global.wx.setNavigationBarTitle = (o) => { navTitle = o.title; };
  const p = loadDetailPage();
  // 模拟本地 navigateTo：入口对中文 name / code 做了 encodeURIComponent
  p.onLoad({ category: 'coin', code: encodeURIComponent('s1'), name: encodeURIComponent('一轮生肖贺岁') });
  assert.equal(p.data.name, '一轮生肖贺岁', 'hero 标题应解码为正确中文');
  assert.equal(p.data.code, 's1');
  assert.equal(p.data.series.name, '一轮生肖贺岁');
  assert.equal(navTitle, '一轮生肖贺岁', '导航栏标题不应是 %E4%B8%80... 编码串');
});

test('系列标题乱码：分享链路双重编码的 name 也能解回中文', async () => {
  setupWx();
  let navTitle = '';
  global.wx.setNavigationBarTitle = (o) => { navTitle = o.title; };
  const p = loadDetailPage();
  const twice = encodeURIComponent(encodeURIComponent('世界文化与自然双重遗产'));
  p.onLoad({ category: 'coin', code: 'WH', name: twice });
  assert.equal(p.data.name, '世界文化与自然双重遗产');
  assert.equal(navTitle, '世界文化与自然双重遗产');
});

test('系列标题：已解码的中文保持原样，含 % 字面量不被误伤', async () => {
  setupWx();
  const p = loadDetailPage();
  p.onLoad({ category: 'coin', code: 's1', name: '100% 纯银纪念系列' });
  assert.equal(p.data.name, '100% 纯银纪念系列');
  // 非法 % 序列不应抛错
  p.onLoad({ category: 'coin', code: 's1', name: '50%off 系列%ZZ' });
  assert.equal(p.data.name, '50%off 系列%ZZ');
});

test('pm 系列详情页：走 /api/series/detail 聚合接口并展示富信息', async () => {
  setupWx();
  const paths = [];
  const p = loadDetailPage({
    get: (path) => {
      paths.push(path);
      // 真实接口已按 sort 排好序，直接返回服务端顺序（年份降序）
      return Promise.resolve({
        ok: true,
        series: { code: 'pm1', name: '熊猫金币', count: 2, yearFrom: '1982', yearTo: '2024', materials: ['金', '银'], thumb: '/img/pm/1.jpg' },
        total: 2, page: 1, pages: 1,
        items: [
          { code: 'C2', name: '熊猫金币2', year: 2024, material: '银', weightG: 30, face: 10, thumb: '' },
          { code: 'C1', name: '熊猫金币1', year: 1982, material: '金', weightG: 8, face: 500, thumb: '/img/pm/1.jpg' },
        ],
      });
    },
  });
  p.onLoad({ category: 'pm', code: 'pm1', name: '熊猫金币' });
  await p.reload();
  assert.equal(p.data.series.yearText, '1982—2024');
  assert.equal(p.data.series.matText, '金 · 银');
  assert.equal(p.data.series.img, 'https://example.test/img/pm/1.jpg');
  assert.equal(p.data.rows.length, 2);
  // 排序交给服务端：请求里必须带 sort，返回什么顺序就展示什么顺序
  assert.match(paths[paths.length - 1], /sort=year_desc/);
  assert.equal(p.data.rows[0].year, 2024);
  assert.equal(p.data.rows[1].year, 1982);
  assert.equal(p.data.rows[0].metaText, '银 · 30 克');
});

test('pm 系列详情页：切排序回第一页重查，不只排已加载那一页', async () => {
  setupWx();
  const paths = [];
  const p = loadDetailPage({
    get: (path) => {
      paths.push(path);
      return Promise.resolve({
        ok: true,
        series: { code: 'pm1', name: '熊猫金币', count: 1, yearFrom: '2024', yearTo: '2024', materials: ['金'], thumb: '' },
        total: 1, page: 1, pages: 1,
        items: [{ code: 'C2', name: '熊猫金币2', year: 2024, material: '金', weightG: 30, face: 10, thumb: '' }],
      });
    },
  });
  p.onLoad({ category: 'pm', code: 'pm1', name: '熊猫金币' });
  await p.reload();
  const before = paths.length;
  p.toggleSort();
  await new Promise((r) => setTimeout(r, 0));
  assert.ok(paths.length > before, '应重新请求接口');
  assert.match(paths[paths.length - 1], /sort=year_asc/);
});

test('详情页分享落地到 series-detail（带 category+code+name）', () => {
  setupWx();
  const p = loadDetailPage();
  p.onLoad({ category: 'coin', code: 's1', name: '币系列' });
  const s = p.onShareAppMessage();
  assert.ok(s.path.indexOf('/pages/series-detail/series-detail?') === 0);
  assert.ok(s.path.includes('category=coin'));
  assert.ok(s.path.includes('code=s1'));
  assert.ok(s.path.includes('name='));
  const tl = p.onShareTimeline();
  assert.ok(tl.query.includes('category=coin'));
});

test('list.goSeriesCard 打开新页面，不再跳回顺序清单', () => {
  setupWx();
  install('utils/catalog.js', baseCatalog());
  install('utils/store.js', { ownedNames: () => ({}), setPriceOf: () => 0, getState: () => ({ holdings: [] }), refresh: () => Promise.resolve() });
  install('utils/api.js', { BASE: 'https://example.test', get: () => Promise.resolve({ ok: true, items: [] }) });
  install('utils/share.js', { appMessage: () => ({}), timeline: () => ({}) });
  const f = path.join(MP, 'pages/list/list.js');
  delete require.cache[require.resolve(f)];
  require(f);
  const p = instance();
  p.data.viewMode = 'series';
  p.data.seriesNote = [{ code: 's2', name: '钞系列' }];
  p.goSeriesCard({ currentTarget: { dataset: { cat: 'note', code: 's2' } } });
  assert.equal(navs.length, 1);
  assert.equal(navs[0].type, 'navigateTo');
  assert.ok(navs[0].url.includes('/pages/series-detail/series-detail?'));
  assert.ok(navs[0].url.includes('category=note'));
  assert.ok(navs[0].url.includes('name=' + encodeURIComponent('钞系列'))); // 钞系列
  assert.equal(p.data.viewMode, 'series', '不应改动当前视图模式');
});

test('series.goSeries 打开新页面，保留返回栈', () => {
  setupWx();
  install('utils/catalog.js', baseCatalog());
  install('utils/store.js', { getState: () => ({ holdings: [] }) });
  install('utils/api.js', { BASE: 'https://example.test', get: () => Promise.resolve({ ok: true, items: [] }) });
  install('utils/share.js', { appMessage: () => ({}), timeline: () => ({}) });
  const f = path.join(MP, 'pages/series/series.js');
  delete require.cache[require.resolve(f)];
  require(f);
  const p = instance();
  p.data.noteGroup = [{ code: 's2', name: '钞系列' }];
  p.goSeries({ currentTarget: { dataset: { code: 's2', cat: 'note' } } });
  assert.equal(navs.length, 1);
  assert.equal(navs[0].type, 'navigateTo');
  assert.ok(navs[0].url.includes('category=note'));
  assert.equal(mem['cl_pending_series'], undefined, '不应再写 storage');
});

test('index.goSeries 打开新页面（修复老格式不带 category 的 bug）', () => {
  setupWx();
  install('utils/catalog.js', baseCatalog());
  install('utils/store.js', { stats: () => ({}), ownedNames: () => ({}), getState: () => ({ user: null }), refresh: () => Promise.resolve() });
  install('utils/api.js', { BASE: 'https://example.test', get: () => Promise.resolve({ ok: false }) });
  install('utils/share.js', { appMessage: () => ({}), timeline: () => ({}) });
  const f = path.join(MP, 'pages/index/index.js');
  delete require.cache[require.resolve(f)];
  require(f);
  const p = instance();
  p.goSeries({ currentTarget: { dataset: { code: 's2', cat: 'note', name: '钞系列' } } });
  assert.equal(navs[0].type, 'navigateTo');
  assert.ok(navs[0].url.includes('category=note'));
  assert.equal(mem['cl_pending_series'], undefined);
});

test('老格式 cl_pending_series：推断品类并回顺序清单', () => {
  setupWx();
  install('utils/catalog.js', baseCatalog());
  install('utils/store.js', { ownedNames: () => ({}), setPriceOf: () => 0, getState: () => ({ holdings: [] }), refresh: () => Promise.resolve() });
  install('utils/api.js', { BASE: 'https://example.test', get: () => Promise.resolve({ ok: true, items: [] }) });
  install('utils/share.js', { appMessage: () => ({}), timeline: () => ({}) });
  const f = path.join(MP, 'pages/list/list.js');
  delete require.cache[require.resolve(f)];
  require(f);
  const p = instance();
  p.data.viewMode = 'series';
  mem['cl_pending_series'] = 's2';
  p.onShow();
  assert.equal(p.data.code, 's2');
  assert.equal(p.data.category, 'note', '纪念钞系列应推断为 note');
  assert.equal(p.data.viewMode, 'list', '应回到顺序清单');
});

test('app.json 注册了 series-detail；号码弹窗样式无深色主题变量残留', () => {
  const app = JSON.parse(fs.readFileSync(path.join(MP, 'app.json'), 'utf8'));
  assert.ok(app.pages.includes('pages/series-detail/series-detail'));
  const wxss = fs.readFileSync(path.join(MP, 'pages/holdings/holdings.wxss'), 'utf8');
  assert.ok(!wxss.includes('--surf-2'), '不应有深色主题 CSS 变量');
  assert.ok(!wxss.includes('#1a1f27'), '不应有深色 fallback 背景');
});
