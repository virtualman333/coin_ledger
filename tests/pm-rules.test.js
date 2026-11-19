'use strict';
/**
 * 贵金属规则与种子测试（T04）
 *
 * 全部离线运行，不连 MySQL：
 *   1. 种子逐行来自 precious-metal-seed.md，3 套 / 28 枚，汇总与 arch 7.1 表一致；
 *   2. schemas/pm.js 的五条红线各自报出 field 级错误；
 *   3. 投影不给估值（hasPrice=false、无 est 键）；
 *   4. json 数据源下 draft 不泄漏到公开接口，publish 后立即可见；
 *   5. A1 占比 3/140=2.1% ≤10%。
 *
 * 写测试前把 PM_SEED_FILE 指到临时副本，绝不改仓库里的种子文件。
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const REAL_SEED = path.join(ROOT, 'data', 'seeds', 'precious-metal-2026.json');
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cl-pm-test-'));
const TEST_SEED = path.join(tmpDir, 'precious-metal-2026.json');
fs.copyFileSync(REAL_SEED, TEST_SEED);
process.env.PM_SEED_FILE = TEST_SEED;      // 必须在 require config 之前设置

const pmSchema = require('../server/schemas/pm');
const common = require('../server/schemas/common');
const catalog = require('../server/services/catalog.service');
const { createDataSource } = require('../server/services/data-source');
const pmService = require('../server/services/pm.service');
const importSeed = require('../tools/import-pm-seed');

/** 读种子副本 */
const seed = () => JSON.parse(fs.readFileSync(TEST_SEED, 'utf8'));

test('种子完整性：3 套 / 28 枚，no=138/139/140，汇总与公告一致', () => {
  const doc = seed();
  assert.equal(doc.sets.length, 3);
  assert.deepEqual(doc.sets.map((s) => s.no), [138, 139, 140]);
  assert.deepEqual(doc.sets.map((s) => s.set_pieces), [15, 11, 2]);
  assert.deepEqual(doc.sets.map((s) => s.pieces.length), [15, 11, 2]);
  assert.equal(doc.sets.reduce((a, s) => a + s.pieces.length, 0), 28);

  const expected = [
    { no: 138, weight: 2670, face: 19620, min: 2000 },
    { no: 139, weight: 12878, face: 118115, min: 18 },
    { no: 140, weight: 9, face: 13, min: 150000 }
  ];
  doc.sets.forEach((s, i) => {
    const sum = pmSchema.summarizePieces(s.pieces);
    assert.equal(sum.setWeightG, expected[i].weight, 'no=' + s.no + ' 总克重');
    assert.equal(sum.setFaceTotal, expected[i].face, 'no=' + s.no + ' 总面额');
    assert.equal(sum.minMintage, expected[i].min, 'no=' + s.no + ' 最小发行量');
    assert.equal(s.set_weight_g, sum.setWeightG);
    assert.equal(s.set_face_total, sum.setFaceTotal);
    assert.equal(s.mintage, null, 'A3：套级 mintage 恒 NULL');
    assert.equal(s.weight_g, null, 'A2：套级 weight_g 恒 NULL');
    assert.equal(s.is_set, 1, 'A1：一套一行');
    assert.equal(s.status, 'draft');
    assert.equal(s.verified, 1);
    assert.ok(/^https?:\/\//.test(s.source_url));
    s.pieces.forEach((p) => {
      assert.ok(Number.isInteger(p.max_mintage) && p.max_mintage > 0);
      assert.ok(!('mintageUnit' in p) || p.mintageUnit === 'piece');
    });
    const check = pmSchema.validateSet(s, { exists: true });
    assert.equal(check.ok, true, 'no=' + s.no + ' 应通过规则：' + JSON.stringify(check.errors));
  });

  // 尺寸原文保留
  assert.equal(doc.sets[1].pieces[1].size_text, '外接⌀100mm');
  assert.equal(doc.sets[2].pieces[1].size_text, '边长 23mm');
  assert.equal(pmSchema.checkRatio(3, 140).ok, true);
});

test('导入器校验：种子通过；篡改任一行立即拒绝', () => {
  const check = importSeed.validateSeed(seed());
  assert.equal(check.ok, true, check.errors.join('；'));
  assert.equal(check.stats.sets, 3);
  assert.equal(check.stats.pieces, 28);

  const broken = JSON.parse(JSON.stringify(seed()));
  broken.sets[0].pieces[0].weight_g = 31;      // 与套级求和不再相等
  const bad = importSeed.validateSeed(broken);
  assert.equal(bad.ok, false);
  assert.ok(bad.errors.some((e) => /set_weight_g/.test(e)));
});

test('A3 红线：套级填 mintage 报 field=mintage', () => {
  const s = seed().sets[0];
  const r = pmSchema.validateSet(Object.assign({}, s, { mintage: 2000 }), { exists: true });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.field === 'mintage'));
});

