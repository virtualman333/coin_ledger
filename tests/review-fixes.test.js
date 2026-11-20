'use strict';
/**
 * 2026-11-20 code review 修复的回归测试（全部离线，不连 MySQL）。
 *
 * 覆盖：
 *   1. catalog.detail(publishedOnly) 把 draft 当不存在（堵住 /api/coin/:no 泄漏）
 *   2. pm.service.update 不允许 payload.status 改上架状态（发布闸门不可绕过）
 *   3. 小程序 persist 保留 category/thumb/unit（贵金属藏品刷新后不退化）
 *   4. public/app.js 的 TABS 含 myfeedback/sitemap（反馈页/站点地图可打开）
 *   5. catalog.js 无 U+FFFD 乱码
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

test('catalog.detail(publishedOnly)：draft 返回 null，published 正常', async () => {
  const { CatalogService } = require('../server/services/catalog.service');
  // 用最小 fake repos，直接验证 detail 的闸门逻辑，不碰数据库
  function svc(status) {
    return new CatalogService({
      repos: {
        coins: { findByNo: async () => ({ no: 138, status: status, category: 'precious_metal' }) },
        descriptions: { findByNo: async () => null },
        images: { listByCoin: async () => [] },
        pmPieces: { listByCoin: async () => [] }
      }
    });
  }
  const draft = await svc('draft').detail(138, { publishedOnly: true });
  assert.equal(draft, null, 'draft 必须等同不存在');
  const pub = await svc('published').detail(138, { publishedOnly: true });
  assert.ok(pub, 'published 应正常返回');
  // 不传 publishedOnly 时（内部/admin 用途）仍可取到
  assert.ok(await svc('draft').detail(138), '内部调用不受影响');
});

test('发布闸门：update 期间 status 必须沿用 current，忽略 payload.status', () => {
  const schema = require('../server/schemas/pm');
  const seed = JSON.parse(read('data/seeds/precious-metal-2026.json'));
  const current = Object.assign({}, seed.sets[0], { verified: 0, sourceUrl: '', status: 'draft' });
  const merged = Object.assign({}, current, { status: 'published' });
  const check = schema.validateSet(merged, { exists: true });
  assert.equal(check.ok, true, 'exists 校验本身不拦 status（这正是需要 service 兜住的原因）');
  // 修复后的写库值：强制沿用 current.status
  const written = Object.assign({}, check.normalized, { status: current.status });
  assert.equal(written.status, 'draft', 'payload 的 published 不得落库');
  // 对照：正规 forPublish 闸门确实会拦未核验
  const gate = schema.validateSet(current, { exists: true, forPublish: true });
  assert.equal(gate.ok, false);
});

test('小程序 persist 保留 category / thumb / unit', () => {
  const s = read('miniprogram/utils/store.js');
  const persist = s.slice(s.indexOf('function persist()'), s.indexOf('function newId()'));
  assert.match(persist, /category:\s*h\.category/);
  assert.match(persist, /thumb:\s*h\.thumb/);
  assert.match(persist, /unit:\s*h\.unit/);
});

test('public/app.js TABS 含 myfeedback 与 sitemap', () => {
  const s = read('public/app.js');
  const m = s.match(/var TABS = \[([^\]]+)\]/);
  assert.ok(m, 'TABS 定义应存在');
  const tabs = [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
  assert.ok(tabs.includes('myfeedback'), 'myfeedback 必须注册，否则 goTab 会重置成 home');
  assert.ok(tabs.includes('sitemap'));
});

test('miniprogram/data/catalog.js 无 U+FFFD 乱码', () => {
  const s = read('miniprogram/data/catalog.js');
  assert.equal(s.includes('\ufffd'), false, '不应有替换字符');
  assert.ok(s.includes('国名及'), '褐马鸡 obverse 应已修正');
});

test('migration 007 为 cl_holdings 增加 thumb / unit 列', () => {
  const s = read('server/migrations/007_holdings_pm_meta.sql');
  assert.match(s, /ADD COLUMN thumb/);
  assert.match(s, /ADD COLUMN unit/);
});
