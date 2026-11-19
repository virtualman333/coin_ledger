'use strict';
/**
 * 贵金属（precious_metal）字段规则。
 *
 * 主理人已拍板的三条口径，全部落在这里，T04 的管理端 `/api/admin/pm` 直接引用：
 *
 *   A1 粒度：一「套」一行（no = 138/139/140），套内规格明细进 cl_pm_pieces。
 *           不为每一枚规格建一条目录行（否则 28 个规格 / 165 个品种 = 17%，
 *           直接破 G3「贵金属占比 ≤10%、首屏 0 条」）。
 *   A2 克重：套级 weight_g 留空；is_set=1 时必须给 set_weight_g + set_pieces。
 *           set_weight_g 由套内明细求和得出，纯算术，不是估算。
 *   A3 面额与发行量：
 *           · 套级 face = 整套面额合计（= set_face_total）。前台卡片不展示套级面额，
 *             详情页标「整套面额合计」。
 *           · 套级 mintage 恒 NULL；逐枚最大发行量存 cl_pm_pieces.max_mintage，
 *             单位由 mintage_unit 标注（贵金属公告是「枚」，存量普通币是「万枚」，绝不能混）。
 *
 * 校验函数返回**字段级**错误（{field, error}），管理端可以就地标红；
 * 顶层文案保持中文，与既有接口风格一致。
 */
const common = require('./common');

/** 三条口径的原文（写进接口错误与文档，避免口径漂移时找不到依据） */
const RULE_TEXT = {
  A1: '贵金属一「套」= 一个目录单元，套内规格明细进 cl_pm_pieces',
  A2: 'is_set=1 时必须提供 set_pieces 与 set_weight_g；套级 weight_g 留空',
  A3: '套级 mintage 恒为 NULL，逐枚最大发行量以「枚」存入规格明细'
};

const METALS = ['gold', 'silver', 'platinum', 'bimetal', 'mixed'];
const PIECE_METALS = ['gold', 'silver', 'platinum', 'bimetal'];
const SHAPES = ['round', 'plum', 'rhombus', 'other'];
const QUALITIES = ['proof', 'uncirculated'];
const ISSUE_METHODS = ['reservation', 'lottery', 'direct_sale', 'unknown'];

/**
 * 判断是否像一条可点开的来源 URL。
 *
 * @param {unknown} v 值
 * @returns {boolean} 是否合法
 */
function isUrl(v) {
  const s = String(v === null || v === undefined ? '' : v).trim();
  return /^https?:\/\/[^\s]+$/i.test(s);
}

/**
 * 套内明细求和（纯算术）。
 *
 * @param {Array<object>} pieces 明细
 * @returns {{setWeightG:number,setFaceTotal:number,minMintage:number,count:number}} 汇总
 */
function summarizePieces(pieces) {
  const list = Array.isArray(pieces) ? pieces : [];
  let weight = 0;
  let face = 0;
  let minMintage = Infinity;
  list.forEach((p) => {
    weight += Number(p.weight_g || p.weightG || 0);
    face += Number(p.face || 0);
    const m = Number(p.max_mintage || p.maxMintage || 0);
    if (m > 0) minMintage = Math.min(minMintage, m);
  });
  return {
    setWeightG: Math.round(weight * 100) / 100,
    setFaceTotal: Math.round(face * 100) / 100,
    minMintage: minMintage === Infinity ? 0 : minMintage,
    count: list.length
  };
}

/**
 * 校验单枚明细。
 *
 * @param {object} piece 明细
 * @param {number} index 下标（从 0 起）
 * @returns {Array<{field:string,error:string}>} 错误列表
 */
