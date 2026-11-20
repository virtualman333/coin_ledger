'use strict';
/**
 * 回归测试：小程序「全套清单」页「年份 ↓」排序按钮。
 * - 点击切换升序/降序，desc 状态与箭头（↓/↑）同步
 * - 贵金属 / 普通纪念币 / 纪念钞三个品类都真正重新排序
 * - 分页数据只排当前已加载的 pmRows，不发起新的网络请求
 * 运行：node --test tests/mp-list-sort.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');

const ROOT = path.join(__dirname, '..');
const MP = path.join(ROOT, 'miniprogram');
const mem = {};
let captured = null;
let apiCalls = [];

function mp(file) {
  return path.join(MP, file);
}

function install(file, exportsObj) {
  const p = mp(file);
  delete require.cache[require.resolve(p)];
  require.cache[require.resolve(p)] = {
    id: p,
    filename: p,
    loaded: true,
    exports: exportsObj,
  };
}

function setupWx() {
  for (const k of Object.keys(mem)) delete mem[k];
  apiCalls = [];
  global.wx = {
    getStorageSync: (k) => (k in mem ? mem[k] : ''),
    setStorageSync: (k, v) => { mem[k] = v; },
    removeStorageSync: (k) => { delete mem[k]; },
    switchTab() {}, navigateTo() {}, navigateBack() {},
    showToast() {}, showLoading() {}, hideLoading() {}, stopPullDownRefresh() {},
  };
  global.getCurrentPages = () => [];
  global.App = () => {};
  global.getApp = () => ({ globalData: {} });
  captured = null;
  global.Page = (c) => { captured = c; };
}

const COINS = [
  { id: 1, name: '测试币-2020', year: 2020, kind: 'coin', series: 's1', seriesName: '币系列', face: 10, faceText: '10 元', setSize: 1 },
  { id: 2, name: '测试钞-2024', year: 2024, kind: 'note', series: 's2', seriesName: '钞系列', face: 100, faceText: '100 元', setSize: 1 },
  { id: 3, name: '测试币-2022', year: 2022, kind: 'coin', series: 's1', seriesName: '币系列', face: 5, faceText: '5 元', setSize: 1 },
];

function loadListPage() {
  install('utils/catalog.js', {
    total: COINS.length,
    seriesList: [],
    coins: COINS,
    categoryOf: (c) => (c.kind === 'note' ? 'commemorative_note' : 'commemorative_coin'),
    seriesName: () => '',
    money: (n) => String(n),
    aiPriceOf: () => 100,
  });
  install('utils/store.js', {
    ownedNames: () => ({}),
    setPriceOf: () => 0,
    getState: () => ({ holdings: [] }),
    refresh: () => Promise.resolve(),
  });
  install('utils/api.js', {
    BASE: 'https://example.test',
    get: (p) => {
      apiCalls.push(p);
      return Promise.resolve({ ok: true, items: [], page: 1, pages: 0, total: 0 });
    },
  });
  install('utils/share.js', { appMessage: () => ({}), timeline: () => ({}) });
  const file = mp('pages/list/list.js');
  delete require.cache[require.resolve(file)];
  require(file);
  const inst = Object.assign({}, captured);
  inst.data = JSON.parse(JSON.stringify(captured.data || {}));
  inst.setData = function (patch, cb) {
    Object.keys(patch).forEach((k) => { this.data[k] = patch[k]; });
    if (typeof cb === 'function') cb();
  };
  inst.data.allTabs = [{ code: '', name: '全部' }];
  inst.data.pmTabs = [{ code: '', name: '全部项目' }];
  return inst;
}

const years = (rows) => rows.map((r) => Number(r.year));

test('按钮绑定与箭头表达式正确（↓ 降序 / ↑ 升序）', () => {
  const wxml = fs.readFileSync(path.join(MP, 'pages', 'list', 'list.wxml'), 'utf8');
  assert.match(wxml, /bindtap="toggleSort"/);
  assert.match(wxml, /\{\{desc \? '↓' : '↑'\}\}/);
});

test('贵金属：点击切换方向并真实重排 pmRows', () => {
  setupWx();
  const p = loadListPage();
  p.data.category = 'pm';
  p.data.desc = true;
  p.data.pmRows = [
    { code: 'a', year: 2020 },
    { code: 'b', year: 2024 },
    { code: 'c', year: 2022 },
  ];

  p.toggleSort();
  assert.equal(p.data.desc, false, '箭头方向状态应切到升序');
  assert.deepEqual(years(p.data.pmRows), [2020, 2022, 2024], '升序：小年份在前');

  p.toggleSort();
  assert.equal(p.data.desc, true, '再次点击应切回降序');
  assert.deepEqual(years(p.data.pmRows), [2024, 2022, 2020], '降序：大年份在前');
});

test('贵金属：字符串年份也能正确排序，且不发起新请求', () => {
  setupWx();
  const p = loadListPage();
  p.data.category = 'pm';
  p.data.desc = true;
  p.data.pmRows = [
    { code: 'a', year: '2021' },
    { code: 'b', year: '2025' },
    { code: 'c', year: '2019' },
  ];
  const before = apiCalls.length;

  p.toggleSort();
  assert.deepEqual(years(p.data.pmRows), [2019, 2021, 2025]);
  assert.equal(apiCalls.length, before, '排序不应重新请求接口');
});

test('普通纪念币：点击后 rows 按年份升序/降序切换', () => {
  setupWx();
  const p = loadListPage();
  p.data.category = 'coin';
  p.data.desc = true;

  p.render();
  assert.deepEqual(years(p.data.rows), [2022, 2020], '默认降序，仅含普通纪念币');

  p.toggleSort();
  assert.equal(p.data.desc, false);
  assert.deepEqual(years(p.data.rows), [2020, 2022], '点击后升序');
});

test('纪念钞：点击后 rows 按年份升序/降序切换', () => {
  setupWx();
  const p = loadListPage();
  p.data.category = 'note';
  p.data.desc = true;

  p.render();
  assert.deepEqual(years(p.data.rows), [2024], '默认降序，仅含钞');

  p.toggleSort();
  assert.equal(p.data.desc, false);
  assert.deepEqual(years(p.data.rows), [2024], '点击后仍为升序且只含钞');
});

test('sortByYear 同年份稳定且与方向一致', () => {
  setupWx();
  const p = loadListPage();
  const rows = [{ code: 'b', year: 2020 }, { code: 'a', year: 2020 }, { code: 'c', year: 2021 }];
  assert.deepEqual(p.sortByYear(rows, true).map((r) => r.code), ['c', 'b', 'a']);
  assert.deepEqual(p.sortByYear(rows, false).map((r) => r.code), ['a', 'b', 'c']);
  assert.deepEqual(rows.map((r) => r.code), ['b', 'a', 'c'], '不应修改原数组');
});
