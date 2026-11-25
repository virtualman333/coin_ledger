'use strict';
/**
 * SEO 深度优化回归测试（Web 端各页面）：
 * - twitter:title / twitter:description 随页面变化（旧实现全站写死首页文案）
 * - keywords 随页面变化（旧实现全站同一串）
 * - 品种页 og:image / twitter:image 用该币实物图
 * - /all /series /plan 抓取端有 SSR 静态正文（旧实现是 JS 空壳）
 * - tab 页结构化数据：BreadcrumbList；/all 额外有 ItemList
 * - 品种页保持 Product + BreadcrumbList；贵金属页不出现价格文案
 *
 * 运行：node --test tests/seo-deep.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const seo = require('../server/services/seo');
const state = require('../server/state/catalog');
state.loadSeed();

const grab = (html, re) => { const m = re.exec(html); return m ? m[1] : ''; };
const ldTypes = (html) => {
  const out = [];
  const re = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/g;
  let m;
  while ((m = re.exec(html))) {
    try { out.push(JSON.parse(m[1])['@type']); }
    catch (e) { out.push('INVALID'); }
  }
  return out;
};

test('twitter / keywords 不再全站写死：home 与 all 各用各的', () => {
  const home = seo.renderIndex({ tab: 'home', i: null });
  const all = seo.renderIndex({ tab: 'all', i: null });
  const kwHome = grab(home, /<meta name="keywords" content="([^"]*)"/);
  const kwAll = grab(all, /<meta name="keywords" content="([^"]*)"/);
  const twHome = grab(home, /<meta name="twitter:title" content="([^"]*)"/);
  const twAll = grab(all, /<meta name="twitter:title" content="([^"]*)"/);
  assert.notEqual(kwHome, kwAll, 'keywords 应随页面不同');
  assert.notEqual(twHome, twAll, 'twitter:title 应随页面不同');
  assert.match(twAll, /全套发行清单/, 'twitter:title 应含清单页主题');
});

test('品种页 meta 随币变化 + og:image / twitter:image 用实物图', () => {
  const c1 = seo.renderIndex({ tab: 'coin', i: 0 });
  const c2 = seo.renderIndex({ tab: 'coin', i: 1 });
  assert.notEqual(grab(c1, /<meta name="twitter:title" content="([^"]*)"/),
    grab(c2, /<meta name="twitter:title" content="([^"]*)"/));
  const og = grab(c1, /<meta property="og:image" content="([^"]*)"/);
  const tw = grab(c1, /<meta name="twitter:image" content="([^"]*)"/);
  assert.match(og, /\/img\/001\.jpg$/, 'og:image 应为该币实物图');
  assert.equal(tw, og, 'twitter:image 与 og:image 应一致');
  const kw = grab(c1, /<meta name="keywords" content="([^"]*)"/);
  assert.match(kw, /纪念币/, '品种页 keywords 应含品类词');
});

test('/all /series /plan 抓取端有 SSR 静态正文', () => {
  for (const tab of ['all', 'series', 'plan']) {
    const html = seo.renderIndex({ tab, i: null });
    assert.match(html, /<article class="sx" id="ssrCoin">/, tab + ' 应有 SSR 正文块');
    assert.match(html, /<h1>/, tab + ' 正文应有 h1');
    assert.match(html, /href="\/coin\//, tab + ' 正文应含品种内链');
  }
  // 首页不重复铺正文（feature grid 已是静态文字）
  const home = seo.renderIndex({ tab: 'home', i: null });
  assert.doesNotMatch(home, /<article class="sx" id="ssrCoin">/);
});

test('结构化数据：品种页 Product+BreadcrumbList，tab 页 BreadcrumbList，/all 有 ItemList', () => {
  const coin = seo.renderIndex({ tab: 'coin', i: 0 });
  assert.ok(ldTypes(coin).includes('Product'));
  assert.ok(ldTypes(coin).includes('BreadcrumbList'));
  const all = seo.renderIndex({ tab: 'all', i: null });
  assert.ok(ldTypes(all).includes('ItemList'), '/all 应有 ItemList');
  assert.ok(ldTypes(all).includes('BreadcrumbList'));
  const home = seo.renderIndex({ tab: 'home', i: null });
  assert.ok(ldTypes(home).includes('WebSite'), '首页 WebSite 结构化数据应保留');
});

test('贵金属套级页：og:image 用实物图，且不出现参考估值文案', () => {
  // 用最小贵金属行测 renderPmIndex（不查库）
  seo.setData({
    seed: state.state().seed,
    desc: state.state().desc,
    plan: state.state().plan
  });
  // renderPmIndex 依赖 PM_COINS（通过 setPmCoins 注入）
  seo.setPmCoins([{
    no: 138, year: 2026, name: '测试贵金属套', face: 100, material: '金',
    setPieces: 2, setWeightG: 30, mintageNote: '', status: 'published',
    pieces: [], category: 'precious_metal'
  }]);
  const html = seo.renderPmIndex({ pm: true, no: 138 });
  assert.ok(html, 'renderPmIndex 应返回 HTML');
  const og = grab(html, /<meta property="og:image" content="([^"]*)"/);
  assert.match(og, /\/img\/138\.jpg$/, 'PM 套级页 og:image 用实物图');
  const twDesc = grab(html, /<meta name="twitter:description" content="([^"]*)"/);
  assert.match(twDesc, /不提供参考估值/, 'PM 页 twitter 应明确声明不提供估值');
  assert.doesNotMatch(twDesc, /单枚约|一套约/, 'PM 页 twitter 不应拼出具体价格');
});
