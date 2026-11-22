'use strict';
/**
 * 回归测试：我的收藏 → 只读分享快照
 * - 后端脱敏白名单：成本 / 市值 / 盈亏 / 号码绝不落库
 * - 接口与迁移已注册
 * - 小程序：预生成分享码、转发/朋友圈带 code、朋友圈访客跳转
 * 运行：npm test
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const MP = path.join(ROOT, 'miniprogram');
const colshare = require(path.join(ROOT, 'server', 'services', 'colshare.service.js'));

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

function install(file, exportsObj) {
  const p = path.join(MP, file);
  delete require.cache[require.resolve(p)];
  require.cache[require.resolve(p)] = {
    id: p, filename: p, loaded: true, exports: exportsObj,
  };
}

/* ---------------- 后端：脱敏 ---------------- */

test('快照条目只保留公开字段，账本隐私不带出去', () => {
  const it = colshare.sanitizeItem({
    name: '2024 熊猫金币',
    year: 2024,
    category: 'pm',
    qty: 20,
    qtyLabel: '20 枚',
    seriesName: '熊猫',
    imgUrl: 'https://x.test/a.png',
    luckyTags: ['无4', '豹子号'],
    cost: 12345,
    market: 67890,
    pnl: 5555,
    serials: ['J12345678'],
    images: ['/collection/secret.jpg'],
  });
  assert.deepEqual(Object.keys(it).sort(), [
    'category', 'imgUrl', 'luckyTags', 'name', 'qty', 'qtyLabel', 'seriesName', 'year',
  ]);
  assert.equal(it.name, '2024 熊猫金币');
  assert.equal(it.category, 'pm');
  assert.equal(it.qty, 20);
  assert.deepEqual(it.luckyTags, ['无4', '豹子号']);
  assert.ok(!JSON.stringify(it).includes('cost'));
  assert.ok(!JSON.stringify(it).includes('market'));
  assert.ok(!JSON.stringify(it).includes('J12345678'));
});

test('脏数据被裁剪：空名字跳过、非法品类归 coin、数量不为负', () => {
  const items = colshare.sanitizeItems([
    null,
    { name: '  ' },
    { name: 'A', category: 'unknown', qty: -5 },
    { name: 'B', qty: '12' },
  ]);
  assert.equal(items.length, 2);
  assert.equal(items[0].category, 'coin');
  assert.equal(items[0].qty, 0);
  assert.equal(items[1].qty, 12);
  assert.equal(items[1].qtyLabel, '12 枚');
});

test('快照最多 200 条，超长字段被截断', () => {
  const many = Array.from({ length: 205 }, (_, i) => ({ name: '币' + i, qty: 1 }));
  const items = colshare.sanitizeItems(many);
  assert.equal(items.length, colshare.MAX_ITEMS);
  const long = colshare.sanitizeItem({ name: 'x'.repeat(200), imgUrl: 'y'.repeat(500) });
  assert.equal(long.name.length, 64);
  assert.equal(long.imgUrl.length, 300);
  const stats = colshare.statsOf(items);
  assert.equal(stats.kinds, 200);
  assert.equal(stats.total, 200);
});

test('后端路由、迁移与注册齐全', () => {
  const routes = read('server/routes/colshare.js');
  assert.ok(routes.includes("app.post('/api/colshare'"));
  assert.ok(routes.includes("app.get('/api/colshare/:code'"));
  assert.ok(routes.includes('app.requireLogin'));
  const index = read('server/routes/index.js');
  assert.ok(index.includes("require('./colshare')"));
  assert.ok(index.includes('app.register(colshareRoutes)'));
  const sql = read('server/migrations/009_colshare.sql');
  assert.ok(sql.includes('CREATE TABLE IF NOT EXISTS cl_colshare'));
});

/* ---------------- 小程序：我的收藏 ---------------- */

