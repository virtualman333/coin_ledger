'use strict';
/**
 * 回归测试：小程序「全套清单」页「年份 ↓」排序按钮。
 * - 点击切换升序/降序，desc 状态与箭头（↓/↑）同步
 * - 普通纪念币 / 纪念钞在本地 catalog 上重排
 * - 贵金属（2823 条 / 服务端分页）必须带 sort 参数回接口重查，不能只排已加载的那一页
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
  const file = mp('views/list/list.logic.js');
  delete require.cache[require.resolve(file)];
  require(file);
  if (!captured) captured = require(file);
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
  const wxml = fs.readFileSync(path.join(MP, 'views', 'list', 'list.wxml'), 'utf8');
  assert.match(wxml, /bindtap="toggleSort"/);
  assert.match(wxml, /\{\{desc \? '↓' : '↑'\}\}/);
});

test('贵金属：切换排序会带 sort 参数回服务端重查（本地只有一页，排了也不对）', () => {
  setupWx();
  const p = loadListPage();
  p.data.category = 'pm';
  p.data.desc = true;
  p.data.pmRows = [
    { code: 'a', year: 2020 },
    { code: 'b', year: 2024 },
  ];
  const before = apiCalls.length;

  p.toggleSort();
  assert.equal(p.data.desc, false, '箭头方向状态应切到升序');
  assert.ok(apiCalls.length > before, '应重新请求贵金属列表');
  assert.match(apiCalls[apiCalls.length - 1], /sort=year_asc/);
  assert.deepEqual(p.data.pmRows, [], '换排序要清掉旧数据，避免先看到上一页的旧顺序');

  p.toggleSort();
  assert.equal(p.data.desc, true, '再次点击应切回降序');
  assert.match(apiCalls[apiCalls.length - 1], /sort=year_desc/);
});

test('贵金属：改筛选条件同样回第一页重查，并把条件带给接口', () => {
  setupWx();
  const p = loadListPage();
  p.data.category = 'pm';
  p.data.pmRows = [{ code: 'a', year: 2020 }];
  p.data.yearOpts = ['全部年份', '2024'];
  p.data.faceOpts = ['全部面额', '10 元'];
  p.data.matOpts = ['全部材质', '金'];

  p.pickYear({ detail: { value: 1 } });
  assert.match(apiCalls[apiCalls.length - 1], /year=2024/);

  p.pickFace({ detail: { value: 1 } });
  assert.match(apiCalls[apiCalls.length - 1], /face=10/);

  p.pickMat({ detail: { value: 1 } });
  const last = apiCalls[apiCalls.length - 1];
  assert.match(last, /material=/);
  assert.match(last, /year=2024/, '其他已生效的条件不能被后一次筛选丢掉');
  assert.match(last, /facets=1/, '第一页要顺带取 facets');
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
