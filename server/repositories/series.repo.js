'use strict';
/**
 * 系列仓储（MySQL 实现）。
 *
 * 系列与品种是多对多，成员关系不在这里 —— 它落在 cl_coins.series_keys。
 * 本表只管系列自身的元信息（名称、简介、卡图、排序），20 条。
 * 贵金属系列 key=PM、sort=200，天然排在普通系列（10–180）之后。
 */
const SERIES_COLUMNS = 'series_key AS seriesKey, name AS name, descr AS descr, img AS img, '
  + 'img_from AS imgFrom, sort AS sort';

function create(pool) {
  if (!pool) throw new Error('series.repo(mysql) 需要连接池');

  return {
    mode: 'db',

    /**
     * 全部系列，按 sort 升序（与前端展示顺序一致）。
     *
     * @returns {Promise<object[]>} 行列表
     */
    async listAll() {
      const [rows] = await pool.query('SELECT ' + SERIES_COLUMNS + ' FROM cl_series ORDER BY sort, series_key');
      return rows;
    },

    /**
     * 单个系列。
     *
     * @param {string} key 系列 key
     * @returns {Promise<object|null>} 行或 null
     */
    async findByKey(key) {
      const [rows] = await pool.query('SELECT ' + SERIES_COLUMNS + ' FROM cl_series WHERE series_key = ? LIMIT 1', [String(key)]);
      return rows.length ? rows[0] : null;
    },

    /**
     * 新建或更新（T03 的 series.service 用）。
     *
     * @param {object} row camelCase 行
     * @returns {Promise<void>} 完成
     */
    async upsert(row) {
      await pool.query(
        `INSERT INTO cl_series (series_key, name, descr, img, img_from, sort)
         VALUES (?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE name = VALUES(name), descr = VALUES(descr), img = VALUES(img),
           img_from = VALUES(img_from), sort = VALUES(sort)`,
        [row.seriesKey, row.name, row.descr || '', row.img || '', row.imgFrom || null, Number(row.sort) || 0]
      );
    },

    /**
     * 删除系列（T03 会同时清理 cl_coins.series_keys，本方法只删元信息）。
     *
     * @param {string} key 系列 key
     * @returns {Promise<number>} 影响行数
     */
    async remove(key) {
      const [r] = await pool.query('DELETE FROM cl_series WHERE series_key = ?', [String(key)]);
      return Number(r.affectedRows || 0);
    }
  };
}

module.exports = { create: create, SERIES_COLUMNS: SERIES_COLUMNS };
