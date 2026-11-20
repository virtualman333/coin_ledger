'use strict';
/**
 * 路由装配总入口（T03 更新）。
 *
 * 顺序有意义：先具体路径，再 /* 兜底。find-my-way 的匹配优先级是
 * 「静态 > 参数 > 通配」，所以 /api/health、/api/bootstrap、/api/catalog、
 * /coin/:no 与四个管理端子域都会命中各自路由，其余全部落到 legacy。
 *
 * T03 已迁出：health(1) + bootstrap(1) + series(1) + 2 个新接口
 * + 页面渲染（SEO）+ 管理端参数/图片/系列/发行计划（约 12 个处理器）。
 * 其余约 30 个接口继续走 routes/legacy.js 委托老 handler —— 绞杀者模式。
 */
const healthRoutes = require('./health');
const bootstrapRoutes = require('./bootstrap');
const catalogRoutes = require('./catalog');
const planRoutes = require('./plans');
const seoRoutes = require('./seo');
const plazaRoutes = require('./plaza');
const adminRoutes = require('./admin');
const legacyRoutes = require('./legacy');

/**
 * 把所有路由挂到 app 上。
 *
 * @param {import('fastify').FastifyInstance} app Fastify 实例
 * @returns {Promise<void>} 注册完成
 */
module.exports = async function registerAll(app) {
  await app.register(healthRoutes);
  await app.register(bootstrapRoutes);
  await app.register(catalogRoutes);
  await app.register(planRoutes);
  await app.register(seoRoutes);
  await app.register(plazaRoutes);
  await app.register(adminRoutes);
  await app.register(legacyRoutes);
};
