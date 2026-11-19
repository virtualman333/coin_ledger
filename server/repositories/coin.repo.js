'use strict';
/**
 * 品种仓储（MySQL 实现）。
 *
 * 这一层是**唯一**出现 `cl_coins` SQL 的地方（验收项：routes/ 里不许有 SQL）。
 * 返回的行已经是 camelCase（SELECT 里 `col AS camel` 由 schemas/coin.js 统一生成），
 * 所以 service 不需要再做字段改名 —— 改名只发生一次。
 *
 * 保号三层里的第二层在这里体现：insert() 只接受「由 service 算好的 no」，
 * update() 把 no 列从可写列里彻底剔除（即使调用方塞进来也不会进 SQL），
 * 第三层是 003_guards.sql 的触发器。
 */
const common = require('../schemas/common');
const coinSchema = require('../schemas/coin');

/** 任何 UPDATE 都不允许出现的列（保号红线 + 自增主键） */
const NEVER_UPDATE_COLUMNS = ['no', 'id', 'created_at'];

/**
 * 生成占位符串：?,?,?
 *
 * @param {number} n 个数
 * @returns {string} 占位符
 */
function marks(n) {
  return new Array(n).fill('?').join(', ');
}

/**
 * 把 patch 的列值对象整理成 SET 片段（并剔除禁区列）。
 *
 * @param {Object<string, unknown>} values 列名 → 值
 * @returns {{setSql: string, params: unknown[]}} SET 片段与参数
 */
function buildSet(values) {
  const cols = Object.keys(values).filter((c) => NEVER_UPDATE_COLUMNS.indexOf(c) < 0);
  if (!cols.length) return { setSql: '', params: [] };
  const setSql = cols.map((c) => '`' + c + '` = ?').join(', ');
  const params = cols.map((c) => {
    const v = values[c];
    // JSON 列必须序列化成字符串；mysql2 不会替我们把数组变成 JSON
    return Array.isArray(v) ? JSON.stringify(v) : v;
  });
  return { setSql: setSql, params: params };
}

/**
 * 创建品种仓储。
 *
 * @param {import('mysql2/promise').Pool} pool 连接池
 * @returns {object} 仓储实例
 */
