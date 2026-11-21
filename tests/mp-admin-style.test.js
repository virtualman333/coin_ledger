'use strict';
/**
 * 管理端样式回归：页面容器、弹层滚动、按钮默认样式、热区、以及贵金属的估值口径。
 *
 * 这轮修的问题：
 * 1. 「访客统计」整块被写在 .page 容器外面 —— 没有页面边距，内容顶到屏幕两边
 * 2. 访客明细的 scroll-view 只给了 max-height，滚不动，底部按钮按不到
 * 3. 明细弹层靠 catchtouchmove 拦滚动，反而把 scroll-view 自己也拦死了
 * 4. 贵金属/翻页按钮没清小程序默认的 ::after 灰边框，棕底上一圈脏边
 * 5. 大分类进度条写死「pm 100%、其余 20%」，跟真实数量无关
 * 6. 管理员看用户持仓时，贵金属被算成「市值 ¥0 / 盈亏 -成本」
 *
 * 运行：node --test tests/mp-admin-style.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const MP = path.join(__dirname, '..', 'miniprogram');
const read = (p) => fs.readFileSync(path.join(MP, p), 'utf8');

const wxml = () => read('pages/admin/admin.wxml');
const wxss = () => read('pages/admin/admin.wxss');

test('访客统计必须在 .page 容器里，不能挂在页面根部', () => {
  const s = wxml();
  const pageStart = s.indexOf('<view class="page">');
  assert.ok(pageStart >= 0, '找不到 .page');
  // 第一个弹层之前都算页面主体
  const pageEnd = s.indexOf('<!-- 编辑品种 -->');
  assert.ok(pageEnd > pageStart, '找不到页面主体的结尾');
  const body = s.slice(pageStart, pageEnd);
  assert.match(body, /tab === 'visitors'/, '访客统计被写在 .page 外面，会没有左右边距');
  // 弹层必须留在页面外边（fixed 定位，不受 padding 影响）
  assert.ok(s.indexOf('class="vdd-mask"') > pageEnd, '访客明细弹层不该塞进页面主体');
});

test('访问明细的 scroll-view 要能拿到确定高度', () => {
  const css = wxss();
  const sheet = css.match(/^\.vdd-sheet\s*\{[^}]*\}/m);
  assert.ok(sheet, '找不到 .vdd-sheet');
  assert.match(sheet[0], /display:\s*flex/, '弹层要用 flex 列布局');
  assert.match(sheet[0], /flex-direction:\s*column/);

  const list = css.match(/^\.vdd-list\s*\{[^}]*\}/m);
  assert.ok(list, '找不到 .vdd-list');
  assert.match(list[0], /flex:\s*1/, 'scroll-view 需要 flex:1');
  assert.match(list[0], /min-height:\s*0/, '缺 min-height:0 时 flex 子项不肯收缩，滚不起来');
  assert.doesNotMatch(list[0], /max-height/, 'max-height 不能替代高度，内容会被裁掉');

  // 头/脚要固定不参与收缩
  for (const sel of ['.vdd-head', '.vdd-sub', '.vdd-foot']) {
    const m = css.match(new RegExp('^\\' + sel + '\\s*\\{[^}]*\\}', 'm'));
    assert.ok(m, '找不到 ' + sel);
    assert.match(m[0], /flex:\s*0 0 auto/, sel + ' 应固定高度');
  }
});

test('弹层用 page-meta 锁页面滚动，不用 catchtouchmove', () => {
  const s = wxml();
  const meta = s.match(/<page-meta[^>]*>/);
  assert.ok(meta, '找不到 page-meta');
  for (const k of ['editing', 'editingSeries', 'fbDetail', 'vsDetail']) {
    assert.ok(meta[0].includes(k), 'page-meta 的锁定条件漏了 ' + k);
  }
  const vdd = s.match(/<view class="vdd-mask"[^>]*>/);
  assert.ok(vdd, '找不到 .vdd-mask');
  assert.doesNotMatch(vdd[0], /catchtouchmove/, 'catchtouchmove 会把内部 scroll-view 一起拦死');
});

test('贵金属/翻页按钮清掉小程序默认的 ::after 边框', () => {
  const css = wxss();
  assert.match(css, /\.pm-search button::after[\s\S]{0,80}border:\s*none/);
  assert.match(css, /\.pm-nav button::after[\s\S]{0,80}border:\s*none/);
});

test('大分类进度条按真实数量画，不再写死 100/20', () => {
  const s = wxml();
  assert.doesNotMatch(s, /item\.code === 'pm' \? 100 : 20/, '进度条还是写死的假数据');
  assert.match(s, /style="width:\{\{item\.pct\}\}%"/, '进度条应该用后端算出的比例');
  const js = read('pages/admin/admin.js');
  assert.match(js, /pct:/, 'loadCats 里没算比例');
});

test('管理端的按钮热区靠伪元素，不靠撑大元素', () => {
  const css = wxss();
  const cases = [
    ['.mod-back', '56rpx'],
    ['.vchip', null],
    ['.search-clear', null],
  ];
  for (const [sel, fixed] of cases) {
    const own = css.match(new RegExp('^\\' + sel + '\\s*\\{[^}]*\\}', 'm'));
    assert.ok(own, '找不到 ' + sel);
    assert.doesNotMatch(own[0], /min-(width|height)\s*:/, sel + ' 不能用 min-* 撑热区');
    const after = css.match(new RegExp('\\' + sel + '::after\\s*\\{[^}]*\\}'));
    assert.ok(after, sel + ' 缺 ::after 热区');
    if (fixed) assert.match(own[0], new RegExp('height:\\s*' + fixed), sel + ' 的视觉高度应保持 ' + fixed);
  }
});

test('长文本不撑破行：标题行允许换行、明细列有省略号', () => {
  const css = wxss();
  const rTitle = css.match(/^\.r-title\s*\{[^}]*\}/m);
  assert.match(rTitle[0], /flex-wrap:\s*wrap/, '.r-title 不换行时 badge 会被挤出去');

  const user = css.match(/^\.vdd-user\s*\{[^}]*\}/m);
  assert.match(user[0], /text-overflow:\s*ellipsis/, '.vdd-user 需要省略号，不能硬裁');

  const tab = css.match(/^\.vdd-tab\s*\{[^}]*\}/m);
  assert.match(tab[0], /min-width:\s*0/, '.vdd-tab 不设 min-width:0 会让整行溢出');
});

test('管理员看用户持仓：贵金属不出市值与盈亏', () => {
  const js = read('pages/admin-user/admin-user.js');
  assert.match(js, /const isPm = !coin/, '贵金属应靠「本地目录查不到」识别');
  assert.match(js, /if \(isPm\) \{/, '贵金属成本要单独累计，不能进入盈亏');
  assert.match(js, /pmCost/, '缺贵金属成本的单独统计');
  // 盈亏不能用「全部成本」当减数
  assert.match(js, /market - \(cost - pmCost\)/, '盈亏仍在减贵金属成本，会显示假亏损');

  const wxmlUser = read('pages/admin-user/admin-user.wxml');
  assert.match(wxmlUser, /item\.isPm/, '模板没有区分贵金属行');
  assert.match(wxmlUser, /不计估值/, '贵金属行应说明不计估值');
});
