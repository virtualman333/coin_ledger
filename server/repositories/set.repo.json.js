'use strict';
/**
 * 套系仓储（JSON 只读实现）。
 * 数据来自 coins.json 的 sets 对象（21 条，键序无关）。
 */
const common = require('../schemas/common');
const source = require('./json-source');

/**
 * coins.json 的 sets → 行列表。
 *
 * @returns {object[]} 行列表
 */
function allRows() {
  const doc = source.coinsDoc() || {};
  const sets = doc.sets && typeof doc.sets === 'object' ? doc.sets : {};
  return Object.keys(sets).sort().map((code) => {
    const s = sets[code] || {};
    return {
      setCode: code,
      name: String(s.name || ''),
      unit: s.unit === undefined ? '枚' : String(s.unit),
      total: Number(s.total) || 0,
      members: Number(s.members) || 0,
      size: s.size === undefined ? null : Number(s.size),
      kind: s.kind === undefined ? null : String(s.kind)
    };
  });
}

function create() {
  return {
    mode: 'json',

    async listAll() {
      return allRows();
    },

    async findByCode(code) {
      return allRows().filter((r) => r.setCode === String(code))[0] || null;
    },

    /**
     * coins.json 的 sets 映射（21 个套系），保持原键序。
     *
     * @returns {object} 原始 sets 对象
     */
    async legacyMapRaw() {
      const doc = source.coinsDoc() || {};
      return doc.sets && typeof doc.sets === 'object' ? doc.sets : {};
    },

    async upsert() {
      throw new common.ReadonlyError();
    }
  };
}

module.exports = { create: create, allRows: allRows };
