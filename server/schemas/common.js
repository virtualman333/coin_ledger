'use strict';
/**
 * 目录域通用约定：分类、排序、分页、错误文案、类型转换。
 *
 * 这个文件是**叶子模块**（不 require 任何业务模块），因为三处都要用同一份定义：
 *   - repositories/*：SQL 里的 ORDER BY 与 SELECT 别名
 *   - services/*：JSON 实现的排序、投影、分页
 *   - schemas/*：字段类型与取值域
 *
 * 「排序只有一处」的落地方式：CATALOG_ORDER_SQL 给 MySQL，compareCatalogOrder 给
 * JSON 内存实现与「迁移后自检」。两者必须保持同一口径 —— 改一处必须改另一处，
 * tests/catalog-migrate.test.js 会验证两者等价。
 */

/** 三个分类（与 cl_coins.category 枚举一致） */
const CATEGORIES = ['commemorative_coin', 'commemorative_note', 'precious_metal'];

/** 分类 → 排序权重。贵金属恒为 2，永远排在最后（G3 不喧宾夺主） */
const CATEGORY_RANK = {
  commemorative_coin: 0,
  commemorative_note: 1,
  precious_metal: 2
};

/** legacy 的 kind（coin/note）→ category */
const CATEGORY_OF_KIND = {
  coin: 'commemorative_coin',
  note: 'commemorative_note'
};

/** 唯一排序口径：分类权重升序 → 年份降序 → no 升序 */
const CATALOG_ORDER_SQL = 'c.category_rank ASC, c.year DESC, c.no ASC';

/**
 * 与 CATALOG_ORDER_SQL 等价的 JS 比较器（JSON 实现与测试用）。
 *
 * @param {object} a 行
 * @param {object} b 行
 * @returns {number} -1 / 0 / 1
 */
function compareCatalogOrder(a, b) {
  const ra = Number(a.categoryRank || 0);
  const rb = Number(b.categoryRank || 0);
  if (ra !== rb) return ra - rb;
  const ya = Number(a.year || 0);
  const yb = Number(b.year || 0);
  if (ya !== yb) return yb - ya;
  return Number(a.no || 0) - Number(b.no || 0);
}

/** 历史已收录边界：no <= 137 永久锁定（改分类 / 删除都不允许） */
const LEGACY_NO_MAX = 137;

/** 分页默认值（沿用 /api/admin/users 的既有形态） */
const PAGE_DEFAULT_SIZE = 20;
const PAGE_MAX_SIZE = 200;

/** 错误文案：必须与 server/index.js 现状逐字一致（快照会比对） */
const ERROR_TEXT = {
  notFound: '接口不存在',
  needLogin: '请先登录',
  needAdmin: '需要管理员权限',
  noImmutable: 'no 不允许修改（保号红线）',
  noCreateOutOfRange: '新编号必须从 ' + (LEGACY_NO_MAX + 1) + ' 起连续分配',
  categoryImmutable: '已发布品种的 category 不允许修改',
  notDraft: '只有草稿状态的品种可以删除',
  readonlyMode: '当前为 JSON 只读模式，品种目录暂不可修改',
  badBody: '请求体不是合法 JSON',
  tooLarge: '请求体过大',
  pmNoPrice: '贵金属不提供参考估值'
};

/**
 * 只读模式错误（DATA_SOURCE=json 时的写路径）。
 * 放在 common.js 而不是 services 里，是为了让 repositories 与 services 都能 throw
 * 同一个类，且不产生任何循环依赖。
 * 状态码 503，文案见 ERROR_TEXT.readonlyMode（管理端会原样展示，不静默失败）。
 */
class ReadonlyError extends Error {
  constructor(message) {
    super(message || ERROR_TEXT.readonlyMode);
    this.name = 'ReadonlyError';
    this.status = 503;
    this.code = 'READONLY_MODE';
  }
}

/**
 * 是否普通对象（排除数组 / null / Date）。
 *
 * @param {unknown} v 值
 * @returns {boolean} 判定
 */
function isPlainObject(v) {
  return !!v && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date);
}

/**
 * 收敛为有限数字；无法收敛时返回 null。
 *
 * @param {unknown} v 值
 * @returns {number|null} 数字
 */
function toNumberOrNull(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * 收敛为整数；无法收敛时返回 null。
 *
 * @param {unknown} v 值
 * @returns {number|null} 整数
 */
function toIntOrNull(v) {
  const n = toNumberOrNull(v);
  return n === null ? null : Math.round(n);
}

/**
 * 收敛为字符串；null/undefined 返回 null，其余 trim。
 *
 * @param {unknown} v 值
 * @returns {string|null} 字符串
 */
function toTextOrNull(v) {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === '' ? null : s;
}

/**
 * 布尔落库值（TINYINT(1)）。
 *
 * @param {unknown} v 值
 * @returns {number} 0 / 1
 */
function toBoolInt(v) {
  if (v === true || v === 1 || v === '1' || v === 'true') return 1;
  return 0;
}

/**
 * 日期列落库值：只接受 YYYY-MM-DD（DATE 列不接受 ISO 时间串）。
 *
 * @param {unknown} v 值
 * @returns {string|null} YYYY-MM-DD 或 null
 */
function toDateOnly(v) {
  if (v === null || v === undefined || v === '') return null;
  if (v instanceof Date) {
    if (Number.isNaN(v.getTime())) return null;
    return v.toISOString().slice(0, 10);
  }
  const s = String(v).trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  return m ? m[1] + '-' + m[2] + '-' + m[3] : null;
}

/**
 * 分页参数规范化。
 *
 * @param {object} query 查询串对象
 * @returns {{page:number,size:number,offset:number}} 分页信息
 */
function normalizePage(query) {
  const q = query || {};
  const page = Math.max(1, Math.floor(Number(q.page) || 1));
  const size = Math.min(PAGE_MAX_SIZE, Math.max(1, Math.floor(Number(q.size) || PAGE_DEFAULT_SIZE)));
  return { page: page, size: size, offset: (page - 1) * size };
}

module.exports = {
  CATEGORIES: CATEGORIES,
  CATEGORY_RANK: CATEGORY_RANK,
  CATEGORY_OF_KIND: CATEGORY_OF_KIND,
  CATALOG_ORDER_SQL: CATALOG_ORDER_SQL,
  compareCatalogOrder: compareCatalogOrder,
  LEGACY_NO_MAX: LEGACY_NO_MAX,
  PAGE_DEFAULT_SIZE: PAGE_DEFAULT_SIZE,
  PAGE_MAX_SIZE: PAGE_MAX_SIZE,
  ERROR_TEXT: ERROR_TEXT,
  ReadonlyError: ReadonlyError,
  isPlainObject: isPlainObject,
  toNumberOrNull: toNumberOrNull,
  toIntOrNull: toIntOrNull,
  toTextOrNull: toTextOrNull,
  toBoolInt: toBoolInt,
  toDateOnly: toDateOnly,
  normalizePage: normalizePage
};
