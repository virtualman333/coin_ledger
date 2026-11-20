'use strict';
/**
 * /api/catalog/pm 筛选与排序：年份/面额/材质/工艺、排序方向、facets。
 *
 * 背景：小程序与网页端都把「年份筛选」露给了用户，但前端从没把 year 传下来、
 * 面板本身也被 category !== 'pm' 挡掉了 —— 功能是半成品。这里固定住接口侧的口径，
 * 前端一旦漏传就会被这条测试的 SQL 断言兜住。
 *
 * 不连库、不启服务：mock app.db.query 记录 SQL 与参数。
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const plansRoutes = require('../server/routes/plans');

/** 记录每次 query 的 (sql, params)，按 SELECT 类型回不同形状 */
function fakeApp(opts) {
  const o = opts || {};
  const calls = [];
  const routes = {};
  const app = {
    get(path, handler) { routes[path] = handler; },
    db: {
      query: async (sql, params) => {
        calls.push({ sql, params });
        if (/COUNT\(\*\)/.test(sql)) return [[{ c: o.total != null ? o.total : 7 }]];
        if (/SELECT DISTINCT year/.test(sql)) return [[{ year: '2026' }, { year: '2025' }]];
        if (/SELECT DISTINCT face/.test(sql)) return [[{ face: 10 }, { face: 50 }]];
        if (/SELECT DISTINCT material/.test(sql)) return [[{ material: '金' }, { material: '银' }]];
        return [[o.items || [{ code: 'G20260101', name: '测试币' }]]];
      },
    },
    metalPrice: { getQuotes: async () => ({}), valueOf: () => null, TROY_OZ_G: 31.1035 },
    _routes: routes,
  };
  return { app, calls };
}

function call(handler, query) {
  return new Promise((resolve) => {
    handler({ params: {}, query: query || {} }, { send: (x) => resolve(x), code() { return this; } });
  });
}

async function run(query, opts) {
  const { app, calls } = fakeApp(opts);
  await plansRoutes(app);
  const res = await call(app._routes['/api/catalog/pm'], query);
  const listCall = calls.filter((c) => /SELECT .*FROM cl_ecgci_pm/.test(c.sql) && !/COUNT/.test(c.sql))[0] || {};
  return { res, calls, sql: listCall.sql || '', params: listCall.params || [] };
}

test('年份 / 面额 / 材质 都落到 WHERE 里，不是静默忽略', async () => {
  const { sql, params } = await run({ year: '2026', face: '10', material: '金' });
  assert.match(sql, /year = \?/);
  assert.match(sql, /face = \?/);
  assert.match(sql, /material = \?/);
  assert.deepEqual(params.slice(0, 3), ['2026', '10', '金']);
});

test('三个筛选可以单独用，也可以组合', async () => {
  const a = await run({ year: '2026' });
  assert.match(a.sql, /WHERE year = \?/);
  assert.doesNotMatch(a.sql, /face = \?/);

  const b = await run({ face: '50' });
  assert.match(b.sql, /WHERE face = \?/);
  assert.deepEqual(b.params[0], '50');
});

test('quality 也支持（接口能力对齐，前端暂不暴露入口）', async () => {
  const { sql, params } = await run({ quality: '精制' });
  assert.match(sql, /quality = \?/);
  assert.equal(params[0], '精制');
});

test('默认按年份倒序，且空年份沉底', async () => {
  const { sql } = await run({});
  assert.match(sql, /ORDER BY .*IS NULL, .*DESC/);
  assert.match(sql, /CAST\(NULLIF\(year, ''\) AS UNSIGNED\)/);
});

test('sort=year_asc 切换方向；未知值回落到默认', async () => {
  const asc = await run({ sort: 'year_asc' });
  assert.match(asc.sql, /IS NULL, .*ASC/);

  const bogus = await run({ sort: 'hack; DROP TABLE' });
  assert.match(bogus.sql, /DESC/);
  assert.doesNotMatch(bogus.sql, /DROP/);
});

test('sort=code 时按编号排序（兼容旧行为）', async () => {
  const { sql } = await run({ sort: 'code' });
  assert.match(sql, /ORDER BY code ASC/);
});

test('facets=1 才做三次去重查询，并原样返回', async () => {
  const withFacets = await run({ facets: '1' });
  assert.ok(withFacets.res.facets);
  assert.deepEqual(withFacets.res.facets.years, ['2026', '2025']);
  assert.deepEqual(withFacets.res.facets.faces, [10, 50]);
  assert.deepEqual(withFacets.res.facets.materials, ['金', '银']);

  const without = await run({});
  assert.equal(without.res.facets, null);
  assert.equal(without.calls.filter((c) => /SELECT DISTINCT/.test(c.sql)).length, 0);
});

test('搜索同时匹配名称 / 编号 / 项目名 / 年份', async () => {
  const { sql, params } = await run({ q: '熊猫' });
  assert.match(sql, /name LIKE \?/);
  assert.match(sql, /code LIKE \?/);
  assert.match(sql, /project_name LIKE \?/);
  assert.match(sql, /year LIKE \?/);
  assert.deepEqual(params.slice(0, 4), ['%熊猫%', '%熊猫%', '%熊猫%', '%熊猫%']);
});

test('筛选与搜索叠加时参数顺序与占位符数量一致', async () => {
  const { sql, params } = await run({ year: '2026', material: '金', q: '熊猫', pageSize: '10' });
  const holes = (sql.match(/\?/g) || []).length;
  // LIMIT / OFFSET 也各占一个占位符
  assert.equal(holes, params.length);
  assert.equal(params[params.length - 1], 0);   // OFFSET
  assert.equal(params[params.length - 2], 10);  // LIMIT
});

test('分页与总数仍按筛选后的集合算', async () => {
  const { res } = await run({ year: '2026', page: '2', pageSize: '30' }, { total: 65 });
  assert.equal(res.total, 65);
  assert.equal(res.page, 2);
  assert.equal(res.pages, 3);
});
