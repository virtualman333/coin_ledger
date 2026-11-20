'use strict';
/**
 * 回归测试：贵金属单枚独立页 /pm/<code>（Web 端不再用弹窗）。
 * - 前端 routeParts/pathOf/legacyPath 识别 /pm/<code>，pm 页有专属 pane 与渲染入口
 * - 服务端 spaRoute/isRoutePath 识别；SSR 页面带独立 title/description/canonical/静态正文
 * - 静态正文与 meta 都不出现价格/估值（贵金属硬规则）
 * - 现有 141 个 URL 的渲染逻辑不受影响（renderPmIndex 分流仍在）
 * - nginx 白名单已加，否则线上 404
 * 运行：node --test tests/pm-page-route.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const seo = require('../server/services/seo');
// spaRoute 的 /coin/N 分支依赖 SEED.coins；给一份最小种子，避免越界返回 null
seo.setData({ seed: { coins: [{ name: '测试币', no: '001' }], series: {}, sets: {} }, desc: {} });

// 前端是浏览器全局脚本，用 vm 载入后调用纯函数，不依赖 DOM
function frontEnd() {
  const vm = require('node:vm');
  const src = read('public/app.js');
  const ctx = {
    location: { pathname: '/', hash: '', search: '' },
    document: { title: '', querySelector: () => null, querySelectorAll: () => [], getElementById: () => null, body: { classList: { toggle() {} } } },
    window: {}, history: {}, navigator: {}, console,
    setTimeout, clearTimeout, URLSearchParams, URL,
    fetch: () => Promise.resolve({ ok: false }),
    // 只需让顶层定义不抛错；实际渲染函数不在本测试调用
    DB: [], PM_DB: [], PM_FULL: { items: [] }, TAB_SEO: {}, SET_META: {}, SITE: 'https://coin.virtualman.top',
    setAttr() {}, esc: (s) => String(s), escHtml: (s) => String(s),
  };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  // 只执行到函数定义区：整份脚本底部有 boot()，用 try 包住让它失败但不影响已定义的函数
  try { vm.runInContext(src, ctx, { timeout: 3000 }); } catch (e) { /* boot 需要真实 DOM，忽略 */ }
  return ctx;
}

test('前端路由：/pm/G19790101 解析为 pm 页，pathOf 能还原规范 URL', () => {
  const c = frontEnd();
  c.location.pathname = '/pm/G19790101';
  const rp = c.routeParts();
  assert.equal(rp.tab, 'pm');
  assert.equal(rp.code, 'G19790101');
  assert.equal(c.pathOf('pm', 'g19790101'), '/pm/G19790101');
  c.location.pathname = '/';
  assert.equal(c.routeParts().tab, 'home');
  c.location.pathname = '/coin/12';
  assert.equal(c.routeParts().tab, 'coin', '普通币详情页路由不能被影响');
});

test('前端路由：hash 老链接 #/pm/xxx 也能迁到真实路径', () => {
  const c = frontEnd();
  c.location.hash = '#/pm/G19790101';
  assert.equal(c.legacyPath(), '/pm/G19790101');
});

