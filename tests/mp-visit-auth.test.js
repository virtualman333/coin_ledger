'use strict';
/**
 * 回归测试：小程序访客上报必须带登录态。
 * 背景：/api/visit 用 auth.currentUser(req) 解析用户，裸 wx.request 不带
 * Authorization 时 uid/userName 永远为空，管理端「访客」列只能显示「访客」。
 * 运行：npm test
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const MP = path.join(__dirname, '..', 'miniprogram');

function loadVisit(mem, calls) {
  global.wx = {
    getStorageSync: (k) => (k in mem ? mem[k] : ''),
    setStorageSync: (k, v) => { mem[k] = v; },
    removeStorageSync: (k) => { delete mem[k]; },
    request: (o) => calls.push(o),
  };
  const file = path.join(MP, 'utils', 'visit.js');
  delete require.cache[require.resolve(file)];
  return require(file);
}

test('已登录时上报带 Authorization: Bearer', () => {
  const mem = { cl_token: 'tok123' };
  const calls = [];
  const visit = loadVisit(mem, calls);
  visit.track('pages/index/index');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].header.Authorization, 'Bearer tok123');
  assert.equal(calls[0].data.client, 'mp');
  assert.equal(calls[0].data.tab, 'home');
});

test('未登录时不上 Authorization 头，但仍上报', () => {
  const mem = {};
  const calls = [];
  const visit = loadVisit(mem, calls);
  visit.track('pages/list/list');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].header.Authorization, undefined);
  assert.equal(calls[0].data.client, 'mp');
});
