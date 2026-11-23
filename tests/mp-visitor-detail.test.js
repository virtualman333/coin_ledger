'use strict';
/**
 * 回归测试：管理端「访客统计」明细弹层两个渲染坑（2026-11-23）。
 * - 汇总数字原来用 <b> 标签，WXML 不渲染 b，导致「N 次访问 / N 会话 / N 页面」
 *   只剩文字标签、数字全空 → 改用 <text class="vdd-num">。
 * - .vdd-list 原来是 flex:1 1 0，父级 .vdd-sheet 只有 max-height 没有确定
 *   height，basis:0 的子项分不到高度整块塌陷 → 明细连空状态都看不见。
 *   改成 scroll-view 自身 max-height，内容少时按内容铺开、多时封顶滚动。
 * 运行：node --test tests/mp-visitor-detail.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const WXML = 'miniprogram/pages/admin-visitors/admin-visitors.wxml';
const LOCAL_WXSS = 'miniprogram/pages/admin-visitors/admin-visitors.wxss';
const COMMON_WXSS = 'miniprogram/pages/admin/admin-common.wxss';

test('明细汇总数字用 text 组件渲染，不再用 WXML 不支持的 b 标签', () => {
  const wxml = read(WXML);
  assert.ok(!/<b>/.test(wxml), 'WXML 里不该出现 <b> 标签（不渲染，数字会消失）');
  for (const field of ['total', 'sessions', 'pages']) {
    assert.match(
      wxml,
      new RegExp('<text class="vdd-num">\\{\\{vsDetail\\.' + field + '\\}\\}</text>'),
      field + ' 应由 .vdd-num 的 text 组件渲染'
    );
  }
});

test('.vdd-num 有对应样式定义（数字可见）', () => {
  const wxss = read(LOCAL_WXSS);
  assert.match(wxss, /\.vdd-num\s*\{/, '本页 wxss 应定义 .vdd-num');
  assert.ok(!/\.vdd-sum-i\s+b\b/.test(wxss), '不应残留针对 b 标签的选择器');
  assert.ok(!/<b>/.test(read(WXML)), 'WXML 不应再用 b 标签');
});

test('.vdd-list 不再 flex:1 1 0 塌陷，改用自身 max-height 可滚', () => {
  const wxss = read(COMMON_WXSS);
  const m = wxss.match(/\.vdd-list\s*\{([^}]*)\}/);
  assert.ok(m, '应能找到 .vdd-list 样式');
  const body = m[1];
  assert.ok(!/flex\s*:\s*1\s+1\s+0/.test(body), 'flex:1 1 0 会在 max-height 父级里塌陷成 0 高度');
  assert.match(body, /max-height\s*:\s*60vh/, '应由 scroll-view 自身 max-height 封顶滚动');
});
