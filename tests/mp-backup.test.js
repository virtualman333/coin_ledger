'use strict';
/**
 * 收藏备份（导出 / 导入）。
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
  assert.match(store.parseImport('不是表格也不是 json').error, /表格|名称/);
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

/* ---------------- 广场已整块下线（2026-11-22） ---------------- */

test('广场下线：小程序不再有页面、入口与接口调用', () => {
  assert.equal(fs.existsSync(path.join(__dirname, '..', 'miniprogram', 'pages', 'plaza')), false, 'plaza 页面应已删除');
  assert.equal(fs.existsSync(path.join(__dirname, '..', 'miniprogram', 'utils', 'feature.js')), false, 'feature 开关应已删除');
  const appJson = readMp('app.json');
  assert.doesNotMatch(appJson, /pages\/plaza/, 'app.json 不该再注册广场页');
  for (const f of ['pages/holdings/holdings.js', 'pages/holdings/holdings.wxml', 'views/home/home.logic.js',
    'views/home/home.wxml', 'views/mine/mine.logic.js', 'pages/more-tools/more-tools.wxml', 'utils/share.js']) {
    assert.doesNotMatch(readMp(f), /plaza|广场|api\/shares/, f + ' 仍残留广场入口');
  }
});

test('广场下线：网站不再有广场 tab 与逻辑', () => {
  const js = readWeb('app.js');
  assert.doesNotMatch(js, /loadPlaza|PLAZA_ON|data-tab="plaza"/, '网站广场逻辑应已删除');
  const html = readWeb('index.html');
  assert.doesNotMatch(html, /pane-plaza|data-tab="plaza"/, '网站不该再有广场 tab');
});

test('网站端也提供同一份 CSV 格式的导入导出', () => {
  const js = readWeb('app.js');
  assert.match(js, /function holdingsCsv\(\)/, '缺导出');
  assert.match(js, /function parseBackup\(/, '缺解析');
  assert.match(js, /function parseCsvRows\(/, '缺 CSV 解析');
  assert.match(js, /'成本合计'/, '表头要和小程序一致');
  assert.match(js, /if \(h\.category === 'pm' && h\.id\) return 'pm\|' \+ h\.id/, '去重键要与小程序一致');
  assert.match(js, /下载 \.csv/, '导出按钮还写着 json');
  const html = readWeb('index.html');
  assert.match(html, /id="backupBtn"/, '藏品页没有入口按钮');
});

/* ---------------- CSV 表格（2026-11-21 起的主格式） ---------------- */

function sampleStore() {
  const store = loadStore();
  store.state.holdings = [
    { id: 'h1', name: '泰山纪念币', category: 'coin', unit: 'set', rolls: 2, cost: 120.456,
      market: 200, group: '世界文化遗产', serials: ['A1', 'A2'], form: 'set', images: [] },
    { id: 'G20240101', name: '熊猫金币', category: 'pm', thumb: '/img/pm/1.jpg',
      unit: 'piece', rolls: 1, cost: 8000, market: 0, group: '贵金属' },
  ];
  return store;
}

test('CSV 导出：中文表头、中文枚举、合计金额、数组用 | 分隔', () => {
  const out = sampleStore().exportCsv();
  assert.equal(out.count, 2);
  const lines = out.csv.trim().split('\r\n');
  assert.equal(lines[0], '名称,类别,编号,单位,数量,成本合计,市值合计,分组,冠号,形态,缩略图,图片,独立',
    '表头固定，Excel 里一眼能看懂');
  assert.equal(lines[1], '泰山纪念币,普通纪念币,h1,套,2,120.46,200,世界文化遗产,A1|A2,整套,,,');
  assert.equal(lines[2], '熊猫金币,贵金属纪念币,G20240101,枚,1,8000,0,贵金属,,,/img/pm/1.jpg,,');
});

test('CSV 往返：导出再导入，数量 / 金额 / 冠号 / 形态都不变形', () => {
  const store = sampleStore();
  const csv = store.exportCsv().csv;
  const r = store.parseImport(csv);
  assert.equal(r.ok, true);
  assert.equal(r.items.length, 2);
  const a = r.items.find((x) => x.name === '泰山纪念币');
  assert.equal(a.category, 'coin');
  assert.equal(a.unit, 'set');
  assert.equal(a.rolls, 2);
  assert.equal(a.cost, 120.46);
  assert.equal(a.market, 200);
  assert.deepEqual(a.serials, ['A1', 'A2']);
  assert.equal(a.form, 'set');
  const b = r.items.find((x) => x.name === '熊猫金币');
  assert.equal(b.category, 'pm');
  assert.equal(b.id, 'G20240101');
  assert.equal(b.unit, 'piece');
  assert.equal(b.thumb, '/img/pm/1.jpg');
});

test('CSV 导入：Excel 复制出来的制表符表格也能吃', () => {
  const store = loadStore();
  const tsv = '名称\t类别\t数量\t成本合计\n泰山纪念币\t普通纪念币\t3\t99.5\n';
  const r = store.parseImport(tsv);
  assert.equal(r.ok, true);
  assert.equal(r.items[0].rolls, 3);
  assert.equal(r.items[0].cost, 99.5);
  assert.equal(r.items[0].category, 'coin');
});

test('CSV 导入：带逗号的名称（引号转义）不会被拆列', () => {
  const store = loadStore();
  const r = store.parseImport('名称,数量\n"泰山, 纪念币",2\n');
  assert.equal(r.ok, true);
  assert.equal(r.items[0].name, '泰山, 纪念币');
  assert.equal(r.items[0].rolls, 2);
});

test('CSV 导入：列顺序可以调换，按表头名匹配', () => {
  const store = loadStore();
  const r = store.parseImport('数量,名称,类别\n2,泰山纪念币,纪念钞\n');
  assert.equal(r.ok, true);
  assert.equal(r.items[0].name, '泰山纪念币');
  assert.equal(r.items[0].rolls, 2);
  assert.equal(r.items[0].category, 'note');
});

test('CSV 导入：Excel 存出来的 BOM 不影响第一列表头', () => {
  const store = loadStore();
  const r = store.parseImport('\uFEFF名称,数量\n泰山纪念币,1\n');
  assert.equal(r.ok, true);
  assert.equal(r.items[0].name, '泰山纪念币');
});

test('CSV 导入：贵金属缺编号照样被挡下', () => {
  const store = loadStore();
  const r = store.parseImport('名称,类别,数量\n熊猫金币,贵金属纪念币,1\n');
  assert.equal(r.ok, false);
  assert.match(r.error, /识别/);
  assert.equal(r.dropped, 1);
});
