'use strict';
/**
 * 回归测试：我的藏品价格口径统一。
 * 只保留 面值（faceText）/ 推理价（aiText）/ 成本（costText，用户自设，默认按面值）。
 * 纯源码 + 轻量运行时断言，离线运行：
 *   node --test tests/mp-holdings-price.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const MP = path.join(ROOT, 'miniprogram');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const load = (p) => require(path.join(MP, p));

// 这些字样/字段在新口径里一律不能出现在小程序「我的藏品」页面
const FORBIDDEN_WORDS = ['市值', '市场价', '市价', '盈亏', '溢价', '参考价', '与市价相当', '浮动'];
const FORBIDDEN_FIELDS = [
  'marketText', 'pnlText', 'aiDiffText', 'pnlPct', 'pnlCls', 'profit', 'profitText', 'sumLabel',
];

function loadPage() {
  const mem = {};
  global.wx = {
    getStorageSync: (k) => (k in mem ? mem[k] : ''),
    setStorageSync: (k, v) => { mem[k] = v; },
    showToast() {}, showModal() {}, hideToast() {},
    showLoading() {}, hideLoading() {}, stopPullDownRefresh() {},
    switchTab() {}, navigateTo() {}, navigateBack() {}, vibrateShort() {},
    redirectTo() {},
  };
  global.getCurrentPages = () => [{ route: 'pages/holdings/holdings' }];
  let captured = null;
  global.Page = (c) => { captured = c; };
  global.App = () => {};
  global.getApp = () => ({ globalData: {} });
  const file = path.join(MP, 'pages', 'holdings', 'holdings.js');
  delete require.cache[require.resolve(file)];
  require(file);
  if (!captured) captured = require(file);
  const inst = Object.assign({}, captured);
  inst.data = JSON.parse(JSON.stringify(captured.data || {}));
  inst.setData = function (patch) {
    Object.keys(patch).forEach((k) => { this.data[k] = patch[k]; });
  };
  return inst;
}

test('我的藏品 WXML 无市值/市场价/盈亏等字样，只展示面值/推理价/成本', () => {
  const wxml = read('miniprogram/pages/holdings/holdings.wxml');
  FORBIDDEN_WORDS.forEach((w) => {
    assert.ok(!wxml.includes(w), `WXML 不应出现「${w}」`);
  });
  FORBIDDEN_FIELDS.forEach((f) => {
    assert.ok(!wxml.includes(f), `WXML 不应展示字段 ${f}`);
  });
  ['面值', '推理价', '成本'].forEach((w) => {
    assert.ok(wxml.includes(w), `WXML 应展示「${w}」`);
  });
});

test('我的藏品顶部汇总只有品种数/套数/总面值/推理价合计/成本合计', () => {
  const wxml = read('miniprogram/pages/holdings/holdings.wxml');
  ['推理价合计', '个品种', '套', '总面值', '成本合计'].forEach((w) => {
    assert.ok(wxml.includes(w), `汇总应包含「${w}」`);
  });
  const js = read('miniprogram/pages/holdings/holdings.js');
  assert.match(js, /aiAllSum/);
  assert.match(js, /推理价合计/);
});

test('我的藏品 JS 展示字段只含面值/推理价/成本，底层 market 数据不参与展示', () => {
  const js = read('miniprogram/pages/holdings/holdings.js');
  ['faceText', 'aiText', 'costText'].forEach((f) => {
    assert.match(js, new RegExp(`${f}\\s*:`), `JS 应产出展示字段 ${f}`);
  });
  FORBIDDEN_FIELDS.forEach((f) => {
    assert.ok(!js.includes(f), `JS 不应产出展示字段 ${f}`);
  });
  assert.ok(!js.includes('h.market'), 'JS 不应读取持仓里的市场估值字段');
});

test('render() 产出的卡片、分组与汇总字段符合新口径', () => {
  const store = load('utils/store.js');
  const cat = load('utils/catalog.js');
  const coin = cat.coins.find((c) => !cat.isPm(c) && (c.setFaceBase || c.setFace) > 0);
  assert.ok(coin, '测试需要一枚普通币');
  store.state.user = { name: '测试用户' };
  store.state.synced = true;
  store.state.holdings = [{
    id: 'h1', name: coin.name, rolls: 2, unit: 'set', cost: 12, market: 999,
  }];

  const p = loadPage();
  p.data.holdCat = 'all';
  p.render();

  const item = p.data.groups[0].items[0];
  ['faceText', 'aiText', 'costText'].forEach((f) => {
    assert.equal(typeof item[f], 'string', `卡片应有 ${f}`);
    assert.notEqual(item[f], '', `卡片 ${f} 不应为空`);
  });
  FORBIDDEN_FIELDS.forEach((f) => {
    assert.ok(!(f in item), `卡片不应含字段 ${f}`);
  });
  assert.equal(typeof p.data.groups[0].aiText, 'string', '分组头部应是推理价合计');
  // pmKinds / pmRolls：贵金属单独计数（本地 catalog 没有它们，面值/推理价都算不出来）
  assert.deepEqual(Object.keys(p.data.stats).sort(), ['aiText', 'costText', 'faceText', 'kinds', 'pmKinds', 'pmRolls', 'rolls']);
  assert.deepEqual(Object.keys(p.data.summary).sort(), ['aiText', 'costText', 'faceText', 'kinds', 'pmKinds', 'pmRolls', 'rolls']);
});

test('成本默认按面值 × 数量初始化，且不覆盖已保存的成本', () => {
  const api = load('utils/api.js');
  const store = load('utils/store.js');
  const cat = load('utils/catalog.js');
  const coin = cat.coins.find((c) => !cat.isPm(c) && (c.setFaceBase || c.setFace) > 0);
  assert.ok(coin);
  const origPut = api.put;
  api.put = () => Promise.resolve({ rev: 1 });
  try {
    store.state.user = { name: '测试用户' };
    store.state.holdings = [];

    // 普通币：成本默认 = 一套面值 × 套数
    store.addCoin(coin, 'set', 3);
    assert.equal(store.state.holdings[0].cost, Math.round((coin.setFace || coin.setFaceBase) * 3 * 100) / 100);

    // 贵金属：接口带面值时成本默认 = 面值 × 数量
    store.state.holdings = [];
    store.addPm({ code: 'PM1', name: '测试金银币', thumb: '', face: 100, rolls: 2 });
    assert.equal(store.state.holdings[0].cost, 200);

    // 已有用户成本不被重复加入/新增操作覆盖
    const saved = { id: 'h9', name: '已保存', rolls: 1, cost: 777, market: 0, category: 'pm' };
    store.state.holdings = [saved];
    assert.throws(() => store.addPm({ code: 'h9', name: '已保存', face: 100 }), /已经在你的收藏里/);
    assert.equal(store.state.holdings[0].cost, 777);
  } finally {
    api.put = origPut;
    store.state.holdings = [];
    store.state.user = null;
  }
});
