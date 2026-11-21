'use strict';
/**
 * 回归测试：价格口径统一。
 * - 目录/清单/首页卡片里跟随币种的价格 = 推理价（aiPrice），不再用参考价 est
 * - 详情页计算方式默认收起，问号点击才弹层显示
 * - 账本里的成本价、用户填写的估值价（market）保留不变
 * 纯源码断言，离线运行。运行：npm test
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

test('Web 清单页单套价与整套价用 aiPrice，不再显示 d.est', () => {
  const s = read('public/app.js');
  // 清单表格「推理价（单枚）」单元格
  assert.match(s, /'<td class="price">' \+ money\(aiPrice\(d\)\)/);
  // 整套价 = 单件推理价 × 套系件数
  assert.match(s, /var setAi = aiPrice\(d\) \* perSet;/);
  assert.ok(s.includes('· 推理价 \' + money(setAi)'));
  // 表格里已无 money(d.est) 的旧展示
  assert.doesNotMatch(s, /money\(d\.est\)/);
});

test('Web 首页最近发行、空账本引导、看图弹窗都用推理价', () => {
  const s = read('public/app.js');
  assert.ok(s.includes("· 推理价 ' + money(aiPrice(d))"));
  assert.ok(s.includes('推理价 / 单'));
  assert.ok(s.includes("'</span><b>' + money(aiPrice(d))"));
});

test('Web 推理价计算方式默认收起，问号点击弹层显示', () => {
  const s = read('public/app.js');
  // 详情页不再直接铺整段公式
  const detail = s.slice(s.indexOf("'<div class=\"coin-price single-price\">'"));
  assert.doesNotMatch(detail.slice(0, 400), /cf-note-inline.*AI_FORMULA_TEXT/);
  // 有问号按钮 + 弹层绑定
  assert.match(s, /data-ai-formula="1"/);
  assert.match(s, /closest\('\[data-ai-formula\]'\)/);
  assert.match(s, /ai-formula-modal/);
  // 用户可见的公式仍在（弹层内容）
  assert.match(s, /var AI_FORMULA_TEXT = '计算方式：/);
});

test('Web 成本估算/整套市价都改用推理价口径', () => {
  const s = read('public/app.js');
  assert.match(s, /var e = aiPrice\(d\) \* sp\.size;/);   // costStats 整套
  assert.match(s, /s\.estOne\s*\+= aiPrice\(d\)/);        // costStats 单枚
  assert.match(s, /s\.est \+= aiPrice\(d\) \* boxN;/);    // SET_STATS
  assert.match(s, /setEst: group\.reduce\(function\(a, c\)\{ return a \+ aiPrice\(c\); \}/);
  const html = read('public/index.html');
  assert.match(html, /推理价<br><span class="thsub">单枚<\/span>/);
  assert.match(html, /按推理价（公开参数推算）估算/);
});

test('账本底层字段保留：成本 cost 与市场估值 market 仍在，小程序不再展示它们', () => {
  const store = read('miniprogram/utils/store.js');
  assert.match(store, /function priceOf\(coin\)/);          // 用户改价能力仍在
  assert.match(store, /state\.prices\[String\(coin\.id - 1\)\]/);
  assert.match(store, /market: cat\.round2\(h\.market\)/);  // 底层字段仍回传，不动后端
  const holdings = read('miniprogram/pages/holdings/holdings.js');
  // 新口径：小程序「我的藏品」只展示面值 / 推理价 / 成本，估值字段不再露出
  assert.doesNotMatch(holdings, /marketText: cat\.money\(h\.market\)/);
  const app = read('public/app.js');
  assert.match(app, /money\(h\.market\)/);                  // Web 底层估值数值仍在，展示标签已统一
});

test('小程序：清单页与首页卡片价格用 aiPriceOf，账本市值不参与', () => {
  const list = read('miniprogram/views/list/list.logic.js');
  assert.match(list, /priceText: '¥' \+ cat\.money\(cat\.aiPriceOf\(c\) \* c\.setSize\)/);
  assert.doesNotMatch(list, /store\.setPriceOf\(c\)/);
  const index = read('miniprogram/views/home/home.logic.js');
  assert.match(index, /priceText: '推理价 ¥' \+ cat\.money\(cat\.aiPriceOf\(c\) \* c\.setSize\)/);
  const listWxml = read('miniprogram/views/list/list.wxml');
  assert.match(listWxml, /推理价/);
});

test('小程序详情页：公式默认隐藏，问号 catchtap 弹出', () => {
  const wxml = read('miniprogram/pages/detail/detail.wxml');
  assert.match(wxml, /class="ai-q" catchtap="toggleFormula"/);
  assert.match(wxml, /ai-formula-mask.*wx:if="\{\{formulaOpen\}\}"/);
  const js = read('miniprogram/pages/detail/detail.js');
  assert.match(js, /formulaOpen: false/);
  assert.match(js, /toggleFormula\(\)/);
});
