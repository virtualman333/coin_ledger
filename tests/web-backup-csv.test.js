'use strict';
/**
 * 网站端收藏备份（CSV）回归。
 *
 * app.js 是浏览器脚本、整体跑不起来，但备份这一段是纯函数：把
 * 「var CSV_COLUMNS … function backupFileName」之间的源码切出来，在 vm 里
 * 给它一个 coll 就能跑。这样两端各写一份的 CSV 逻辑都能被真正执行到，
 * 不会出现「小程序导出的表格网站读不了」。
 *
 * 运行：node --test tests/web-backup-csv.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const appSrc = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');

function backupBlock() {
  const start = appSrc.indexOf('var CSV_COLUMNS = [');
  const end = appSrc.indexOf('function backupFileName(){');
  assert.ok(start > 0 && end > start, 'app.js 里找不到 CSV 备份代码块');
  return appSrc.slice(start, end);
}

/** 在沙箱里跑导出 / 解析，返回 { csv, items, error, dropped } */
function run(coll, raw) {
  const code = backupBlock() + '\n;({ csv: holdingsCsv(), parse: parseBackup })';
  const sandbox = { coll: coll || [], console };
  const api = vm.runInNewContext(code, sandbox);
  if (raw === undefined) return { csv: api.csv };
  return Object.assign({ csv: api.csv }, api.parse(raw));
}

const SAMPLE = [
  { id: 'h1', name: '泰山纪念币', category: 'coin', unit: 'set', rolls: 2, cost: 120.456,
    market: 200, group: '世界文化遗产', serials: ['A1', 'A2'], form: 'set', images: [] },
  { id: 'G20240101', name: '熊猫金币', category: 'pm', thumb: '/img/pm/1.jpg',
    unit: 'piece', rolls: 1, cost: 8000, market: 0, group: '贵金属' },
];

test('网站端 CSV 表头与小程序一致', () => {
  const { csv } = run(SAMPLE);
  const lines = csv.trim().split('\r\n');
  assert.equal(lines[0], '名称,类别,编号,单位,数量,成本合计,市值合计,分组,冠号,形态,缩略图,图片,独立');
});

test('网站端导出→解析：字段完整往返', () => {
  const out = run(SAMPLE, run(SAMPLE).csv);
  assert.equal(out.ok, true);
  assert.equal(out.items.length, 2);
  const a = out.items.find((x) => x.name === '泰山纪念币');
  assert.equal(a.category, 'coin');
  assert.equal(a.unit, 'set');
  assert.equal(a.rolls, 2);
  assert.equal(a.cost, 120.46);
  assert.equal(JSON.stringify(a.serials), '["A1","A2"]', '冠号数组要完整还原');
  assert.equal(a.form, 'set');
  const b = out.items.find((x) => x.name === '熊猫金币');
  assert.equal(b.category, 'pm');
  assert.equal(b.id, 'G20240101');
  assert.equal(b.thumb, '/img/pm/1.jpg');
});

test('网站端导入：Excel 制表符 / 引号逗号 / 调换列序 / BOM 都能读', () => {
  const tsv = run([], '名称\t类别\t数量\t成本合计\n泰山纪念币\t普通纪念币\t3\t99.5\n');
  assert.equal(tsv.ok, true);
  assert.equal(tsv.items[0].rolls, 3);
  assert.equal(tsv.items[0].cost, 99.5);

  const quoted = run([], '名称,数量\n"泰山, 纪念币",2\n');
  assert.equal(quoted.items[0].name, '泰山, 纪念币');

  const reorder = run([], '数量,名称,类别\n2,泰山纪念币,纪念钞\n');
  assert.equal(reorder.items[0].category, 'note');

  const bom = run([], '\uFEFF名称,数量\n泰山纪念币,1\n');
  assert.equal(bom.items[0].name, '泰山纪念币');
});

test('网站端仍能导入手里的旧版 JSON 备份', () => {
  const raw = JSON.stringify({ app: 'coin-ledger', type: 'holdings', version: 1,
    holdings: [{ name: '泰山纪念币', rolls: 1, cost: 5 }] });
  const r = run([], raw);
  assert.equal(r.ok, true);
  assert.equal(r.items[0].name, '泰山纪念币');
});

test('网站端：贵金属缺编号 / 缺名称的行被丢弃并计数', () => {
  const r = run([], '名称,类别,数量\n熊猫金币,贵金属纪念币,1\n,普通纪念币,2\n');
  assert.equal(r.ok, false);
  assert.equal(r.dropped, 2);
  assert.match(r.error, /识别/);
});
