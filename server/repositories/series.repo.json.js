'use strict';
/**
 * 系列仓储（JSON 只读实现）。
 *
 * 注意字段名差异：series.json 用 `desc`，而 `desc` 是 SQL 保留字，
 * 库里列名是 `descr`。行形状统一成 descr，投影时再换回 desc ——
 * 这种「对外用 desc、对内用 descr」的转换只允许出现在 projection 一处。
 */
const common = require('../schemas/common');
const source = require('./json-source');

/**
 * series.json → 行列表（按 sort 升序，与 listWithCount 的排序一致）。
 *
 * @returns {object[]} 行列表
 */
function allRows() {
  const doc = source.seriesDoc() || {};
  const items = Array.isArray(doc.items) ? doc.items : [];
  return items
    .map((s) => ({
      seriesKey: String(s.key),
      name: String(s.name || ''),
      descr: s.desc === undefined ? '' : String(s.desc),
      img: s.img === undefined ? '' : String(s.img),
      imgFrom: s.imgFrom === undefined ? null : String(s.imgFrom),
      sort: Number(s.sort) || 0
    }))
    .sort((a, b) => (a.sort - b.sort) || a.seriesKey.localeCompare(b.seriesKey));
}

function create() {
  return {
    mode: 'json',

    async listAll() {
      return allRows();
    },

    async findByKey(key) {
      return allRows().filter((r) => r.seriesKey === String(key))[0] || null;
    },

    async upsert() {
      throw new common.ReadonlyError();
    },

    async remove() {
      throw new common.ReadonlyError();
    }
  };
}

module.exports = { create: create, allRows: allRows };
