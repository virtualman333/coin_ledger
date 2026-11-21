'use strict';
/**
 * 页脚合规：备案号必须在、个人联系方式不能回流。
 *
 * 备案号是硬要求（工信部规定经营性/非经营性网站都要在首页底部公示并链接到备案系统）；
 * 个人微信号这类信息不该挂在公域页脚，需要联系时走法律条款页或站内反馈。
 *
 * 运行：node --test tests/legal-footer.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, 'public', p), 'utf8');

const ICP = '鲁ICP备2020034737号';

function footer() {
  const s = read('index.html');
  const a = s.indexOf('<footer>');
  const b = s.indexOf('</footer>');
  assert.ok(a > 0 && b > a, '找不到 footer');
  return s.slice(a, b);
}

test('页脚公示备案号，并链接到工信部备案系统', () => {
  const f = footer();
  assert.ok(f.includes(ICP), '页脚缺少备案号 ' + ICP);
  const link = f.match(/<a[^>]*href="https:\/\/beian\.miit\.gov\.cn\/?"[^>]*>[^<]*<\/a>/);
  assert.ok(link, '备案号应是可点击链接');
  assert.ok(link[0].includes(ICP), '链接文字应为备案号');
  assert.match(link[0], /target="_blank"/);
  assert.match(link[0], /rel="noopener"/);
});

test('页脚不再出现个人联系方式', () => {
  const f = footer();
  assert.ok(!f.includes('virtualman2001'), '页脚还有微信号');
  assert.ok(!/联系我/.test(f), '页脚还有「联系我」块');
  assert.ok(!/1[3-9]\d{9}/.test(f), '页脚有手机号');
  assert.ok(!/mailto:/.test(f), '页脚不应直接挂邮箱');
});

test('法律条款页同步备案号，联系方式收敛为邮件 + 站内反馈', () => {
  const s = read('legal.html');
  assert.ok(s.includes(ICP), '法律条款页缺备案号');
  assert.ok(!s.includes('virtualman2001'), '法律条款页还有微信号');
  assert.ok(s.includes('admin@virtualman.top'), '至少要留一个可用的书面联系方式');
  assert.match(s, /站内反馈/, '应引导到站内反馈');
});

test('首页全文不再出现个人微信号', () => {
  const s = read('index.html');
  assert.ok(!s.includes('virtualman2001'), 'index.html 里还有个人微信号');
  // app.js 里也不该再留着复制微信号的逻辑
  const js = read('app.js');
  assert.ok(!js.includes('virtualman2001'), 'app.js 里还有微信号');
  assert.ok(!/#wxId|getElementById\('wxId'\)/.test(js), 'app.js 还绑着已删除的微信号节点');
});
