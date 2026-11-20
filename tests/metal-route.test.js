'use strict';
/**
 * 贵金属详情路由：确认 metalValue 真正进入响应体（曾漏塞导致前端拿不到）。
 * mock app.db 与 app.metalPrice，不连库、不启服务、不联网。
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const metalPriceRoutes = require('../server/routes/metal-price');
const plansRoutes = require('../server/routes/plans');

function fakeApp(overrides) {
  const routes = {};
  const app = {
    get(path, handler) { routes[path] = handler; },
    db: { query: async () => [] },
    metalPrice: {
      TROY_OZ_G: 31.1035,
      getQuotes: async () => ({}),
      valueOf: () => null,
    },
    _routes: routes,
  };
  return Object.assign(app, overrides || {});
}

function call(handler, params, query) {
  return new Promise((resolve) => {
    let body;
    handler({ params: params || {}, query: query || {} }, {
      send: (x) => resolve(x),
      code() { return this; },
    });
  });
}

test('/api/metal-price 返回四种金属元/克与汇率', async () => {
  const quotes = {};
  ['XAU', 'XAG', 'XPT', 'XPD'].forEach((s) => {
    quotes[s] = { name: s, usdOz: 1000, cnyPerGram: 214.4, fallback: false };
  });
  const app = fakeApp({
    metalPrice: {
      TROY_OZ_G: 31.1035,
      getQuotes: async () => ({ quotes, fx: 6.667, fetchedAt: 'now', stale: false }),
    },
  });
  await metalPriceRoutes(app);
  const res = await call(app._routes['/api/metal-price']);
  assert.equal(res.ok, true);
  assert.equal(res.quotes.XAU.cnyPerGram, 214.4);
  assert.equal(res.quotes.XAG.usdPerOz, 1000);
  assert.equal(res.fx, 6.667);
  assert.equal(res.stale, false);
});

test('/api/catalog/pm/:code 响应体包含 metalValue（回归：曾漏塞）', async () => {
  const raw = {
    code: 'G19790101', name: '测试金币', material: ['金'], weight: [15.5518], fineness: '91.6',
    frontPicture: '', backPicture: '', projectName: '', projectYear: 1979,
  };
  const mv = { symbol: 'XAU', name: '黄金', pureGram: 14.245, cnyPerGram: 770.5, value: 10975.9 };
  const app = fakeApp({
    db: { query: async () => [[{ raw: raw, thumb: '', thumb_back: '', weight_g: 15.5518 }]] },
    metalPrice: {
      TROY_OZ_G: 31.1035,
      getQuotes: async () => ({}),
      valueOf: () => mv,
    },
  });
  await plansRoutes(app);
  const res = await call(app._routes['/api/catalog/pm/:code'], { code: 'G19790101' });
  assert.equal(res.ok, true);
  assert.deepEqual(res.item.metalValue, mv, '详情响应必须带 metalValue');
});

test('无行情材质（铜）详情 metalValue 为 null 但不报错', async () => {
  const raw = {
    code: 'C0001', name: '测试铜章', material: ['铜'], weight: [10], fineness: '99',
    frontPicture: '', backPicture: '',
  };
  const app = fakeApp({
    db: { query: async () => [[{ raw: raw, thumb: '', thumb_back: '', weight_g: 10 }]] },
    metalPrice: { TROY_OZ_G: 31.1035, getQuotes: async () => ({}), valueOf: () => null },
  });
  await plansRoutes(app);
  const res = await call(app._routes['/api/catalog/pm/:code'], { code: 'C0001' });
  assert.equal(res.ok, true);
  assert.equal(res.item.metalValue, null);
});
