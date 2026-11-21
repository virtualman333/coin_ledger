'use strict';
/**
 * 管理端「用户管理」信息完整度回归。
 *
 * 需求（2026-11-21）：用户管理列表要能直接看出头像、用户名（昵称）、账号名（登录名）；
 * 点进「查看藏品」也要显示这几样，并把能显示的账号信息都列出来，省得管理员来回切页。
 *
 * 断言落在源码上：管理页是 WXML/Vue 模板，跑不了单测，只能盯住关键字段与渲染分支。
 * 运行：npm test
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const MP = path.join(ROOT, 'miniprogram');
const readMp = (p) => fs.readFileSync(path.join(MP, p), 'utf8');
const readWeb = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

test('用户列表：有头像就显示真头像，没有才退回首字母', () => {
  const wxml = readMp('pages/admin-users/admin-users.wxml');
  assert.match(wxml, /<image[^>]*src="\{\{item\.avatarUrl\}\}"[^>]*wx:if="\{\{item\.avatarUrl\}\}"/,
    '缺头像图（应优先渲染 image，wx:else 才用首字母）');
  assert.match(wxml, /wx:else>\{\{item\.initial\}\}/, '缺首字母兜底');

  const js = readMp('pages/admin-users/admin-users.js');
  // 头像存的是站内相对路径，小程序必须拼接口域名，否则 <image> 静默空白
  assert.match(js, /indexOf\('http'\) === 0 \? u\.avatar : api\.BASE \+ u\.avatar/, '头像没有拼接口域名');
});

test('用户列表：用户名与账号名分两行，账号名带前缀不歧义', () => {
  const wxml = readMp('pages/admin-users/admin-users.wxml');
  assert.match(wxml, /\{\{item\.displayName\}\}/, '缺用户名（昵称）');
  assert.match(wxml, /账号 \{\{item\.accountName\}\}/, '缺账号名，或没写「账号」前缀');
  assert.match(wxml, /\{\{item\.metaText\}\}/, '缺藏品数 / 注册 / 最近登录那一行');

  const js = readMp('pages/admin-users/admin-users.js');
  assert.match(js, /displayName: display/, 'displayName 没取昵称优先');
  assert.match(js, /accountName: u\.name/, 'accountName 没取登录名');
  assert.match(js, /metaText:[\s\S]{0,160}条藏品[\s\S]{0,80}注册/, 'metaText 没带藏品数与注册时间');
  assert.match(js, /lastLoginText/, '没有最近登录');
});

test('用户列表：微信 / 管理员 / 测试 / 禁用 四种状态都能看出来', () => {
  const wxml = readMp('pages/admin-users/admin-users.wxml');
  assert.match(wxml, /badge wx[^>]*wx:if="\{\{item\.wx\}\}"/, '缺微信标记');
  assert.match(wxml, /badge admin[^>]*wx:if="\{\{item\.role === 'admin'\}\}"/, '缺管理员标记');
  assert.match(wxml, /badge test[^>]*wx:if="\{\{item\.isTest\}\}"/, '缺测试标记');
  assert.match(wxml, /badge off[^>]*wx:if="\{\{item\.disabled\}\}"/, '缺禁用标记');
});

test('查看藏品页：头部有头像、用户名、账号名与徽标', () => {
  const wxml = readMp('pages/admin-user/admin-user.wxml');
  assert.match(wxml, /src="\{\{avatarUrl\}\}"[^>]*wx:if="\{\{avatarUrl\}\}"/, '查看藏品页缺真头像');
  assert.match(wxml, /\{\{userName\}\}/, '缺用户名');
  assert.match(wxml, /账号 \{\{accountName\}\}/, '缺账号名');
  assert.match(wxml, /ubadge adm[\s\S]{0,80}isAdmin/, '缺管理员徽标');
  assert.match(wxml, /ubadge (test|off|wx)/, '缺状态徽标');

  const js = readMp('pages/admin-user/admin-user.js');
  assert.match(js, /avatarUrl/, '没算头像地址');
  assert.match(js, /api\.BASE \+ user\.avatar/, '头像没拼接口域名');
  assert.match(js, /accountName: user\.name/, '没带账号名');
});

test('查看藏品页：账号信息卡把 ID / 登录方式 / 改名 / 注册 / 最近登录 都列出来', () => {
  const wxml = readMp('pages/admin-user/admin-user.wxml');
  for (const label of ['用户 ID', '登录方式', '改过名', '注册时间', '最近登录']) {
    assert.ok(wxml.includes(label), '账号信息卡缺「' + label + '」');
  }
  const js = readMp('pages/admin-user/admin-user.js');
  assert.match(js, /const \{ dayText \} = require\('\.\.\/\.\.\/utils\/datetime'\)/, '日期没走统一格式化');
  assert.match(js, /loginText/, '没算登录方式');
  assert.match(js, /nameChangedText/, '没算改名状态');
});

test('后台用户页：列表与详情都以「头像 + 用户名 + 账号名」为主视觉', () => {
  const vue = readWeb('admin/src/pages/Users.vue');
  assert.match(vue, /<el-avatar[^>]*:src="row\.avatar/, '列表缺头像');
  assert.match(vue, /<b>\{\{ row\.nickname \|\| row\.name \}\}<\/b>/, '列表主标题应是用户名（昵称）');
  assert.match(vue, /账号 \{\{ row\.name \}\}/, '列表缺账号名');

  assert.match(vue, /<el-avatar[^>]*:src="detail\.avatar/, '详情缺头像');
  assert.match(vue, /账号 \{\{ detail\.name \|\| '—' \}\}/, '详情缺账号名');
  for (const label of ['用户名（昵称）', '微信绑定', '改名', '藏品条数', '测试账号']) {
    assert.ok(vue.includes(label), '详情缺「' + label + '」');
  }
});
