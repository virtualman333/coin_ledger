'use strict';
/**
 * 小程序页面访问上报（供管理端「访客」面板统计来源与页面留存）。
 * 会话 ID 存在本地持久缓存里，跨天不变，这样才算得出次日回访。
 */
const api = require('./api');

const SID_KEY = 'cl_visit_sid';
const LAST_PREFIX = 'cl_visit_last_';

const TAB_ALIAS = {
  'pages/index/index': 'home',
  'pages/list/list': 'all',
  'pages/plan/plan': 'plan',
  'pages/series/series': 'series',
  'pages/holdings/holdings': 'holdings',
  'pages/mine/mine': 'mine',
  'pages/detail/detail': 'detail',
  'pages/account/account': 'account',
  'pages/about/about': 'about',
  'pages/more/more': 'more',
  'pages/feedback/feedback': 'feedback',
  'pages/privacy/privacy': 'privacy',
};

function sid() {
  let v = '';
  try { v = wx.getStorageSync(SID_KEY) || ''; } catch (e) { /* 隐私模式 */ }
  if (!/^[A-Za-z0-9_-]{8,40}$/.test(v)) {
    v = 'm' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
    try { wx.setStorageSync(SID_KEY, v); } catch (e) {}
  }
  return v;
}

function tabOf(route) {
  if (TAB_ALIAS[route]) return TAB_ALIAS[route];
  const parts = String(route || '').split('/');
  return (parts[parts.length - 1] || 'home').slice(0, 24);
}

function track(route) {
  try {
    const tab = tabOf(route);
    // 管理端页面与后台操作不算普通访客行为
    if (tab === 'admin' || tab === 'admin-user') return;
    const key = LAST_PREFIX + tab;
    const now = Date.now();
    let last = 0;
    try { last = Number(wx.getStorageSync(key)) || 0; } catch (e) {}
    if (now - last < 30000) return;           // 同页面 30 秒内不重复
    try { wx.setStorageSync(key, now); } catch (e) {}

    wx.request({
      url: api.BASE + '/api/visit',
      method: 'POST',
      header: { 'content-type': 'application/json' },
      data: { sid: sid(), tab, path: route, client: 'mp' },
      fail() {},
    });
  } catch (e) { /* 埋点失败绝不影响页面 */ }
}

module.exports = { track, tabOf, sid };
