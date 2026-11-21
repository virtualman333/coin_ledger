'use strict';
/**
 * 管理端样式回归（管理页已拆成「首页 + 8 个三级页面」）。
 *
 * 断言按职责落到具体页面：
 *   - 通用样式（卡片/弹层/搜索/按钮）在 pages/admin/admin-common.wxss
 *   - 访客、贵金属、大分类、参数等各归各页
 * 避免再把某页的样式问题藏在另一个文件里查不到。
 *
 * 运行：node --test tests/mp-admin-style.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const MP = path.join(__dirname, '..', 'miniprogram');
const read = (p) => fs.readFileSync(path.join(MP, p), 'utf8');
const pageWxml = (slug) => read('pages/' + slug + '/' + slug + '.wxml');
const pageWxss = (slug) => read('pages/' + slug + '/' + slug + '.wxss');
const pageJs = (slug) => read('pages/' + slug + '/' + slug + '.js');
const common = () => read('pages/admin/admin-common.wxss');

const MODULES = ['admin-cats', 'admin-pm', 'admin-params', 'admin-images',
  'admin-series', 'admin-users', 'admin-feedback', 'admin-visitors'];

test('访客统计在自己的页面里，弹层留在页面容器外', () => {
  const s = pageWxml('admin-visitors');
  const pageStart = s.indexOf('<view class="page">');
  assert.ok(pageStart >= 0, '找不到 .page');
  const maskStart = s.indexOf('class="vdd-mask"');
  assert.ok(maskStart > pageStart, '找不到访客明细弹层');
  const body = s.slice(pageStart, maskStart);
  assert.match(body, /vs-cards/, '统计卡应在 .page 内');
  assert.ok(maskStart > s.lastIndexOf('</view>', maskStart), '弹层不该塞进页面主体');
});

test('访问明细的 scroll-view 要能拿到确定高度', () => {
  const css = common();
  const sheet = css.match(/^\.vdd-sheet\s*\{[^}]*\}/m);
  assert.ok(sheet, '找不到 .vdd-sheet');
  assert.match(sheet[0], /display:\s*flex/);
  assert.match(sheet[0], /flex-direction:\s*column/);

  const list = css.match(/^\.vdd-list\s*\{[^}]*\}/m);
  assert.ok(list, '找不到 .vdd-list');
  assert.match(list[0], /flex:\s*1/);
  assert.match(list[0], /min-height:\s*0/);
  assert.doesNotMatch(list[0], /max-height/, 'max-height 不能替代高度');

  for (const sel of ['.vdd-head', '.vdd-sub', '.vdd-foot']) {
    const m = css.match(new RegExp('^\\' + sel + '\\s*\\{[^}]*\\}', 'm'));
    assert.ok(m, '找不到 ' + sel);
    assert.match(m[0], /flex:\s*0 0 auto/, sel + ' 应固定高度');
  }
});

test('有弹层的页面都用 page-meta 锁滚动，不用 catchtouchmove', () => {
  const cases = {
    'admin-params': 'editing',
    'admin-series': 'editingSeries',
    'admin-feedback': 'fbDetail',
    'admin-visitors': 'vsDetail',
  };
  for (const slug of Object.keys(cases)) {
    const s = pageWxml(slug);
    const meta = s.match(/<page-meta[^>]*>/);
    assert.ok(meta, slug + ' 缺 page-meta');
    assert.ok(meta[0].includes(cases[slug]), slug + ' 的 page-meta 条件不对');
    assert.ok(s.indexOf('<page-meta') < s.indexOf('<view class="page">'), slug + ' 的 page-meta 必须在最前面');
    // 注释里可以写「不要加 catchtouchmove」，只看实际属性
    const live = s.replace(/<!--[\s\S]*?-->/g, '');
    assert.doesNotMatch(live, /catchtouchmove/, slug + ' 不该用 catchtouchmove');
  }
});

test('每个模块页都能独立刷新，且直链进入也要校验权限', () => {
  for (const slug of MODULES) {
    const js = pageJs(slug);
    assert.match(js, /onPullDownRefresh\(\)/, slug + ' 缺下拉刷新');
    assert.match(js, /ensureAdmin\(\)/, slug + ' 缺管理员校验');
  }
});

test('贵金属/翻页按钮清掉小程序默认的 ::after 边框', () => {
  const css = common();
  assert.match(css, /\.pm-search button::after[\s\S]{0,80}border:\s*none/);
  assert.match(css, /\.pm-nav button::after[\s\S]{0,80}border:\s*none/);
});

test('大分类进度条按真实数量画，不再写死 100/20', () => {
  const s = pageWxml('admin-cats');
  assert.doesNotMatch(s, /item\.code === 'pm' \? 100 : 20/, '进度条还是写死的假数据');
  assert.match(s, /style="width:\{\{item\.pct\}\}%"/);
  assert.match(pageJs('admin-cats'), /pct:/, 'loadCats 里没算比例');
});

test('管理端的按钮热区靠伪元素，不靠撑大元素', () => {
  const css = common();
  for (const sel of ['.vchip', '.search-clear']) {
    const own = css.match(new RegExp('^\\' + sel + '\\s*\\{[^}]*\\}', 'm'));
    assert.ok(own, '找不到 ' + sel);
    assert.doesNotMatch(own[0], /min-(width|height)\s*:/, sel + ' 不能用 min-* 撑热区');
    const after = css.match(new RegExp('\\' + sel + '::after\\s*\\{[^}]*\\}'));
    assert.ok(after, sel + ' 缺 ::after 热区');
  }
});

test('长文本不撑破行：标题行允许换行、明细列有省略号', () => {
  const css = common();
  const rTitle = css.match(/^\.r-title\s*\{[^}]*\}/m);
  assert.match(rTitle[0], /flex-wrap:\s*wrap/, '.r-title 不换行时 badge 会被挤出去');

  const user = css.match(/^\.vdd-user\s*\{[^}]*\}/m);
  assert.match(user[0], /text-overflow:\s*ellipsis/);

  const tab = css.match(/^\.vdd-tab\s*\{[^}]*\}/m);
  assert.match(tab[0], /min-width:\s*0/);
});

test('管理员看用户持仓：贵金属不出市值与盈亏', () => {
  const js = pageJs('admin-user');
  assert.match(js, /const isPm = !coin/);
  assert.match(js, /if \(isPm\) \{/);
  assert.match(js, /pmCost/);
  assert.match(js, /market - \(cost - pmCost\)/, '盈亏仍在减贵金属成本，会显示假亏损');

  const wxmlUser = pageWxml('admin-user');
  assert.match(wxmlUser, /item\.isPm/);
  assert.match(wxmlUser, /不计估值/);
});

test('管理首页只留入口，模块内容都已下沉到三级页面', () => {
  const home = pageWxml('admin');
  for (const marker of ['class="mask"', 'vdd-mask', 'pm-row', 'cat-card', 'class="grid"']) {
    assert.ok(!home.includes(marker), '首页还残留模块内容：' + marker);
  }
  assert.match(home, /goModule/, '首页入口应走 goModule');
  const js = pageJs('admin');
  for (const slug of MODULES) {
    assert.ok(js.includes('/pages/' + slug + '/' + slug), '首页缺少到 ' + slug + ' 的跳转');
  }
});

test('每个模块页的 onLoad 真的会去拉数据（不是光写个属性名）', () => {
  for (const slug of MODULES) {
    const js = pageJs(slug);
    // onLoad 允许带参数（从「资料库」深链进来时要读 query），不能只认 onLoad()
    const start = js.search(/onLoad\s*\([^)]*\)\s*\{/);
    const end = js.indexOf('onPullDownRefresh(');
    assert.ok(start > 0 && end > start, slug + ' 找不到 onLoad');
    const body = js.slice(start, end);
    assert.match(body, /this\.load\w+\(/, slug + ' 的 onLoad 没有调用加载方法');
    assert.doesNotMatch(body, /this\.load\w+;/, slug + ' 写成了 this.loadX;（少了括号，等于没拉）');
  }
});

test('模块页里 this.xxx() 调用的方法都在本文件定义', () => {
  for (const slug of MODULES) {
    const js = pageJs(slug);
    const defined = new Set((js.match(/\n  (\w+)\(/g) || []).map((m) => m.trim().slice(0, -1)));
    const calls = new Set((js.match(/this\.(\w+)\(/g) || []).map((m) => m.slice(5, -1)));
    const missing = [...calls].filter((c) => !defined.has(c) && c !== 'setData');
    assert.deepEqual(missing, [], slug + ' 调用了不存在的方法：' + missing.join(', '));
  }
});
