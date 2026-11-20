'use strict';
/**
 * 回归测试：小程序「按系列」页三大品类分组。
 * - 普通纪念币 / 纪念钞按系列成员归类
 * - 贵金属项目走 /api/series?category=pm
 * - 点分组卡片时同时传 {code, category}，list 页切品类后定位系列
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

/** 用假模块替换小程序里的 require，避免测试依赖真实数据/网络 */
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

function instance() {
  const inst = Object.assign({}, captured);
  inst.data = JSON.parse(JSON.stringify(captured.data || {}));
  inst.setData = function (patch, cb) {
    Object.keys(patch).forEach((k) => { this.data[k] = patch[k]; });
    if (typeof cb === 'function') cb();
  };
  return inst;
}

function loadSeriesPage() {
  install('utils/catalog.js', {
    total: 4,
    seriesList: [
      { code: 's1', name: '币系列', img: 'img/s1.jpg' },
      { code: 's2', name: '钞系列', img: '' },
    ],
    inSeries(code) {
      if (code === 's1') return [{ name: '币1', kind: 'coin' }, { name: '币2', kind: 'coin' }];
      if (code === 's2') return [{ name: '钞1', kind: 'note' }, { name: '钞2', kind: 'note' }];
      return [];
    },
  });
  install('utils/store.js', { getState: () => ({ holdings: [] }) });
  install('utils/api.js', {
    BASE: 'https://example.test',
    get: (p) => Promise.resolve(
      p === '/api/series?category=pm'
        ? { ok: true, items: [{ code: 'pm1', name: '熊猫金币', count: 3 }] }
        : { ok: true, items: [] }
    ),
  });
  const file = mp('pages/series/series.js');
  delete require.cache[require.resolve(file)];
  require(file);
  return instance();
}

function loadListPage() {
  install('utils/catalog.js', {
    total: 0,
    seriesList: [],
    coins: [],
    categoryOf: () => 'commemorative_coin',
    seriesName: () => '',
    money: (n) => String(n),
  });
  install('utils/store.js', {
    ownedNames: () => ({}),
    setPriceOf: () => 0,
    getState: () => ({ holdings: [] }),
    refresh: () => Promise.resolve(),
  });
  install('utils/api.js', {
    BASE: 'https://example.test',
    get: () => Promise.resolve({ ok: true, items: [], page: 1, pages: 0, total: 0 }),
  });
  install('utils/share.js', { appMessage: () => ({}), timeline: () => ({}) });
  const file = mp('pages/list/list.js');
  delete require.cache[require.resolve(file)];
  require(file);
  const inst = instance();
  inst.data.allTabs = [{ code: '', name: '全部' }];
  inst.data.pmTabs = [{ code: '', name: '全部项目' }];
  return inst;
}

test('系列按成员分成普通纪念币与纪念钞两组', () => {
  setupWx();
  const p = loadSeriesPage();
  p.build();
  assert.equal(p.data.coinGroup.length, 1);
  assert.equal(p.data.noteGroup.length, 1);
  assert.equal(p.data.coinGroup[0].code, 's1');
  assert.equal(p.data.noteGroup[0].code, 's2');
  assert.equal(p.data.coinGroup[0].cat, 'coin');
  assert.equal(p.data.noteGroup[0].cat, 'note');
});

test('贵金属分组从公开接口加载', async () => {
  setupWx();
  const p = loadSeriesPage();
  await p.loadPmSeries();
  assert.equal(p.data.pmLoaded, true);
  assert.deepEqual(p.data.pmGroup, [{ code: 'pm1', name: '熊猫金币', count: 3 }]);
});

test('点分组卡片写入带品类的 pending', () => {
  setupWx();
  const p = loadSeriesPage();
  p.goSeries({ currentTarget: { dataset: { code: 's2', cat: 'note' } } });
  assert.deepEqual(mem['cl_pending_series'], { code: 's2', category: 'note' });
});

test('list 页读取对象 pending：先切到纪念钞再定位系列', () => {
  setupWx();
  const p = loadListPage();
  mem['cl_pending_series'] = { code: 's2', category: 'note' };
  p.onShow();
  assert.equal(p.data.category, 'note');
  assert.equal(p.data.code, 's2');
  assert.equal(mem['cl_pending_series'], undefined);
});

test('list 页读取对象 pending：贵金属切品类并带项目 code', () => {
  setupWx();
  const p = loadListPage();
  mem['cl_pending_series'] = { code: 'pm1', category: 'pm' };
  p.onShow();
  assert.equal(p.data.category, 'pm');
  assert.equal(p.data.code, 'pm1');
});

test('list 页兼容老的字符串 pending', () => {
  setupWx();
  const p = loadListPage();
  p.data.category = 'coin';
  mem['cl_pending_series'] = 's9';
  p.onShow();
  assert.equal(p.data.code, 's9');
  assert.equal(p.data.category, 'coin');
});