function validatePiece(piece, index) {
  const errors = [];
  const p = piece || {};
  const at = 'pieces[' + index + ']';
  const seq = Number(p.seq);

  if (!Number.isInteger(seq) || seq < 1) errors.push({ field: at + '.seq', error: '套内序号必须是 ≥1 的整数' });
  if (!String(p.name || '').trim()) errors.push({ field: at + '.name', error: '缺少规格名称' });
  if (PIECE_METALS.indexOf(p.metal) < 0) errors.push({ field: at + '.metal', error: '材质只能是 gold/silver/platinum/bimetal' });

  const weight = common.toNumberOrNull(p.weight_g !== undefined ? p.weight_g : p.weightG);
  if (weight === null || weight <= 0) errors.push({ field: at + '.weight_g', error: '克重必须大于 0' });

  const purity = common.toNumberOrNull(p.purity);
  if (purity === null || purity <= 0 || purity > 1) errors.push({ field: at + '.purity', error: '成色必须在 (0, 1] 之间' });

  const face = common.toNumberOrNull(p.face);
  if (face === null || face < 0) errors.push({ field: at + '.face', error: '面额必须 ≥0' });

  const mintage = common.toIntOrNull(p.max_mintage !== undefined ? p.max_mintage : p.maxMintage);
  if (mintage === null || mintage <= 0) errors.push({ field: at + '.max_mintage', error: '最大发行量必须是大于 0 的整数（单位=枚）' });

  const unit = p.mintage_unit || p.mintageUnit;
  if (unit !== undefined && unit !== null && ['piece', 'wan_piece'].indexOf(String(unit)) < 0) {
    errors.push({ field: at + '.mintage_unit', error: '发行量单位只能是 piece 或 wan_piece' });
  }
  if (p.shape !== undefined && p.shape !== null && SHAPES.indexOf(String(p.shape)) < 0) {
    errors.push({ field: at + '.shape', error: '器型只能是 round/plum/rhombus/other' });
  }
  if (p.quality !== undefined && p.quality !== null && QUALITIES.indexOf(String(p.quality)) < 0) {
    errors.push({ field: at + '.quality', error: '工艺只能是 proof/uncirculated' });
  }
  return errors;
}

/**
 * 校验一「套」贵金属。
 *
 * @param {object} payload 套数据（含 pieces[]）
 * @param {{forPublish?: boolean, exists?: boolean}} [opts] forPublish 时额外检查核验与主图
 * @returns {{ok:boolean, errors:Array<{field:string,error:string}>, normalized:object}} 校验结果
 */
