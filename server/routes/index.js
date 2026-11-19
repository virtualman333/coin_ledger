'use strict';
/**
 * 路由装配总入口。
 *
 * 顺序有意义：先注册具体路径，再注册 /* 兜底。
 * find-my-way 的匹配优先级是「静态 > 参数 > 通配」，所以 /api/health 一定命中
 * routes/health.js，其余全部落到 routes/legacy.js（绞杀者兜底）。
 *
 * T03 起在这里逐个 app.register：bootstrap / catalog / account / auth / reminders /
 * feedback / seo / admin[...]，每迁一个域就把对应分支从 legacy 摘掉。
 */
const healthRoutes = require('./health');
const legacyRoutes = require('./legacy');

/**
 * 把所有路由挂到 app 上。
 *
 * @param {import('fastify').FastifyInstance} app Fastify 实例
 * @returns {Promise<void>} 注册完成
 */
module.exports = async function registerAll(app) {
  await app.register(healthRoutes);
  await app.register(legacyRoutes);
};
