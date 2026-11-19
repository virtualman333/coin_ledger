'use strict';
/**
 * 把网站的品种目录打包成小程序内置数据模块。
 * 品种目录是静态参考数据（不随用户变化），内置进包体可以离线秒开、不耗流量；
 * 账号 / 藏品 / 行情走服务器数据库（/api/state、/api/holdings）。
 *
 *   node tools/build_mp_data.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'miniprogram', 'data', 'catalog.js');

/* T04：优先吃 export:json 的 latest 产物（与 DB 同源）；没有就回落 public/data，
   并明确打印警告 —— 灰度期两者可能不同步，静默回落最危险（arch 6.3）。 */
const LATEST = path.join(ROOT, 'data', 'exports', 'latest');
const SRC = fs.existsSync(path.join(LATEST, 'coins.json')) ? LATEST : path.join(ROOT, 'public', 'data');
if (SRC === path.join(ROOT, 'public', 'data')) {
  console.warn('  ! data/exports/latest 不存在，回落 public/data/*.json（请先跑 export:json）');
}
function readSrc(name, fallback) {
  try { return JSON.parse(fs.readFileSync(path.join(SRC, name), 'utf8')); }
  catch (e) { return fallback; }
}
const coinsDoc = readSrc('coins.json', { coins: [], series: {}, sets: {}, defaults: [] });
const descDoc = readSrc('descriptions.json', {});
const imgDoc = readSrc('images.json', { real: [], mock: [] });
const galDoc = readSrc('gallery.json', { coins: {} });
const KIND_LABEL = { main: '主图', obverse: '正面', reverse: '背面', set: '整套' };

const realSet = new Set((imgDoc.real || []).map(Number));

const coins = coinsDoc.coins.map((c) => {
  const id = c.i + 1;                     // 图片编号 = 序号 + 1，文件名 001.jpg 起
  const d = descDoc[String(id)] || null;
  const row = {
    id,                                  // 与现有小程序代码一致：id = c.i + 1，不改成 no
    no: c.i + 1,
    category: c.category || (c.kind === 'note' ? 'commemorative_note' : 'commemorative_coin'),
    hasPrice: c.category !== 'precious_metal',
    year: c.year,
    name: c.name,
    series: c.series,
    seriesKeys: c.seriesKeys || (c.series ? [c.series] : []),
    face: c.face,
    mintage: c.mintage,
    material: c.material,
    dia: c.dia,
    // 钞没有直径，只有票幅；小程序详情页直接读 diaText，别再让它显示空白
    diaText: c.kind === 'note'
      ? (c.size ? String(c.size).replace('×', ' × ') + 'mm' : '—')
      : (c.dia === '—' || !c.dia ? '—' : c.dia + 'mm'),
    diaLabel: c.kind === 'note' ? '票幅' : '直径',
    // 实物参数（元禾收藏补充）：厚度/重量/铸造单位/边齿/正背面图案
    thickness: c.thickness || '',
    weight: c.weight || '',
    caster: c.caster || '',
    edge: c.edge || '',
    obverse: c.obverse || '',
    reverse: c.reverse || '',
    specFrom: c.specFrom || '',
    limit: c.limit || 0,
    kind: c.kind,
    est: c.est,
    set: c.set || 'single',
    pieces: c.pieces || 1,
    setSize: c.setSize || 0,   // 管理端设定的一套件数（0 = 按默认算）
    img: realSet.has(id),
  };
  const gal = (galDoc.coins && galDoc.coins[String(id)]) || [];
  if (gal.length) {
    row.imgs = gal
      .filter((it) => it && it.f)
      .map((it) => ({ url: '',
        f: it.f, k: it.k || 'main', label: KIND_LABEL[it.k] || '图片' }));
    row.imgs.sort((a, b) => (a.k === 'main' ? -1 : 0) - (b.k === 'main' ? -1 : 0));
  }
  if (d && d.text) {
    // descMd 保留分段与 **粗体**（详情页用 rich-text 渲染）；desc 留一份压平纯文本做摘要/分享
    const raw = d.textMd || d.text || '';
    row.descMd = String(raw).trim();
    row.desc = String(raw).replace(/\s+/g, ' ').trim().slice(0, 140);   // 摘要/分享用，控制包体积
    row.descTitle = d.title || '';
    row.descSrc = d.source === 'baike' ? '百度百科' : (d.title ? '中国人民银行公告' : '');
  }
  return row;
});

