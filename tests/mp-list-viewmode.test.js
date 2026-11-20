'use strict';
/**
 * 回归测试：小程序「全套清单」页的两种视图模式。
 * - 默认顺序清单，可切到「按系列」卡片视图
 * - 按系列视图：普通币/纪念钞从本地目录分组，贵金属复用 pmTabs 项目
 * - 点系列卡片回顺序清单并定位到对应品类 + 系列
 * 运行：node --test tests/mp-list-viewmode.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');

const MP = path.join(__dirname, '..', 'miniprogram');
let captured = null;

function install(file, exportsObj) {
  const p = path.join(MP, file);
  delete require.cache[require.resolve(p)];
  require.cache[require.resolve(p)] = { id: p, filename: p, loaded: true, exports: exportsObj };
}

function setupWx() {
  global.wx = {
    getStorageSync: () => '', setStorageSync() {}, removeStorageSync() {},
    switchTab() {}, navigateTo() {}, showToast() {}, stopPullDownRefresh() {},
  };
  global.getCurrentPages = () => [];
  global.App = () => {};
  global.getApp = () => ({ globalData: {} });
  captured = null;
  global.Page = (c) => { captured = c; };
}

const COINS = [
  { id: 1, name: '币A', year: 2020, kind: 'coin', series: 's1', seriesName: '币系列', face: 10, faceText: '10 元', setSize: 1 },
  { id: 2, name: '钞A', year: 2022, kind: 'note', series: 's2', seriesName: '钞系列', face: 100, faceText: '100 元', setSize: 1 },
];

function loadListPage() {
  install('utils/catalog.js', {
    total: 2,
    coins: COINS,
    seriesList: [
      { code: 's1', name: '币系列', img: 'img/s1.jpg' },
      { code: 's2', name: '钞系列', img: '' },
    ],
    inSeries(code) {
      if (code === 's1') return [COINS[0]];
      if (code === 's2') return [COINS[1]];
      return [];
    },
    categoryOf: (c) => (c.kind === 'note' ? 'commemorative_note' : 'commemorative_coin'),
    seriesName: () => '',
    money: (n) => String(n),
    aiPriceOf: () => 100,
  });
  install('utils/store.js', {
    ownedNames: () => ({ 币A: 1 }),
    setPriceOf: () => 0,
    getState: () => ({ holdings: [] }),
    refresh: () => Promise.resolve(),
  });
  install('utils/api.js', {
    BASE: 'https://example.test',
    get: () => Promise.resolve({ ok: true, items: [], page: 1, pages: 0, total: 0 }),
  });
  install('utils/share.js', { appMessage: () => ({}), timeline: () => ({}) });
  const file = path.join(MP, 'pages/list/list.js');
  delete require.cache[require.resolve(file)];
  require(file);
  const inst = Object.assign({}, captured);
  inst.data = JSON.parse(JSON.stringify(captured.data || {}));
  inst.setData = function (patch, cb) {
    Object.keys(patch).forEach((k) => { this.data[k] = patch[k]; });
    if (typeof cb === 'function') cb();
  };
  inst.data.allTabs = [{ code: '', name: '全部' }];
  inst.data.pmTabs = [
    { code: '', name: '全部项目' },
    { code: 'pm1', name: '熊猫金币', count: 8 },
  ];
  return inst;
}

test('默认顺序清单，切到按系列构建三组分册', () => {
  setupWx();
  const p = loadListPage();
  assert.equal(p.data.viewMode, 'list');
  p.toggleViewMode({ currentTarget: { dataset: { mode: 'series' } } });
  assert.equal(p.data.viewMode, 'series');
  assert.equal(p.data.seriesCoin.length, 1);
  assert.equal(p.data.seriesCoin[0].code, 's1');
  assert.equal(p.data.seriesCoin[0].own, 1);
  assert.equal(p.data.seriesCoin[0].pct, 100);
  assert.equal(p.data.seriesNote.length, 1);
  assert.equal(p.data.seriesNote[0].code, 's2');
  // 贵金属跳过「全部项目」
  assert.deepEqual(p.data.seriesPm, [{ code: 'pm1', name: '熊猫金币', count: 8 }]);
  assert.equal(p.data.seriesPmLoaded, true);
});

test('重复点同一模式不重复构建', () => {
  setupWx();
  const p = loadListPage();
  p.toggleViewMode({ currentTarget: { dataset: { mode: 'series' } } });
  p.data.seriesCoin = [];
  p.toggleViewMode({ currentTarget: { dataset: { mode: 'series' } } });
  assert.equal(p.data.seriesCoin.length, 0, '重复点不应重建');
});

test('点系列卡片回到顺序清单并定位品类与系列', async () => {
  setupWx();
  const p = loadListPage();
  p.toggleViewMode({ currentTarget: { dataset: { mode: 'series' } } });
  // 纪念钞卡片
  p.goSeriesCard({ currentTarget: { dataset: { cat: 'note', code: 's2' } } });
  assert.equal(p.data.viewMode, 'list');
  assert.equal(p.data.category, 'note');
  assert.equal(p.data.code, 's2');
  // 贵金属卡片走 pm 分支（loadPmFull 异步，这里只断言切了模式与品类）
  p.toggleViewMode({ currentTarget: { dataset: { mode: 'series' } } });
  p.goSeriesCard({ currentTarget: { dataset: { cat: 'pm', code: 'pm1' } } });
  assert.equal(p.data.category, 'pm');
  assert.equal(p.data.code, 'pm1');
});

test('WXML：有视图切换栏，列表与按系列两区互斥显示', () => {
  const wxml = fs.readFileSync(path.join(MP, 'pages/list/list.wxml'), 'utf8');
  assert.match(wxml, /bindtap="toggleViewMode"/);
  assert.ok(wxml.includes('data-mode="list"'));
  assert.ok(wxml.includes('data-mode="series"'));
  assert.ok(wxml.includes('class="pm-full" wx:if="{{viewMode === \'list\''));
  assert.ok(wxml.includes('class="list" wx:if="{{viewMode === \'list\''));
  assert.ok(wxml.includes('class="series-view" wx:if="{{viewMode === \'series\'}}"'));
  assert.match(wxml, /bindtap="goSeriesCard"/);
});
