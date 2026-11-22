'use strict';
/**
 * 访客域业务层：匿名埋点写入 + 管理端统计/明细。
 *
 * 从 legacy/api-handler.js 的 4 个分支拆出。存储是独立的 data/visits.json
 * （server/visitors.js），与原实现一致：不存 IP 原文之外的任何身份信息，
 * 且同一会话 30 秒内同一 tab 只记一次。
 */
const store = require('../store');
const auth = require('../auth');
const visitors = require('../visitors');
const { badRequest } = require('../core/http');

/** 允许的客户端类型与时间范围（防注入，同时收敛前端拼错的值） */
const CLIENTS = ['web', 'mp'];
const RANGES = ['today', 'week', 'month', 'year', 'all'];

/**
 * 记录一次访问。
 *
 * 兼容旧版前端（不带 body）：总数照记，明细只在带合法会话 ID 时写。
 *
 * @param {import('http').IncomingMessage} rawReq 原始请求
 * @param {object} vbody 请求体（解析失败时传 {}）
 * @returns {Promise<object>} 响应体
 */
async function record(rawReq, vbody) {
  const d = store.load();
  const today = new Date().toISOString().slice(0, 10);
  const sid = String(vbody.sid || '').slice(0, 40);
  const vtab = String(vbody.tab || 'home').slice(0, 24);
  const vclient = vbody.client === 'mp' ? 'mp' : 'web';

  if (/^[A-Za-z0-9_-]{8,40}$/.test(sid) && !visitors.recentlySeen(sid, vtab, 30, vclient)) {
    const vme = auth.currentUser(rawReq, d);
    const xff = String(rawReq.headers['x-forwarded-for'] || '').split(',')[0].trim();
    visitors.add({
      sid,
      tab: vtab,
      client: vclient,
      path: String(vbody.path || '').slice(0, 160),
      ip: String(rawReq.headers['x-real-ip'] || xff || rawReq.socket.remoteAddress || '').slice(0, 64),
      ua: String(rawReq.headers['user-agent'] || '').slice(0, 240),
      uid: vme ? vme.id : '',
      userName: vme ? vme.name : '',
      nickName: vme ? (vme.nickname || '') : '',
    });
  }

  const total = await store.commit((draft) => {
    if (!draft.visits) draft.visits = { total: 0, days: {} };
    if (!draft.visits.days) draft.visits.days = {};
    draft.visits.total = (draft.visits.total || 0) + 1;
    draft.visits.days[today] = (draft.visits.days[today] || 0) + 1;
    return draft.visits.total;
  });
  return { ok: true, total, today: store.load().visits.days[today] || 1 };
}

/**
 * 访问总量（公开只读，页脚展示用）。
 *
 * @returns {object} 响应体
 */
function totals() {
  const v = store.load().visits || { total: 0, days: {} };
  const today = new Date().toISOString().slice(0, 10);
  return { ok: true, total: v.total || 0, today: (v.days && v.days[today]) || 0 };
}

/**
 * 管理端访客统计（按客户端与时间范围过滤）。
 *
 * @param {object} query 已解析的查询参数
 * @returns {object} 响应体
 */
function adminStats(query) {
  const client = CLIENTS.indexOf(String(query.client || '')) >= 0 ? String(query.client) : 'all';
  const range = RANGES.indexOf(String(query.range || '')) >= 0 ? String(query.range) : 'all';
  const items = visitors.load().items;
  const res = visitors.stats(items, { client, range });
  // 埋点只记 uid / 用户名，头像与昵称要回用户表补：列表、IP 聚合、用户聚合三处都要
  attachProfile(store.load().users, res.sessions, res.ipGroups, res.userGroups);
  return Object.assign({ ok: true }, res);
}

/**
 * 用用户表补齐头像与昵称。
 *
 * 站内头像存的是文件名，拼 /avatar/ 前缀；没传过站内头像的用华为外链兜底。
 *
 * @param {Array<object>} users 用户表
 * @param {...Array<object>} lists 需要补字段的聚合数组
 * @returns {void}
 */
function attachProfile(users, ...lists) {
  const byId = {};
  (users || []).forEach((u) => { byId[u.id] = u; });
  lists.forEach((list) => (list || []).forEach((g) => {
    if (!g || !g.uid) return;
    const u = byId[g.uid];
    if (!u) return;
    if (!g.avatar) g.avatar = u.avatar ? '/avatar/' + u.avatar : (u.hwAvatar || '');
    if (!g.nickName) g.nickName = u.nickname || '';
    if (!g.name) g.name = u.name || '';
  }));
}

/**
 * 管理端访客明细：按 IP 或会话 ID 查某段时间内的访问流水。
 *
 * 埋点从 3.0.85 才记昵称，老记录只有用户名 —— 这里用用户表按 uid 补一层，
 * 否则管理端会一直看到「只有用户名、没有昵称」的旧数据。
 *
 * @param {object} query 已解析的查询参数
 * @returns {object} 响应体
 */
function adminDetail(query) {
  const d = store.load();
  const ip = String(query.ip || '').slice(0, 80);
  const sid = String(query.sid || '').slice(0, 40);
  const uid = String(query.uid || '').slice(0, 16);
  const range = RANGES.indexOf(String(query.range || '')) >= 0 ? String(query.range) : 'all';
  if (!ip && !sid && !uid) throw badRequest('缺少 ip / sid / uid');

  const scoped = visitors.filterByRange(visitors.load().items, range);
  const detail = visitors.detail(scoped, { ip, sid, uid });

  const byId = {};
  (d.users || []).forEach((u) => { byId[u.id] = u; });
  (detail.rows || []).forEach((row) => {
    const u = byId[row.uid];
    if (u) {
      if (!row.nickName) row.nickName = u.nickname || '';
      if (!row.name) row.name = u.name || '';
    }
  });
  return Object.assign({ ok: true }, detail);
}

module.exports = {
  record: record,
  totals: totals,
  adminStats: adminStats,
  adminDetail: adminDetail
};
