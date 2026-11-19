'use strict';
/**
 * 品种描述仓储（MySQL 实现）。
 *
 * 数据源是原 descriptions.json（128 条）。缺 9 条（19/26/38/59/86/87/101/130/136）
 * 是**正常**的：这些品种当年没有可收录的公告原文。迁移不补空行，导出也不补，
 * 否则 /api/bootstrap 的 desc 对象会多出 9 个空条目，前端「央行发行公告」区块
 * 会从「不渲染」变成「渲染一个空标题」。
 */
const DESCRIPTION_COLUMNS = 'coin_no AS coinNo, title AS title, url AS url, body AS body, '
  + 'body_md AS bodyMd, published_on AS publishedOn, date_text AS dateText, source AS source';

function create(pool) {
  if (!pool) throw new Error('description.repo(mysql) 需要连接池');

  return {
    mode: 'db',

    /**
     * 全部描述。
     *
     * @returns {Promise<object[]>} 行列表（按 coin_no 升序）
     */
    async listAll() {
      const [rows] = await pool.query('SELECT ' + DESCRIPTION_COLUMNS + ' FROM cl_coin_descriptions ORDER BY coin_no');
      return rows;
    },

    /**
     * 单个品种的描述。
     *
     * @param {number} no 品种编号
     * @returns {Promise<object|null>} 行或 null
     */
    async findByNo(no) {
      const [rows] = await pool.query('SELECT ' + DESCRIPTION_COLUMNS + ' FROM cl_coin_descriptions WHERE coin_no = ? LIMIT 1', [Number(no)]);
      return rows.length ? rows[0] : null;
    },

    /**
     * 写入/更新一条（迁移与未来的 admin 编辑共用）。
     *
     * @param {object} row camelCase 行
     * @returns {Promise<void>} 完成
     */
    async upsert(row) {
      await pool.query(
        `INSERT INTO cl_coin_descriptions (coin_no, title, url, body, body_md, published_on, date_text, source)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE title = VALUES(title), url = VALUES(url), body = VALUES(body),
           body_md = VALUES(body_md), published_on = VALUES(published_on),
           date_text = VALUES(date_text), source = VALUES(source)`,
        [row.coinNo, row.title || '', row.url || null, row.body || '', row.bodyMd || null,
          row.publishedOn || null, row.dateText || null, row.source || null]
      );
    },

    /**
     * 删除一条（仅测试/运维用；生产不会调用）。
     *
     * @param {number} no 品种编号
     * @returns {Promise<number>} 影响行数
     */
    async remove(no) {
      const [r] = await pool.query('DELETE FROM cl_coin_descriptions WHERE coin_no = ?', [Number(no)]);
      return Number(r.affectedRows || 0);
    }
  };
}

module.exports = { create: create, DESCRIPTION_COLUMNS: DESCRIPTION_COLUMNS };
