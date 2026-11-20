'use strict';
/**
 * 贵金属行情与克重价 单元测试。
 * 纯逻辑，mock 全局 fetch、注入时钟与临时缓存文件，不连外网、不启服务。
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const svc = require('../server/services/metal-price.service');

const PRICES = { XAU: 3582.15, XAG: 42.405, XPT: 1000, XPD: 1000 };
const FX = 6.6667;
const HOUR = 60 * 60 * 1000;

let fileSeq = 0;
/** 每个用例一个独立缓存文件，避免互相污染 */
function tmpCache() {
  return path.join(os.tmpdir(), 'metal-price-test-' + process.pid + '-' + (++fileSeq) + '.json');
}
function createSvc(opts) {
  return svc.create(Object.assign({ cacheFile: tmpCache() }, opts || {}));
}

function mockFetch() {
  const orig = global.fetch;
  global.fetch = async function (url) {
    let body;
    if (/gold-api\.com\/price\//.test(url)) {
      const sym = url.split('/').pop();
      body = { price: PRICES[sym] };
    } else if (/frankfurter/.test(url)) {
      body = { rates: { CNY: FX } };
    } else {
      body = { rates: { CNY: FX } };
    }
    return { ok: true, status: 200, json: async () => body };
  };
  return () => { global.fetch = orig; };
}

/** 可计数的 fetch mock：能统计拉取次数、改价、切换全挂 */
function mockFetchCounting() {
  const orig = global.fetch;
  let calls = 0;
  let fail = false;
  const prices = Object.assign({}, PRICES);
  let fx = FX;
  global.fetch = async function (url) {
    calls++;
    if (fail) throw new Error('offline');
    let body;
    if (/gold-api\.com\/price\//.test(url)) {
      body = { price: prices[url.split('/').pop()] };
    } else {
      body = { rates: { CNY: fx } };
    }
    return { ok: true, status: 200, json: async () => body };
  };
  return {
    restore: () => { global.fetch = orig; },
    calls: () => calls,
    setFail: (v) => { fail = !!v; },
    setPrice: (sym, v) => { prices[sym] = v; },
    setFx: (v) => { fx = v; }
  };
}

test('材质识别：金银铂钯 / 数组 / 双金属 / 铜', () => {
  assert.equal(svc.metalOf('金'), 'XAU');
  assert.equal(svc.metalOf(['金']), 'XAU');
  assert.equal(svc.metalOf('银'), 'XAG');
  assert.equal(svc.metalOf('铂'), 'XPT');
  assert.equal(svc.metalOf('钯'), 'XPD');
  assert.equal(svc.metalOf('金/银/双金属'), 'XAU');
  assert.equal(svc.metalOf('铜'), null);
  assert.equal(svc.metalOf(''), null);
});

test('首项归一：详情接口的数组字段', () => {
  assert.equal(svc.first(['金']), '金');
  assert.equal(svc.first([15.5518]), 15.5518);
  assert.equal(svc.first('91.6'), '91.6');
  assert.equal(svc.first(null), null);
});

test('元/克换算：美元/盎司 ÷ 31.1035 × 汇率', () => {
  const restore = mockFetch();
  return createSvc().getQuotes().then((snap) => {
    restore();
    const expected = Math.round((PRICES.XAU / 31.1035 * FX) * 100) / 100;
    assert.equal(snap.quotes.XAU.cnyPerGram, expected);
    assert.equal(snap.quotes.XAU.usdOz, PRICES.XAU);
    assert.equal(snap.fx, FX);
    assert.equal(snap.stale, false);
  }).catch((e) => { restore(); throw e; });
});

test('克重价：1/2 盎司金币 91.6% 成色', () => {
  const restore = mockFetch();
  const s = createSvc();
  return s.getQuotes().then(() => {
    restore();
    const v = s.valueOf(['金'], [15.5518], '91.6');
    assert.equal(v.symbol, 'XAU');
    assert.equal(v.pureGram, 14.245); // 15.5518 × 0.916
    const perGram = Math.round((PRICES.XAU / 31.1035 * FX) * 100) / 100;
    assert.equal(v.value, Math.round(14.245 * perGram * 100) / 100);
    assert.equal(v.fineness, 91.6);
  }).catch((e) => { restore(); throw e; });
});

test('克重价：成色小数归一化 + 银币', () => {
  const restore = mockFetch();
  const s = createSvc();
  return s.getQuotes().then(() => {
    restore();
    const v = s.valueOf('银', 31.1035, 0.8);
    assert.equal(v.symbol, 'XAG');
    assert.equal(v.fineness, 80);        // 0.8 -> 80%
    assert.equal(v.pureGram, 24.883);    // 31.1035 × 0.8
    assert.ok(v.value > 0);
  }).catch((e) => { restore(); throw e; });
});

test('无行情材质返回 null，非法克重返回 null', () => {
  const restore = mockFetch();
  const s = createSvc();
  return s.getQuotes().then(() => {
    restore();
    assert.equal(s.valueOf('铜', 10, 99), null);
    assert.equal(s.valueOf('金', 0, 99), null);
    assert.equal(s.valueOf('金', 'abc', 99), null);
  }).catch((e) => { restore(); throw e; });
});

