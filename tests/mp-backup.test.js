'use strict';
/**
 * 收藏备份（导出 / 导入）与小程序的广场开关。
 *
 * 导出格式两端共用，任何一端改字段都要能对上；导入必须挡住脏数据，
 * 且「合并」不能覆盖用户已有的数量与成本。
 *
 * 运行：node --test tests/mp-backup.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const MP = path.join(ROOT, 'miniprogram');
const readMp = (p) => fs.readFileSync(path.join(MP, p), 'utf8');
const readWeb = (p) => fs.readFileSync(path.join(ROOT, 'public', p), 'utf8');

const mem = {};
let puts = [];

function setupWx() {
  Object.keys(mem).forEach((k) => { delete mem[k]; });
  puts = [];
  global.wx = {
    getStorageSync: (k) => (k in mem ? mem[k] : ''),
    setStorageSync: (k, v) => { mem[k] = v; },
    removeStorageSync: (k) => { delete mem[k]; },
    showToast() {}, showModal() {}, hideToast() {},
    showLoading() {}, hideLoading() {}, stopPullDownRefresh() {},
    switchTab() {}, navigateTo() {}, navigateBack() {}, redirectTo() {},
  };
  global.getCurrentPages = () => [];
  global.App = () => {};
  global.getApp = () => ({ globalData: {} });
  global.Page = () => {};
}

function install(file, exportsObj) {
  const p = path.join(MP, file);
  delete require.cache[require.resolve(p)];
  require.cache[require.resolve(p)] = { id: p, filename: p, loaded: true, exports: exportsObj };
}

function loadStore() {
  setupWx();
  install('utils/catalog.js', {
    total: 0,
    seriesList: [],
    coins: [],
    byName: {},
    categoryOf: () => 'commemorative_coin',
    seriesName: () => '',
    money: (n) => String(n),
    round2: (n) => Math.round((Number(n) || 0) * 100) / 100,
    setSizeOf: () => 1,
    aiPriceOf: () => 0,
  });
  install('utils/api.js', {
    BASE: 'https://example.test',
    get: () => Promise.resolve({ ok: true, holdings: [] }),
    put: (p, body) => { puts.push(body); return Promise.resolve({ ok: true, rev: 1 }); },
    post: () => Promise.resolve({ ok: true }),
  });
  install('utils/share.js', { appMessage: () => ({}), timeline: () => ({}) });
  const file = path.join(MP, 'utils', 'store.js');
  delete require.cache[require.resolve(file)];
  const store = require(file);
  store.state.user = { id: 'u1', name: 'tester' };
  store.state.holdings = [];
  return store;
}

/* ---------------- 导出 ---------------- */

test('导出包结构与字段白名单', () => {
  const store = loadStore();
  store.state.holdings = [
    { id: 'h1', name: '泰山纪念币', unit: 'set', rolls: 2, cost: 120.456, market: 200,
      group: '世界文化遗产', serials: ['A1'], form: 'set', images: [], extra: '不该带' },
    { id: 'G20240101', name: '熊猫金币', category: 'pm', thumb: '/img/pm/1.jpg',
      unit: 'piece', rolls: 1, cost: 8000, market: 0, group: '贵金属' },
  ];
  const data = store.exportHoldings();
  assert.equal(data.app, 'coin-ledger');
  assert.equal(data.type, 'holdings');
  assert.equal(data.version, 1);
  assert.equal(data.count, 2);
  assert.ok(Array.isArray(data.holdings));
  assert.ok(data.exportedAt, '要有导出时间');

  const first = data.holdings[0];
  assert.equal(first.cost, 120.46, '成本要 round2');
  assert.equal(first.unit, 'set');
  assert.equal(first.extra, undefined, '白名单外的字段不能带出去');

  const pm = data.holdings[1];
  assert.equal(pm.category, 'pm');
  assert.equal(pm.id, 'G20240101', '贵金属必须带编号');
  assert.equal(pm.unit, 'piece');
});

test('空账本导出是 count=0 而不是报错', () => {
  const store = loadStore();
  const data = store.exportHoldings();
  assert.equal(data.count, 0);
  assert.deepEqual(data.holdings, []);
});

