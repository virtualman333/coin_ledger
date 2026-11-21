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

test('全部系列页有品类 tab，且只渲染选中的那一组', () => {
  const html = read('index.html');
  const bar = html.match(/<div class="cat-tabs" id="seriesCats">[\s\S]*?<\/div>/);
  assert.ok(bar, '系列页缺少分类 tab');
  for (const cat of ['all', 'coin', 'note', 'pm']) {
    assert.ok(bar[0].includes('data-scat="' + cat + '"'), '缺少分类按钮：' + cat);
  }

  const js = read('app.js');
  assert.match(js, /var SERIES_CAT = 'all'/, '缺分类状态');
  assert.match(js, /function initSeriesCats\(\)/, '缺点击绑定');
  const fn = js.slice(js.indexOf('function renderSeries()'), js.indexOf('function renderCost'));
  assert.match(fn, /showCoin = SERIES_CAT === 'all' \|\| SERIES_CAT === 'coin'/);
  assert.match(fn, /showNote = SERIES_CAT === 'all' \|\| SERIES_CAT === 'note'/);
  assert.match(fn, /showPm = SERIES_CAT === 'all' \|\| SERIES_CAT === 'pm'/);
  // 三组 section 都要受 show* 控制，不能无条件拼接
  assert.match(fn, /\(showCoin \? section\('纪念币'/);
  assert.match(fn, /\(showNote \? section\('纪念钞'/);
  assert.match(fn, /\(showPm \? section\('贵金属纪念币'/);
});
