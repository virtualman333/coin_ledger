'use strict';
/**
 * 目录数据层测试（T02 验收）
 *
 * 覆盖 5 组不变量，全部**离线**运行（不需要 MySQL）：
 *   1. 前置断言：源数据条数 137/128/20/21/12/137/250/2 与已知的 9 个描述缺项；
 *   2. 迁移计划：no = i + 1、dia 双列、mintage 小数、绝无 DELETE cl_coins、幂等；
 *   3. 迁移执行器：`-- @@` 切块（003 的触发器能整段发送）、checksum 稳定；
 *   4. 零漂移：JSON 仓储 → 老形态投影 → 导出，与 public/data 深比较 0 差异；
 *   5. 只读语义：DATA_SOURCE=json 时写路径抛 503 中文文案；
 *   6. 贵金属规则：A1/A2/A3（一「套」一行、套级克重、套级 mintage 为 NULL）。
 *
 * 运行：npm test
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const migrate = require('../tools/migrate-catalog-to-db');
const runner = require('../server/migrations/runner');
const diffCatalog = require('../tools/diff-catalog');
const exportJson = require('../tools/export-json');
const { createDataSource } = require('../server/services/data-source');
const catalog = require('../server/services/catalog.service');
const common = require('../server/schemas/common');
const pm = require('../server/schemas/pm');
const coinRepoJson = require('../server/repositories/coin.repo.json');

const PUBLIC_DATA = path.join(ROOT, 'public', 'data');

/**
 * 用 diff 的深比较器比较两个值，返回差异条数。
 *
 * @param {unknown} a 左
 * @param {unknown} b 右
 * @returns {number} 差异条数
 */
function diffCount(a, b) {
  const acc = { diffs: [], orderWarns: [], strict: false };
  diffCatalog.deepCompare(a, b, '', acc);
  return acc.diffs.length;
}

test('迁移前置断言：源数据条数与已知缺项都符合预期', () => {
  const src = migrate.loadSources();
  const check = migrate.validateSources(src);
  assert.equal(check.ok, true, '断言应通过：' + check.errors.join('；'));
  assert.equal(check.stats.coins, 137);
  assert.equal(check.stats.descriptions, 128);
  assert.equal(check.stats.series, 20);
  assert.equal(check.stats.sets, 21);
  assert.equal(check.stats.defaults, 12);
  assert.equal(check.stats.galleryCoinKeys, 137);
  assert.equal(check.stats.images, 250);
  assert.equal(check.stats.real, 135);
  assert.deepEqual(check.stats.mock, [34, 56]);
  assert.equal(check.stats.planYears, 2);
  assert.equal(check.stats.planItems, 10);
  assert.deepEqual(check.stats.missingDesc, [19, 26, 38, 59, 86, 87, 101, 130, 136]);
});

test('迁移前置断言：条数被改坏时必须失败（不是静默通过）', () => {
  const src = migrate.loadSources();
  const broken = JSON.parse(JSON.stringify(src));
  broken.coins.coins = broken.coins.coins.slice(0, 100);
  const check = migrate.validateSources(broken);
  assert.equal(check.ok, false);
  assert.ok(check.errors.some((e) => /品种数应为 137/.test(e)), '应报品种数不符');
});