test('A2 红线：套级填 weight_g 报 field=weight_g；缺 set_weight_g / set_pieces 也报错', () => {
  const s = seed().sets[0];
  const filled = pmSchema.validateSet(Object.assign({}, s, { weight_g: 30 }), { exists: true });
  assert.equal(filled.ok, false);
  assert.ok(filled.errors.some((e) => e.field === 'weight_g'));

  const missingWeight = pmSchema.validateSet(Object.assign({}, s, { set_weight_g: null }), { exists: true });
  assert.ok(missingWeight.errors.some((e) => e.field === 'set_weight_g'));

  const missingCount = pmSchema.validateSet(Object.assign({}, s, { set_pieces: null }), { exists: true });
  assert.ok(missingCount.errors.some((e) => e.field === 'set_pieces'));
});

test('A1 红线：pieces 行数 ≠ set_pieces 报 field=pieces', () => {
  const s = seed().sets[0];
  const r = pmSchema.validateSet(Object.assign({}, s, { set_pieces: 14 }), { exists: true });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => /pieces/.test(e.field)));
});

test('明细求和红线：套级克重/面额与明细不符时各自报错', () => {
  const s = seed().sets[0];
  const weight = pmSchema.validateSet(Object.assign({}, s, { set_weight_g: 2671 }), { exists: true });
  assert.equal(weight.ok, false);
  assert.ok(weight.errors.some((e) => e.field === 'set_weight_g' && /明细求和/.test(e.error)));

  const face = pmSchema.validateSet(Object.assign({}, s, { face: 19621 }), { exists: true });
  assert.equal(face.ok, false);
  assert.ok(face.errors.some((e) => e.field === 'face' && /明细求和/.test(e.error)));
});

test('上架闸门：verified=0 不允许 publish，报错 field=verified', () => {
  const s = seed().sets[0];
  const r = pmSchema.validateSet(Object.assign({}, s, { verified: 0 }), { exists: true, forPublish: true });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.field === 'verified'));
});

test('投影红线：PM 出 hasPrice=false，不出 est 键', () => {
  const ds = createDataSource({ mode: 'json' });
  const pmSvc = pmService.create({ dataSource: ds, withTx: async () => {} });
  return pmSvc.findByNo(138).then((row) => {
    const projected = catalog.projectCatalogCoin(row, { pieces: row.pieces });
    assert.equal(projected.hasPrice, false);
    assert.equal(Object.prototype.hasOwnProperty.call(projected, 'est'), false);
    assert.equal(projected.category, 'precious_metal');
    assert.equal(projected.pm.isSet, true);
    assert.equal(projected.pm.setWeightG, 2670);
    assert.equal(projected.pm.setFaceTotal, 19620);
    assert.equal(projected.pm.pieces.length, 15);
    assert.equal(projected.pm.pieces[0].mintageUnit, 'piece');
    assert.equal(projected.pm.mintageNote.includes('逐枚不同'), true);
    // 老形态也给 bootstrap/admin 用，但 PM draft 不进 bootstrap
    const legacy = catalog.projectLegacyCoin(row);
    assert.equal(Object.prototype.hasOwnProperty.call(legacy, 'est'), false);
  });
});

test('公开查询：draft 不泄漏；category=pm 先 0 后 3；coin 恒 127', async () => {
  const ds = createDataSource({ mode: 'json' });
  const svc = catalog.create(ds);
  const pmSvc = pmService.create({ dataSource: ds, withTx: async () => {} });

  assert.equal((await svc.query({ category: 'pm', status: 'published' })).total, 0, 'draft 不能出现在公开目录');
  // service 层允许内部按 draft 查询（管理端），公开路由 routes/catalog.js 强制 published
  assert.equal((await svc.query({ category: 'pm', status: 'draft' })).total, 3);
  assert.equal((await svc.query({ category: 'coin', status: 'published' })).total, 127);
  assert.equal((await svc.query({ status: 'published' })).total, 137);
  assert.equal((await ds.repos.coins.listAllIncludingPm()).length, 140, '数据层合计 140 条');

  // 管理端能看到 3 条 draft
  const drafts = await pmSvc.listByStatus('draft');
  assert.equal(drafts.length, 3);

  // publish 后公开接口立即可见（写的是临时种子副本）
  for (const s of drafts) {
    const r = await pmSvc.setStatus(s.no, 'published');
    assert.equal(r.ok, true, r.error);
  }
  assert.equal((await svc.query({ category: 'pm', status: 'published' })).total, 3);
  assert.equal((await svc.query({ status: 'published' })).total, 140);

  // 还原临时副本，避免影响后续测试
  fs.copyFileSync(REAL_SEED, TEST_SEED);
  ds.repos.coins && require('../server/repositories/json-source').clearCache();
});

test('删除红线：已发布/历史编号都不允许删', async () => {
  const ds = createDataSource({ mode: 'json' });
  const svc = pmService.create({ dataSource: ds, withTx: async () => {} });
  const denied = await svc.remove(1);           // 历史编号 1 不在 PM 里
  assert.equal(denied.ok, false);
  const row = await svc.findByNo(138);
  assert.equal(row.status, 'draft', '临时副本已还原');
});

test.after(() => {
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (e) { /* ignore */ }
});