/* ---------------- 解析 ---------------- */

test('解析：导出包 / 裸数组 / ```json 包裹 都能吃', () => {
  const store = loadStore();
  const one = { name: '泰山纪念币', rolls: 1, cost: 5 };
  const asPackage = JSON.stringify({ app: 'coin-ledger', holdings: [one] });
  const asArray = JSON.stringify([one]);
  const asFence = '```json\n' + asPackage + '\n```';

  for (const raw of [asPackage, asArray, asFence]) {
    const r = store.parseImport(raw);
    assert.equal(r.ok, true, '解析失败：' + raw.slice(0, 20));
    assert.equal(r.items.length, 1);
    assert.equal(r.items[0].name, '泰山纪念币');
  }
});

test('解析：非法输入给出可读原因', () => {
  const store = loadStore();
  assert.equal(store.parseImport('').ok, false);
  assert.match(store.parseImport('不是 json').error, /JSON/);
  assert.match(store.parseImport('{"a":1}').error, /holdings/);
});

test('解析：脏数据逐条丢弃，不污染账本', () => {
  const store = loadStore();
  const raw = JSON.stringify([
    { name: '正常', rolls: 2, cost: 10 },
    { name: '', rolls: 1 },                 // 没名字
    { name: '数量为零', rolls: 0 },          // rolls < 1
    { name: '数量非数字', rolls: 'abc' },
    { name: '贵金属缺编号', category: 'pm', rolls: 1 },
    null,
    'string',
  ]);
  const r = store.parseImport(raw);
  assert.equal(r.ok, true);
  assert.equal(r.items.length, 1, '只有第一条合法');
  assert.equal(r.dropped, 6);
});

test('解析：数量封顶、负数金额归零、单位只认 piece/set', () => {
  const store = loadStore();
  const r = store.parseImport(JSON.stringify([
    { name: 'A', rolls: 999999, cost: -5, market: -1, unit: 'box' },
  ]));
  assert.equal(r.items[0].rolls, 9999);
  assert.equal(r.items[0].cost, 0);
  assert.equal(r.items[0].market, 0);
  assert.equal(r.items[0].unit, 'set');
});

/* ---------------- 导入 ---------------- */

test('合并导入：新增进账本，落库一次', async () => {
  const store = loadStore();
  const r = store.parseImport(JSON.stringify([
    { name: '泰山纪念币', rolls: 2, cost: 30 },
    { name: '黄山纪念币', rolls: 1, cost: 15 },
  ]));
  const res = await store.importHoldings(r.items, 'merge');
  assert.equal(res.added, 2);
  assert.equal(res.skipped, 0);
  assert.equal(res.total, 2);
  assert.equal(store.state.holdings.length, 2);
  assert.equal(puts.length, 1, '导入后要把整份账本推给服务端');
});

test('合并导入：重复项跳过，且不覆盖已有数量与成本', async () => {
  const store = loadStore();
  store.state.holdings = [{ id: 'h1', name: '泰山纪念币', unit: 'set', rolls: 5, cost: 500 }];
  const r = store.parseImport(JSON.stringify([
    { name: '泰山纪念币', rolls: 1, cost: 10 },   // 已存在 → 跳过
    { name: '黄山纪念币', rolls: 1, cost: 15 },   // 新增
  ]));
  const res = await store.importHoldings(r.items, 'merge');
  assert.equal(res.added, 1);
  assert.equal(res.skipped, 1);
  assert.equal(store.state.holdings.length, 2);

  const kept = store.state.holdings.filter((h) => h.name === '泰山纪念币')[0];
  assert.equal(kept.rolls, 5, '合并不能改已有数量');
  assert.equal(kept.cost, 500, '合并不能改已有成本');
});

