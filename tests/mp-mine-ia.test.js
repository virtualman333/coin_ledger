'use strict';
/**
 * 「我的」信息架构重做：
 *   - 主页只留三个入口（我的藏品 / 个人资料 / 更多功能），工具类收进「更多功能」
 *   - 新增个人资料页（头像 + 昵称），补上之前缺失的修改入口
 *
 * 运行：node --test tests/mp-mine-ia.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const MP = path.join(__dirname, '..', 'miniprogram');
const read = (p) => fs.readFileSync(path.join(MP, p), 'utf8');

test('「我的」只留三个入口，工具类不再堆在主页', () => {
  const wxml = read('pages/mine/mine.wxml');
  for (const fn of ['goHoldings', 'goProfile', 'goMoreTools']) {
    assert.ok(wxml.includes('bindtap="' + fn + '"'), '缺少入口：' + fn);
  }
  for (const gone of ['onBackup', 'goCount', 'goMyFeedback', 'goAbout', 'goAdmin', 'goPlaza']) {
    assert.ok(!wxml.includes(gone), '「' + gone + '」应已收进更多功能页');
  }
});

test('「我的」不再用整块渐变卡，主数字独立成区', () => {
  const wxml = read('pages/mine/mine.wxml');
  const wxss = read('pages/mine/mine.wxss');
  // 旧设计：.stat / .stat-main / .sm-big 的大渐变块
  assert.ok(!wxml.includes('class="stat"'), '旧的总览卡应已替换');
  assert.ok(!wxss.includes('.stat-main'), '旧样式的残留');
  assert.match(wxml, /class="hero"/, '主视觉块');
  assert.match(wxml, /class="rows"/, '入口行');
  assert.match(wxml, /class="row-thumbs"/, '藏品缩略图叠放');
  assert.match(wxml, /class="hp-seg/, '分段进度刻度');
  // 渐变只保留在小面积元素上（头像占位、按钮、进度条），不再是一整块
  assert.ok(!/background: linear-gradient\(135deg, #b98f43 0%/.test(wxss), '仍有大面积金色渐变');
});

test('「我的」的方法与模板对得上', () => {
  const wxml = read('pages/mine/mine.wxml');
  const js = read('pages/mine/mine.js');
  const handlers = new Set((wxml.match(/(?:bind|catch)tap="([A-Za-z_]\w*)"/g) || [])
    .map((m) => m.split('"')[1]));
  for (const h of handlers) {
    assert.ok(new RegExp('\n  ' + h + '\\(').test(js), '模板里的 ' + h + ' 在 JS 里没有定义');
  }
});

test('更多功能页：工具 / 反馈 / 管理分组齐全', () => {
  const wxml = read('pages/more-tools/more-tools.wxml');
  for (const fn of ['onBackup', 'goCount', 'goMyFeedback', 'goAbout']) {
    assert.ok(wxml.includes('bindtap="' + fn + '"'), '更多功能缺入口：' + fn);
  }
  // 管理端只对管理员显示
  const adminBlock = wxml.slice(wxml.indexOf('goAdmin') - 260, wxml.indexOf('goAdmin'));
  assert.match(adminBlock, /wx:if="\{\{isAdmin\}\}"/, '管理端入口应只对管理员显示');
});

test('收藏备份迁到更多功能页后逻辑完整', () => {
  const js = read('pages/more-tools/more-tools.js');
  assert.match(js, /store\.exportHoldings\(\)/, '缺导出');
  assert.match(js, /store\.parseImport\(/, '缺解析');
  assert.match(js, /store\.importHoldings\(parsed\.items, 'merge'\)/, '缺合并导入');
  assert.match(js, /chooseMessageFile/, '缺从聊天记录选文件');
});

test('个人资料页：头像 / 昵称 / 保存', () => {
  const wxml = read('pages/profile/profile.wxml');
  assert.match(wxml, /open-type="chooseAvatar"/, '头像要能选（微信头像能力）');
  assert.match(wxml, /bindchooseavatar="onChooseAvatar"/);
  assert.match(wxml, /type="nickname"/, '昵称输入应支持一键填微信昵称');
  assert.match(wxml, /bindtap="save"/);

  const js = read('pages/profile/profile.js');
  assert.match(js, /api\.post\('\/api\/me\/profile'/, '缺保存接口');
});

test('只改昵称时不能把头像清掉（接口里 avatar:"" 表示删除头像）', () => {
  const js = read('pages/profile/profile.js');
  // 必须只有拿到新头像数据时才把 avatar 放进 payload
  assert.match(js, /if \(avatarData\) payload\.avatar = avatarData/, '没换头像时也带了 avatar 字段，会把头像清空');
  assert.doesNotMatch(js, /avatar:\s*avatarData \|\| ''/, '不要用空串兜底，接口会当成清除头像');
});

test('两个新页面都已注册，且「我的」能跳过去', () => {
  const app = JSON.parse(read('app.json'));
  assert.ok(app.pages.includes('pages/profile/profile'));
  assert.ok(app.pages.includes('pages/more-tools/more-tools'));

  const js = read('pages/mine/mine.js');
  assert.match(js, /\/pages\/profile\/profile/);
  assert.match(js, /\/pages\/more-tools\/more-tools/);
});

test('账户与安全没丢：从个人资料页进', () => {
  const wxml = read('pages/profile/profile.wxml');
  assert.match(wxml, /bindtap="goAccount"/, '改密码/绑微信的入口不见了');
  const js = read('pages/profile/profile.js');
  assert.match(js, /\/pages\/account\/account/);
});

test('列表页走 baseline UI，主页面只允许既定暖色，都不用渐变', () => {
  // mine 是唯一的主视觉页，自成一套；profile / more-tools 是列表页，复用 baseline
  for (const slug of ['profile', 'more-tools']) {
    const wxss = read('pages/' + slug + '/' + slug + '.wxss');
    assert.match(wxss, /@import "\.\.\/\.\.\/styles\/ui\.wxss"/, slug + ' 没引入 baseline UI');
  }
  const mine = read('pages/mine/mine.wxss');
  // 渐变只允许出现在主 CTA 按钮上（与全站 .btn-primary 保持一致），其余地方不许
  const grads = (mine.match(/linear-gradient\([^)]*\)/g) || []);
  assert.equal(grads.length, 2, '渐变只该出现在两个主按钮上，实际：' + grads.length);
  assert.ok(grads.every((g) => g.includes('#b98f43')), '渐变必须是全站的品牌金');
  // 只允许涨跌这两个语义色，其余一律中性
  // 只允许全站既有 token：主/次/弱三级文字、纸白、浅金底、线色、品牌金、涨跌语义色
  const ALLOWED = ['#2b2926', '#6b6559', '#8a8378', '#8a6420',
    '#ffffff', '#f6efe0', '#f6f3ec', '#ece7dc', '#f2eee4', '#e6dfd0', '#faf8f3',
    '#b98f43', '#d9b364', '#9c5850', '#3f7050'];
  const colors = (mine.match(/#[0-9a-fA-F]{6}/g) || []).filter((c) => !ALLOWED.includes(c.toLowerCase()));
  assert.deepEqual([...new Set(colors)], [], '主页面出现了计划外的颜色');
});
