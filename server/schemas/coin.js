'use strict';
/**
 * 品种字段白名单与类型（唯一一份）。
 *
 * 三处消费：
 *   1. repositories/coin.repo.js —— 生成 SELECT 别名列表、INSERT/UPDATE 的列名；
 *   2. services/coin.service.js  —— 写操作白名单（不在名单里的字段直接丢弃）；
 *   3. tools/migrate-catalog-to-db.js —— 校验 JSON → 列 的类型收敛。
 *
 * 约定：对外 JSON 用 camelCase，库里是 snake_case。映射只写在这里，
 * 任何地方都不许再手写一遍列名（否则迁移/导出必然分叉）。
 */
const common = require('./common');

/**
 * 字段定义。
 *   col       库内列名
 *   type      int|uint|decimal|string|text|json|bool|date|enum|datetime
 *   nullable  允许 NULL（写入时 null 落 NULL，而不是 0/''）
 *   readOnly  由库或系统维护，外部 patch 一律忽略
 */
const FIELDS = {
  id: { col: 'id', type: 'int', readOnly: true },
  no: { col: 'no', type: 'uint', readOnly: true },          // 保号红线：永不可写
  category: { col: 'category', type: 'enum', values: common.CATEGORIES, readOnly: true },
  categoryRank: { col: 'category_rank', type: 'uint', readOnly: true },
  kind: { col: 'kind', type: 'enum', values: ['coin', 'note'] },
  year: { col: 'year', type: 'uint' },
  name: { col: 'name', type: 'string', maxLength: 128 },
  series: { col: 'series', type: 'string', maxLength: 16 },
  seriesKeys: { col: 'series_keys', type: 'json' },
  face: { col: 'face', type: 'decimal' },
  mintage: { col: 'mintage', type: 'decimal', nullable: true },
  mintageUnit: { col: 'mintage_unit', type: 'enum', values: ['wan_piece', 'piece'] },
  mintageNote: { col: 'mintage_note', type: 'string', maxLength: 255, nullable: true },
  material: { col: 'material', type: 'string', maxLength: 32 },
  dia: { col: 'dia', type: 'decimal', nullable: true },
  diaText: { col: 'dia_text', type: 'string', maxLength: 8, nullable: true },
  size: { col: 'size', type: 'string', maxLength: 16, nullable: true },
  thickness: { col: 'thickness', type: 'string', maxLength: 16, nullable: true },
  weight: { col: 'weight', type: 'string', maxLength: 16, nullable: true },
  caster: { col: 'caster', type: 'string', maxLength: 64, nullable: true },
  edge: { col: 'edge', type: 'string', maxLength: 32, nullable: true },
  obverse: { col: 'obverse', type: 'text', nullable: true },
  reverse: { col: 'reverse', type: 'text', nullable: true },
  specFrom: { col: 'spec_from', type: 'string', maxLength: 64, nullable: true },
  est: { col: 'est', type: 'decimal', nullable: true },
  setCode: { col: 'set_code', type: 'string', maxLength: 32 },
  pieces: { col: 'pieces', type: 'uint' },
  setSize: { col: 'set_size', type: 'uint', nullable: true },
  limitQty: { col: 'limit_qty', type: 'uint', nullable: true },
  reserveLimit: { col: 'reserve_limit', type: 'uint', nullable: true },
  /* 贵金属结构化字段（普通币钞为 NULL） */
  metal: { col: 'metal', type: 'enum', values: ['gold', 'silver', 'platinum', 'bimetal', 'mixed'], nullable: true },
  purity: { col: 'purity', type: 'decimal', nullable: true },
  weightG: { col: 'weight_g', type: 'decimal', nullable: true },
  spec: { col: 'spec', type: 'string', maxLength: 64, nullable: true },
  shape: { col: 'shape', type: 'enum', values: ['round', 'plum', 'rhombus', 'other'], nullable: true },
  quality: { col: 'quality', type: 'enum', values: ['proof', 'uncirculated'], nullable: true },
  issueMethod: { col: 'issue_method', type: 'enum', values: ['reservation', 'lottery', 'direct_sale', 'unknown'], nullable: true },
  issueDate: { col: 'issue_date', type: 'date', nullable: true },
  isSet: { col: 'is_set', type: 'bool' },
  setPieces: { col: 'set_pieces', type: 'uint', nullable: true },
  setWeightG: { col: 'set_weight_g', type: 'decimal', nullable: true },
  setFaceTotal: { col: 'set_face_total', type: 'decimal', nullable: true },
  salesChannel: { col: 'sales_channel', type: 'string', maxLength: 64, nullable: true },
  dealer: { col: 'dealer', type: 'string', maxLength: 64, nullable: true },
  certificate: { col: 'certificate', type: 'string', maxLength: 64, nullable: true },
  packaging: { col: 'packaging', type: 'string', maxLength: 64, nullable: true },
  /* 来源与状态 */
  sourceUrl: { col: 'source_url', type: 'string', maxLength: 255 },
  sourceText: { col: 'source_text', type: 'string', maxLength: 255, nullable: true },
  sourceDate: { col: 'source_date', type: 'date', nullable: true },
  verified: { col: 'verified', type: 'bool' },
  status: { col: 'status', type: 'enum', values: ['draft', 'published'], readOnly: true },
  createdAt: { col: 'created_at', type: 'datetime', readOnly: true },
  updatedAt: { col: 'updated_at', type: 'datetime', readOnly: true }
};

