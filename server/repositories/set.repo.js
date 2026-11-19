'use strict';
/**
 * 套系仓储（MySQL 实现）。
 *
 * 普通币套系（21 条）：一卷/一刀多少枚、全套多少枚、已收录多少 ——
 * 前端「套系进度」直接读它。贵金属套装**不复用**本表，
 * 它的套内结构在 cl_pm_pieces（一「套」一行，逐枚明细在子表）。
 */
const SET_COLUMNS = 'set_code AS setCode, name AS name, unit AS unit, total AS total, '
  + 'members AS members, size AS size, kind AS kind';

function create(pool) {
  if (!pool) throw new Error('set.repo(mysql) 需要连接池');

  return {
    mode: 'db',

    /**
     * 全部套系。
     *
     * @returns {Promise<object[]>} 行列表
     */
    async listAll() {
      const [rows] = await pool.query('SELECT ' + SET_COLUMNS + ' FROM cl_sets ORDER BY set_code');
      return rows;
    },

    /**
     * 单个套系。
     *
     * @param {string} code 套系 key
     * @returns {Promise<object|null>} 行或 null
     */
    async findByCode(code) {
      const [rows] = await pool.query('SELECT ' + SET_COLUMNS + ' FROM cl_sets WHERE set_code = ? LIMIT 1', [String(code)]);
      return rows.length ? rows[0] : null;
    },

    /**
     * 写入或更新（迁移用）。
     *
     * @param {object} row camelCase 行
     * @returns {Promise<void>} 完成
     */
    async upsert(row) {
      await pool.query(
        `INSERT INTO cl_sets (set_code, name, unit, total, members, size, kind)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE name = VALUES(name), unit = VALUES(unit), total = VALUES(total),
           members = VALUES(members), size = VALUES(size), kind = VALUES(kind)`,
        [row.setCode, row.name, row.unit || '枚', Number(row.total) || 0,
          Number(row.members) || 0, row.size === null || row.size === undefined ? null : Number(row.size),
          row.kind || null]
      );
    }
  };
}

module.exports = { create: create, SET_COLUMNS: SET_COLUMNS };
