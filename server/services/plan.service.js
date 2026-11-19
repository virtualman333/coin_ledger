'use strict';
/**
 * 发行计划服务（T03）。
 *
 * 规则字段从 schemas/plan.js 取（原样从 legacy 搬入），整份替换在**一个事务**里：
 *   · db 模式：repos.plan.replace(conn, next) 在同一次 conn 上写 cl_plan_doc +
 *     清 cl_plan_years + 逐年度插入，事务由 app.withTx 提供；
 *   · json 模式（S0 现状）：原子写 PLAN_FILE 并通知 legacy 的内存 PLAN，
 *     /api/bootstrap 与 reminders 立即生效。
 *
 * 成功响应 `{ok:true,years,items}`、错误文案都逐字保持 legacy。
 */
const fs = require('fs');

const config = require('../config');
const audit = require('../audit');
const legacy = require('../legacy/api-handler');
const planSchema = require('../schemas/plan');

/**
 * 创建发行计划服务。
 *
 * @param {{dataSource: object, withTx: Function}} ctx 依赖
 * @returns {object} 服务实例
 */
function create(ctx) {
  const ds = ctx.dataSource;
  const repos = ds.repos;

  return {
    mode: ds.mode,

    /**
     * 读整份计划。
     *
     * @returns {Promise<object>} {updated,note,years}
     */
    async get() {
      return repos.plan.get();
    },

    /**
     * 整份替换。
     *
     * @param {object} body 请求体（允许 {plan:{...}} 或直接 {years:[...]}）
     * @param {string} actor 操作人
     * @param {string} ip 来源 IP
     * @returns {Promise<{ok:boolean,error?:string,years?:number,items?:number}>} 结果
     */
    async replace(body, actor, ip) {
      const src = body && typeof body === 'object' ? body : {};
      const next = planSchema.normalizePlan(src.plan ? src.plan : src);
      const bad = planSchema.validatePlan(next);
      if (bad) return { ok: false, error: bad };

      const years = (next.years || []).length;
      const items = (next.years || []).reduce((a, y) => a + (y.items || []).length, 0);

      if (ds.mode === 'db') {
        await ctx.withTx(async (conn) => {
          await repos.plan.replace(conn, next);
        });
      } else {
        fs.writeFileSync(config.PLAN_FILE, JSON.stringify(next, null, 1) + '\n', 'utf8');
        // 老 reminders 分支还在用内存 PLAN，必须同步；否则「保存后不重启不生效」
        legacy.setPlan(next);
      }

      audit.log(actor, 'plan.update', '', years + ' 个年度 / ' + items + ' 个项目', ip);
      console.log('[admin] 更新发行计划：' + years + ' 个年度 / ' + items + ' 个项目');
      return { ok: true, years: years, items: items };
    }
  };
}

module.exports = { create: create };
