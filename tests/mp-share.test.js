'use strict';
/**
 * 回归测试：小程序分享能力
 * - 核心内容页同时支持「转发给朋友」和「分享到朋友圈」
 * - 贵金属详情分享落到 pmdetail?code=XXX，特殊字符要编码
 * - 公开页复用统一分享配置，落地路径正确
 * 运行：npm test
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const MP = path.join(__dirname, '..', 'miniprogram');
const share = require(path.join(MP, 'utils', 'share.js'));

const CONTENT_PAGES = [
  'index/index',
  'detail/detail',
  'pmdetail/pmdetail',
  'plan/plan',
  'series/series',
  'plaza/plaza',
  'list/list',
];

function pageFile(rel) {
  return path.join(MP, 'pages', rel + '.js');
}

function install(file, exportsObj) {
  const p = path.join(MP, file);
  delete require.cache[require.resolve(p)];
  require.cache[require.resolve(p)] = {
    id: p,
    filename: p,
    loaded: true,
    exports: exportsObj,
  };
}

test('核心内容页全部支持转发给朋友与分享到朋友圈', () => {
  for (const rel of CONTENT_PAGES) {
    const s = fs.readFileSync(pageFile(rel), 'utf8');
    assert.match(s, /onShareAppMessage\s*\(/, rel + ' 缺少转发给朋友');
    assert.match(s, /onShareTimeline\s*\(/, rel + ' 缺少朋友圈分享');
  }
});

test('贵金属详情转发落到 pmdetail?code=，标题带项目名', () => {
  const m = share.pmMessage({
    code: 'PM24/01',
    name: '熊猫金币',
    projectName: '2024版',
    thumbUrl: 'https://x.test/a.png',
  });
  assert.equal(m.title, '熊猫金币｜2024版');
  assert.equal(m.path, '/pages/pmdetail/pmdetail?code=' + encodeURIComponent('PM24/01'));
  assert.equal(m.imageUrl, 'https://x.test/a.png');
});

test('贵金属详情朋友圈分享用 query 传 code，图片有兜底', () => {
  const t = share.pmTimeline({ code: 'PM 24', name: '熊猫金币' });
  assert.equal(t.title, '熊猫金币');
  assert.equal(t.query, 'code=' + encodeURIComponent('PM 24'));
  assert.equal(t.imageUrl, share.COVER);
});

test('贵金属分享无数据时回落到首页，不抛错', () => {
  assert.equal(share.pmMessage(null).path, '/pages/index/index');
  assert.equal(share.pmTimeline(null).query, '');
  assert.equal(share.pmMessage({ code: 'X1' }).title, 'X1');
});

test('公开页分享配置指向对应落地页', () => {
  assert.equal(share.appMessage('series').path, '/pages/series/series');
  assert.equal(share.timeline('series').query, '');
  assert.equal(share.appMessage('plaza').path, '/pages/plaza/plaza');
  assert.equal(share.appMessage('plan').path, '/pages/plan/plan');
  assert.equal(share.timeline('plan').query, '');
  assert.equal(share.appMessage('__unknown__').path, '/pages/index/index');
});

test('series / plaza / plan 复用统一分享配置', () => {
  for (const rel of ['series/series', 'plaza/plaza', 'plan/plan']) {
    const key = rel.split('/')[0];
    const s = fs.readFileSync(pageFile(rel), 'utf8');
    assert.ok(s.includes("require('../../utils/share')"), rel + ' 未引入 share');
    assert.ok(s.includes("return share.appMessage('" + key + "')"), rel + ' 转发配置不对');
    assert.ok(s.includes("return share.timeline('" + key + "')"), rel + ' 朋友圈配置不对');
  }
});

test('pmdetail 分享回调透传当前详情，未加载时用 URL code 兜底', () => {
  let captured = null;
  global.Page = (c) => { captured = c; };
  global.wx = {};
  install('utils/api.js', { BASE: 'https://x.test', get: () => Promise.resolve({ ok: true }) });
  install('utils/store.js', { state: { holdings: [] } });
  install('utils/share.js', {
    pmMessage: (it) => ({ title: 'M:' + it.code, path: '/p/' + it.code }),
    pmTimeline: (it) => ({ title: 'T:' + it.code, query: 'code=' + it.code }),
  });

  const file = pageFile('pmdetail/pmdetail');
  delete require.cache[require.resolve(file)];
  require(file);

  const page = Object.assign({}, captured);
  page.data = { code: 'CODE1', item: { code: 'ITEM1' } };
  assert.deepEqual(page.onShareAppMessage(), { title: 'M:ITEM1', path: '/p/ITEM1' });
  assert.deepEqual(page.onShareTimeline(), { title: 'T:ITEM1', query: 'code=ITEM1' });
  page.data.item = null;
  assert.deepEqual(page.onShareAppMessage(), { title: 'M:CODE1', path: '/p/CODE1' });
});

test('pmdetail 页面提供显式分享按钮', () => {
  const wxml = fs.readFileSync(path.join(MP, 'pages', 'pmdetail', 'pmdetail.wxml'), 'utf8');
  assert.match(wxml, /open-type="share"/);
});
