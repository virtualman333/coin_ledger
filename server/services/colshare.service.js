'use strict';
/**
 * 收藏快照脱敏：只保留「别人能看到什么」，成本 / 市值 / 盈亏绝不落库。
 *
 * 小程序端传上来的持仓对象字段很多（cost / market / pnl / serials ...），
 * 这里用白名单重构一份新对象，避免以后前端多传字段就悄悄泄漏账本隐私。
 */
const MAX_ITEMS = 200;

const CATEGORIES = new Set(['coin', 'note', 'pm']);

function cleanText(v, max) {
  return String(v == null ? '' : v).trim().slice(0, max);
}

/**
 * 分享内容选项（用户勾哪些就存哪些）。
 * 成本、市值、盈亏这些账本隐私永远不在选项里 —— 不是靠开关关闭，而是压根不采。
 */
const OPTION_KEYS = ['list', 'qty', 'face', 'ai'];

function normalizeOptions(raw) {
  const o = raw && typeof raw === 'object' ? raw : {};
  const out = {};
  OPTION_KEYS.forEach((k) => { out[k] = o[k] === undefined ? true : !!o[k]; });
  return out;
}

/** 单个收藏的公开字段 */
function sanitizeItem(raw, opts) {
  if (!raw || typeof raw !== 'object') return null;
  const name = cleanText(raw.name, 64);
  if (!name) return null;
  const o = normalizeOptions(opts);
  const qty = Math.max(0, Number(raw.qty) || 0);
  const tags = Array.isArray(raw.luckyTags)
    ? raw.luckyTags.slice(0, 6).map((t) => cleanText(t, 12)).filter(Boolean)
    : [];
  const item = {
    name: name,
    year: Number(raw.year) || 0,
    category: CATEGORIES.has(raw.category) ? raw.category : 'coin',
    qty: qty,
    seriesName: cleanText(raw.seriesName, 48),
    imgUrl: cleanText(raw.imgUrl, 300),
    luckyTags: tags,
  };
  // 没勾数量就别落数量文案；面值/推理价同理 —— 不落库，读取时自然也拿不到
  if (o.qty) item.qtyLabel = cleanText(raw.qtyLabel || (qty + ' 枚'), 24);
  if (o.face) item.face = Math.max(0, Number(raw.face) || 0);
  if (o.ai) item.ai = Math.max(0, Number(raw.ai) || 0);
  return item;
}

/** 整份快照：最多 200 条，非法条目直接跳过 */
function sanitizeItems(list, opts) {
  if (!Array.isArray(list)) return [];
  const out = [];
  for (let i = 0; i < list.length && out.length < MAX_ITEMS; i += 1) {
    const it = sanitizeItem(list[i], opts);
    if (it) out.push(it);
  }
  return out;
}

/** 统计：品种数按条目数，总件数按 qty 累加；面值/推理价只在字段存在时累加 */
function statsOf(items) {
  return {
    kinds: items.length,
    total: items.reduce((a, it) => a + (Number(it.qty) || 0), 0),
    faceTotal: items.reduce((a, it) => a + (Number(it.face) || 0), 0),
    aiTotal: items.reduce((a, it) => a + (Number(it.ai) || 0), 0),
  };
}

module.exports = {
  MAX_ITEMS: MAX_ITEMS,
  OPTION_KEYS: OPTION_KEYS,
  normalizeOptions: normalizeOptions,
  sanitizeItem: sanitizeItem,
  sanitizeItems: sanitizeItems,
  statsOf: statsOf,
};
