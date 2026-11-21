'use strict';
/**
 * 顺序清单的品类隔离：纪念币与纪念钞的系列页签、筛选选项、筛选状态各自独立。
 *
 * 以前的毛病：系列页签用的是全量 seriesList，切到「纪念钞」下面还挂着
 * 一轮生肖贺岁、世界文化遗产这些纪念币系列，选中必然 0 条；
 * 三个筛选下拉同理，而且筛选条件切品类后还会带过去。
 *
 * 运行：node --test tests/mp-list-category.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

const MP = path.join(__dirname, '..', 'miniprogram');
const readMp = (p) => fs.readFileSync(path.join(MP, p), 'utf8');

const COINS = [
  // 纪念币：面额 5 / 10，材质双色铜合金
  { id: 1, name: '币A', year: 2020, kind: 'coin', series: 'S1', seriesKeys: ['S1'], face: 5, faceText: '5 元', material: '双色铜合金', setSize: 1, smallUrl: '' },
  { id: 2, name: '币B', year: 2022, kind: 'coin', series: 'S1', seriesKeys: ['S1'], face: 10, faceText: '10 元', material: '双色铜合金', setSize: 1, smallUrl: '' },
  { id: 3, name: '币C', year: 2019, kind: 'coin', series: 'S2', seriesKeys: ['S2'], face: 10, faceText: '10 元', material: '黄铜合金', setSize: 1, smallUrl: '' },
  // 纪念钞：面额 100，材质纸
  { id: 4, name: '钞A', year: 2024, kind: 'note', series: 'N1', seriesKeys: ['N1'], face: 100, faceText: '100 元', material: '纸', setSize: 1, smallUrl: '' },
];

function install(file, exportsObj) {
  const p = path.join(MP, file);
  delete require.cache[require.resolve(p)];
  require.cache[require.resolve(p)] = { id: p, filename: p, loaded: true, exports: exportsObj };
}

function baseCatalog() {
  return {
    total: COINS.length,
    coins: COINS,
    seriesList: [
      { code: 'S2', name: '币系列二', sort: 20, count: 1 },
      { code: 'S1', name: '币系列一', sort: 10, count: 2 },
      { code: 'N1', name: '钞系列', sort: 30, count: 1 },
    ],
    categoryOf: (c) => (c.kind === 'note' ? 'commemorative_note' : 'commemorative_coin'),
    inSeries: (code) => COINS.filter((c) => (c.seriesKeys || [c.series]).indexOf(code) >= 0),
    seriesName: (code) => ({ S1: '币系列一', S2: '币系列二', N1: '钞系列' }[code] || ''),
    money: (n) => String(n),
    round2: (n) => Math.round(n * 100) / 100,
    aiPriceOf: () => 0,
    setSizeOf: () => 1,
    setPriceOf: () => 0,
  };
}

function loadPage() {
  global.wx = {
    getStorageSync: () => '',
    setStorageSync() {}, removeStorageSync() {},
    showToast() {}, showModal() {}, stopPullDownRefresh() {},
    navigateTo() {}, switchTab() {}, navigateBack() {},
  };
  global.getCurrentPages = () => [];
  global.App = () => {};
  global.getApp = () => ({ globalData: {} });
  let captured = null;
  global.Page = (c) => { captured = c; };

  install('utils/catalog.js', baseCatalog());
  install('utils/store.js', {
    ownedNames: () => ({}), setPriceOf: () => 0, findHolding: () => null,
    getState: () => ({ holdings: [], user: null, synced: true }),
    stats: () => ({ face: 0, cost: 0, market: 0, profit: 0, rolls: 0, kinds: 0 }),
    refresh: () => Promise.resolve(),
  });
  install('utils/api.js', { BASE: '', get: () => Promise.resolve({ ok: true, items: [] }), post: () => Promise.resolve({ ok: true }) });
  install('utils/share.js', { appMessage: () => ({}), timeline: () => ({}), COVER: '' });
  install('utils/feature.js', { plaza: false });

  const f = path.join(MP, 'views/list/list.logic.js');
  delete require.cache[require.resolve(f)];
  require(f);
  if (!captured) captured = require(f);
  const inst = Object.assign({}, captured);
  inst.data = JSON.parse(JSON.stringify(captured.data || {}));
  inst.setData = function (patch, cb) {
    Object.keys(patch).forEach((k) => { this.data[k] = patch[k]; });
    if (typeof cb === 'function') cb();
  };
  return inst;
}

test('系列页签只列本品类出现过的系列', () => {
  const p = loadPage();
  const coinTabs = p.tabsForCategory('coin').map((t) => t.code);
  assert.deepEqual(coinTabs, ['', 'S1', 'S2'], '纪念币页签不该出现钞系列');
  const noteTabs = p.tabsForCategory('note').map((t) => t.code);
  assert.deepEqual(noteTabs, ['', 'N1'], '纪念钞页签不该出现币系列');
});

test('页签按系列 sort 排序，并带上该品类下的数量', () => {
  const p = loadPage();
  const tabs = p.tabsForCategory('coin');
  assert.equal(tabs[0].code, '');
  assert.equal(tabs[0].count, 3, '「全部」应是该品类的品种数');
  assert.equal(tabs[1].code, 'S1');
  assert.equal(tabs[1].count, 2);
  assert.equal(tabs[2].code, 'S2');
});

test('筛选选项按品类生成：钞里没有 5 元面额、没有铜合金', () => {
  const p = loadPage();
  const coinOpts = p.buildFilterOpts('coin');
  assert.ok(coinOpts.faceOpts.includes('5 元'));
  assert.ok(coinOpts.faceOpts.includes('10 元'));
  assert.ok(coinOpts.matOpts.includes('双色铜合金'));

  const noteOpts = p.buildFilterOpts('note');
  assert.deepEqual(noteOpts.faceOpts, ['全部面额', '100 元']);
  assert.deepEqual(noteOpts.matOpts, ['全部材质', '纸']);
  assert.deepEqual(noteOpts.yearOpts, ['全部年份', '2024']);
});

test('切品类会重建页签，并把筛选条件换成该品类自己的', () => {
  const p = loadPage();
  p.applyCategory('coin', '');
  assert.deepEqual(p.data.tabs.map((t) => t.code), ['', 'S1', 'S2']);
  assert.ok(p.data.faceOpts.includes('5 元'));

  p.applyCategory('note', '');
  assert.deepEqual(p.data.tabs.map((t) => t.code), ['', 'N1'], '切到纪念钞后页签没换');
  assert.ok(!p.data.faceOpts.includes('5 元'), '切到纪念钞后还能选 5 元面额');
});

test('筛选状态按品类独立：切走再切回来还记得，也不会污染另一个品类', () => {
  const p = loadPage();
  p.applyCategory('coin', '');
  // 在纪念币下选「2022 年 · 10 元」
  p.setData({ yearIdx: 1, yearFilter: '2022', faceIdx: 1, faceFilter: '10', matIdx: 1, matFilter: '双色铜合金' });
  p.syncExtra();
  assert.equal(p.data.extraCount, 3, '年 / 面额 / 材质三个条件');

  // 切到纪念钞：条件应清空（钞没有 2022 的 10 元）
  p.applyCategory('note', '');
  assert.equal(p.data.yearFilter, '', '纪念钞不该继承纪念币的年份条件');
  assert.equal(p.data.faceFilter, '');
  assert.equal(p.data.extraCount, 0);

  // 在纪念钞下选 2024
  p.setData({ yearIdx: 1, yearFilter: '2024' });
  p.syncExtra();

  // 切回纪念币：原来的条件还在
  p.applyCategory('coin', '');
  assert.equal(p.data.yearFilter, '2022', '切回纪念币应恢复它自己的筛选');
  assert.equal(p.data.faceFilter, '10');
});

test('clearExtra 只清当前品类，不影响另一个品类已存的条件', () => {
  const p = loadPage();
  p.applyCategory('coin', '');
  p.setData({ yearIdx: 1, yearFilter: '2022' });
  p.syncExtra();

  p.applyCategory('note', '');
  p.setData({ yearIdx: 1, yearFilter: '2024' });
  p.syncExtra();
  p.clearExtra();
  assert.equal(p.data.yearFilter, '', '当前品类应被清空');

  p.applyCategory('coin', '');
  assert.equal(p.data.yearFilter, '2022', '另一个品类的条件不该被连带清掉');
});

test('「按系列」里切过品类，回到清单也会刷新页签', () => {
  const p = loadPage();
  p.applyCategory('coin', '');
  p.setData({ viewMode: 'series' });
  p.setData({ category: 'note' });   // 按系列视图里点「纪念钞」
  p.toggleViewMode({ currentTarget: { dataset: { mode: 'list' } } });
  assert.deepEqual(p.data.tabs.map((t) => t.code), ['', 'N1'], '回清单后页签还停在上一个品类');
});

test('品种详情的同系列改成了卡片（缩略图 / 年份面额 / 已收标记）', () => {
  const wxml = readMp('pages/detail/detail.wxml');
  assert.match(wxml, /class="same-scroll"[\s\S]{0,80}scroll-x/, '同系列应该是横向滚动容器');
  assert.match(wxml, /class="same-card"/, '缺卡片节点');
  assert.match(wxml, /class="same-img"/, '卡片要有缩略图');
  assert.match(wxml, /class="same-own"[\s\S]{0,40}已收/, '卡片要有已收标记');
  assert.doesNotMatch(wxml, /class="chips"/, '旧的纯文字胶囊应已移除');

  const js = readMp('pages/detail/detail.js');
  assert.match(js, /imgUrl: c\.smallUrl \|\| c\.thumbUrl \|\| c\.imgUrl/, '同系列要带缩略图');
  assert.match(js, /owned: !!ownedMap\[c\.name\]/, '同系列要标出哪些已收');
});
