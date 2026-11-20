'use strict';
/**
 * 回归测试：发行计划「提醒我」只对可提醒的项目开放。
 * - 已发行（status !== 'upcoming'）不能提醒
 * - 待发行但预约已结束（cdCls === 'cd-end'）不能提醒
 * - 待发行但发行日已过不能提醒
 * - 待发行、预约未结束、发行日未过可以提醒
 * - remind(e) 二次校验：旧渲染残留的点击也被拦下
 * 运行：node --test tests/mp-plan-remind.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const MP = path.join(__dirname, '..', 'miniprogram');

function dayOffset(n) {
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  d.setDate(d.getDate() + n);
  return d;
}

function ymd(d) {
  return d.getFullYear() + '-' +
    String(d.getMonth() + 1).padStart(2, '0') + '-' +
    String(d.getDate()).padStart(2, '0');
}

// 带时刻的预约区间，结束日期写全年份以跨年不出错
function reserveRange(startOffset, endOffset) {
  return ymd(dayOffset(startOffset)) + ' 10:00 至 ' + ymd(dayOffset(endOffset)) + ' 10:00';
}

function loadPage() {
  const calls = { subscribe: 0, request: [], modals: 0 };
  global.wx = {
    getStorageSync: () => '',
    setStorageSync: () => {},
    removeStorageSync: () => {},
    request: (o) => { calls.request.push(o); },
    showToast: () => {},
    showModal: () => { calls.modals++; },
    navigateTo: () => {},
    requestSubscribeMessage: (o) => {
      calls.subscribe++;
      const res = {};
      (o && o.tmplIds || []).forEach((id) => { res[id] = 'accept'; });
      if (o && o.success) o.success(res);
    },
  };
  global.getCurrentPages = () => [{ route: 'pages/plan/plan' }];
  let captured = null;
  global.Page = (c) => { captured = c; };
  global.App = () => {};
  global.getApp = () => ({ globalData: {} });

  const file = path.join(MP, 'pages', 'plan', 'plan.js');
  delete require.cache[require.resolve(file)];
  require(file);

  const inst = Object.assign({}, captured);
  inst.data = JSON.parse(JSON.stringify(captured.data || {}));
  inst.setData = function (patch) {
    Object.keys(patch).forEach((k) => { this.data[k] = patch[k]; });
  };

  // 让 remind() 通过登录校验，便于观察是否真的走到订阅环节
  const store = require(path.join(MP, 'utils', 'store.js'));
  store.getState().user = { userId: 'test-user' };

  inst.data.plansFromApi = {
    plan: {
      years: [{
        year: 2026,
        items: [
          {
            key: 'issued', name: '已发行币', status: 'issued',
            date: ymd(dayOffset(-5)), reserve: reserveRange(-20, -19), mintage: 1000,
          },
          {
            key: 'reserve-ended', name: '预约已结束币', status: 'upcoming',
            date: ymd(dayOffset(10)), reserve: reserveRange(-10, -9), mintage: 1000,
          },
          {
            key: 'date-passed', name: '过了发行日币', status: 'upcoming',
            date: ymd(dayOffset(-3)), reserve: '', mintage: 1000,
          },
          {
            key: 'ok', name: '可提醒币', short: '可提醒', status: 'upcoming',
            date: ymd(dayOffset(7)), reserve: reserveRange(2, 3), mintage: 1000,
          },
        ],
      }],
    },
  };
  inst.build();
  return { p: inst, calls };
}

function rowOf(p, key) {
  return p.data.years.reduce((a, y) => a.concat(y.items), []).filter((x) => x.key === key)[0];
}

test('build(): 已发行项目不能提醒', () => {
  const { p } = loadPage();
  assert.equal(rowOf(p, 'issued').isUp, false);
  assert.equal(rowOf(p, 'issued').canRemind, false);
});

test('build(): 待发行但预约已结束（cd-end）不能提醒', () => {
  const { p } = loadPage();
  const row = rowOf(p, 'reserve-ended');
  assert.equal(row.isUp, true);
  assert.equal(row.cdCls, 'cd-end');
  assert.equal(row.canRemind, false);
});

test('build(): 待发行但发行日已过不能提醒', () => {
  const { p } = loadPage();
  const row = rowOf(p, 'date-passed');
  assert.equal(row.isUp, true);
  assert.ok(row.days < 0);
  assert.equal(row.canRemind, false);
});

test('build(): 待发行、预约未结束、发行日未过可以提醒', () => {
  const { p } = loadPage();
  const row = rowOf(p, 'ok');
  assert.equal(row.isUp, true);
  assert.notEqual(row.cdCls, 'cd-end');
  assert.ok(row.days >= 0);
  assert.equal(row.canRemind, true);
});

test('remind(): 对已发行/预约结束/发行日已过的旧点击直接 return', () => {
  const { p, calls } = loadPage();
  ['issued', 'reserve-ended', 'date-passed'].forEach((key) => {
    p.remind({ currentTarget: { dataset: { key, name: '测试币' } } });
  });
  assert.equal(calls.subscribe, 0, '不应触发订阅');
  assert.equal(calls.request.length, 0, '不应上报服务端');
  assert.equal(calls.modals, 0, '不应弹登录框');
});

test('remind(): 可提醒项目仍能正常走订阅流程', () => {
  const { p, calls } = loadPage();
  p.remind({ currentTarget: { dataset: { key: 'ok', name: '可提醒' } } });
  assert.equal(calls.subscribe, 1);
  assert.equal(calls.request.length, 1);
  assert.equal(calls.request[0].method, 'POST');
  assert.ok(String(calls.request[0].url).endsWith('/api/reminders'));
});