test('迁移计划：no = i+1、dia 双列、mintage 小数、无 DELETE', () => {
  const src = migrate.loadSources();
  const plan = migrate.buildPlan(src);

  assert.equal(plan.coins.length, 137);
  plan.coins.forEach((row, i) => assert.equal(row.no, i + 1, '第 ' + i + ' 行的 no 必须是 i+1'));

  // dia：数字走 dia，"—" 走 dia_text（存量 10 条纪念钞）
  const note = plan.coins[39];                       // i=39，dia "—"
  assert.equal(note.dia_text, '—');
  assert.equal(note.dia, null);
  const coin = plan.coins[0];
  assert.equal(coin.dia, 30);
  assert.equal(coin.dia_text, null);

  // mintage：261.5 这类小数不能被取整
  assert.equal(plan.coins[1].mintage, 261.5);

  // 描述：128 条，缺的 9 个不补
  assert.equal(plan.descriptions.length, 128);
  const descNos = plan.descriptions.map((d) => d.coin_no);
  [19, 26, 38, 59, 86, 87, 101, 130, 136].forEach((no) => {
    assert.equal(descNos.indexOf(no), -1, 'no=' + no + ' 本来就没有描述，不应写入');
  });

  // 保号：写 plan 的每一天都只用 upsert/insert，绝不 DELETE cl_coins
  // （先剥掉注释：迁移脚本的说明文字里就写着「不做 DELETE」，不能把它当违例）
  const stripComments = (src) => String(src)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/--.*$/gm, '')
    .replace(/^\s*\/\/.*$/gm, '');
  const sqlFiles = ['001_catalog_core.sql', '002_catalog_aux.sql', '003_guards.sql', '004_precious_metal.sql'];
  sqlFiles.forEach((f) => {
    const sql = stripComments(fs.readFileSync(path.join(ROOT, 'server', 'migrations', f), 'utf8'));
    assert.equal(/DELETE\s+FROM\s+cl_coins/i.test(sql), false, f + ' 不允许出现 DELETE FROM cl_coins');
  });
  const toolSrc = stripComments(fs.readFileSync(path.join(ROOT, 'tools', 'migrate-catalog-to-db.js'), 'utf8'));
  assert.equal(/DELETE\s+FROM\s+cl_coins/i.test(toolSrc), false, '迁移脚本不允许 DELETE 品种');
});

test('迁移计划是幂等的：同一份源数据两次 buildPlan 结果完全一致', () => {
  const src = migrate.loadSources();
  const a = migrate.buildPlan(src);
  const b = migrate.buildPlan(migrate.loadSources());
  assert.equal(JSON.stringify(a) === JSON.stringify(b), true, '两次生成的写入计划必须逐字相同');
});

test('迁移执行器：按 -- @@ 切块，003 的两个触发器各自整段', () => {
  const list = runner.listMigrations();
  assert.deepEqual(list.map((m) => m.version), ['001_catalog_core', '002_catalog_aux', '003_guards', '004_precious_metal']);

  const guard = list.filter((m) => m.version === '003_guards')[0];
  assert.equal(guard.blocks.length, 4, '003 应为 4 块：2 个 DROP + 2 个 CREATE TRIGGER（视图已故意省略，见文件末尾说明）');

  const creates = guard.blocks.filter((b) => /CREATE TRIGGER/.test(b));
  assert.equal(creates.length, 2);
  creates.forEach((b) => {
    assert.match(b, /BEGIN[\s\S]*END;/, '触发器体必须整段保留（内部有分号）');
    assert.match(b, /SIGNAL SQLSTATE '45000'/);
  });
  // 切块不能把 BEGIN…END 里的分号当分隔符
  list.forEach((m) => {
    m.blocks.forEach((b) => {
      assert.equal(/^\s*--\s*@@\s*$/m.test(b), false, m.version + ' 的块里不应残留分隔符');
    });
  });

  // checksum 只看内容，与换行风格无关
  const sql = fs.readFileSync(path.join(ROOT, 'server', 'migrations', '001_catalog_core.sql'), 'utf8');
  assert.equal(runner.checksumOf(sql), runner.checksumOf(sql.replace(/\n/g, '\r\n')), 'CRLF 不应改变 checksum');
});

test('零漂移：JSON 仓储 → 老形态投影 与 coins.json 逐字段一致', () => {
  const doc = JSON.parse(fs.readFileSync(path.join(PUBLIC_DATA, 'coins.json'), 'utf8'));
  const rows = coinRepoJson.allRows();
  assert.equal(rows.length, doc.coins.length);

  rows.forEach((row) => {
    const original = doc.coins[row.no - 1];
    assert.equal(Number(original.i) + 1, row.no, '行顺序应与 i 对齐');
    const projected = catalog.projectLegacyCoin(row);
    const n = diffCount(projected, original);
    assert.equal(n, 0, 'no=' + row.no + '（' + original.name + '）投影后出现 ' + n + ' 处漂移');
  });
});

