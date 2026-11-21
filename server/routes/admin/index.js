'use strict';
/**
 * 管理端路由装配。
 *
 * 一个业务域一个文件：
 *   coins / series / plan / images / pm    目录维护（参数、图片、系列、发行计划、贵金属）
 *   users                                  用户管理 + 审计
 *   guard                                  反爬封禁自查/解封
 *   feedback                               反馈处理
 *   visitors                               访客统计/明细
 */
const coinsRoutes = require('./coins');
const seriesRoutes = require('./series');
const planRoutes = require('./plan');
const imagesRoutes = require('./images');
const pmRoutes = require('./pm');
const usersRoutes = require('./users');
const guardRoutes = require('./guard');
const feedbackRoutes = require('./feedback');
const visitorsRoutes = require('./visitors');

/**
 * 注册全部管理端路由。
 *
 * @param {import('fastify').FastifyInstance} app Fastify 实例
 * @returns {Promise<void>} 完成
 */
module.exports = async function adminRoutes(app) {
  await app.register(coinsRoutes);
  await app.register(seriesRoutes);
  await app.register(planRoutes);
  await app.register(imagesRoutes);
  await app.register(pmRoutes);
  await app.register(usersRoutes);
  await app.register(guardRoutes);
  await app.register(feedbackRoutes);
  await app.register(visitorsRoutes);
};
