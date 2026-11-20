'use strict';
/**
 * 回归测试：首页首屏副文案压缩后，三个动态注入点必须仍然健在。
 * - data-copy="range"：app.js 注入年份区间
 * - id="coinTotalB"  ：app.js 与 SEO 快照注入品种数
 * - button.why[data-tip]：1984 起算说明气泡
 * 且压缩后正文明显变短——防止后续改动又把首屏堆成 4 行长文案。
 * 运行：node --test tests/hero-sub-copy.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'public/index.html'), 'utf8');
const seo = fs.readFileSync(path.join(ROOT, 'server/services/seo.js'), 'utf8');

// 取首屏正文 <p class="hh-sub">…</p>（非加载遮罩的 p.sub）
const m = html.match(/<p class="hh-sub">([\s\S]*?)<\/p>/);
assert.ok(m, '应能找到首页首屏副文案 p.hh-sub');
const sub = m[1];

// 去掉标签后的可见纯文本
const plain = sub.replace(/<[^>]+>/g, '').replace(/\s+/g, '').trim();

test('首屏副文案保留年份动态点 data-copy="range"', () => {
  assert.match(sub, /<span data-copy="range">1984—2026<\/span>/);
});

test('首屏副文案保留品种数动态点 id="coinTotalB"', () => {
  assert.match(sub, /<b id="coinTotalB">\d+<\/b>/);
});

test('首屏副文案保留起算说明气泡按钮 data-tip', () => {
  assert.match(sub, /<button class="why"[^>]*data-tip="[^"]+"[^>]*>i<\/button>/);
});

test('首屏副文案已压缩：可见正文不超过 70 字', () => {
  // 压缩前可见正文约 80 字（含「多用户、双主题、手机可用」等尾巴），压后约 53 字。
  assert.ok(plain.length <= 70, `副文案仍然过长（${plain.length} 字）：${plain}`);
});

test('SEO 快照的品种数注入正则仍能命中 coinTotalB', () => {
  const re = /id="coinTotalB">\d+(<)/g;
  assert.match(seo, /id="coinTotalB"/, 'SEO 服务应包含 coinTotalB 注入逻辑');
  assert.match(sub, re, '压缩后的文案仍应命中 SEO 注入正则');
});

test('app.js 的数据装配仍覆盖 range 与 total 两类动态点', () => {
  const app = fs.readFileSync(path.join(ROOT, 'public/app.js'), 'utf8');
  assert.match(app, /k === 'range'\) nodes\[i\]\.textContent = range/);
  assert.match(app, /k === 'total'\) nodes\[i\]\.textContent = total/);
});

test('版本号三端一致：package.json 与 index.html 静态资源 ?v=', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.match(html, new RegExp(`/app\\.css\\?v=${pkg.version.replace(/\./g, '\\.')}`));
  assert.match(html, new RegExp(`/app\\.js\\?v=${pkg.version.replace(/\./g, '\\.')}`));
});