test('零漂移：export --from-json 的 6 个产物与 public/data 深比较 0 差异', async () => {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cl-export-test-'));
  try {
    const ds = createDataSource({ mode: 'json' });
    const docs = await exportJson.buildDocs(ds, PUBLIC_DATA);   // 借基线的 updated/note 文档戳
    exportJson.writeDocs(outDir, docs);

    const result = diffCatalog.diffDirs(outDir, PUBLIC_DATA, { strictKeyOrder: false });
    assert.equal(result.missing.length, 0, '不应缺文件：' + result.missing.join('；'));
    assert.deepEqual(result.diffs, [], '不应有实质差异');
    assert.ok(result.allowed.length >= 1, 'meta.count / meta.generated 属允许差异');
  } finally {
    fs.rmSync(outDir, { recursive: true, force: true });
  }
});

test('只读语义：DATA_SOURCE=json 时写路径抛 503 且文案明确', async () => {
  const ds = createDataSource({ mode: 'json' });
  assert.equal(ds.writable, false);
  assert.throws(() => ds.assertWritable(), (e) => e.status === 503 && /JSON 只读模式/.test(e.message));

  await assert.rejects(() => ds.repos.coins.update(1, { face: 2 }), (e) => e.status === 503);
  await assert.rejects(() => ds.repos.coins.insert({ no: 138, name: 'x' }), (e) => e.status === 503);
  await assert.rejects(() => ds.repos.plan.replace(null, { years: [] }), (e) => e.status === 503);
  await assert.rejects(() => ds.repos.pmPieces.replaceAll(null, 138, []), (e) => e.status === 503);
});

test('排序口径：category_rank ASC, year DESC, no ASC（SQL 与 JS 比较器一致）', async () => {
  assert.equal(common.CATALOG_ORDER_SQL, 'c.category_rank ASC, c.year DESC, c.no ASC');

  const ds = createDataSource({ mode: 'json' });
  const svc = catalog.create(ds);
  const res = await svc.query({ status: 'published' });
  assert.equal(res.total, 137);

  for (let i = 1; i < res.items.length; i += 1) {
    const a = res.items[i - 1];
    const b = res.items[i];
    assert.ok(common.compareCatalogOrder(a, b) <= 0, '第 ' + i + ' 项违反排序口径');
  }
  // 贵金属排在最后（当前还没有 PM 数据，这里断言过滤器本身可用）
  const pmOnly = await svc.query({ category: 'pm' });
  assert.equal(pmOnly.total, 0);
  const notes = await svc.query({ category: 'note' });
  assert.equal(notes.total, 10, '纪念钞应为 10 个');
});

test('迁移执行器（桩连接）：首次全跑、二次全跳过、checksum 变更即报错', async () => {
  // 本机没有 MySQL 时的替代验证：用一个只记账不执行的假连接，
  // 证明「跳过已应用」「checksum 保护」「整块发送」这三条逻辑是对的。
  const state = new Map();
  const sent = [];
  const fakeConn = {
    async query(sql, params) {
      if (/^CREATE TABLE IF NOT EXISTS cl_schema_migrations/.test(sql)) return [{}, []];
      if (/SELECT version, checksum FROM cl_schema_migrations/.test(sql)) {
        return [Array.from(state.entries()).map(([version, checksum]) => ({ version, checksum })), []];
      }
      if (/^INSERT INTO cl_schema_migrations/.test(sql)) {
        state.set(String(params[0]), String(params[1]));
        return [{ affectedRows: 1 }, []];
      }
      sent.push(String(sql));
      return [{}, []];
    }
  };

  const first = await runner.apply(fakeConn, {});
  assert.deepEqual(first.applied, ['001_catalog_core', '002_catalog_aux', '003_guards', '004_precious_metal']);
  assert.equal(first.skipped.length, 0);
  assert.equal(first.blocks, 14, '4 个文件共 14 个语句块');
  assert.equal(sent.length, 14, '每块必须整段发送一次（不能按分号再切）');
  // 触发器整段里既有 BEGIN 又有分号，证明切块没有破坏语句
  assert.ok(sent.some((s) => /BEGIN[\s\S]*END;/.test(s)), '触发器必须整段发送');

  sent.length = 0;
  const second = await runner.apply(fakeConn, {});
  assert.deepEqual(second.applied, []);
  assert.equal(second.skipped.length, 4, '第二次执行必须全部跳过');
  assert.equal(sent.length, 0, '已应用版本不应再发送任何语句');

  // 改文件内容 → checksum 不一致 → 必须报错（禁止悄悄改历史迁移）
  state.set('001_catalog_core', 'deadbeef');
  await assert.rejects(() => runner.apply(fakeConn, {}), (e) => /checksum 与库内记录不一致/.test(e.message));
});

