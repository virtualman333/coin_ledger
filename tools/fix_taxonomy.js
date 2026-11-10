'use strict';
/**
 * 发行数据重整（v2 → v3）
 *
 * 解决三件真实问题：
 * 1) 系列混杂：奥运币与国内体育赛事混在「奥运·体育」；世博会/千禧年这类「盛会」混在「周年·事件」。
 * 2) 一套的口径错了：多枚套币（建国 35 周年 3 枚、六运会 3 枚、冬奥对钞 2 张…）被按「20 件」计价，
 *    一套市价被放大 6～10 倍。一套件数应由套系自己声明。
 * 3) 8 个套系的 total 与目录条目数不符（total 写的是套内枚数，成员却只有 1 条），
 *    导致「已收 1 / 3」永远收不齐。
 *
 * 生成 v3：series 拆成 18 类；sets 增加 size（一套件数）与 kind（roll 卷 / box 套）；
 * total 改为目录条目数，套内枚数由 size 承担。
 *
 *   node tools/fix_taxonomy.js            # 预演，只打印差异
 *   node tools/fix_taxonomy.js --write    # 写回 public/data/coins.json
 */
const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '..', 'public', 'data', 'coins.json');
const doc = JSON.parse(fs.readFileSync(FILE, 'utf8'));
const WRITE = process.argv.includes('--write');

/* ---------------- 1. 新的系列表 ---------------- */
const SERIES = {
  SX: '生肖贺岁',
  WC: '世界文化遗产',
  WH: '世界文化与自然双重遗产',
  NP: '国家公园',
  TW: '宝岛台湾',
  AY: '奥运',
  TY: '体育赛事',
  HZ: '和字书法',
  JJ: '京剧艺术',
  PP: '人物诞辰',
  EV: '周年庆典',
  EX: '盛会·博览',
  CN: '纪念钞',
  ZZ: '自治区成立',
  HG: '港澳回归',
  DW: '珍稀野生动物',
  TC: '科技成就',
  ZT: '社会公益·文化',
};

/* 需要改归的品种：按名称精确匹配 */
const MOVES = {
  1987: 'TY', 1990: 'TY', 1991: 'TY', 1995: 'TY',                 // 六运会 / 亚运会 / 女足 / 世乒赛
  1986: 'EX', 1995.1: 'EX', 1995.2: 'EX', 2000: 'EX', 2010: 'EX', // 国际和平年 / 妇女大会 / 联合国50 / 千禧年 / 世博会
};

/* 按名称判断（更稳，避免年份重复时对不上） */
function seriesOf(coin, current) {
  const n = coin.name;
  if (coin.kind === 'note') return 'CN';                 // 纪念钞按品类自成一系列
  if (/第29届奥运会|第24届冬奥会/.test(n)) return 'AY';
  if (/第六届运动会|亚洲运动会|女子足球|乒乓球锦标赛/.test(n)) return 'TY';
  if (/世界妇女大会|联合国成立五十周年|迎接新世纪|上海世博会/.test(n)) return 'EX';
  return current;
}

/* ---------------- 2. 套系：一套几件、是卷还是套 ---------------- */
/* size = 一「套」包含的件数；kind：roll 按整卷 20 件收藏，box 按发行套收藏 */
const SET_SIZE = {
  jg35: { size: 3, kind: 'box', name: '建国三十五周年（3 枚）' },
  lh6:  { size: 3, kind: 'box', name: '第六届全运会（3 枚）' },
  yz11: { size: 2, kind: 'box', name: '第十一届亚运会（2 枚）' },
  zs10: { size: 3, kind: 'box', name: '全民义务植树十周年（3 枚）' },
  jd70: { size: 3, kind: 'box', name: '建党七十周年（3 枚）' },
  nzf:  { size: 2, kind: 'box', name: '第一届女足世锦赛（2 枚）' },
  hk97: { size: 2, kind: 'box', name: '香港回归（2 枚）' },
  mo99: { size: 2, kind: 'box', name: '澳门回归（2 枚）' },
  cny24: { size: 2, kind: 'box', name: '第24届冬奥会纪念钞（对钞 2 张）' },
};

/* ---------------- 3. 执行 ---------------- */
const changes = [];

doc.coins.forEach((c) => {
  const next = seriesOf(c, c.series);
  if (next !== c.series) {
    changes.push(`${c.year} ${c.name}：${doc.series[c.series]} → ${SERIES[next]}`);
    c.series = next;
  }
});
doc.series = SERIES;

const members = {};
doc.coins.forEach((c) => {
  if (!c.set || c.set === 'single') return;
  members[c.set] = members[c.set] || [];
  members[c.set].push(c);
});

Object.keys(doc.sets).forEach((id) => {
  const meta = doc.sets[id];
  const n = (members[id] || []).length;
  const override = SET_SIZE[id] || {};
  const before = JSON.stringify(meta);
  meta.total = n;                                   // 目录条目数
  meta.size = override.size || 20;                  // 一套件数
  meta.kind = override.kind || 'roll';              // roll = 按整卷 20 件收藏，box = 按发行套收藏
  if (override.name) meta.name = override.name;
  if (before !== JSON.stringify(meta)) {
    changes.push(`[set ${id}] total=${meta.total} size=${meta.size} kind=${meta.kind} ${meta.name}`);
  }
});

/* 校验 */
const stat = {};
doc.coins.forEach((c) => { stat[c.series] = (stat[c.series] || 0) + 1; });
const bad = [];
Object.keys(doc.series).forEach((code) => { if (!stat[code]) bad.push(`空系列 ${code}`); });
doc.coins.forEach((c) => {
  if (!doc.series[c.series]) bad.push(`未定义系列 ${c.series}（${c.name}）`);
  if (c.set !== 'single' && !doc.sets[c.set]) bad.push(`未定义套系 ${c.set}（${c.name}）`);
  if (c.pieces && c.set !== 'single') {
    const need = doc.sets[c.set].size;
    if (need !== 20 && c.pieces !== need) bad.push(`件数不符 ${c.name}：pieces=${c.pieces} size=${need}`);
  }
});

console.log('系列分布：');
Object.keys(SERIES).forEach((code) => {
  console.log('  ' + code.padEnd(3), SERIES[code].padEnd(14), stat[code] || 0);
});
console.log('合计', Object.values(stat).reduce((a, b) => a + b, 0), '个品种');
console.log('\n变动 ' + changes.length + ' 条：');
changes.forEach((x) => console.log('  ' + x));
console.log(bad.length ? '\n校验失败：\n  ' + bad.join('\n  ') : '\n校验通过');

if (WRITE) {
  fs.writeFileSync(FILE, JSON.stringify(doc, null, 0) + '\n', 'utf8');
  console.log('\n已写入 ' + path.relative(process.cwd(), FILE));
} else {
  console.log('\n（预演，加 --write 写入）');
}
