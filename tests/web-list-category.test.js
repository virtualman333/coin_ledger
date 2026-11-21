'use strict';
/**
 * 网站端顺序清单：系列 / 年份下拉必须跟着当前品类走。
 *
 * 与小程序同源的问题——下拉是一次性全量填充，切到「纪念钞」后
 * 仍然列出纪念币的系列，选中必然 0 条，用户还以为没数据。
 *
 * 运行：node --test tests/web-list-category.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (p) => fs.readFileSync(path.join(__dirname, '..', 'public', p), 'utf8');

test('下拉选项按 activeCatalog() 重建，而不是全量 DB', () => {
  const js = read('app.js');
  const fn = js.slice(js.indexOf('function rebuildFilterOptions()'), js.indexOf('function renderTable()'));
  assert.ok(fn, '找不到 rebuildFilterOptions');
  assert.match(fn, /var rows = activeCatalog\(\)/, '应按当前品类取数据');
  assert.doesNotMatch(fn, /DB\.forEach/, '不该再拿全量 DB 填充');
  // 系列与年份两处都要重建
  assert.match(fn, /getElementById\('fSeries'\)/);
  assert.match(fn, /getElementById\('fYear'\)/);
});

test('切品类后失效的选中值会被清掉，避免「筛了 0 条还看不出原因」', () => {
  const js = read('app.js');
  const fn = js.slice(js.indexOf('function rebuildFilterOptions()'), js.indexOf('function renderTable()'));
  assert.match(fn, /used\[keepSeries\] \? keepSeries : ''/, '系列选中值没有按新选项校验');
  assert.match(fn, /years\[keepYear\] \? keepYear : ''/, '年份选中值没有按新选项校验');
});

test('只在品类变化时重建，不在每次渲染都重排下拉', () => {
  const js = read('app.js');
  const fn = js.slice(js.indexOf('function rebuildFilterOptions()'), js.indexOf('function renderTable()'));
  assert.match(fn, /if \(LAST_SERIES_CAT === VIEW_CATEGORY\) return;/, '缺品类比较，会每帧重建');
  assert.match(fn, /LAST_SERIES_CAT = VIEW_CATEGORY/, '没有记录上次的品类');
});

test('renderTable 一进来就同步下拉', () => {
  const js = read('app.js');
  const fn = js.slice(js.indexOf('function renderTable(){'));
  const head = fn.slice(0, 200);
  assert.match(head, /rebuildFilterOptions\(\)/, '渲染前应先同步下拉选项');
});
