'use strict';
/**
 * 品种描述仓储（JSON 只读实现）。
 * 与 MySQL 实现返回同样的 camelCase 行形状；键序无关紧要（投影时才排序）。
 */
const common = require('../schemas/common');
const source = require('./json-source');

/**
 * descriptions.json → 行列表。
 *
 * 原文的 date 形如「1984年」「2015年11月26日」，多数无法解析成完整 DATE，
 * 因此 published_on 只在能解析出 YYYY-MM-DD 时填，原始文本一律留在 date_text ——
 * 导出时优先用 date_text，保证 description.json 逐字还原。
 *
 * @returns {object[]} 行列表（按 coin_no 升序）
 */
function allRows() {
  const doc = source.descriptionsDoc() || {};
  return Object.keys(doc)
    .map(Number)
    .filter((n) => Number.isInteger(n) && n > 0)
    .sort((a, b) => a - b)
    .map((no) => {
      const d = doc[String(no)] || {};
      const dateText = d.date === undefined || d.date === null ? null : String(d.date);
      const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateText || '').trim());
      return {
        coinNo: no,
        title: d.title === undefined ? '' : String(d.title),
        url: d.url === undefined ? null : String(d.url),
        body: d.text === undefined ? '' : String(d.text),
        bodyMd: d.textMd === undefined ? null : String(d.textMd),
        publishedOn: m ? dateText : null,
        dateText: dateText,
        source: d.source === undefined ? null : String(d.source)
      };
    });
}

function create() {
  return {
    mode: 'json',

    async listAll() {
      return allRows();
    },

    async findByNo(no) {
      const n = Number(no);
      return allRows().filter((r) => r.coinNo === n)[0] || null;
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
