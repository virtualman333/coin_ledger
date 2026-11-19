'use strict';
/**
 * 事务连接一致性回归（QA 第 3 个 Bug）
 *
 * db 模式下 DELETE /api/admin/pm/:no 曾报 Lock wait timeout（51 秒）：
 * pm.service.remove 在 withTx 里先用事务 conn 删 cl_pm_pieces 子行，
 * 再用 pool 的另一条连接删 cl_coins 父行 —— 父行 DELETE 要级联锁子行，
 * 自锁互等 50 秒超时，事务原子性也破了。
 *
 * 本机没有 MySQL，所以用「桩连接」验证结构性不变量：
 * 同一个 withTx 回调里，所有仓储写调用拿到的 conn 必须是同一个对象。
 * 覆盖 pm.service 的 create/update/pieces/status/remove 与 series.service.remove。
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const pmService = require('../server/services/pm.service');
const seriesService = require('../server/services/series.service');

/** 事务连接的哨兵对象：任何写调用拿到别的连接都会断言失败 */
const TX = { id: 'TX_CONN_SENTINEL' };

/**
 * 构造记录调用参数的桩数据源。
 *
 * @param {object} overrides 覆盖仓储行为
 * @returns {{ds: object, calls: object[], withTx: Function}} 桩
 */
function harness(overrides) {
  const calls = [];
  const o = overrides || {};
  const pmRow = o.pmRow || null;
  const repos = {
    coins: {
      async listAll() { return o.coinRows || []; },
      async listByCategory() { return pmRow ? [pmRow] : []; },
      async listPublished() { return o.coinRows || []; },
      async countByCategory() { return { commemorative_coin: 137, commemorative_note: 0, precious_metal: pmRow ? 1 : 0 }; },
      async findByNo(no, conn) { calls.push(['coins.findByNo', no, conn]); return pmRow; },
      async insert(cols, conn) { calls.push(['coins.insert', cols.no, conn]); return cols.no; },
      async update(no, values, conn) { calls.push(['coins.update', no, conn]); return pmRow; },
      async remove(no, conn) { calls.push(['coins.remove', no, conn]); return 1; }
    },
    pmPieces: {
      async listByCoin(no) { return Array.isArray(pmRow.pieces) ? pmRow.pieces : []; },
      async replaceAll(conn, no, pieces) { calls.push(['pieces.replaceAll', no, conn]); return pieces.length; },
      async removeByCoin(conn, no) { calls.push(['pieces.removeByCoin', no, conn]); return 1; }
    },
    series: {
      async listAll() { return o.seriesRows || []; },
      async remove(key, conn) { calls.push(['series.remove', key, conn]); return 1; }
    }
  };
  const ds = { mode: 'db', repos: repos, assertWritable() {} };
  const withTx = async (fn) => fn(TX);
  return { ds: ds, calls: calls, withTx: withTx };
}

/** 所有写调用（写方法名含 insert/update/remove/replaceAll）都必须拿到 TX */
function assertAllWritesOnTx(calls) {
  const writes = calls.filter((c) => /\.insert$|\.update$|\.remove$|removeByCoin$|replaceAll$/.test(c[0]));
  assert.ok(writes.length >= 1, '至少应记录一个写调用，实际 ' + JSON.stringify(calls));
  writes.forEach((c) => {
    assert.equal(c[c.length - 1], TX, c[0] + ' 没有使用事务连接（混用 pool 会死锁）');
  });
}

test('DELETE 贵金属草稿：删子行与删父行必须在同一个事务连接', async () => {
  const seed = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'seeds', 'precious-metal-2026.json'), 'utf8'));
  const pmRow = pmService.rowFromSeed(Object.assign({}, seed.sets[0], { no: 143, status: 'draft' }));
  const h = harness({ pmRow: pmRow });
  const svc = pmService.create({ dataSource: h.ds, withTx: h.withTx });

  const r = await svc.remove(143);
  assert.equal(r.ok, true, r.error);
  const child = h.calls.find((c) => c[0] === 'pieces.removeByCoin');
  const parent = h.calls.find((c) => c[0] === 'coins.remove');
  assert.ok(child && parent, '子行和父行都应删除');
  assert.equal(child[2], TX);
  assert.equal(parent[2], TX, 'coins.remove(no, conn) 必须把 conn 传进去');
  assertAllWritesOnTx(h.calls);
});

test('PM 新建 / 编辑 / 整份替换规格 / 上下架：事务内写调用全部使用同一 conn', async () => {
  const seed = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'seeds', 'precious-metal-2026.json'), 'utf8'));
  const pmRow = pmService.rowFromSeed(seed.sets[0]);
  const h = harness({ pmRow: pmRow });
  const svc = pmService.create({ dataSource: h.ds, withTx: h.withTx });

  assert.equal((await svc.update(138, seed.sets[0])).ok, true);
  assertAllWritesOnTx(h.calls);

  h.calls.length = 0;
  assert.equal((await svc.replacePieces(138, seed.sets[0].pieces)).ok, true);
  assertAllWritesOnTx(h.calls);

  h.calls.length = 0;
  assert.equal((await svc.setStatus(138, 'published')).ok, true);
  assertAllWritesOnTx(h.calls);

  // 新建走「无现有套」的桩
  const h2 = harness({ pmRow: null });
  const svc2 = pmService.create({ dataSource: h2.ds, withTx: h2.withTx });
  const created = await svc2.create(seed.sets[0]);
  assert.equal(created.ok, true);
  assertAllWritesOnTx(h2.calls);
});

test('删除系列：删系列元信息与清理品种 seriesKeys 也在同一事务连接', async () => {
  const h = harness({
    seriesRows: [{ seriesKey: 'T03TEST' }],
    coinRows: [{ no: 1, series: 'T03TEST', seriesKeys: ['T03TEST'] }]
  });
  const svc = seriesService.create({
    dataSource: h.ds,
    catalog: { seriesWithCount: () => [] },
    withTx: h.withTx
  });
  const r = await svc.remove('T03TEST', 'admin', '127.0.0.1');
  assert.equal(r.ok, true, r.error);
  assertAllWritesOnTx(h.calls);
});