function validateSet(payload, opts) {
  const p = common.isPlainObject(payload) ? payload : {};
  const options = opts || {};
  const errors = [];

  /* ---- 基本 ---- */
  const year = common.toIntOrNull(p.year);
  if (year === null || year < 1900 || year > 2100) errors.push({ field: 'year', error: '发行年份不合法' });

  const name = String(p.name || '').trim();
  if (!name) errors.push({ field: 'name', error: '缺少套名称' });
  else if (name.length > 128) errors.push({ field: 'name', error: '套名称不能超过 128 字' });

  const no = common.toIntOrNull(p.no);
  if (!options.exists) {
    // A1：新套的 no 必须是 138 起（1..137 是历史边界，永久锁定）
    if (no !== null && no !== undefined && no <= common.LEGACY_NO_MAX) {
      errors.push({ field: 'no', error: '新编号必须大于 ' + common.LEGACY_NO_MAX });
    }
  }

  if (!String(p.series || 'PM').trim()) errors.push({ field: 'series', error: '缺少系列 key' });

  /* ---- A2 克重 ---- */
  const isSet = p.is_set === 1 || p.is_set === true || p.isSet === 1 || p.isSet === true ? 1 : 0;
  const setPieces = common.toIntOrNull(p.set_pieces !== undefined ? p.set_pieces : p.setPieces);
  const setWeightG = common.toNumberOrNull(p.set_weight_g !== undefined ? p.set_weight_g : p.setWeightG);
  const weightG = common.toNumberOrNull(p.weight_g !== undefined ? p.weight_g : p.weightG);

  if (isSet) {
    if (setPieces === null || setPieces < 1) errors.push({ field: 'set_pieces', error: 'A2：套内枚数必须 ≥1' });
    if (setWeightG === null || setWeightG <= 0) errors.push({ field: 'set_weight_g', error: 'A2：套总克重必须大于 0' });
    if (weightG !== null) errors.push({ field: 'weight_g', error: 'A2：套装的套级克重必须留空，改用 set_weight_g' });
  } else if (weightG === null || weightG <= 0) {
    errors.push({ field: 'weight_g', error: '单枚品种必须提供 weight_g' });
  }

  /* ---- 材质与成色 ---- */
  if (METALS.indexOf(p.metal) < 0) errors.push({ field: 'metal', error: '材质只能是 gold/silver/platinum/bimetal/mixed' });
  const purity = common.toNumberOrNull(p.purity);
  if (purity !== null && (purity <= 0 || purity > 1)) errors.push({ field: 'purity', error: '成色必须在 (0, 1] 之间' });

  /* ---- A3 面额与发行量 ---- */
  const face = common.toNumberOrNull(p.face);
  if (face !== null && face < 0) errors.push({ field: 'face', error: '面额必须 ≥0' });
  if (isSet && (p.mintage !== undefined && p.mintage !== null && p.mintage !== '')) {
    errors.push({ field: 'mintage', error: 'A3：套装的套级发行量必须为 NULL，逐枚发行量写进规格明细' });
  }
  if (isSet && !String(p.mintage_note || p.mintageNote || '').trim()) {
    errors.push({ field: 'mintage_note', error: 'A3：套装必须用 mintage_note 说明「发行量逐枚不同，见规格明细」' });
  }
  const unit = p.mintage_unit || p.mintageUnit;
  if (unit !== undefined && unit !== null && ['wan_piece', 'piece'].indexOf(String(unit)) < 0) {
    errors.push({ field: 'mintage_unit', error: '发行量单位只能是 piece 或 wan_piece' });
  }

  /* ---- 发行方式 ---- */
  if (p.issue_method !== undefined && p.issue_method !== null && ISSUE_METHODS.indexOf(String(p.issue_method)) < 0) {
    errors.push({ field: 'issue_method', error: '发行方式只能是 reservation/lottery/direct_sale/unknown' });
  }
  if (p.quality !== undefined && p.quality !== null && QUALITIES.indexOf(String(p.quality)) < 0) {
    errors.push({ field: 'quality', error: '工艺只能是 proof/uncirculated' });
  }
  if (p.shape !== undefined && p.shape !== null && SHAPES.indexOf(String(p.shape)) < 0) {
    errors.push({ field: 'shape', error: '器型只能是 round/plum/rhombus/other' });
  }

  /* ---- 来源（新建/编辑必填；存量迁移数据不校验这一条） ---- */
  if (!options.exists && !isUrl(p.source_url || p.sourceUrl)) {
    errors.push({ field: 'source_url', error: '必须提供可核验的公告链接（http/https）' });
  }

  /* ---- 规格明细 ---- */
  const pieces = Array.isArray(p.pieces) ? p.pieces : [];
  if (isSet) {
    if (!pieces.length) {
      errors.push({ field: 'pieces', error: '套装必须提供套内规格明细' });
    } else if (setPieces !== null && pieces.length !== setPieces) {
      errors.push({ field: 'pieces', error: '规格明细行数（' + pieces.length + '）必须等于 set_pieces（' + setPieces + '）' });
    }
    const seqs = {};
    pieces.forEach((piece, i) => {
      validatePiece(piece, i).forEach((e) => errors.push(e));
      const s = Number(piece && piece.seq);
      if (seqs[s]) errors.push({ field: 'pieces[' + i + '].seq', error: '套内序号重复：' + s });
      seqs[s] = true;
    });

    // 纯算术校验：套级字段必须等于逐枚求和，否则就是人工填错
    const sum = summarizePieces(pieces);
    if (setWeightG !== null && Math.abs(sum.setWeightG - setWeightG) > 0.01) {
      errors.push({ field: 'set_weight_g', error: '套总克重应等于明细求和 ' + sum.setWeightG + 'g，实际填了 ' + setWeightG + 'g' });
    }
    if (face !== null && Math.abs(sum.setFaceTotal - face) > 0.01) {
      errors.push({ field: 'face', error: '整套面额合计应等于明细求和 ' + sum.setFaceTotal + ' 元，实际填了 ' + face + ' 元' });
    }
    if (setPieces !== null && sum.count !== setPieces) {
      errors.push({ field: 'set_pieces', error: 'set_pieces 与明细行数不一致' });
    }
  } else if (pieces.length) {
    errors.push({ field: 'pieces', error: '单枚品种不应带规格明细（is_set=0）' });
  }

  /* ---- 上架前置条件（P1-4：未核验不允许发布） ---- */
  if (options.forPublish) {
    if (!(p.verified === 1 || p.verified === true)) {
      errors.push({ field: 'verified', error: '未核验来源的品种不允许上架' });
    }
    if (!isUrl(p.source_url || p.sourceUrl)) {
      errors.push({ field: 'source_url', error: '上架前必须补齐公告链接' });
    }
  }

  const normalized = {
    no: no,
    category: 'precious_metal',
    categoryRank: common.CATEGORY_RANK.precious_metal,
    kind: 'coin',
    year: year,
    name: name,
    series: String(p.series || 'PM').trim(),
    seriesKeys: Array.isArray(p.series_keys || p.seriesKeys) ? (p.series_keys || p.seriesKeys) : [String(p.series || 'PM').trim()],
    face: face === null ? 0 : face,
    mintage: isSet ? null : common.toNumberOrNull(p.mintage),
    mintageUnit: isSet ? null : (unit || 'wan_piece'),
    mintageNote: p.mintage_note || p.mintageNote || null,
    material: String(p.material || '').trim(),
    metal: p.metal,
    purity: purity,
    weightG: weightG,
    spec: p.spec || null,
    shape: p.shape || null,
    quality: p.quality || null,
    issueMethod: p.issue_method || p.issueMethod || 'unknown',
    issueDate: common.toDateOnly(p.issue_date || p.issueDate),
    isSet: isSet,
    setPieces: isSet ? setPieces : null,
    setWeightG: isSet ? setWeightG : null,
    setFaceTotal: isSet ? (face === null ? 0 : face) : null,
    salesChannel: p.sales_channel || p.salesChannel || null,
    dealer: p.dealer || null,
    certificate: p.certificate || null,
    packaging: p.packaging || null,
    obverse: p.obverse || null,
    reverse: p.reverse || null,
    caster: p.caster || null,
    sourceUrl: String(p.source_url || p.sourceUrl || '').trim(),
    sourceText: p.source_text || p.sourceText || null,
    sourceDate: common.toDateOnly(p.source_date || p.sourceDate),
    verified: common.toBoolInt(p.verified),
    status: options.forPublish ? 'published' : (p.status === 'published' ? 'published' : 'draft'),
    pieces: isSet ? pieces : []
  };

  return { ok: errors.length === 0, errors: errors, normalized: normalized };
}

/**
 * G3 红线：贵金属目录占比 ≤10%（且首屏 0 条由前端分段控件保证）。
 *
 * @param {number} pmCount 贵金属条数
 * @param {number} total 目录总条数
 * @returns {{ratio:number, ok:boolean}} 占比与判定
 */
function checkRatio(pmCount, total) {
  const t = Number(total) || 0;
  const p = Number(pmCount) || 0;
  const ratio = t === 0 ? 0 : p / t;
  return { ratio: Math.round(ratio * 10000) / 10000, ok: ratio <= 0.1 };
}

module.exports = {
  RULE_TEXT: RULE_TEXT,
  METALS: METALS,
  PIECE_METALS: PIECE_METALS,
  SHAPES: SHAPES,
  QUALITIES: QUALITIES,
  ISSUE_METHODS: ISSUE_METHODS,
  isUrl: isUrl,
  summarizePieces: summarizePieces,
  validatePiece: validatePiece,
  validateSet: validateSet,
  checkRatio: checkRatio
};
