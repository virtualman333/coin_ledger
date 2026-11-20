'use strict';
/**
 * GET /api/series/detail 聚合接口测试（mock app.db / app.catalog / seriesService，不连库不启服务）。
 * - pm：从 cl_ecgci_pm 聚合元信息 + 分页成员，返回 yearFrom/yearTo/materials/thumb
 * - coin/note：seriesService 元信息 + catalog.query 成员
 * - 缺 code 返回 400；未知系列返回 404
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const catalogRoutes = require('../server/routes/catalog');

function fakeApp(overrides) {
  const routes = {};
  const app = {
    get(path, handler) { routes[path] = handler; },
    db: { query: async () => [] },
    catalog: { query: async () => ({ total: 0, page: 1, size: 30, items: [] }) },
    dataSource: {},
    withTx: async (fn) => fn(),
    _routes: routes,
  };
  return Object.assign(app, overrides || {});
}

function call(handler, query) {
  return new Promise((resolve) => {
    let status = 200;
    handler({ query: query || {} }, {
      code(c) { status = c; return this; },
      send: (x) => resolve({ status, body: x }),
    });
  });
}

test('pm：聚合接口返回系列元信息 + 分页成员', async () => {
  const calls = [];
  const app = fakeApp({
    db: {
      query: async (sql, params) => {
        calls.push({ sql, params });
        if (sql.indexOf('GROUP BY') >= 0) {
          return [[{ code: 'G201706', name: '一带一路金银纪念币', count: 3,
            yearFrom: '2017', yearTo: '2017', materials: '金,银', thumb: '/img/pm/1.jpg' }]];
        }
        if (sql.indexOf('COUNT(*)') >= 0) return [[{ c: 3 }]];
        return [[
          { code: 'A1', name: '金币', year: 2017, material: '金', weightG: 8, face: 500 },
          { code: 'A2', name: '银币', year: 2017, material: '银', weightG: 30, face: 10 },
        ]];
      },
    },
  });
  await catalogRoutes(app);
  const handler = app._routes['/api/series/detail'];
  assert.equal(typeof handler, 'function', '接口应注册');
  const { status, body } = await call(handler, { category: 'pm', code: 'G201706', page: '1', size: '2' });
  assert.equal(status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.category, 'pm');
  assert.equal(body.series.name, '一带一路金银纪念币');
  assert.equal(body.series.yearFrom, '2017');
  assert.equal(body.series.yearTo, '2017');
  assert.deepEqual(body.series.materials, ['金', '银']);
  assert.equal(body.series.thumb, '/img/pm/1.jpg');
  assert.equal(body.total, 3);
  assert.equal(body.pages, 2);
  assert.equal(body.items.length, 2);
  assert.ok(calls.some((c) => c.sql.indexOf('project_code = ?') >= 0), '应按 project_code 过滤');
});

test('coin/note：seriesService 元信息 + catalog.query 成员（published）', async () => {
  let queryArg = null;
  const app = fakeApp({
    catalog: {
      query: async (f) => {
        queryArg = f;
        return { total: 2, page: 1, size: 30, items: [{ no: 1, name: '币A' }, { no: 2, name: '币B' }] };
      },
      seriesWithCount: (seriesRows, coinRows) => (seriesRows || []).map((s) => ({
        key: s.seriesKey, name: s.name, desc: s.descr, img: s.img, sort: s.sort, count: (coinRows || []).length,
      })),
    },
    dataSource: {
      mode: 'db',
      repos: {
        series: { listAll: async () => [{ seriesKey: 's1', name: '生肖系列', descr: '简介', img: 'img/s1.jpg', sort: 1 }] },
        coins: { listPublished: async () => [] },
      },
    },
  });
  await catalogRoutes(app);
  const { status, body } = await call(app._routes['/api/series/detail'], { category: 'coin', code: 's1' });
  assert.equal(status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.category, 'coin');
  assert.equal(body.series.name, '生肖系列');
  assert.equal(body.series.desc, '简介');
  assert.equal(body.series.count, 2);
  assert.equal(queryArg.status, 'published', '公开接口强制只看已上架');
  assert.equal(queryArg.series, 's1');
  assert.equal(body.items.length, 2);
});

test('缺 code 返回 400', async () => {
  const app = fakeApp();
  await catalogRoutes(app);
  const { status, body } = await call(app._routes['/api/series/detail'], { category: 'pm' });
  assert.equal(status, 400);
  assert.equal(body.ok, false);
});

test('未知贵金属项目返回 404', async () => {
  const app = fakeApp({ db: { query: async () => [[]] } });
  await catalogRoutes(app);
  const { status, body } = await call(app._routes['/api/series/detail'], { category: 'pm', code: 'NOPE' });
  assert.equal(status, 404);
  assert.equal(body.ok, false);
});
