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

const coinsDoc = JSON.parse(fs.readFileSync(path.join(ROOT, 'public/data/coins.json'), 'utf8'));
const descDoc = JSON.parse(fs.readFileSync(path.join(ROOT, 'public/data/descriptions.json'), 'utf8'));
const imgDoc = JSON.parse(fs.readFileSync(path.join(ROOT, 'public/data/images.json'), 'utf8'));
let galDoc = { coins: {} };
try {
  galDoc = JSON.parse(fs.readFileSync(path.join(ROOT, 'public/data/gallery.json'), 'utf8'));
} catch (e) {
  console.warn('没有 gallery.json，按单图打包');
}
const KIND_LABEL = { main: '主图', obverse: '正面', reverse: '背面', set: '整套' };

const realSet = new Set((imgDoc.real || []).map(Number));

const coins = coinsDoc.coins.map((c) => {
  const id = c.i + 1;                     // 图片编号 = 序号 + 1，文件名 001.jpg 起
  const d = descDoc[String(id)] || null;
  const row = {
    id,
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

const payload = {
  generatedAt: new Date().toISOString(),
  meta: coinsDoc.meta || {},
  series: coinsDoc.series || {},
  seriesMeta: (function () {
    try { return JSON.parse(fs.readFileSync(path.join(ROOT, 'public', 'data', 'series.json'), 'utf8')).items || []; }
    catch (e) { return []; }
  })(),
  sets: coinsDoc.sets || {},
  plan,
  coins,
};

const banner = '/* 由 tools/build_mp_data.js 生成，请勿手改。数据源：public/data/*.json */\n';
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, banner + 'module.exports = ' + JSON.stringify(payload) + ';\n', 'utf8');

const kb = (fs.statSync(OUT).size / 1024).toFixed(1);
console.log(`写入 ${path.relative(ROOT, OUT)}：${coins.length} 个品种，${kb} KB`);
console.log(`其中有真实图 ${coins.filter((c) => c.img).length} 个，有介绍 ${coins.filter((c) => c.desc).length} 个`);
console.log(`发行计划 ${(plan.years || []).length} 个年度 / ${(plan.years || []).reduce((a, y) => a + (y.items || []).length, 0)} 个项目`);
