'use strict';
/**
 * 小程序「贵金属」列表页的筛选链路。
 *
 * 修之前：筛选按钮露着，但面板条件是 `category !== 'pm'`，点开是空白；
 * 年份/面额/材质从没传给接口（接口其实支持 year），排序只在已加载的 30 条里排。
 * 这里把「入口可见 → 参数真的发出去 → 改条件重新拉第一页」整条链路钉死。
 *
 * 运行：node --test tests/mp-pm-filter.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const MP = path.join(ROOT, 'miniprogram');
const read = (p) => fs.readFileSync(path.join(MP, p), 'utf8');

test('筛选面板不再对贵金属关闭', () => {
  const s = read('views/list/list.wxml');
  const m = s.match(/<view class="fpanel"[^>]*>/);
  assert.ok(m, '找不到筛选面板');
  assert.doesNotMatch(m[0], /category !== 'pm'/, '贵金属点了「筛选」还是空白');
});

test('贵金属的「只看已收」不暴露（需要服务端按 code 列表过滤）', () => {
  const s = read('views/list/list.wxml');
  const m = s.match(/<view class="fbtn[^"]*"[^>]*bindtap="toggleOwn"[^>]*>/);
  assert.ok(m, '找不到只看已收按钮');
  assert.match(m[0], /category !== 'pm'/, '贵金属没有只看已收的实现，不能给入口');
});

test('普通币那一行计数不再出现在贵金属上', () => {
  const s = read('views/list/list.wxml');
  const m = s.match(/<view class="bar"[^>]*>/);
  assert.ok(m, '找不到 .bar');
  assert.match(m[0], /category !== 'pm'/, '贵金属会同时显示两套数字');
  // 贵金属自己的栏要有条数和排序
  const pmBar = s.match(/<view class="pm-bar">[\s\S]*?<\/view>/);
  assert.ok(pmBar, '找不到 .pm-bar');
  assert.match(pmBar[0], /pmTotal/);
  assert.match(pmBar[0], /toggleSort/);
});

test('loadPmFull 把年份/面额/材质/排序/ facets 都发给接口', () => {
  const s = read('views/list/list.logic.js');
  const fn = s.slice(s.indexOf('loadPmFull(page, append)'), s.indexOf('retryPmFull()'));
  assert.match(fn, /'&sort='/, '没传排序');
  assert.match(fn, /year_desc/, '缺 year_desc');
  assert.match(fn, /year_asc/, '缺 year_asc');
  assert.match(fn, /&year=/, '没传年份');
  assert.match(fn, /&face=/, '没传面额');
  assert.match(fn, /&material=/, '没传材质');
  assert.match(fn, /facets=1/, '首屏没取 facets，筛选项拼不出来');
});

test('改筛选条件会回第一页重新拉，而不是只过滤已加载的 30 条', () => {
  const s = read('views/list/list.logic.js');
  for (const name of ['pickYear', 'pickFace', 'pickMat', 'clearExtra', 'toggleSort']) {
    const i = s.indexOf(name + '(');
    assert.ok(i > 0, '找不到 ' + name);
    const body = s.slice(i, i + 900);
    assert.match(body, /refreshAfterFilter\(\)|loadPmFull\(1, false\)/, name + ' 没有重新请求贵金属数据');
  }
  const def = s.indexOf('refreshAfterFilter() {');
  assert.ok(def > 0, '找不到 refreshAfterFilter 定义');
  const raf = s.slice(def, def + 420);
  assert.match(raf, /category === 'pm'/);
  assert.match(raf, /loadPmFull\(1, false\)/);
});

test('搜索与清空搜索也走贵金属接口', () => {
  const s = read('views/list/list.logic.js');
  const onSearch = s.slice(s.indexOf('onSearch(e)'), s.indexOf('onSearchBlur()'));
  assert.match(onSearch, /category === 'pm'/, '贵金属搜索走的是本地 render，等于没搜');
  assert.match(onSearch, /loadPmFull\(1, false\)/);
  assert.match(onSearch, /setTimeout/, '逐字请求接口需要防抖');

  const clear = s.slice(s.indexOf('clearSearch()'), s.indexOf('clearSearch()') + 420);
  assert.match(clear, /category === 'pm'/, '清空搜索后贵金属列表不会恢复');
  assert.match(clear, /loadPmFull\(1, false\)/);
});

test('切品类会换掉下拉选项，贵金属不会列出普通币的年份', () => {
  const s = read('views/list/list.logic.js');
  assert.match(s, /buildPmFilterOpts/, '缺 facets → 选项的转换');
  assert.match(s, /applyFilterOpts\(category\)/, '切品类没换选项');
  const ac = s.slice(s.indexOf('applyCategory(category, code)'), s.indexOf('applyCategory(category, code)') + 600);
  assert.match(ac, /applyFilterOpts\(category\)/);
});

test('筛选请求有序号守卫，慢响应不能覆盖新结果', () => {
  const s = read('views/list/list.logic.js');
  const fn = s.slice(s.indexOf('loadPmFull(page, append)'), s.indexOf('retryPmFull()'));
  assert.match(fn, /_pmSeq/);
  assert.match(fn, /seq !== this\._pmSeq/);
  // 守卫必须先于自增：否则上拉连点时第二次调用会把第一次判成过期，列表卡在「加载中」
  const guardAt = fn.indexOf('pmLoading) return');
  const seqAt = fn.indexOf('_pmSeq = ');
  assert.ok(guardAt > 0 && seqAt > 0, '找不到守卫或序号自增');
  assert.ok(guardAt < seqAt, '「追加型请求直接返回」必须写在序号自增之前');
});
