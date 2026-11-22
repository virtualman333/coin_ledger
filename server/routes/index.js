'use strict';
/**
 * 路由装配总入口。
 *
 * 分层约定（新增接口照这个来，不要再往一个文件里堆）：
 *
 *   routes/<域>.js             HTTP 层：读 body/query、挂鉴权、调 service、发响应
 *   services/<域>.service.js   业务层：校验规则、事务、跨模块编排
 *   repositories/*.repo.js     数据访问层：SQL / 文件读写
 *   state/catalog.js           目录域运行时数据（SEED / PLAN / GALLERY）
 *   core/http.js               请求/响应基础设施
 *
 * 顺序有意义：先具体路径，最后 fallback（`/*` 兜底）。
 * 匹配优先级是「静态 > 参数 > 通配」，所以 /api/admin/users/batch 不会被 :id 抢走。
 */
const healthRoutes = require('./health');
const bootstrapRoutes = require('./bootstrap');
const catalogRoutes = require('./catalog');
const metalPriceRoutes = require('./metal-price');
const coinCountRoutes = require('./coin-count');
const planRoutes = require('./plans');
const seoRoutes = require('./seo');
const holdingsExtraRoutes = require('./holdings-extra');
const colshareRoutes = require('./colshare');
const authRoutes = require('./auth');
const accountRoutes = require('./account');
const feedbackRoutes = require('./feedback');
const visitorRoutes = require('./visitors');
const reminderRoutes = require('./reminders');
const adminRoutes = require('./admin');
const honeypotRoutes = require('./honeypot');
const fallbackRoutes = require('./fallback');

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
  await app.register(metalPriceRoutes);
  await app.register(coinCountRoutes);
  await app.register(planRoutes);
  await app.register(seoRoutes);
  await app.register(holdingsExtraRoutes);
  await app.register(colshareRoutes);
  await app.register(authRoutes);
  await app.register(accountRoutes);
  await app.register(feedbackRoutes);
  await app.register(visitorRoutes);
  await app.register(reminderRoutes);
  await app.register(adminRoutes);
  await app.register(honeypotRoutes);
  await app.register(fallbackRoutes);
};
