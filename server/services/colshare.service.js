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

/** 单个藏品的公开字段 */
function sanitizeItem(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const name = cleanText(raw.name, 64);
  if (!name) return null;
  const qty = Math.max(0, Number(raw.qty) || 0);
  const tags = Array.isArray(raw.luckyTags)
    ? raw.luckyTags.slice(0, 6).map((t) => cleanText(t, 12)).filter(Boolean)
    : [];
  return {
    name: name,
    year: Number(raw.year) || 0,
    category: CATEGORIES.has(raw.category) ? raw.category : 'coin',
    qty: qty,
    qtyLabel: cleanText(raw.qtyLabel || (qty + ' 枚'), 24),
    seriesName: cleanText(raw.seriesName, 48),
    imgUrl: cleanText(raw.imgUrl, 300),
    luckyTags: tags,
  };
}

/** 整份快照：最多 200 条，非法条目直接跳过 */
function sanitizeItems(list) {
  if (!Array.isArray(list)) return [];
  const out = [];
  for (let i = 0; i < list.length && out.length < MAX_ITEMS; i += 1) {
    const it = sanitizeItem(list[i]);
    if (it) out.push(it);
  }
  return out;
}

/** 统计：品种数按条目数，总件数按 qty 累加 */
function statsOf(items) {
  return {
    kinds: items.length,
    total: items.reduce((a, it) => a + (Number(it.qty) || 0), 0),
  };
}

module.exports = {
  MAX_ITEMS: MAX_ITEMS,
  sanitizeItem: sanitizeItem,
  sanitizeItems: sanitizeItems,
  statsOf: statsOf,
};
