'use strict';
/**
 * 系列字段规则（与 server/series.js 的 create/update 逐字同口径）。
 *
 * 关键：key 只允许 1–12 位字母、数字或下划线；名称非空且截断到 24 字；
 * 简介截断到 120 字；sort 缺省取 (现有条数+1)*10。
 * 这些文案会被管理端原样展示，不能改。
 */

const KEY_RE = /^[A-Za-z0-9_]{1,12}$/;

/**
 * 校验系列 key。
 *
 * @param {unknown} key 原始 key
 * @returns {string} 错误文案；'' 表示合法
 */
function validateKey(key) {
  const k = String(key === undefined || key === null ? '' : key).trim();
  if (!KEY_RE.test(k)) return 'key 只能 1–12 位字母、数字或下划线';
  return '';
}

/**
 * 校验系列名称。
 *
 * @param {unknown} name 原始名称
 * @returns {string} 错误文案；'' 表示合法
 */
function validateName(name) {
  const n = String(name === undefined || name === null ? '' : name).trim();
  if (!n) return '系列名不能为空';
  return '';
}

/**
 * 新建系列的字段收敛（文案与 legacy seriesSvc.create 一致）。
 *
 * @param {object} fields 表单字段
 * @param {number} nextCount 当前系列数 + 1（用于缺省 sort）
 * @returns {{ok:boolean,error?:string,item?:object}} 结果
 */
function buildNew(fields, nextCount) {
  const f = fields && typeof fields === 'object' ? fields : {};
  const key = String(f.key || '').trim();
  const keyError = validateKey(key);
  if (keyError) return { ok: false, error: keyError };
  const name = String(f.name || '').trim();
  const nameError = validateName(name);
  if (nameError) return { ok: false, error: nameError };
  return {
    ok: true,
    item: {
      key: key,
      name: name.slice(0, 24),
      desc: String(f.desc || '').slice(0, 120),
      img: String(f.img || ''),
      sort: Number(f.sort) || (Number(nextCount) + 1) * 10
    }
  };
}

/**
 * 编辑系列的字段收敛（未出现的键保持不变）。
 *
 * @param {object} item 原系列（会被原地修改，与 legacy 一致）
 * @param {object} fields 表单字段
 * @returns {void}
 */
function applyUpdate(item, fields) {
  const f = fields && typeof fields === 'object' ? fields : {};
  if (typeof f.name === 'string' && f.name.trim()) item.name = f.name.trim().slice(0, 24);
  if (typeof f.desc === 'string') item.desc = f.desc.slice(0, 120);
  if (typeof f.img === 'string') item.img = f.img;
  if (f.sort !== undefined && Number.isFinite(Number(f.sort))) item.sort = Number(f.sort);
}

module.exports = { KEY_RE: KEY_RE, validateKey: validateKey, validateName: validateName, buildNew: buildNew, applyUpdate: applyUpdate };
