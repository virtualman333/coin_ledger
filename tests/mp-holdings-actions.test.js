'use strict';
/**
 * 「我的藏品」卡片交互：唯一的编辑入口是显式的「⋯」。
 *
 * 之前同时挂了左滑（露出改成本/改数量）和长按（打开面板）：
 *   - 长按不可发现，350ms 才会有反馈
 *   - 左滑和页面上下滚动抢手势，在长卡片上误触率高
 *   - 两个入口做同一件事，提示文案也只能写「左滑或长按」，用户记不住
 * 现在：点卡片看资料，点右侧「⋯」改账。两个动作都显式可见。
 *
 * 运行：node --test tests/mp-holdings-actions.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const MP = path.join(ROOT, 'miniprogram');
const readMp = (p) => fs.readFileSync(path.join(MP, p), 'utf8');

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
  if (!captured) captured = require(file);
  const inst = Object.assign({}, captured);
  inst.data = JSON.parse(JSON.stringify(captured.data || {}));
  inst.setData = function (patch, cb) {
    Object.keys(patch).forEach((k) => { this.data[k] = patch[k]; });
    if (typeof cb === 'function') cb();
  };
  inst.data.groups = [{
    name: '测试组',
    items: [{
      id: 'h1', coinId: 1, name: '测试币', imgUrl: '', rolls: 2, isPm: false,
      unitWord: '套', qtyLabel: '40 枚', marketText: '400', costText: '300',
      unitCostText: '150', aiText: '400', serials: [], images: [], form: '',
    }],
  }];
  return inst;
}

test('卡片不再挂左滑与长按', () => {
  const wxml = readMp('pages/holdings/holdings.wxml');
  assert.doesNotMatch(wxml, /bindlongpress/, '长按入口应已移除');
  assert.doesNotMatch(wxml, /bindtouch(start|end|move)/, '左滑手势应已移除');
  const js = readMp('pages/holdings/holdings.js');
  assert.doesNotMatch(js, /swipeStart|swipeEnd|closeSwipe/, '滑动手势的 JS 逻辑应一并删除');
  assert.doesNotMatch(js, /swipeId/, 'swipeId 状态应已删除');
  assert.doesNotMatch(wxml, /hswipe/, '左滑容器应已删除');
  // 注释里可以写「已去掉左滑/长按」，但展示给用户的文案不能再提
  const visible = wxml.replace(/<!--[\s\S]*?-->/g, '');
  assert.doesNotMatch(visible, /左滑|长按/, '引导文案不该再提已删除的手势');
});

test('每张卡片右侧有一个显式的「⋯」编辑入口', () => {
  const wxml = readMp('pages/holdings/holdings.wxml');
  const m = wxml.match(/<view\s+class="hc-more"[\s\S]*?<\/view>|<view\n\s+class="hc-more"[\s\S]*?>⋯<\/view>/);
  assert.ok(m, '找不到 .hc-more 入口');
  // 必须 catchtap：否则点「⋯」会冒泡到卡片的 bindtap，跳去详情页
  assert.match(m[0], /catchtap="openSheet"/, '「⋯」要用 catchtap，防止冒泡进详情');
  assert.match(m[0], /data-g="\{\{gi\}\}"/, '要把分组下标传给 openSheet');
  assert.match(m[0], /data-i="\{\{ii\}\}"/, '要把条目下标传给 openSheet');
  assert.match(m[0], /aria-label=/, '要可被读屏识别');
});

test('点卡片仍然进详情（没有被编辑入口吃掉）', () => {
  const wxml = readMp('pages/holdings/holdings.wxml');
  const card = wxml.slice(wxml.indexOf('class="hcard'), wxml.indexOf('class="hcard') + 500);
  assert.match(card, /bindtap="goDetail"/, '卡片主体仍应进详情');

  const p = loadPage();
  let nav = '';
  global.wx.navigateTo = (o) => { nav = o.url; };
  p.goDetail({ currentTarget: { dataset: { id: '1', ispm: false } } });
  assert.match(nav, /pages\/detail\/detail\?id=1/, '普通币应跳到详情页');
});

test('点「⋯」打开编辑面板，并带上这一条的完整数据', () => {
  const p = loadPage();
  p.openSheet({ currentTarget: { dataset: { g: 0, i: 0 } } });
  assert.ok(p.data.sheet, '面板没打开');
  assert.equal(p.data.sheet.id, 'h1');
  assert.equal(p.data.sheet.name, '测试币');
  assert.equal(p.data.sheet.rolls, 2);
  assert.equal(p.data.sheet.focus, '', '从「⋯」进来不自动聚焦输入框，避免弹键盘挡住面板');
});

test('多选态不显示「⋯」（那时点卡片是勾选，不该再改账）', () => {
  const wxml = readMp('pages/holdings/holdings.wxml');
  const m = wxml.match(/class="hc-more"([\s\S]{0,120})/);
  assert.ok(m, '找不到 .hc-more');
  assert.match(m[1], /wx:if="\{\{!selectMode\}\}"/, '多选态应该隐藏编辑入口');
});

test('编辑面板的入口文案与卡片信息保持一致', () => {
  const wxml = readMp('pages/holdings/holdings.wxml');
  // 成本与推理价合并成一行，卡片从 4 行降到 3 行
  assert.match(wxml, /成本 ¥\{\{item\.costText\}\}/);
  assert.match(wxml, /推理价 ¥\{\{item\.aiText\}\}/);
  assert.doesNotMatch(wxml, /hc-ai/, '旧的「推理价」独立行应已合并进 .hc-meta');
});

test('卡片副标题把套数与件数合成一句，不再有图片角标', () => {
  const js = readMp('pages/holdings/holdings.js');
  assert.match(js, /qtyText:/, '缺 qtyText');
  const wxml = readMp('pages/holdings/holdings.wxml');
  assert.match(wxml, /\{\{item\.qtyText\}\}/, '副标题应该用 qtyText');
  assert.doesNotMatch(wxml, /hc-badge/, '角标已合并进副标题，不该再渲染');
});

test('面板里的「资料」能直接跳详情，并先关掉面板', () => {
  const wxml = readMp('pages/holdings/holdings.wxml');
  assert.match(wxml, /class="sheet-link"[\s\S]{0,80}goSheetDetail/);
  const p = loadPage();
  p.openSheet({ currentTarget: { dataset: { g: 0, i: 0 } } });
  let nav = '';
  global.wx.navigateTo = (o) => { nav = o.url; };
  p.goSheetDetail();
  assert.match(nav, /pages\/detail\/detail\?id=1/);
  assert.equal(p.data.sheet, null, '跳转前要关掉面板');
});

test('改了没保存就点遮罩，会先问一句再关', () => {
  const p = loadPage();
  p.openSheet({ currentTarget: { dataset: { g: 0, i: 0 } } });
  // 直接改引用：本文件的 setData 是浅合并，不认 'sheet.rolls' 这种路径写法
  p.data.sheet.rolls = 5;

  let asked = null;
  global.wx.showModal = (o) => { asked = o; };
  p.closeSheet();
  assert.ok(asked, '应弹确认框');
  assert.match(asked.title, /放弃/);
  assert.ok(p.data.sheet, '用户还没确认，面板不能关');

  // 点「放弃」才关
  global.wx.showModal = (o) => { o.success({ confirm: true }); };
  p.closeSheet();
  assert.equal(p.data.sheet, null);
});

test('没改过就直接关，不打扰用户', () => {
  const p = loadPage();
  p.openSheet({ currentTarget: { dataset: { g: 0, i: 0 } } });
  let asked = 0;
  global.wx.showModal = () => { asked += 1; };
  p.closeSheet();
  assert.equal(asked, 0, '不该弹确认');
  assert.equal(p.data.sheet, null);
});
