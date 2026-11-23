'use strict';
/**
 * 应用级开关（目前只有「维护状态」）。
 *
 * 存在 cl_meta 里做单值：'1' / '0'。不复用 store 的整份文档模型 ——
 * 这个值会被小程序每次冷启动读取，写频率极低，单独读写更简单。
 *
 * 缓存 10 秒：管理端点保存后立刻能看到效果，同时避免每次启动都打库。
 */
const KEY = 'app.maintenance';

let cache = { at: 0, on: false };

/**
 * 读维护状态。
 *
 * @param {import('fastify').FastifyInstance} app Fastify 实例（用 app.db）
 * @returns {Promise<boolean>} 是否维护中
 */
async function getMaintenance(app) {
  if (Date.now() - cache.at < 10000) return cache.on;
  try {
    const [rows] = await app.db.query('SELECT v FROM cl_meta WHERE k = ? LIMIT 1', [KEY]);
    const v = rows && rows[0] ? String(rows[0].v) : '';
    cache = { at: Date.now(), on: v === '1' };
  } catch (e) {
    // 查不到就按「关闭」处理：维护状态是收紧功能，不能因为一次查询失败把大家挡在外面
    cache = { at: Date.now(), on: false };
  }
  return cache.on;
}

/**
 * 写维护状态。
 *
 * @param {import('fastify').FastifyInstance} app Fastify 实例
 * @param {boolean} on 是否开启
 * @returns {Promise<boolean>} 写入后的值
 */
async function setMaintenance(app, on) {
  const v = on ? '1' : '0';
  await app.db.query(
    'INSERT INTO cl_meta (k, v) VALUES (?, ?) ON DUPLICATE KEY UPDATE v = VALUES(v)',
    [KEY, v]
  );
  cache = { at: Date.now(), on: !!on };
  return !!on;
}

module.exports = { getMaintenance, setMaintenance };
