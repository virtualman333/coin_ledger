'use strict';
/**
 * 管理端目录域路由装配。
 *
 * 只挂 T03 迁出的 4 个页面：「参数 / 图片 / 系列 / 发行计划」。
 * 用户、审计、访客、反馈、guard 等管理端接口继续由 routes/legacy.js 委托老 handler。
 */
const coinsRoutes = require('./coins');
const seriesRoutes = require('./series');
const planRoutes = require('./plan');
const imagesRoutes = require('./images');

/**
 * 注册全部管理端目录域路由。
 *
 * @param {import('fastify').FastifyInstance} app Fastify 实例
 * @returns {Promise<void>} 完成
 */
module.exports = async function adminRoutes(app) {
  await app.register(coinsRoutes);
  await app.register(seriesRoutes);
  await app.register(planRoutes);
  await app.register(imagesRoutes);
};
