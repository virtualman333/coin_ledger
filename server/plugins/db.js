'use strict';
/**
 * 目录域数据库连接池（fastify-plugin：decorate 与 hook 需要跨作用域）。
 *
 * 与用户域的 store-mysql.js 是**两个独立连接池**，各管各的表：
 *   - store-mysql.js  → cl_users / cl_holdings / cl_prices / cl_visits / cl_meta（不动）
 *   - 本插件           → cl_coins / cl_coin_descriptions / cl_series / cl_sets /
 *                        cl_coin_images / cl_plan_* / cl_pm_pieces（本次新建）
 * 分开的理由见架构 1.3：用户域已经跑在 MySQL 上且工作正常，不放进风险区。
 *
 * DATA_SOURCE=json 时**不建池**：灰度回滚就是把变量改回 json 再重启，
 * 这一步不能因为连不上库而起不来。
 */
const fp = require('fastify-plugin');

const config = require('../config');

module.exports = fp(async function dbPlugin(app) {
  if (!config.isDbDataSource) {
    app.decorate('db', null);
    app.decorate('withTx', async function noTx() {
      throw new Error('DATA_SOURCE=json 模式下没有可写事务（目录域为只读实现）');
    });
    console.log('[db] DATA_SOURCE=json：目录域走 JSON 只读实现，不建立 MySQL 连接池');
    return;
  }

  const mysql = require('mysql2/promise');
  const pool = mysql.createPool(config.mysqlOptions());

  let version = '';
  try {
    const [rows] = await pool.query('SELECT VERSION() AS v');
    version = rows && rows[0] ? String(rows[0].v) : '';
    // R3：JSON 列需要 5.7+，这里提前探测一次，避免运行期才发现
    const [probe] = await pool.query("SELECT JSON_VALID('[]') AS ok");
    if (!probe || Number(probe[0].ok) !== 1) {
      throw new Error('当前 MySQL 不支持 JSON 列（需要 5.7+）');
    }
  } catch (e) {
    try { await pool.end(); } catch (closeErr) { /* 连接本就不可用 */ }
    const err = new Error(
      '目录库连接失败（' + config.DB.host + ':' + config.DB.port + '/' + config.DB.database + '）：' + e.message
      + '。如需回滚到只读模式，把环境变量设为 DATA_SOURCE=json 后重启。'
    );
    err.status = 503;
    throw err;
  }

  console.log('[db] 目录库已连接 ' + config.DB.host + ':' + config.DB.port + '/' + config.DB.database
    + '（MySQL ' + version + '）');

  app.decorate('db', pool);
  app.decorate('dbVersion', version);

  /**
   * 事务包装：回调拿到 conn，抛错自动 rollback。
   * 目录域所有多表写（套 + 规格明细、计划整份替换）都走它。
   *
   * @param {(conn: import('mysql2/promise').PoolConnection) => Promise<any>} fn 事务体
   * @returns {Promise<any>} 事务体的返回值
   */
  app.decorate('withTx', async function withTx(fn) {
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      const result = await fn(conn);
      await conn.commit();
      return result;
    } catch (e) {
      try { await conn.rollback(); } catch (rollbackErr) { /* 事务可能已被服务端回滚 */ }
      throw e;
    } finally {
      conn.release();
    }
  });

  app.addHook('onClose', async function closeDb() {
    try { await pool.end(); } catch (e) { /* 已关闭 */ }
  });
}, { name: 'cl-db' });
