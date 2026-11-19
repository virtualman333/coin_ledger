'use strict';
/**
 * 发行计划字段规则（从 legacy/api-handler.js 的 validatePlan / normalizePlan 原样搬入）。
 *
 * 语义一字不改：
 *   1. validatePlan 返回**中文错误串**（'' 表示通过），不是抛异常；
 *   2. normalizePlan 把表单里被提交成字符串的数字字段收敛为 number，
 *      空字符串直接删键，`extra` 收敛为布尔，`schedule` 丢掉整行为空的项目；
 *   3. 项目 key 全局唯一（跨年度）。
 */
const common = require('./common');

/**
 * 校验整份计划。
 *
 * @param {object} plan 计划文档
 * @returns {string} 错误文案；'' 表示通过
 */
function validatePlan(plan) {
  if (!plan || typeof plan !== 'object') return '计划数据不合法';
  if (!Array.isArray(plan.years)) return '缺少 years 数组';
  const keys = new Set();
  for (const y of plan.years) {
    if (!y || !Number.isFinite(Number(y.year))) return '年度缺少合法 year';
    if (!Array.isArray(y.items)) return y.year + ' 年缺少 items 数组';
    for (const it of y.items) {
      if (!it || typeof it.key !== 'string' || !it.key.trim()) return '项目缺少 key';
      if (keys.has(it.key)) return '项目 key 重复：' + it.key;
      keys.add(it.key);
      if (!String(it.name || '').trim()) return '项目 ' + it.key + ' 缺少名称';
    }
  }
  return '';
}

/**
 * 表单数字字段收敛（原地修改并返回同一对象，与 legacy 一致）。
 *
 * @param {object} plan 计划文档
 * @returns {object} 收敛后的同一对象
 */
function normalizePlan(plan) {
  if (!plan || typeof plan !== 'object') return plan;
  const NUM = ['face', 'mintage', 'limit', 'coinNo', 'proxy'];
  (plan.years || []).forEach((y) => {
    if (!Array.isArray(y.items)) return;
    y.items.forEach((it) => {
      NUM.forEach((k) => {
        if (it[k] === '') delete it[k];
        else if (it[k] !== undefined && it[k] !== null) it[k] = Number(it[k]) || 0;
      });
      if (it.extra !== undefined) it.extra = it.extra === true || it.extra === 'true' || it.extra === 1;
      if (Array.isArray(it.schedule)) {
        it.schedule = it.schedule.filter((s) => s && (String(s.k || '').trim() || String(s.v || '').trim()));
      }
    });
  });
  return plan;
}

/**
 * 计划里是否混入了贵金属条目（P0-2：发行计划永不含 PM）。
 *
 * @param {object} plan 计划文档
 * @returns {string[]} 命中的项目 key
 */
function findPmItems(plan) {
  const hits = [];
  ((plan && plan.years) || []).forEach((y) => {
    ((y && y.items) || []).forEach((it) => {
      if (!it) return;
      const v = [it.key, it.name, it.seriesKey, it.category]
        .map((x) => String(x || '').toLowerCase()).join(' ');
      if (/\bpm\b|贵金属|precious[_ -]?metal/.test(v)) hits.push(String(it.key));
    });
  });
  return hits;
}

module.exports = {
  validatePlan: validatePlan,
  normalizePlan: normalizePlan,
  findPmItems: findPmItems,
  isPlainObject: common.isPlainObject
};