function loadHoldings(holdingsData, loggedIn, state) {
  let captured = null;
  state.posted = null;
  state.redirected = '';
  global.Page = (c) => { captured = c; };
  global.wx = {
    redirectTo: (o) => { state.redirected = o.url; },
    setStorageSync() {}, getStorageSync() {}, showToast() {},
    showLoading() {}, hideLoading() {}, stopPullDownRefresh() {},
  };
  install('utils/catalog.js', {
    byName: {}, total: 0, money: (n) => String(n), round2: (n) => n, aiPriceOf: () => 0,
  });
  install('utils/api.js', {
    BASE: 'https://x.test',
    get: () => Promise.resolve({ ok: true }),
    post: (p, d) => {
      state.posted = { p, d };
      return Promise.resolve({ ok: true, code: 'CODE123' });
    },
  });
  install('utils/store.js', {
    isLogin: () => loggedIn,
    getState: () => ({ holdings: holdingsData }),
    state: { holdings: holdingsData },
    stats: () => ({}),
    refresh: () => Promise.resolve(),
  });
  install('utils/share.js', {
    COVER: '/images/share-cover.png',
    appMessage: () => ({ title: 'fallback', path: '/pages/mine/mine' }),
    timeline: () => ({ title: 'fallback', query: '' }),
  });
  const file = path.join(MP, 'pages/holdings/holdings.js');
  delete require.cache[require.resolve(file)];
  require(file);
  if (!captured) captured = require(file);
  const page = Object.assign({}, captured);
  page.data = JSON.parse(JSON.stringify(captured.data || {}));
  page.setData = function (patch) {
    Object.keys(patch).forEach((k) => { this.data[k] = patch[k]; });
  };
  return page;
}

test('预生成快照码，转发与朋友圈都带 code', async () => {
  const state = {};
  const p = loadHoldings([
    { id: 'h1', name: '熊猫金币', rolls: 2, unit: 'set', category: 'pm', thumb: '/thumb.png' },
  ], true, state);
  await p.prepareShare();
  assert.equal(p.data.shareCode, 'CODE123');
  assert.equal(state.posted.p, '/api/colshare');
  const item = state.posted.d.items[0];
  assert.equal(item.name, '熊猫金币');
  assert.equal(item.qty, 40);
  assert.equal(item.category, 'pm');
  assert.ok(!JSON.stringify(item).includes('cost'));

  const msg = p.onShareAppMessage();
  assert.equal(msg.path, '/pages/colshare/colshare?code=CODE123');
  assert.ok(msg.title.includes('我的收藏'));
  const tl = p.onShareTimeline();
  assert.equal(tl.query, 'code=CODE123');
});

test('未登录或空藏品时回落到原分享，不生成快照', () => {
  const state = {};
  const p = loadHoldings([], true, state);
  p.prepareShare();
  assert.equal(state.posted, null);
  assert.equal(p.onShareAppMessage().path, '/pages/mine/mine');
  assert.equal(p.onShareTimeline().query, '');
});

test('朋友圈打开 holdings?code 时跳到快照页并编码 code', () => {
  const state = {};
  const p = loadHoldings([], false, state);
  p.onLoad({ code: 'ab/cd' });
  assert.equal(state.redirected, '/pages/colshare/colshare?code=' + encodeURIComponent('ab/cd'));
});

test('我的收藏页有显式分享按钮，快照页已注册', () => {
  const wxml = read('miniprogram/pages/holdings/holdings.wxml');
  assert.match(wxml, /分享我的收藏/);
  assert.match(wxml, /open-type="share"/);
  const app = JSON.parse(read('miniprogram/app.json'));
  assert.ok(app.pages.includes('pages/colshare/colshare'));
});

/* ---------------- 小程序：快照展示页 ---------------- */

test('快照页读取接口、按本地时间展示，并可二次分享', () => {
  let captured = null;
  global.Page = (c) => { captured = c; };
  global.wx = { setNavigationBarTitle() {}, previewImage() {} };
  install('utils/api.js', {
    BASE: 'https://x.test',
    get: (p) => Promise.resolve({
      ok: true,
      owner: '小明',
      kinds: 1,
      total: 20,
      createdAt: '2026-11-20T09:00:00.000Z',
      items: [{ name: '熊猫金币', year: 2024, qty: 20, qtyLabel: '20 枚', seriesName: '熊猫', imgUrl: '', luckyTags: ['无4'] }],
    }),
  });
  install('utils/share.js', { COVER: '/images/share-cover.png' });
  const file = path.join(MP, 'pages/colshare/colshare.js');
  delete require.cache[require.resolve(file)];
  require(file);
  if (!captured) captured = require(file);
  const page = Object.assign({}, captured);
  page.data = JSON.parse(JSON.stringify(captured.data));
  page.setData = function (patch) {
    Object.keys(patch).forEach((k) => { this.data[k] = patch[k]; });
  };

  return page.onLoad({ code: 'X1' }).then(() => {
    assert.equal(page.data.owner, '小明');
    assert.equal(page.data.items.length, 1);
    assert.equal(page.data.items[0].tagText, '无4');
    assert.equal(page.data.loading, false);
    const msg = page.onShareAppMessage();
    assert.equal(msg.path, '/pages/colshare/colshare?code=X1');
    assert.equal(page.onShareTimeline().query, 'code=X1');
  });
});
