'use strict';
/* 把「元禾收藏」抓来的实物参数（厚度/重量/铸造单位/边齿）并入 public/data/coins.json。
 * 只补这三四个字段，不动面额/发行量等已有数据 —— 但如果发现冲突会打印出来。
 *
 * 用法：node tools/merge-ybk.js [--write]
 */
const fs = require('fs');
const path = require('path');

const COINS = path.join(__dirname, '..', 'public', 'data', 'coins.json');
const YBK = path.join(__dirname, '_data', 'ybk.json');
const doc = JSON.parse(fs.readFileSync(COINS, 'utf8'));
const ybk = JSON.parse(fs.readFileSync(YBK, 'utf8')).items;

const num = (s) => { const m = /(\d+(?:\.\d+)?)/.exec(String(s || '')); return m ? Number(m[1]) : null; };
/** 「1亿枚」「2.5亿枚」「6000万枚」统一折算成万 */
const toWan = (s) => {
  const t = String(s || '');
  const m = /(\d+(?:\.\d+)?)/.exec(t);
  if (!m) return null;
  return /亿/.test(t) ? Number(m[1]) * 10000 : Number(m[1]);
};

/** 名称切成关键词：去掉年份数字、通用后缀、括号里的别名单独拆开 */
function tokens(name) {
  return String(name || '')
    .replace(/[（(]/g, ' ').replace(/[）)]/g, ' ')
    .replace(/20\d\d|19\d\d/g, ' ')
    .replace(/流通纪念币|普通纪念币|纪念币|纪念钞|流通|普通|大全|套币/g, ' ')
    .replace(/[·—\-—、,，。.\s]+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean);
}

/** 中文没有空格，按「字二元组」求相似度，比按空格切词靠谱 */
function bigrams(str) {
  const s = String(str || '')
    .replace(/20\d\d|19\d\d/g, '')
    .replace(/流通纪念币|普通纪念币|纪念币|纪念钞|流通|普通/g, '')
    .replace(/[\s（）()·—\-—、,，。.]/g, '');
  const out = new Set();
  for (let i = 0; i < s.length - 1; i++) out.add(s.slice(i, i + 2));
  return out;
}
function overlap(a, b) {
  const A = bigrams(a), B = bigrams(b);
  let hit = 0;
  A.forEach((g) => { if (B.has(g)) hit++; });
  return hit;
}

/* 「双色铜合金 / 双金属铜合金 / 双色铜合金镶嵌」「黄铜合金 / 黄色铜合金 / 黄铜和金」
 * 都是同一类材质的两种写法，别当成冲突刷屏。 */
function sameMaterial(a, b) {
  const norm = (s) => String(s || '')
    .replace(/黄色?铜合金|黄铜和金|黄铜/g, '黄铜')
    .replace(/双金属铜合金|双色铜合金镶嵌|双色铜合金|双金属/g, '双色铜')
    .replace(/[（）()\s、/]/g, '');
  const x = norm(a), y = norm(b);
  if (x === y) return true;
  return x.indexOf(y) >= 0 || y.indexOf(x) >= 0;
}

/** 我方名称的关键词：括号里的别名单独拆出来，去掉年份与通用后缀 */
function keyParts(name) {
  let s = String(name || '').replace(/[（(]([^）)]*)[）)]/g, ' $1 ');
  s = s.replace(/20\d\d\s*年?|19\d\d\s*年?/g, ' ');
  s = s.replace(/流通纪念币|普通纪念币|纪念币|纪念钞|流通|普通/g, ' ');
  return s.split(/[·—\-—、,，\s]+/).filter((x) => x && !/^第?\d+组$/.test(x));
}

/* 元禾常把「同一套的两三枚」合并在一个页面里：
 * 「1996年中国珍稀野生动物-白鳍豚、华南虎流通纪念币」。
 * 所以不能用「一条只配一个品种」的贪心，改成按关键词命中来配，允许多对一。
 */
