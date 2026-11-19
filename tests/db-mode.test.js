'use strict';
/**
 * db 模式专项回归（QA 第 4/5/6 个 Bug）
 *
 * 本机无 MySQL，用桩连接 + 临时目录验证三个结构性问题：
 *   4) 改图必须写 cl_meta['catalog.gallery_ver']，且用同一事务连接；
 *   5) sitemap 合并老品种与已上架 PM 时按 no 去重；
 *   6) data:sync 在 db 模式把已上架 PM 打成「贵金属」而不是「有价格的普通币」。
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const TX = { id: 'TX_CONN_SENTINEL' };

test('Bug4：image.repo.bumpVersion 递增 gallery_ver，并使用事务连接', async () => {
  const imageRepo = require('../server/repositories/image.repo');
  const calls = [];
  const fakeConn = {
    async query(sql, params) {
      calls.push([sql, params]);
      if (/SELECT v FROM cl_meta/.test(sql)) return [[{ v: '99167363' }], []];
      return [{ affectedRows: 1 }, []];
    }
  };
  const repo = imageRepo.create({ query: async () => { throw new Error('不应使用 pool 连接'); } });
  const next = await repo.bumpVersion(fakeConn);

  assert.equal(next, '99167364', '旧值 +1，保证同一毫秒内多次改图也必变');
  assert.equal(calls.length, 2);
  calls.forEach(([sql, params]) => {
    assert.ok(/cl_meta/.test(sql));
    if (params) assert.ok(params.length === 0 || params.length === 1);
  });
  assert.ok(/ON DUPLICATE KEY UPDATE/.test(calls[1][0]));
});

test('Bug4：db 模式 saveGallery 在事务内调用 bumpVersion', async () => {
  const imageService = require('../server/services/image.service');
  const calls = [];
  const mockImages = {
    async listAll() { return []; },
    async listByCoin() { return []; },
    async version() { return '99167363'; },
    async replaceForCoin(conn, no, list) { calls.push(['replaceForCoin', conn, no]); },
    async bumpVersion(conn) { calls.push(['bumpVersion', conn]); return '99167364'; }
  };
  const ds = { mode: 'db', repos: { images: mockImages } };
  const svc = imageService.create({ dataSource: ds, withTx: async (fn) => fn(TX) });
  const r = await svc.saveGallery({ id: 1, images: [] }, 'admin', '127.0.0.1');
  assert.equal(r.status, 200);
  assert.deepEqual(calls.map((c) => c[0]), ['replaceForCoin', 'bumpVersion']);
  calls.forEach((c) => assert.equal(c[1], TX, c[0] + ' 必须用事务连接'));
});

test('Bug5：sitemap 合并时按 no 去重，PM 只出现一次且 priority=0.5', () => {
  const gen = require('../tools/gen-sitemap');
  const legacy = Array.from({ length: 137 }, (_, i) => ({
    i: i, no: i + 1, year: 2000 + i, name: '普通币' + i, kind: 'coin', face: 1, material: '铜镍合金'
  }));
  // 模拟 db 模式：legacyCoins() 已经把上架的 PM 带出来（QA 场景）
  legacy.push({ i: 137, no: 138, year: 2026, name: '熊猫套', kind: 'coin', face: 19620, material: '金', category: 'precious_metal' });
  const pmPublished = [
    { no: 138, year: 2026, name: '熊猫套', face: 19620, material: '金', mintageNote: '' },
    { no: 139, year: 2026, name: '马年套', face: 118115, material: '金', mintageNote: '' },
    { no: 140, year: 2026, name: '贺岁套', face: 13, material: '金', mintageNote: '' }
  ];

  const coins = gen.assembleSitemapCoins(legacy, pmPublished);
  assert.equal(coins.length, 140);
  assert.equal(new Set(coins.map((c) => c.no)).size, 140, 'no 不允许重复');

  const xml = gen.buildXml(coins, [], '2026-01-01');
  assert.equal((xml.match(/<loc>https:\/\/coin\.virtualman\.top\/coin\/138<\/loc>/g) || []).length, 1);
  assert.equal((xml.match(/<loc>https:\/\/coin\.virtualman\.top\/coin\/139<\/loc>/g) || []).length, 1);
  assert.equal((xml.match(/<loc>https:\/\/coin\.virtualman\.top\/coin\/140<\/loc>/g) || []).length, 1);
  // 4 = 3 个 PM 套 + /sitemap 页本身（基线里它就是 0.5）
  assert.equal((xml.match(/<priority>0\.5<\/priority>/g) || []).length, 4);
  assert.equal((xml.match(/<url>/g) || []).length, 146, '6 页 + 137 普通 + 3 PM = 146');
});

test('Bug6：db 模式 data:sync 把已上架 PM 打成贵金属（种子仍是 draft）', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cl-mp-dbmode-'));
  const src = path.join(tmp, 'export');
  const out = path.join(tmp, 'catalog.js');
  try {
    // 1) 造一份「db 模式 export:json」产物：137 普通 + 3 个带 category/status 的 PM
    const doc = JSON.parse(fs.readFileSync(path.join(ROOT, 'public', 'data', 'coins.json'), 'utf8'));
    const seed = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'seeds', 'precious-metal-2026.json'), 'utf8'));
    doc.coins = doc.coins.map((c) => Object.assign({}, c, { no: c.i + 1, category: 'commemorative_coin', status: 'published' }));
    seed.sets.forEach((s) => {
      doc.coins.push({
        i: s.no - 1, no: s.no, category: 'precious_metal', status: 'published',
        year: s.year, name: s.name, series: s.series, face: s.face,
        material: s.material, kind: 'coin', mintage: null
      });
    });
    fs.mkdirSync(src, { recursive: true });
    fs.writeFileSync(path.join(src, 'coins.json'), JSON.stringify(doc));
    ['descriptions.json', 'images.json', 'plan.json', 'series.json', 'gallery.json'].forEach((f) => {
      fs.copyFileSync(path.join(ROOT, 'public', 'data', f), path.join(src, f));
    });
    // 种子保持 draft（db 模式 publish 不改文件的真实情况）
    const seedFile = path.join(tmp, 'pm-seed.json');
    fs.writeFileSync(seedFile, JSON.stringify(seed));

    execFileSync(process.execPath, [path.join(ROOT, 'tools', 'build_mp_data.js')], {
      cwd: ROOT,
      env: Object.assign({}, process.env, {
        MP_EXPORT_DIR: src,
        MP_PM_SEED_FILE: seedFile,
        MP_OUT: out
      }),
      stdio: 'pipe'
    });

    const payload = require(out);
    const pm = payload.coins.filter((c) => c.category === 'precious_metal');
    assert.equal(payload.coins.length, 140);
    assert.equal(pm.length, 3, '三个已上架套都要进包');
    assert.deepEqual(pm.map((c) => c.no), [138, 139, 140]);
    pm.forEach((c) => {
      assert.equal(c.hasPrice, false, '贵金属不能有价格');
      assert.ok(c.pm && Array.isArray(c.pm.pieces), '必须带 pm 子对象与规格表');
      assert.equal(c.pm.pieces.length, c.pm.setPieces);
    });
    assert.equal(new Set(payload.coins.map((c) => c.no)).size, 140, '不能按 no 重复');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
