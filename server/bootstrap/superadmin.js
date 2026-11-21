'use strict';
/**
 * 启动期账号初始化（bootstrap 层）。
 *
 * 两件事，都只在进程启动时跑一次：
 *   1. 确保超级管理员存在（首次启动建号，并把旧版单用户数据认领给它）；
 *   2. 提供「默认持仓」——新账号/重置账本时的初始内容。
 *
 * 这些逻辑以前写在 legacy/api-handler.js 顶部，和 30 个接口混在一个文件里，
 * 启动顺序（store.init → loadSeed → ensureSuperadmin）根本看不出来。搬出来后
 * app.start() 里的调用顺序就是文档。
 */
const crypto = require('crypto');

const store = require('../store');
const auth = require('../auth');
const catalogState = require('../state/catalog');

const SUPERADMIN_NAME = process.env.SUPERADMIN_NAME || 'virtualman';

/**
 * 首次建超管用的口令：只从环境变量取；没配就随机生成并打印一次，
 * 避免把口令写死在仓库里（硬编码的口令一旦进 git 历史就再也擦不掉）。
 *
 * @returns {string} 明文口令（仅用于本次哈希，不落盘）
 */
function superadminPassword() {
  if (process.env.SUPERADMIN_PASSWORD) return process.env.SUPERADMIN_PASSWORD;
  const pw = crypto.randomBytes(12).toString('base64').replace(/[^A-Za-z0-9]/g, '').slice(0, 12);
  console.log(`[boot] 未设置 SUPERADMIN_PASSWORD，本次生成超管口令：${pw}（登录后请立即修改）`);
  return pw;
}

/**
 * 新账号的默认持仓（来自 coins.json 的 defaults）。
 *
 * @returns {object[]} 持仓条目
 */
function defaultHoldings() {
  return (catalogState.state().seed.defaults || []).map((x, i) => ({
    id: 'h' + (i + 1),
    name: x.name,
    rolls: x.rolls,
    cost: x.cost,
    market: x.market,
    group: x.group || '独立藏品',
    sep: !!x.sep
  }));
}

/**
 * 确保超管账号存在；顺带把 v2 的单用户持仓认领给超管。
 *
 * @returns {Promise<void>} 完成
 */
async function ensureSuperadmin() {
  const d = store.load();
  const admin = auth.findByName(d, SUPERADMIN_NAME);

  if (!admin) {
    const { salt, hash } = auth.hashPassword(superadminPassword());
    await store.commit((draft) => {
      const u = {
        id: auth.nextID(draft),
        name: SUPERADMIN_NAME,
        role: 'admin',
        salt, hash,
        createdAt: new Date().toISOString(),
        lastLogin: null
      };
      draft.users.push(u);
      // 旧版单用户数据认领给超管
      if (Array.isArray(draft.holdings._legacy)) {
        draft.holdings[u.id] = draft.holdings._legacy;
        delete draft.holdings._legacy;
      } else if (!Array.isArray(draft.holdings[u.id])) {
        draft.holdings[u.id] = defaultHoldings();
      }
      return u;
    });
    console.log(`[boot] 已创建超级管理员「${SUPERADMIN_NAME}」并接管初始藏品`);
    return;
  }

  if (Array.isArray(d.holdings._legacy)) {
    await store.commit((draft) => {
      draft.holdings[admin.id] = draft.holdings._legacy;
      delete draft.holdings._legacy;
    });
    console.log(`[boot] 已把旧版单用户藏品认领给「${SUPERADMIN_NAME}」`);
  }
}

module.exports = {
  SUPERADMIN_NAME: SUPERADMIN_NAME,
  superadminPassword: superadminPassword,
  defaultHoldings: defaultHoldings,
  ensureSuperadmin: ensureSuperadmin
};