// 发行计划（央行年度计划）：网站 /plan 与小程序 pages/plan 共用同一份数据
let plan = { years: [] };
try {
  plan = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'public', 'data', 'plan.json'), 'utf8'));
} catch (e) {
  console.warn('  ! 没读到 plan.json，发行计划将为空');
}

/* 贵金属已上架套：从种子文件读取（draft 不打包），字段与网站 /api/catalog 一致。
   种子路径与后端共用 config.PM_SEED_FILE 的默认值（这里不连库、不引 Fastify）。 */
const pmSeedFile = path.join(ROOT, 'data', 'seeds', 'precious-metal-2026.json');
let pmRows = [];
try {
  const pmDoc = JSON.parse(fs.readFileSync(pmSeedFile, 'utf8'));
  pmRows = (pmDoc.sets || []).filter((s) => s.status === 'published').map((s) => ({
    id: s.no,
    no: s.no,
    category: 'precious_metal',
    hasPrice: false,
    year: s.year,
    name: s.name,
    series: s.series || 'PM',
    seriesKeys: s.series_keys || ['PM'],
    face: s.face,
    mintage: null,
    mintageNote: s.mintage_note || '',
    material: s.material || '',
    dia: '—',
    diaText: '—',
    diaLabel: '规格',
    thickness: '',
    weight: s.set_weight_g ? s.set_weight_g + ' 克（全套）' : '',
    caster: s.caster || '',
    edge: '',
    obverse: s.obverse || '',
    reverse: s.reverse || '',
    specFrom: '',
    limit: 0,
    kind: 'coin',
    est: undefined,
    set: 'single',
    pieces: s.set_pieces,
    setSize: s.set_pieces,
    img: fs.existsSync(path.join(ROOT, 'public', 'img', String(s.no).padStart(3, '0') + '.jpg')),
    pm: {
      metal: s.metal, purity: s.purity, weightG: s.weight_g, weightText: null,
      spec: null, shape: s.shape, quality: s.quality, issueMethod: s.issue_method,
      issueDate: s.issue_date, isSet: !!s.is_set, setPieces: s.set_pieces,
      setWeightG: s.set_weight_g, setFaceTotal: s.set_face_total,
      salesChannel: s.sales_channel, dealer: s.dealer, certificate: s.certificate,
      packaging: s.packaging, mintageNote: s.mintage_note,
      pieces: (s.pieces || []).map((p) => ({
        seq: p.seq, name: p.name, metal: p.metal, weightG: p.weight_g, purity: p.purity,
        face: p.face, maxMintage: p.max_mintage, mintageUnit: 'piece', shape: p.shape,
        sizeText: p.size_text, quality: p.quality, reverseText: p.reverse_text || ''
      }))
    }
  }));
} catch (e) {
  console.warn('  ! 贵金属种子不可读，小程序包不含贵金属：' + e.message);
}
const allCoins = coins.concat(pmRows);

const payload = {
  generatedAt: new Date().toISOString(),
  meta: coinsDoc.meta || {},
  series: coinsDoc.series || {},
  seriesMeta: (function () {
    try { return (readSrc('series.json', { items: [] }).items || []); }
    catch (e) { return []; }
  })(),
  sets: coinsDoc.sets || {},
  plan,
  coins: allCoins,
};

const banner = '/* 由 tools/build_mp_data.js 生成，请勿手改。数据源：public/data/*.json */\n';
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, banner + 'module.exports = ' + JSON.stringify(payload) + ';\n', 'utf8');

const kb = (fs.statSync(OUT).size / 1024).toFixed(1);
const MAX_KB = 372;   // 286KB × 1.3（PRD P0-8 包体守卫）
if (Number(kb) > MAX_KB) {
  console.error(`包体 ${kb}KB 超过 ${MAX_KB}KB 上限，请检查目录字段是否膨胀`);
  process.exit(1);
}
console.log(`写入 ${path.relative(ROOT, OUT)}：${allCoins.length} 个品种（含贵金属 ${pmRows.length} 套），${kb} KB`);
console.log(`其中有真实图 ${coins.filter((c) => c.img).length} 个，有介绍 ${coins.filter((c) => c.desc).length} 个`);
console.log(`发行计划 ${(plan.years || []).length} 个年度 / ${(plan.years || []).reduce((a, y) => a + (y.items || []).length, 0)} 个项目`);
