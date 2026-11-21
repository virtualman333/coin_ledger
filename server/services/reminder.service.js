'use strict';
/**
 * 预约提醒域业务层（订阅消息）。
 *
 * 从 legacy/api-handler.js 的 3 个 /api/reminders 分支拆出。
 * 存储与定时器在 server/reminders.js，这里只做「当前用户 + 发行计划项目」的编排。
 */
const reminders = require('../reminders');
const catalogState = require('../state/catalog');
const { badRequest } = require('../core/http');

/**
 * 我的提醒列表 + 订阅模板信息。
 *
 * @param {object} me 当前用户
 * @returns {object} 响应体
 */
function list(me) {
  return {
    ok: true,
    templateId: reminders.TEMPLATE_ID,
    wxBound: !!me.wxOpenid,
    items: reminders.listOf(me.id),
  };
}

/**
 * 新增/更新一条发行预约提醒。
 *
 * @param {object} me 当前用户
 * @param {{key?: string, note?: string, platform?: string}} body 请求体
 * @returns {object} 响应体
 */
function create(me, body) {
  if (!me.wxOpenid) throw badRequest('订阅提醒需要微信登录后才能收到通知');

  const key = String(body.key || '').trim();
  const item = catalogState.findPlanItem(key);
  if (!item) throw badRequest('这个发行项目不存在');

  const r = reminders.upsert(me, item, { note: body.note, platform: body.platform });
  if (!r.ok) throw badRequest(r.error);
  return {
    ok: true,
    item: { id: r.item.id, key: r.item.key, name: r.item.name, remindAt: r.item.remindAt },
    remindText: reminders.timeText(new Date(r.item.remindAt)),
    items: reminders.listOf(me.id),
  };
}

/**
 * 取消一条提醒（按 id 或 key）。
 *
 * @param {object} me 当前用户
 * @param {{id?: string, key?: string}} body 请求体
 * @returns {object} 响应体
 */
function cancel(me, body) {
  const id = String(body.id || body.key || '').trim();
  if (!id) throw badRequest('缺少要取消的提醒');
  reminders.cancel(me.id, id);
  return { ok: true, items: reminders.listOf(me.id) };
}

module.exports = { list: list, create: create, cancel: cancel };