test('拉取失败降级：接口全挂时用兜底价且不抛错', () => {
  const orig = global.fetch;
  global.fetch = async () => { throw new Error('offline'); };
  return createSvc().getQuotes().then((snap) => {
    global.fetch = orig;
    assert.equal(snap.stale, true);
    assert.ok(snap.quotes.XAU.usdOz > 0);
    assert.ok(snap.quotes.XAU.cnyPerGram > 0);
    assert.equal(snap.quotes.XAU.fallback, true);
  }).catch((e) => { global.fetch = orig; throw e; });
});

test('小时缓存：同小时只拉一次，且并发请求合并为一次拉取', async () => {
  const m = mockFetchCounting();
  let now = Date.UTC(2026, 0, 1, 9, 5, 0);
  const s = svc.create({ cacheFile: tmpCache(), now: () => now });
  try {
    const snaps = await Promise.all([s.getQuotes(), s.getQuotes(), s.getQuotes()]);
    // 一次 load = 4 种金属 + 1 次汇率 = 5 次 fetch；并发只触发一次 load
    assert.equal(m.calls(), 5);
    assert.equal(snaps[0], snaps[1]);
    assert.equal(snaps[1], snaps[2]);

    // 同小时后续顺序请求仍读缓存，不再拉取
    await s.getQuotes();
    await s.getQuotes();
    assert.equal(m.calls(), 5);
  } finally {
    m.restore();
  }
});

test('小时缓存：跨小时会重新拉取并刷新价格', async () => {
  const m = mockFetchCounting();
  let now = Date.UTC(2026, 0, 1, 9, 5, 0);
  const s = svc.create({ cacheFile: tmpCache(), now: () => now });
  try {
    const a = await s.getQuotes();
    assert.equal(a.quotes.XAU.usdOz, PRICES.XAU);
    const callsAfterFirst = m.calls();

    m.setPrice('XAU', 3700);
    m.setFx(7.0);
    now += HOUR; // 跨到下一小时
    const b = await s.getQuotes();
    assert.equal(b.quotes.XAU.usdOz, 3700);
    assert.equal(b.fx, 7.0);
    assert.ok(m.calls() > callsAfterFirst, '跨小时必须重新拉外部接口');
    assert.notEqual(a.fetchedAt, b.fetchedAt);

    // 新小时内再次请求不再拉取
    const afterRefresh = m.calls();
    await s.getQuotes();
    assert.equal(m.calls(), afterRefresh);
  } finally {
    m.restore();
  }
});

test('小时缓存：持久化到文件，进程重启后同小时仍读缓存', async () => {
  const m = mockFetchCounting();
  const file = tmpCache();
  const now = Date.UTC(2026, 0, 1, 9, 5, 0);
  try {
    const s1 = svc.create({ cacheFile: file, now: () => now });
    const a = await s1.getQuotes();
    const callsAfterFirst = m.calls();

    const rec = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.ok(rec.hourKey, '缓存文件应记录 hourKey');
    assert.ok(rec.fetchedAt, '缓存文件应记录 fetchedAt');
    assert.ok(rec.payload && rec.payload.quotes, '缓存文件应记录 payload');

    // 模拟进程重启：新实例读同一文件、同一小时
    const s2 = svc.create({ cacheFile: file, now: () => now });
    const b = await s2.getQuotes();
    assert.equal(m.calls(), callsAfterFirst, '重启后同小时不应再拉外部接口');
    assert.equal(b.quotes.XAU.usdOz, a.quotes.XAU.usdOz);
    assert.equal(b.fetchedAt, a.fetchedAt);
    assert.equal(b.hourKey, a.hourKey);
  } finally {
    m.restore();
  }
});

test('小时缓存：外部接口失败且有旧缓存时，返回旧值并标记 stale', async () => {
  const m = mockFetchCounting();
  let now = Date.UTC(2026, 0, 1, 9, 5, 0);
  const s = svc.create({ cacheFile: tmpCache(), now: () => now });
  try {
    const good = await s.getQuotes();
    assert.equal(good.stale, false);

    m.setFail(true);
    now += HOUR; // 跨小时后拉取失败
    const bad = await s.getQuotes();
    assert.equal(bad.stale, true, '失败回落必须标记 stale');
    assert.equal(bad.quotes.XAU.usdOz, good.quotes.XAU.usdOz, '应返回旧缓存的价格');
    assert.equal(bad.fx, good.fx, '应返回旧缓存的汇率');
    assert.equal(
      bad.quotes.XAU.cnyPerGram,
      good.quotes.XAU.cnyPerGram,
      '克重价也应沿用旧缓存'
    );

    // 失败结果被缓存：同小时后续请求直接读，不再反复尝试
    const callsAfterFail = m.calls();
    const again = await s.getQuotes();
    assert.equal(m.calls(), callsAfterFail);
    assert.equal(again.stale, true);
  } finally {
    m.restore();
  }
});
