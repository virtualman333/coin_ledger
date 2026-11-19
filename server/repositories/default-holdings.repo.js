'use strict';
/**
 * 新账号初始藏品模板仓储（MySQL 实现）。
 *
 * coins.json 的 defaults（12 条）在 /api/bootstrap 里原样下发，
 * 也在 POST /api/holdings/reset 时变成新账本的初始 12 条。
 *
 * 注意 sep 的「存在性」：存量 12 条里只有 1 条带 sep:true，
 * 其余 11 条**没有这个键**（不是 false）。导出时必须按「有才输出」还原，
 * 否则 defaults 数组会多出 11 个 `"sep": false`，与基线 diff 就出来了。
 */
const COLUMNS = 'ord AS ord, name AS name, rolls AS rolls, cost AS cost, market AS market, grp AS grp, sep AS sep';

function create(pool) {
  if (!pool) throw new Error('default-holdings.repo(mysql) 需要连接池');

  return {
    mode: 'db',

    /**
     * 全部模板行（按 ord）。
     *
     * @returns {Promise<object[]>} 行列表
     */
    async listAll() {
      const [rows] = await pool.query('SELECT ' + COLUMNS + ' FROM cl_default_holdings ORDER BY ord');
      return rows;
    },

    /**
     * 写入或更新（迁移用）。
     *
     * @param {object} row camelCase 行
     * @returns {Promise<void>} 完成
     */
    async upsert(row) {
      await pool.query(
        `INSERT INTO cl_default_holdings (ord, name, rolls, cost, market, grp, sep)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE name = VALUES(name), rolls = VALUES(rolls), cost = VALUES(cost),
           market = VALUES(market), grp = VALUES(grp), sep = VALUES(sep)`,
        [Number(row.ord), String(row.name), Math.round(Number(row.rolls) || 0),
          Number(row.cost) || 0, Number(row.market) || 0,
          String(row.grp || '独立藏品'), row.sep ? 1 : 0]
      );
    }
  };
}

module.exports = { create: create, COLUMNS: COLUMNS };
