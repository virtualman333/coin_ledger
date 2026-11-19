'use strict';
/**
 * 回归测试：我的藏品左滑手势。
 * - 水平左滑超过阈值才展开，垂直滚动/轻微滑动不误触
 * - 右滑收起
 * - 左滑「改成本」打开面板时聚焦成本输入
 * 运行：npm test
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const MP = path.join(__dirname, '..', 'miniprogram');

function loadPage() {
  const mem = {};
  global.wx = {
    getStorageSync: (k) => (k in mem ? mem[k] : ''),
    setStorageSync: (k, v) => { mem[k] = v; },
    removeStorageSync: (k) => { delete mem[k]; },
    request: (o) => { if (o && o.fail) o.fail({ errMsg: 'offline' }); },
    showToast() {}, showModal() {}, hideToast() {},
    showLoading() {}, hideLoading() {}, stopPullDownRefresh() {},
    switchTab() {}, navigateTo() {}, navigateBack() {}, vibrateShort() {},
  };
  global.getCurrentPages = () => [{ route: 'pages/index/index' }];
  let captured = null;
  global.Page = (c) => { captured = c; };
  global.App = () => {};
  global.getApp = () => ({ globalData: {} });
  const file = path.join(MP, 'pages', 'holdings', 'holdings.js');
  delete require.cache[require.resolve(file)];
  require(file);
  const inst = Object.assign({}, captured);
  inst.data = JSON.parse(JSON.stringify(captured.data || {}));
  inst.setData = function (patch) {
    Object.keys(patch).forEach((k) => { this.data[k] = patch[k]; });
  };
  inst.data.groups = [{
    name: '测试组',
    items: [{
      id: 'h1', coinId: 1, name: '测试币', imgUrl: '', rolls: 2,
      unitWord: '套', qtyLabel: '40 枚', marketText: '400', costText: '300',
      unitCostText: '150',
    }],
  }];
  return inst;
}

test('左滑超过阈值展开操作', () => {
  const p = loadPage();
  p._swipe = { x: 240, y: 100, id: 'h1' };
  p.swipeEnd({ changedTouches: [{ clientX: 140, clientY: 102 }] });
  assert.equal(p.data.swipeId, 'h1');
});

test('右滑收起', () => {
  const p = loadPage();
  p.setData({ swipeId: 'h1' });
  p._swipe = { x: 140, y: 100, id: 'h1' };
  p.swipeEnd({ changedTouches: [{ clientX: 240, clientY: 101 }] });
  assert.equal(p.data.swipeId, '');
});

test('垂直滚动不误触', () => {
  const p = loadPage();
  p._swipe = { x: 240, y: 100, id: 'h1' };
  p.swipeEnd({ changedTouches: [{ clientX: 200, clientY: 260 }] });
  assert.equal(p.data.swipeId, '');
});

test('滑开状态点卡片只收起，不跳详情', () => {
  const p = loadPage();
  let navigated = false;
  global.wx.navigateTo = () => { navigated = true; };
  p.setData({ swipeId: 'h1' });
  p.goDetail({ currentTarget: { dataset: { id: 1 } } });
  assert.equal(p.data.swipeId, '');
  assert.equal(navigated, false);
});

test('左滑「改成本」打开面板并聚焦成本输入', () => {
  const p = loadPage();
  p.setData({ swipeId: 'h1' });
  p.openSheet({ currentTarget: { dataset: { g: 0, i: 0, focus: 'cost' } } });
  assert.equal(p.data.swipeId, '');
  assert.equal(p.data.sheet.focus, 'cost');
  assert.equal(p.data.sheet.id, 'h1');
  assert.equal(p.data.sheet.unitCost, '150');
});