test('贵金属规则 A1/A2/A3：一「套」一行、套级克重留空、套级 mintage 为 NULL', () => {
  const pieces = [
    { seq: 1, name: '30克圆形金质纪念币', metal: 'gold', weight_g: 30, purity: 0.999, face: 500, max_mintage: 500000, shape: 'round', size_text: '⌀32mm', quality: 'uncirculated' },
    { seq: 2, name: '3克圆形金质纪念币', metal: 'gold', weight_g: 3, purity: 0.999, face: 50, max_mintage: 800000, shape: 'round', size_text: '⌀18mm', quality: 'uncirculated' }
  ];
  const good = {
    no: 138, year: 2026, name: '2026 版熊猫贵金属纪念币', series: 'PM',
    face: 550, mintage: null, mintage_note: '全套 2 枚，发行量逐枚不同，见规格明细',
    material: '金', metal: 'gold', purity: 0.999, weight_g: null,
    is_set: 1, set_pieces: 2, set_weight_g: 33, set_face_total: 550,
    issue_method: 'reservation', source_url: 'https://www.chngc.net/common/news-detail?id=262028',
    verified: 1, pieces: pieces
  };

  const ok = pm.validateSet(good);
  assert.equal(ok.ok, true, '合法套应通过：' + JSON.stringify(ok.errors));
  assert.equal(ok.normalized.category, 'precious_metal');
  assert.equal(ok.normalized.categoryRank, 2, '贵金属排序权重恒为 2');
  assert.equal(ok.normalized.mintage, null, 'A3：套级 mintage 必须为 NULL');
  assert.equal(ok.normalized.weightG, null, 'A2：套级 weight_g 必须留空');
  assert.equal(ok.normalized.setWeightG, 33);
  assert.equal(ok.normalized.pieces.length, 2);

  // A2：缺 set_weight_g → 报错
  const noWeight = pm.validateSet(Object.assign({}, good, { set_weight_g: null }));
  assert.equal(noWeight.ok, false);
  assert.ok(noWeight.errors.some((e) => e.field === 'set_weight_g'));

  // A2：套级 weight_g 不许填
  const withWeight = pm.validateSet(Object.assign({}, good, { weight_g: 30 }));
  assert.equal(withWeight.ok, false);
  assert.ok(withWeight.errors.some((e) => e.field === 'weight_g'));

  // A3：套级 mintage 填了就报错
  const withMintage = pm.validateSet(Object.assign({}, good, { mintage: 2000 }));
  assert.equal(withMintage.ok, false);
  assert.ok(withMintage.errors.some((e) => e.field === 'mintage'));

  // 明细行数必须等于 set_pieces
  const wrongCount = pm.validateSet(Object.assign({}, good, { set_pieces: 3, set_weight_g: 33, face: 550 }));
  assert.equal(wrongCount.ok, false);
  assert.ok(wrongCount.errors.some((e) => /pieces/.test(e.field)));

  // 套级克重/面额必须是明细求和（纯算术校验）
  const wrongSum = pm.validateSet(Object.assign({}, good, { set_weight_g: 40 }));
  assert.equal(wrongSum.ok, false);
  assert.ok(wrongSum.errors.some((e) => /明细求和/.test(e.error)));

  // 未核验不允许上架
  const publishUnverified = pm.validateSet(Object.assign({}, good, { verified: 0 }), { forPublish: true });
  assert.equal(publishUnverified.ok, false);
  assert.ok(publishUnverified.errors.some((e) => e.field === 'verified'));
});

test('G3 红线：贵金属占比 3/140 = 2.1% 仍 ≤10%', () => {
  const r = pm.checkRatio(3, 140);
  assert.equal(r.ok, true);
  assert.ok(r.ratio < 0.1);
  // 反例：每枚规格都建一行（28 个）会破线 —— 这就是 A1 选「一「套」一行」的原因
  assert.equal(pm.checkRatio(28, 165).ok, false);
});
