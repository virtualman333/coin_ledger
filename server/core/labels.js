'use strict';
/**
 * 术语口径：对外一律叫「收藏」。
 *
 * 2026-11 起小程序/网站/鸿蒙统一不再出现「藏品」二字（个人主体小程序审核口径），
 * 但老数据里 `grp` 存过「独立藏品」（客户端分组兜底标签被直接落库），
 * 所以读出来的地方都要过一次 groupLabel()，否则老账号会看到旧词。
 */

const LEGACY_SOLO = '独立藏品';
const SOLO_GROUP = '单品收藏';

/** 把库里的分组标签转成当前口径；空值也归到「单品收藏」 */
function groupLabel(g) {
  const v = String(g == null ? '' : g).trim();
  if (!v || v === LEGACY_SOLO) return SOLO_GROUP;
  return v;
}

module.exports = { groupLabel, SOLO_GROUP, LEGACY_SOLO };
