'use strict';
/**
 * 健康检查业务层：把运行状态汇总成一个响应体。
 *
 * 以前 /api/health 的响应体由 legacy/api-handler 的 handleApi 第一段产生，
 * 路由只是把请求转给它。现在在这里重建，**字段名与顺序逐字不变**：
 *
 *   ok / version / uptime / coins / images / users / rev / storage / guard
 *
 * tools/api-snapshot.js 与 tests/contract-smoke.test.js 都会比对这段响应，
 * 新增字段只能往后加，老字段不许改名或调序。
 */
const config = require('../config');
const store = require('../store');
const guard = require('../guard');
const catalogState = require('../state/catalog');

/**
 * 生成健康检查响应体。
 *
 * @returns {object} 响应体
 */
function snapshot() {
  const d = store.load();
  const st = catalogState.state();
  return {
    ok: true,
    version: config.VERSION,
    uptime: Math.floor((Date.now() - config.START_AT) / 1000),
    coins: st.seed.coins.length,
    images: st.imgSet.length,
    users: d.users.length,
    rev: d.rev || 0,
    storage: store.info(),
    guard: guard.stats()
  };
}

module.exports = { snapshot: snapshot };