test('合并导入：贵金属按编号去重（同名不同编号是两枚）', async () => {
  const store = loadStore();
  store.state.holdings = [{ id: 'G1', name: '熊猫金币', category: 'pm', unit: 'piece', rolls: 1, cost: 100 }];
  const r = store.parseImport(JSON.stringify([
    { id: 'G1', name: '熊猫金币', category: 'pm', rolls: 1, cost: 100 },   // 同一枚 → 跳过
    { id: 'G2', name: '熊猫金币', category: 'pm', rolls: 1, cost: 200 },   // 同名的另一枚 → 新增
  ]));
  const res = await store.importHoldings(r.items, 'merge');
  assert.equal(res.skipped, 1);
  assert.equal(res.added, 1);
  assert.equal(store.state.holdings.length, 2);
});

test('覆盖导入：整份替换', async () => {
  const store = loadStore();
  store.state.holdings = [{ id: 'old', name: '旧藏品', unit: 'set', rolls: 9, cost: 900 }];
  const r = store.parseImport(JSON.stringify([{ name: '新藏品', rolls: 1, cost: 10 }]));
  const res = await store.importHoldings(r.items, 'replace');
  assert.equal(res.added, 1);
  assert.equal(store.state.holdings.length, 1);
  assert.equal(store.state.holdings[0].name, '新藏品');
});

test('未登录时导入被拒（账本只属于登录用户）', async () => {
  const store = loadStore();
  store.state.user = null;
  const r = store.parseImport(JSON.stringify([{ name: '泰山纪念币', rolls: 1 }]));
  await assert.rejects(() => store.importHoldings(r.items, 'merge'), /登录/);
  assert.equal(store.state.holdings.length, 0);
});

/* ---------------- 广场开关 ---------------- */

test('广场开关默认关闭，且只在一处定义', () => {
  const f = readMp('utils/feature.js');
  assert.match(f, /plaza:\s*false/, '广场入口应处于关闭状态');
});

test('小程序的广场入口都受开关控制', () => {
  // 广场入口从「我的」收进了「更多功能」页
  assert.match(readMp('pages/more-tools/more-tools.wxml'), /wx:if="\{\{plazaOn\}\}"[\s\S]{0,120}goPlaza/,
    '「更多功能」里的广场入口没有开关');
  assert.doesNotMatch(readMp('views/mine/mine.wxml'), /goPlaza/, '「我的」不该再直接挂广场入口');
  assert.match(readMp('views/home/home.wxml'), /plazaOn && feed\.length/, '首页晒单板块没有开关');
  const holdings = readMp('pages/holdings/holdings.wxml');
  assert.match(holdings, /wx:if="\{\{plazaOn\}\}"[^>]*shareToPlaza/, '弹层里的「分享广场」没有开关');
  assert.match(holdings, /wx:if="\{\{plazaOn\}\}"[^>]*toggleSelectMode/, '「多选分享」没有开关');
});

test('小程序首页关闭广场后不再请求广场数据', () => {
  const s = readMp('views/home/home.logic.js');
  assert.match(s, /if \(!feature\.plaza\)[\s\S]{0,80}feed: \[\]/, '关掉入口后还在拉 /api/shares');
});

test('网站端：广场 tab 隐藏且旧链接回落首页', () => {
  const js = readWeb('app.js');
  assert.match(js, /var PLAZA_ON = false/, '开关应为关闭');
  assert.match(js, /name === 'plaza' && !PLAZA_ON\) name = 'home'/, '缺少 goTab 回落');
  assert.match(js, /querySelector\('\[data-tab="plaza"\]'\)[\s\S]{0,40}hidden = true/, '顶部 tab 没有被隐藏');
  const css = readWeb('app.css');
  assert.match(css, /\.tab\[hidden\]\{display:none\}/, 'hidden 需要样式兜底');
});

test('网站端也提供同一份格式的导入导出', () => {
  const js = readWeb('app.js');
  assert.match(js, /function backupPayload\(\)/, '缺导出');
  assert.match(js, /function parseBackup\(/, '缺解析');
  assert.match(js, /app: 'coin-ledger', type: 'holdings', version: 1/, '导出格式要与小程序一致');
  assert.match(js, /if \(h\.category === 'pm' && h\.id\) return 'pm\|' \+ h\.id/, '去重键要与小程序一致');
  const html = readWeb('index.html');
  assert.match(html, /id="backupBtn"/, '藏品页没有入口按钮');
});