/** SELECT 别名列表（库内 snake_case → 对外 camelCase，一处生成） */
const SELECT_LIST = Object.keys(FIELDS).map(function (k) { return FIELDS[k].col + ' AS ' + k; }).join(', ');

/**
 * legacy 管理端可改字段（对应 server/index.js 的 applyCoinPatch 白名单 + seriesKeys）。
 * 注意 dia 走「双列规则」，set 在对外 JSON 里叫 set（列 set_code）。
 */
const LEGACY_PATCH_FIELDS = ['year', 'face', 'est', 'mintage', 'pieces', 'setSize', 'material', 'dia', 'series', 'setCode', 'kind', 'seriesKeys'];

/** 贵金属可改字段（T04 用；普通币钞不接受这些字段的批量修改） */
const PM_PATCH_FIELDS = [
  'year', 'name', 'series', 'seriesKeys', 'face', 'mintage', 'mintageUnit', 'mintageNote', 'material',
  'metal', 'purity', 'weightG', 'spec', 'shape', 'quality', 'issueMethod', 'issueDate',
  'isSet', 'setPieces', 'setWeightG', 'setFaceTotal', 'salesChannel', 'dealer', 'certificate', 'packaging',
  'obverse', 'reverse', 'caster', 'sourceUrl', 'sourceText', 'sourceDate', 'verified'
];

/** 迁移与系统维护字段：只由迁移脚本 / service 内部写，不接受外部 patch */
const SYSTEM_FIELDS = ['no', 'id', 'category', 'categoryRank', 'status', 'createdAt', 'updatedAt'];

/**
 * 单字段类型收敛。非法值返回 undefined（调用方据此判定「字段被忽略」）。
 *
 * @param {string} key camelCase 字段名
 * @param {unknown} raw 原始值
 * @returns {unknown} 收敛后的值（或 undefined）
 */
function coerceValue(key, raw) {
  const f = FIELDS[key];
  if (!f) return undefined;

  if (raw === null || raw === undefined) {
    if (f.nullable) return null;
    if (f.type === 'json') return null;
    return undefined;
  }

  switch (f.type) {
    case 'int':
    case 'uint': {
      const n = common.toIntOrNull(raw);
      if (n === null) return undefined;
      if (f.type === 'uint' && n < 0) return undefined;
      return n;
    }
    case 'decimal': {
      const n = common.toNumberOrNull(raw);
      if (n === null) return undefined;
      return n;
    }
    case 'bool':
      return common.toBoolInt(raw);
    case 'date':
      return common.toDateOnly(raw);
    case 'json': {
      if (Array.isArray(raw)) return raw.map(function (x) { return String(x); });
      if (typeof raw === 'string') {
        const s = raw.trim();
        if (!s) return null;
        try {
          const parsed = JSON.parse(s);
          return Array.isArray(parsed) ? parsed.map(function (x) { return String(x); }) : null;
        } catch (e) {
          return undefined;
        }
      }
      return undefined;
    }
    case 'enum': {
      const s = String(raw).trim();
      return f.values.indexOf(s) >= 0 ? s : undefined;
    }
    case 'string':
    case 'text': {
      const s = String(raw).trim();
      if (f.maxLength && s.length > f.maxLength) return s.slice(0, f.maxLength);
      if (s === '' && f.nullable) return null;
      return s;
    }
    default:
      return undefined;
  }
}

/**
 * 按白名单收敛一批 patch 字段。
 *
 * @param {object} patch 客户端提交的 patch
 * @param {string[]} allowed 允许写入的字段名（camelCase）
 * @returns {{values: Object<string, unknown>, applied: Object<string, unknown>, rejected: string[]}} 结果
 */
function coercePatch(patch, allowed) {
  const values = {};
  const applied = {};
  const rejected = [];
  const src = common.isPlainObject(patch) ? patch : {};
  const allow = Array.isArray(allowed) ? allowed : [];

  Object.keys(src).forEach(function (key) {
    if (allow.indexOf(key) < 0) return;                 // 白名单外：静默丢弃（与 applyCoinPatch 一致）
    const v = coerceValue(key, src[key]);
    if (v === undefined) { rejected.push(key); return; }
    values[FIELDS[key].col] = v;
    applied[key] = v;
  });

  return { values: values, applied: applied, rejected: rejected };
}

/**
 * dia 双列规则（存量有 number 也有「—」）。
 *   number  → dia=数字，dia_text=NULL
 *   "—" 等  → dia=NULL，dia_text=原文本
 *
 * @param {unknown} raw 原始 dia
 * @returns {{dia: number|null, diaText: string|null}} 两列的值
 */
function splitDia(raw) {
  if (raw === null || raw === undefined || raw === '') return { dia: null, diaText: null };
  const n = Number(raw);
  if (Number.isFinite(n)) return { dia: n, diaText: null };
  return { dia: null, diaText: String(raw).trim().slice(0, 8) };
}

module.exports = {
  FIELDS: FIELDS,
  SELECT_LIST: SELECT_LIST,
  LEGACY_PATCH_FIELDS: LEGACY_PATCH_FIELDS,
  PM_PATCH_FIELDS: PM_PATCH_FIELDS,
  SYSTEM_FIELDS: SYSTEM_FIELDS,
  coerceValue: coerceValue,
  coercePatch: coercePatch,
  splitDia: splitDia
};
