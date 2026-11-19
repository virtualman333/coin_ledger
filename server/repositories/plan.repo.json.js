'use strict';
/**
 * 发行计划仓储（JSON 只读实现）。
 *
 * 键序与 plan.json 一致（updated, note, years，年度内 year→…→items），
 * 导出时直接 JSON.stringify 就能和原文件对上。
 */
const common = require('../schemas/common');
const source = require('./json-source');

function create() {
  return {
    mode: 'json',

    /**
     * 读整份计划。
     *
     * @returns {Promise<{updated:string, note:string, years:object[]}>} 计划文档
     */
    async get() {
      const doc = source.planDoc() || {};
      const years = Array.isArray(doc.years) ? doc.years : [];
      return {
        updated: doc.updated === undefined || doc.updated === null ? '' : String(doc.updated),
        note: doc.note === undefined || doc.note === null ? '' : String(doc.note),
        years: years.map((y) => Object.assign({}, y, { items: Array.isArray(y.items) ? y.items : [] }))
      };
    },

    async replace() {
      throw new common.ReadonlyError();
    }
  };
}

module.exports = { create: create };
