'use strict';
/**
 * 反馈域业务层：功能建议（feature）、纠错反馈（feedback）、管理端处理。
 *
 * 从 legacy/api-handler.js 的 6 个分支拆出。存储仍是独立的 data/feedback.json
 * （server/feedback.js），不碰用户的整份文档 —— 这条边界保持不变。
 *
 * 共同规则：文案长度、每日条数上限、UGC 内容安全检测（微信审核硬性要求）。
 */
const feedback = require('../feedback');
const wxsec = require('../wxsec');
const audit = require('../audit');
const catalogState = require('../state/catalog');
const { badRequest, httpError } = require('../core/http');

/** 功能建议每天最多 3 条；纠错反馈每天最多 10 条 */
const FEATURE_DAILY_LIMIT = 3;
const FEEDBACK_DAILY_LIMIT = 10;

/**
 * 提交功能建议（更多功能页）。
 *
 * @param {object} me 当前用户
 * @param {{text?: string}} body 请求体
 * @returns {Promise<object>} 响应体
 */
async function submitFeature(me, body) {
  if (me.isTest) throw httpError(403, '这个入口对测试账号不开放');

  const text = String(body.text || '').trim();
  if (text.length < 4) throw badRequest('多写几个字，我们才知道你想要的');
  if (text.length > 400) throw badRequest('最多 400 字');

  const mine = feedback.list('all').filter((x) => x.uid === me.id && x.kind === 'feature');
  const today = new Date().toISOString().slice(0, 10);
  if (mine.filter((x) => String(x.createdAt).slice(0, 10) === today).length >= FEATURE_DAILY_LIMIT) {
    throw httpError(429, '今天已经提了 3 条，明天再来');
  }

  const chk = await wxsec.checkText(text, me.wxOpenid || '');
  if (!chk.ok) throw badRequest('内容里有不适合发布的信息，请修改后再提交');

  const rec = feedback.add({
    kind: 'feature', uid: me.id, userName: me.name,
    nickname: me.nickname || '', avatar: me.avatar ? '/avatar/' + me.avatar : '',
    text,
  });
  console.log('[feature] ' + me.name + ' 提需求：' + text.slice(0, 40));
  return { ok: true, id: rec.id };
}

/**
 * 我提过的反馈与管理员回复。
 *
 * @param {object} me 当前用户
 * @returns {object} 响应体
 */
function mine(me) {
  const items = feedback.listByUser(me.id);
  return { ok: true, items, open: items.filter((x) => x.status === 'open').length };
}

/**
 * 提交纠错反馈（可带最多 3 张图）。
 *
 * @param {object} me 当前用户
 * @param {object} body 请求体
 * @returns {Promise<object>} 响应体
 */
async function submitCorrection(me, body) {
  const text = String(body.text || '').trim();
  if (text.length < 4) throw badRequest('请把问题写清楚一点（至少 4 个字）');
  if (text.length > 800) throw badRequest('反馈内容最多 800 字');
  if (feedback.todayCount(me.id) >= FEEDBACK_DAILY_LIMIT) {
    throw httpError(429, '今天提交得有点多，明天再来吧');
  }

  // UGC 必须过内容安全检测（微信审核硬性要求）
  const textCheck = await wxsec.checkText(text, me.wxOpenid || '');
  if (!textCheck.ok) {
    console.log('[feedback] 文本未通过内容安全 uid=' + me.id + ' reason=' + textCheck.reason);
    throw badRequest('内容里有不适合发布的信息，请修改后再提交');
  }

  const coinId = Number(body.coinId) || 0;
  const coin = catalogState.state().seed.coins.filter((c) => Number(c.i) + 1 === coinId)[0];
  const rawImgs = Array.isArray(body.images) ? body.images.slice(0, 3) : [];
  const bufs = rawImgs.map((dataUrl) => feedback.decodeImage(dataUrl)).filter(Boolean);
  const images = [];
  for (const buf of bufs) {
    const imgCheck = await wxsec.checkImage(buf);
    if (!imgCheck.ok) {
      console.log('[feedback] 图片未通过内容安全 uid=' + me.id + ' reason=' + imgCheck.reason);
      throw badRequest('图片里有不适合发布的内容，请换一张');
    }
    const name = feedback.saveBuffer(buf);
    if (name) images.push(name);
  }

  const saved = feedback.add({
    uid: me.id,
    userName: me.name,
    nickname: me.nickname || '',
    avatar: me.avatar ? '/avatar/' + me.avatar : '',
    coinId,
    coinName: coin ? coin.name : '',
    text,
    images
  });
  console.log('[feedback] ' + me.name + ' → #' + coinId + ' ' + text.slice(0, 30));
  return { ok: true, id: saved.id };
}

/**
 * 管理端反馈列表（可按状态筛选）。
 *
 * @param {object} query 已解析的查询参数
 * @returns {object} 响应体
 */
function adminList(query) {
  const items = feedback.list(query.status || 'all');
  const open = feedback.list('open').length;
  return { ok: true, items, open };
}

/**
 * 管理端处理反馈：标记完成 / 重新打开 / 回复。
 *
 * @param {object} me 当前管理员
 * @param {string} id 反馈 ID
 * @param {object} body 请求体
 * @param {string} ip 客户端 IP
 * @returns {object} 响应体
 */
function adminPatch(me, id, body, ip) {
  const hit = feedback.update(id, body);
  if (!hit) throw httpError(404, '反馈不存在');
  audit.log(me.name, 'feedback.' + (body.status === 'done' ? 'done' : 'reopen'), id, '', ip);
  return { ok: true, item: hit };
}

/**
 * 管理端删除反馈。
 *
 * @param {object} me 当前管理员
 * @param {string} id 反馈 ID
 * @param {string} ip 客户端 IP
 * @returns {object} 响应体
 */
function adminRemove(me, id, ip) {
  const hit = feedback.remove(id);
  if (!hit) throw httpError(404, '反馈不存在');
  audit.log(me.name, 'feedback.delete', id, '', ip);
  return { ok: true };
}

module.exports = {
  submitFeature: submitFeature,
  mine: mine,
  submitCorrection: submitCorrection,
  adminList: adminList,
  adminPatch: adminPatch,
  adminRemove: adminRemove
};
