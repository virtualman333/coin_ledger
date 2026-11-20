'use strict';
/**
 * 贵金属行情与克重价 单元测试。
 * 纯逻辑，mock 全局 fetch，不连外网、不启服务。
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const svc = require('../server/services/metal-price.service');

const PRICES = { XAU: 3582.15, XAG: 42.405, XPT: 1000, XPD: 1000 };
const FX = 6.6667;

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
  return svc.create().getQuotes().then((snap) => {
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
  const s = svc.create();
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
  const s = svc.create();
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
  const s = svc.create();
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
  return svc.create().getQuotes().then((snap) => {
    global.fetch = orig;
    assert.equal(snap.stale, true);
    assert.ok(snap.quotes.XAU.usdOz > 0);
    assert.ok(snap.quotes.XAU.cnyPerGram > 0);
    assert.equal(snap.quotes.XAU.fallback, true);
  }).catch((e) => { global.fetch = orig; throw e; });
});