test('前端：pm 页有专属 pane，卡片点击进独立页而非弹窗', () => {
  const html = read('public/index.html');
  assert.match(html, /id="pane-pm"/);
  assert.match(html, /id="pmBox"/);
  const js = read('public/app.js');
  assert.match(js, /function goPm\(/);
  assert.match(js, /function renderPmDetail\(/);
  assert.match(js, /showPmCard\(code\)[\s\S]{0,160}goPm\(code\)/);
  assert.ok(!/pm-modal-mask/.test(js.split('function showPmCard')[1] || ''), '详情页渲染不该再创建弹窗遮罩');
});

test('前端：pm 页 meta 用真实字段，且不写价格', () => {
  const js = read('public/app.js');
  const seg = js.slice(js.indexOf('function syncPmSeo'), js.indexOf('function syncSeo'));
  assert.match(seg, /不提供参考估值/);
  assert.ok(!/推理价|参考市价|约 ¥/.test(seg), 'meta 不能出现价格口径');
});

test('服务端：spaRoute / isRoutePath 识别 /pm/<code>', () => {
  assert.equal(seo.spaRoute('/pm/G19790101').tab, 'pm');
  assert.equal(seo.spaRoute('/pm/G19790101').code, 'G19790101');
  assert.equal(seo.isRoutePath('/pm/G19790101'), true);
  assert.equal(seo.isRoutePath('/pm/../../etc'), false, '路径穿越不能被当成页面路由');
  assert.equal(seo.spaRoute('/coin/1').tab, 'coin', '普通币路由不能受影响');
  assert.equal(seo.spaRoute('/all').tab, 'all');
});

test('服务端：/pm/<code> 返回独立 title/desc/canonical + 静态正文，且无价格', () => {
  const html = seo.renderPmItemIndex({
    tab: 'pm', code: 'G19790101',
    pmItem: {
      name: '中华人民共和国成立30周年纪念金币', projectName: '建国30周年',
      year: 1979, material: '金', weight: '1/2盎司', face: 400,
      fineness: '91.6', circulation: 70000, quality: '精制',
      castingUnit: '上海造币厂', announce: '中国人民银行公告'
    }
  });
  assert.ok(html, '应能渲染出 HTML');
  assert.match(html, /<title>[^<]*中华人民共和国成立30周年纪念金币[^<]*<\/title>/);
  assert.match(html, /canonical" href="https:\/\/coin\.virtualman\.top\/pm\/G19790101"/);
  assert.match(html, /og:url" content="https:\/\/coin\.virtualman\.top\/pm\/G19790101"/);
  assert.match(html, /id="ssrCoin"/, '必须有静态正文块，否则抓取端只看到首页模板');
  assert.match(html, /编号[\s\S]{0,80}G19790101/);
  assert.match(html, /application\/ld\+json/);
  assert.match(html, /不提供参考估值/);
  // 只约束「抓取端实际读到的」：页面级 meta 与 SSR 正文块。
  // index.html 是 SPA 单文件，其它 pane 里本来就有推理价/盈亏字样，前端装配后才会隐藏。
  const meta = html.slice(html.indexOf('<head>'), html.indexOf('</head>'));
  const ssr = html.slice(html.indexOf('id="ssrCoin"'), html.indexOf('</article>', html.indexOf('id="ssrCoin"')));
  assert.ok(!/参考市价|推理价|约 \d+ 元|盈亏/.test(meta), 'meta 不能出现价格文字');
  assert.ok(!/参考市价|推理价|约 \d+ 元|盈亏/.test(ssr), 'SSR 正文不能出现价格文字');
});

test('服务端：查不到币时仍可渲染通用 meta，页面不 500，且不编造币名/不收录', () => {
  const html = seo.renderPmItemIndex({ tab: 'pm', code: 'UNKNOWN999', pmItem: null });
  assert.ok(html);
  assert.match(html, /UNKNOWN999/);
  assert.match(html, /canonical" href="https:\/\/coin\.virtualman\.top\/pm\/UNKNOWN999"/);
  assert.match(html, /id="ssrCoin"/);
  assert.match(html, /<meta name="robots" content="noindex,nofollow">/);
  assert.equal((html.match(/name="robots"/g) || []).length, 1, '不能出现两个冲突的 robots');
  assert.ok(!/"@type":"Product"/.test(html), '没有真实币名时不输出 Product 结构化数据');
  assert.ok(!/「UNKNOWN999」/.test(html.slice(html.indexOf('<head>'), html.indexOf('</head>'))), 'meta 不把编号伪装成币名');
});

test('服务端：现有页面的渲染分流保持不变', () => {
  assert.equal(typeof seo.renderPmIndex, 'function');
  assert.equal(typeof seo.sendPmIndex, 'function');
  assert.equal(typeof seo.ssrCoinBlock, 'function');
  assert.equal(seo.spaRoute('/coin/1').tab, 'coin');
  assert.equal(seo.spaRoute('/all').tab, 'all');
  assert.equal(seo.spaRoute('/pm/G19790101').tab, 'pm');
  assert.equal(seo.spaRoute('/nonexistent-page'), null);
});

test('部署：nginx 白名单包含 /pm/<code>，否则线上 404', () => {
  const conf = read('deploy/nginx-locations.conf');
  assert.match(conf, /location ~ "\^\/pm\/\[A-Za-z0-9_-\]/);
});
