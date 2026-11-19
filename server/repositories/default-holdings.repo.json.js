'use strict';
/**
 * 新账号初始藏品模板仓储（JSON 只读实现）。
 * 数据来自 coins.json 的 defaults（12 条）。
 */
const common = require('../schemas/common');
const source = require('./json-source');

/**
 * defaults → 行列表。
 *
 * @returns {object[]} 行列表
 */
function allRows() {
  const doc = source.coinsDoc() || {};
  const list = Array.isArray(doc.defaults) ? doc.defaults : [];
  return list.map((x, i) => ({
    ord: i,
    name: String(x.name || ''),
    rolls: Number(x.rolls) || 0,
    cost: Number(x.cost) || 0,
    market: Number(x.market) || 0,
    grp: x.group === undefined ? '独立藏品' : String(x.group),
    sep: x.sep ? 1 : 0,
    // 保留「原对象里到底有没有 sep 这个键」，导出时才能逐字还原
    hadSepKey: Object.prototype.hasOwnProperty.call(x, 'sep')
  }));
}

function create() {
  return {
    mode: 'json',

    async listAll() {
      return allRows();
    },

    async upsert() {
      throw new common.ReadonlyError();
    }
  };
}

module.exports = { create: create, allRows: allRows };
