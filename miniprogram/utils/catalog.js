/**
 * 品种目录（内置，离线可用）。
 * 「一套」件数由套系声明：整卷 20 枚 / 整刀 20 张；多枚套币按发行套（建国 35 周年 3 枚、冬奥对钞 2 张）。
 */
const raw = require('../data/catalog.js');
const api = require('./api');

const PER_SET = 20;

/** 老包体可能没有 category 字段：按 kind 兜底，绝不把贵金属误判成普通币 */
const categoryOf = (c) => (c && c.category) || ((c && c.kind === 'note') ? 'commemorative_note' : 'commemorative_coin');
const isPm = (c) => categoryOf(c) === 'precious_metal';
const SETS = raw.sets || {};
const SERIES = raw.series || {};

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function fmtMintage(w) {
  const n = Number(w) || 0;
  if (!n) return '—';
  if (n >= 10000) {
    const y = Math.round((n / 10000) * 10) / 10;   // 保留 1 位：19996 万 → 2 亿
    return y + ' 亿';
  }
  return n + ' 万';
}

function pad3(n) {
  const s = String(n);
  return s.length >= 3 ? s : ('00' + s).slice(-3);
}

/** 单件的面额与市价（face 统一按单件存） */
function unitOf(coin) {
  return { face: round2(coin.face), est: round2(coin.est) };
}

/** 简称：去掉「（xx）」与年份前缀，取「·」后段，用于标签与列表 */
function shortName(name) {
  const text = String(name || '');
  const head = text.split('（')[0];
  if (head.indexOf('·') >= 0) return head.split('·').pop().trim();
  const inner = /（(.+?)）/.exec(text);
  if (inner) {
    const seg = inner[1].split('·')[0].trim();
    if (seg.length <= 5) return seg;
  }
  const trimmed = head.replace(/^\d{4}年贺岁/, '').trim();
  return trimmed || text;
}

function groupName(coin) {
  const meta = SETS[coin.set];
  return coin.set && coin.set !== 'single' && meta && meta.name ? meta.name : '独立藏品';
}

/** 一「套」包含几件（展示口径）：按实物成套 —— 整卷 20 枚 / 套系声明的件数。
 *  央行「每人预约限额」（reserveLimit）不参与计算：
 *  它约束的是「一次能买多少」，不是「一套有几件」，混用会出现「一套 10 枚」这种与实物不符的展示。 */
function setSizeOf(coin) {
  // 管理端显式设置的一套件数优先级最高
  if (coin && coin.setSize > 0) return coin.setSize;
  // 展示口径：预约限额优先（二轮羊/猴/鸡 40 枚一卷，2018 起 20 枚）
  if (coin && coin.limit > 0) return coin.limit;
  return setSizeBaseOf(coin);
}

/** 物理成套件数：只给账本用 —— 账本记的是手里实际几卷几套，不跟预约限额走 */
function setSizeBaseOf(coin) {
  if (coin && coin.setSize > 0) return coin.setSize;
  const meta = SETS[coin.set];
  return meta && meta.size ? meta.size : PER_SET;
}

const coins = raw.coins.map((c) => {
  const unit = unitOf(c);
  const size = setSizeOf(c);
  const item = Object.assign({}, c, {
    faceUnit: unit.face,
    estUnit: unit.est,
    setSize: size,
    setSizeBase: setSizeBaseOf(c),
    setFace: round2(unit.face * size),
    setEst: round2(unit.est * size),
    setFaceBase: round2(unit.face * setSizeBaseOf(c)),
    group: groupName(c),
    short: shortName(c.name),
    seriesName: isPm(c) ? '贵金属' : (SERIES[c.series] || '其他'),
    imgUrl: c.img ? api.BASE + '/img/' + pad3(c.id) + '.jpg' : '',
    // 统一裁切过的方形缩略图（去白边、币占满画布），卡片与大图预览用它
    thumbUrl: c.img ? api.BASE + '/img/th/' + pad3(c.id) + '.jpg' : '',
    // 160px 小图，列表行 / 首页卡片用（约 5KB，是原图的 1/8）
    smallUrl: c.img ? api.BASE + '/img/th/s/' + pad3(c.id) + '.jpg' : '',
    // 多图：正面 / 背面 / 整套；没有多图时退回单图
    imgs: (c.imgs && c.imgs.length
      ? c.imgs.map((it) => ({
          url: api.BASE + '/img/' + it.f,
          kind: it.k,
          label: it.label,
        }))
      : (c.img ? [{ url: api.BASE + '/img/' + pad3(c.id) + '.jpg', kind: 'main', label: '主图' }] : [])),
    faceText: unit.face + ' 元/' + (c.kind === 'note' ? '张' : '枚'),
    mintageText: fmtMintage(c.mintage),
    // 纪念钞没有「直径」，只有票幅（145×70）；数据里用 '—' 占位时别再拼「毫米」
    diaText: /^\d+(\.\d+)?$/.test(String(c.dia))
      ? c.dia + ' 毫米'
      : (c.size ? c.size + ' 毫米' : '—'),
  });
  return item;
});