function create(pool) {
  if (!pool) throw new Error('coin.repo(mysql) 需要连接池：DATA_SOURCE=db 时才可实例化');

  return {
    mode: 'db',

    /**
     * 列出全部品种（含 draft），按统一排序口径。
     *
     * @param {{status?: string}} [filter] status='published' 时只出已上架
     * @returns {Promise<object[]>} 行列表
     */
    async listAll(filter) {
      const f = filter || {};
      const params = [];
      let where = '';
      if (f.status === 'published' || f.status === 'draft') {
        where = ' WHERE c.status = ?';
        params.push(f.status);
      }
      const [rows] = await pool.query(
        'SELECT ' + coinSchema.SELECT_LIST + ' FROM cl_coins c' + where + ' ORDER BY ' + common.CATALOG_ORDER_SQL,
        params
      );
      return rows;
    },

    /**
     * 公开视图：只出 published（sitemap / 前台 / 导出都用它）。
     *
     * @returns {Promise<object[]>} 行列表
     */
    async listPublished() {
      return this.listAll({ status: 'published' });
    },

    /**
     * 按 no 取一行。
     *
     * @param {number} no 业务主键
     * @returns {Promise<object|null>} 行或 null
     */
    async findByNo(no) {
      const [rows] = await pool.query('SELECT ' + coinSchema.SELECT_LIST + ' FROM cl_coins c WHERE c.no = ? LIMIT 1', [Number(no)]);
      return rows.length ? rows[0] : null;
    },

    /**
     * 按分类取（/api/catalog?category=pm 用）。
     *
     * @param {string} category 分类
     * @param {{status?: string}} [filter] 状态过滤
     * @returns {Promise<object[]>} 行列表
     */
    async listByCategory(category, filter) {
      const f = filter || {};
      const params = [category];
      let sql = 'SELECT ' + coinSchema.SELECT_LIST + ' FROM cl_coins c WHERE c.category = ?';
      if (f.status === 'published' || f.status === 'draft') {
        sql += ' AND c.status = ?';
        params.push(f.status);
      }
      sql += ' ORDER BY ' + common.CATALOG_ORDER_SQL;
      const [rows] = await pool.query(sql, params);
      return rows;
    },

    /**
     * 插入一行。
     *
     * @param {Object<string, unknown>} cols 列名 → 值（由 service 用 schemas/coin 收敛）
     * @returns {Promise<number>} 业务主键 no
     */
    async insert(cols) {
      const keys = Object.keys(cols || {});
      if (!keys.length) throw new Error('coin.insert 需要至少一个字段');
      const params = keys.map((k) => (Array.isArray(cols[k]) ? JSON.stringify(cols[k]) : cols[k]));
      const sql = 'INSERT INTO cl_coins (' + keys.map((k) => '`' + k + '`').join(', ') + ') VALUES (' + marks(keys.length) + ')';
      await pool.query(sql, params);
      return Number(cols.no);
    },

    /**
     * 按 no 更新（no/id 列被强制剔除）。
     *
     * @param {number} no 业务主键
     * @param {Object<string, unknown>} values 列名 → 值
     * @returns {Promise<object|null>} 更新后的行
     */
    async update(no, values) {
      const built = buildSet(values || {});
      if (!built.setSql) return this.findByNo(no);
      // 触发器兜底：即使有人绕过 service 把 no 塞进来，这里也不会拼进 SQL
      await pool.query('UPDATE cl_coins SET ' + built.setSql + ' WHERE `no` = ?', built.params.concat([Number(no)]));
      return this.findByNo(no);
    },

    /**
     * 幂等写入（迁移专用）：按 no 冲突则更新其余列。
     *
     * 两条保号红线在这里体现：
     *   · ON DUPLICATE 的更新列表**不含 no / id**，从 SQL 层面就不可能改号；
     *   · 调用方（迁移脚本）在写之前会断言「同 no 的 name 必须一致」，
     *     不一致就报错停下 —— 绝不用旧 JSON 覆盖人工核验过的品种名。
     *
     * @param {Object<string, unknown>} cols 列名 → 值
     * @returns {Promise<void>} 完成
     */
    async upsert(cols) {
      const keys = Object.keys(cols || {});
      if (!keys.length) throw new Error('coin.upsert 需要至少一个字段');
      const params = keys.map((k) => (Array.isArray(cols[k]) ? JSON.stringify(cols[k]) : cols[k]));
      const updates = keys
        .filter((k) => k !== 'no' && k !== 'id')
        .map((k) => '`' + k + '` = VALUES(`' + k + '`)')
        .join(', ');
      const sql = 'INSERT INTO cl_coins (' + keys.map((k) => '`' + k + '`').join(', ') + ') VALUES ('
        + marks(keys.length) + ')' + (updates ? ' ON DUPLICATE KEY UPDATE ' + updates : '');
      await pool.query(sql, params);
    },

    /**
     * 下一个可用编号：MAX(no)+1。必须在事务连接里调用（FOR UPDATE 锁区间）。
     *
     * @param {object} [conn] 事务连接；缺省用池（会退化成非锁定读，仅供工具使用）
     * @returns {Promise<number>} 新编号
     */
    async nextNo(conn) {
      const runner = conn || pool;
      const [rows] = await runner.query('SELECT COALESCE(MAX(no), 0) AS m FROM cl_coins FOR UPDATE');
      return Number(rows[0].m) + 1;
    },

    /**
     * 删除草稿（service 已断言 no>137 且 status=draft；触发器再兜一层）。
     *
     * @param {number} no 业务主键
     * @returns {Promise<number>} 影响行数
     */
    async remove(no) {
      const [r] = await pool.query("DELETE FROM cl_coins WHERE `no` = ? AND status = 'draft'", [Number(no)]);
      return Number(r.affectedRows || 0);
    },

    /**
     * 各分类计数（/api/health、G3 占比断言用）。
     *
     * @returns {Promise<Object<string, number>>} category → count
     */
    async countByCategory() {
      const [rows] = await pool.query('SELECT category, COUNT(*) AS n FROM cl_coins GROUP BY category');
      const out = {};
      rows.forEach((r) => { out[String(r.category)] = Number(r.n); });
      common.CATEGORIES.forEach((c) => { if (out[c] === undefined) out[c] = 0; });
      return out;
    },

    /**
     * 全量计数。
     *
     * @returns {Promise<number>} 行数
     */
    async count() {
      const [rows] = await pool.query('SELECT COUNT(*) AS n FROM cl_coins');
      return Number(rows[0].n);
    }
  };
}

module.exports = { create: create, NEVER_UPDATE_COLUMNS: NEVER_UPDATE_COLUMNS };
