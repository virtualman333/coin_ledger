'use strict';
/**
 * 账本域业务层：我的状态 / 持仓读写 / 全局行情。
 *
 * 从 legacy/api-handler.js 的 `/api/state`、`/api/holdings*`、`/api/prices` 四个分支拆出。
 *
 * 持仓校验规则（字段白名单、条数上限、名称必须存在于目录）原本就在处理器里，
 * 属于业务规则而不是参数解析，所以整段搬到这里；路由层只负责读 body 与鉴权。
 */
const store = require('../store');
const auth = require('../auth');
const catalogState = require('../state/catalog');
const superadmin = require('../bootstrap/superadmin');
const { badRequest } = require('../core/http');
const { groupLabel } = require('../core/labels');

const MAX_HOLDINGS = 300;

/**
 * 号码数组白名单：只留字符串、去空白、去重、最多 200 张。
 *
 * @param {unknown} v 原始数组
 * @returns {string[]} 清洗后的号码
 */
function normSerials(v) {
  if (!Array.isArray(v)) return [];
  const out = [], seen = new Set();
  for (const s of v) {
    const no = String(s == null ? '' : s).trim().slice(0, 24);
    if (!no || seen.has(no)) continue;
    seen.add(no); out.push(no);
    if (out.length >= 200) break;
  }
  return out;
}

/**
 * 图片数组白名单：只留 /collection/ 相对路径，最多 3 张。
 *
 * @param {unknown} v 原始数组
 * @returns {string[]} 清洗后的路径
 */
function normImages(v) {
  if (!Array.isArray(v)) return [];
  const out = [], seen = new Set();
  for (const s of v) {
    const p = String(s == null ? '' : s).trim();
    if (!/^\/collection\/[A-Za-z0-9._-]+\.(jpg|jpeg|png|webp)$/i.test(p) || seen.has(p)) continue;
    seen.add(p); out.push(p);
    if (out.length >= 3) break;
  }
  return out;
}

/**
 * 规整并校验一份持仓（整份替换语义）。
 *
 * @param {unknown} input 前端提交的 holdings
 * @returns {object[]} 可落库的持仓条目
 */
function normalizeHoldings(input) {
  if (!Array.isArray(input)) throw badRequest('holdings 必须是数组');
  if (input.length > MAX_HOLDINGS) throw badRequest(`持仓条目不能超过 ${MAX_HOLDINGS}`);
  const seen = new Set();
  return input.map((h, idx) => {
    if (!h || typeof h !== 'object') throw badRequest(`第 ${idx + 1} 条格式错误`);
    const name = String(h.name || '').trim();
    if (!catalogState.hasCoin(name)) throw badRequest(`未知品种：${name}`);
    if (seen.has(name)) throw badRequest(`品种重复：${name}`);
    seen.add(name);
    const rolls = Number(h.rolls);
    const cost = Number(h.cost);
    const market = Number(h.market);
    if (!Number.isFinite(rolls) || rolls < 0 || rolls > 999) throw badRequest(`${name} 的数量不合法`);
    if (!Number.isFinite(cost) || cost < 0 || cost > 1e8) throw badRequest(`${name} 的成本不合法`);
    if (!Number.isFinite(market) || market < 0 || market > 1e8) throw badRequest(`${name} 的市价不合法`);
    return {
      id: String(h.id || 'h' + (idx + 1)),
      name,
      rolls: Math.round(rolls),
      cost: Math.round(cost * 100) / 100,
      market: Math.round(market * 100) / 100,
      group: groupLabel(h.group).slice(0, 24),
      sep: !!h.sep,
      category: ['coin','note','pm'].indexOf(h.category) >= 0 ? h.category : 'coin',
      // 贵金属缩略图与「按单枚记」口径（migration 007）。
      // thumb 允许相对路径或 http(s) URL，限制长度即可；unit 白名单 piece，其余按套处理。
      thumb: String(h.thumb || '').slice(0, 512),
      unit: h.unit === 'piece' ? 'piece' : '',
      // 收藏增强（migration 008）：号码数组 / 整套单个 / 图片数组
      serials: normSerials(h.serials),
      form: h.form === 'single' || h.form === 'set' ? h.form : '',
      images: normImages(h.images)
    };
  });
}

/**
 * 当前用户 + 全局状态（前端首屏刷新用）。
 *
 * @param {import('http').IncomingMessage} rawReq 原始请求
 * @returns {object} 响应体
 */
function state(rawReq) {
  const d = store.load();
  const me = auth.currentUser(rawReq, d);
  return {
    ok: true,
    rev: d.rev || 0,
    user: auth.publicUser(me),
    isAdmin: !!(me && me.role === 'admin'),
    holdings: me && Array.isArray(d.holdings[me.id]) ? d.holdings[me.id] : [],
    prices: d.prices || {},
    userCount: d.users.length
  };
}

/**
 * 整份保存我的持仓。
 *
 * @param {string} uid 用户 ID
 * @param {unknown} holdings 前端提交的数组
 * @returns {Promise<object>} 响应体
 */
async function saveHoldings(uid, holdings) {
  const clean = normalizeHoldings(holdings);
  const rev = await store.commit((draft) => {
    draft.holdings[uid] = clean;
    return draft.rev + 1;
  });
  return { ok: true, rev, count: clean.length };
}

/**
 * 重置我的持仓为默认内容。
 *
 * @param {string} uid 用户 ID
 * @returns {Promise<object>} 响应体
 */
async function resetHoldings(uid) {
  const rev = await store.commit((draft) => {
    draft.holdings[uid] = superadmin.defaultHoldings();
    return draft.rev + 1;
  });
  return { ok: true, rev, holdings: store.load().holdings[uid] };
}

/**
 * 更新全局行情（仅管理员）。按品种编号校验，值域 0 ~ 1e7，保留两位小数。
 *
 * @param {unknown} input 前端提交的 prices 对象
 * @returns {Promise<object>} 响应体
 */
async function setPrices(input) {
  if (!input || typeof input !== 'object') throw badRequest('prices 必须是对象');
  const coinCount = catalogState.state().seed.coins.length;
  const prices = {};
  Object.keys(input).forEach((k) => {
    const i = Number(k);
    const v = Number(input[k]);
    if (!Number.isInteger(i) || i < 0 || i >= coinCount) throw badRequest(`未知品种编号 ${k}`);
    if (!Number.isFinite(v) || v < 0 || v > 1e7) throw badRequest(`编号 ${k} 的价格不合法`);
    prices[String(i)] = Math.round(v * 100) / 100;
  });

  const rev = await store.commit((draft) => {
    draft.prices = Object.assign({}, draft.prices, prices);
    return draft.rev + 1;
  });
  return { ok: true, rev, count: Object.keys(prices).length };
}

module.exports = {
  normalizeHoldings: normalizeHoldings,
  state: state,
  saveHoldings: saveHoldings,
  resetHoldings: resetHoldings,
  setPrices: setPrices
};