/** 发行计划（央行年度计划），与网站 /plan 共用 public/data/plan.json */
const PLAN = (raw.plan && Array.isArray(raw.plan.years)) ? raw.plan : { years: [] };

const byId = {};
const byName = {};
coins.forEach((c) => {
  byId[c.id] = c;
  byName[c.name] = c;
});

/**
 * 系列列表：以系列主数据（seriesMeta）为准，成员按 coin.seriesKeys 统计。
 * 一个品种可以属于多个系列，所以各系列数量之和 ≥ 品种总数。
 */
const seriesMeta = raw.seriesMeta || [];

function keysOf(c) {
  return (Array.isArray(c.seriesKeys) && c.seriesKeys.length) ? c.seriesKeys : (c.series ? [c.series] : []);
}

const seriesList = (seriesMeta.length
  ? seriesMeta.map((m) => ({
    code: m.key,
    name: m.name,
    desc: m.desc || '',
    img: m.img || '',
    sort: m.sort || 0,
    count: coins.filter((c) => keysOf(c).indexOf(m.key) >= 0).length,
  }))
  : Object.keys(SERIES).map((code) => ({
    code,
    name: SERIES[code],
    desc: '',
    img: '',
    sort: 0,
    count: coins.filter((c) => keysOf(c).indexOf(code) >= 0).length,
  }))).filter((s) => s.count > 0).sort((a, b) => a.sort - b.sort);


/**
 * AI 推理价：只用公开参数估的理论价。
 *    ln(P) = 12.605 − 2.2721·ln(M) + 0.1102·ln(M)² + 0.3325·ln(1+age) + 材质系数 + 钞系数
 *   M   = 发行量（万枚 / 万张）
 *   age = 今年 − 发行年
 * 系数由 136 个在册品种的参考价做对数回归得到（R²≈0.83，中位误差 ~5 元）。
 * 它衡量的是「发行量 + 材质 + 年代」能解释的那部分价值，
 * 题材溢价、龙头地位这类因素不在模型里 —— 也正因如此，和参考价的差额本身就是信号。
 *
 * 通胀怎么处理：时间项 ln(1+age) 是从真实市价回归出来的**名义**增长曲线，
 * 里面已经含了通胀（老币的名义价本来就跟着物价走）。再乘一个通胀因子会重复计算，
 * 实测这样做反而把 R² 从 0.83 拉低到 0.78。
 * 所以通胀只用作**下限保护**：面值按年化 2.5% 折到今天，理论价不该低于它。
 */
const AI_MAT = {
  '双色铜合金': 0.8456,
  '钢芯镀镍': 0.0384,
  '紫铜合金': 0.8331,
  '铜镍合金': 1.4898,
  '纸质': 1.1127,
  '塑料': 0.7390,
  '铜锌合金': 1.7983,
  '镍包钢': -1.3443,
};

function aiPriceOf(coin) {
  if (!coin) return 0;
  const thisYear = new Date().getFullYear();
  const M = Math.max(1, Number(coin.mintage) || 1000);
  const age = Math.max(0, thisYear - (Number(coin.year) || thisYear));
  const lm = Math.log(M);
  let ln = 12.605 - 2.2721 * lm + 0.1102 * lm * lm + 0.3325 * Math.log(1 + age);
  ln += AI_MAT[coin.material] || 0;
  if (coin.kind === 'note') ln += 1.8516;
  let p = Math.exp(ln);
  // 下限：面值本身 + 面值按 2.5%/年折到今天的购买力，取大者
  const face = Number(coin.face) || 1;
  const infl = Math.pow(1.025, age);
  const floor = Math.max(face * 1.2, face * infl);
  if (!isFinite(p) || p < floor) p = floor;
  return Math.round(p * 10) / 10;
}

/** 系列名（以系列主数据为准，找不到再退回旧字典） */
function seriesName(code) {
  const hit = seriesList.filter((s) => s.code === code)[0];
  return hit ? hit.name : (SERIES[code] || '');
}

/** 某个系列下的品种（按 seriesKeys 判断，支持一个品种属于多个系列） */
function inSeries(code) {
  if (!code) return coins;
  return coins.filter((c) => keysOf(c).indexOf(code) >= 0);
}

/** 千分位金额，去掉多余的 .00 */
function money(n) {
  const v = round2(n);
  const neg = v < 0;
  const abs = Math.abs(v);
  const fixed = abs.toFixed(2);
  const parts = fixed.split('.');
  const int = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const trim = String(parts[1] || '').replace(/0+$/, '');
  const dec = trim ? '.' + trim : '';
  return (neg ? '-' : '') + int + dec;
}

function signed(n) {
  const v = round2(n);
  if (v > 0) return '+' + money(v);
  return money(v);
}

module.exports = {
  PER_SET,
  categoryOf,
  isPm,
  pmCoins: coins.filter(isPm),
  coins,
  byId,
  byName,
  seriesList,
  inSeries,
  aiPriceOf,
  seriesName,
  series: SERIES,
  sets: SETS,
  fmtMintage,
  unitOf,
  setSizeOf,
  setSizeBaseOf,
  groupName,
  shortName,
  money,
  signed,
  round2,
  plan: PLAN,
  total: coins.length,
  descCount: coins.filter((c) => c.desc).length,
};