const pairs = [];
const skipped = [];

doc.coins.forEach((c) => {
  const parts = keyParts(c.name);
  const core = parts.length ? parts[parts.length - 1] : c.name;
  const cands = ybk.map((y) => {
    const dy = num(y.year), cy = Number(c.year);
    if (dy === null || Math.abs(dy - cy) > 1) return null;   // 发行公告常在上一年，留 1 年容差
    if (num(y.face) !== Number(c.face)) return null;
    if (c.kind === 'coin' && num(y.dia) && num(c.dia) && num(y.dia) !== Number(c.dia)) return null;
    const yParts = keyParts(y.name);
    let score = overlap(c.name, y.name);
    // 核心词（如「白鳍豚」「举重」「朝天宫」）直接命中，是最可靠的信号
    if (core && y.name.indexOf(core) >= 0) score += 10;
    // 我方任意关键词出现在元禾名称里也加分
    parts.forEach((p) => { if (p.length >= 2 && y.name.indexOf(p) >= 0) score += 2; });
    yParts.forEach((p) => { if (p.length >= 2 && c.name.indexOf(p) >= 0) score += 1; });
    return score >= 6 ? { y, score } : null;
  }).filter(Boolean);

  if (!cands.length) { skipped.push(c); return; }
  cands.sort((a, b) => b.score - a.score);
  pairs.push({ c, y: cands[0].y, score: cands[0].score });
});

// ---------- 报告 ----------
const conflicts = [];
pairs.forEach(({ c, y }) => {
  if (y.material && c.material && !sameMaterial(c.material, y.material)) {
    conflicts.push(`材质 ${c.name}: 我们=${c.material} / 元禾=${y.material}`);
  }
  const ym = toWan(y.mintage), cm = Number(c.mintage);
  if (ym && cm && Math.abs(ym - cm) / Math.max(cm, 1) > 0.02) {
    conflicts.push(`发行量 ${c.name}: 我们=${cm}万 / 元禾=${y.mintage}（折算 ${ym}万）`);
  }
});

const usedY = new Set(pairs.map((x) => x.y.name));
console.log(`我方 ${doc.coins.length} 个品种 · 元禾 ${ybk.length} 条（用到 ${usedY.size} 条）· 匹配上 ${pairs.length} 个`);
console.log(`\n未匹配（我方没有对应条目）：`);
skipped.forEach((c) => console.log(`  - ${c.year} ${c.name}（${c.face}元）`));
if (conflicts.length) {
  console.log(`\n字段冲突 ${conflicts.length} 处（不自动改，只提示）：`);
  conflicts.forEach((s) => console.log('  ! ' + s));
}

const withExtra = pairs.filter(({ y }) => y.thickness || y.weight || y.caster || y.edge).length;
console.log(`\n可补充参数的品种：${withExtra} / ${pairs.length}`);
console.log('样例：');
pairs.slice(0, 6).forEach(({ c, y }) => {
  console.log(`  ${c.year} ${c.name} → 厚 ${y.thickness || '—'} · 重 ${y.weight || '—'} · ${y.caster || '—'} · ${y.edge || '—'}`);
});

if (process.argv.includes('--write')) {
  let n = 0;
  pairs.forEach(({ c, y }) => {
    if (y.thickness) c.thickness = y.thickness;
    if (y.weight) c.weight = y.weight;
    if (y.caster) c.caster = y.caster;
    if (y.edge) c.edge = y.edge;
    if (y.obverse && !c.obverse) c.obverse = y.obverse;
    if (y.reverse && !c.reverse) c.reverse = y.reverse;
    n++;
  });
  fs.writeFileSync(COINS, JSON.stringify(doc) + '\n');
  console.log(`\n已写入 ${n} 个品种的厚度/重量/铸造/边齿 → ${COINS}`);
} else {
  console.log('\n（预演，加 --write 才写入）');
}
