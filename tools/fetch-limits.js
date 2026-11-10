'use strict';
/* 从央行「普通纪念币」栏目抓 2015 年以来的发行/预约兑换公告，
 * 抽「每人预约、兑换限额」原文，输出 tools/_data/limits.json。
 *
 * 栏目列表与文章正文都是静态 HTML，直接用 curl 拉（走系统代理，不依赖无头浏览器）。
 * 用法：node tools/fetch-limits.js [--pages 32]
 */
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const BASE = 'https://www.pbc.gov.cn';
const COLL = '/huobijinyinju/147948/147964';
const OUT = path.join(__dirname, '_data', 'limits.json');
const CACHE = path.join(__dirname, '_data', '_pbc_cache.json');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const PAGES = Number((process.argv.includes('--pages') ? process.argv[process.argv.indexOf('--pages') + 1] : 0) || 32);

function curl(url) {
  return execFileSync('curl', ['-s', '-k', '-m', '30', '-A', UA, url], { maxBuffer: 1 << 24 }).toString('utf8');
}
function text(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&#160;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

/* ---------- 1. 列表 ---------- */
function listPages() {
  const rows = [];
  for (let p = 1; p <= PAGES; p++) {
    const url = p === 1 ? `${BASE}${COLL}/index.html` : `${BASE}${COLL}/22786-${p}.html`;
    let h;
    try { h = curl(url); } catch { console.log(`  列表第 ${p} 页失败，停`); break; }
    const found = [...h.matchAll(/href="(\/huobijinyinju\/[^"]*?\/index\.html)"[^>]*>\s*([^<]{4,160}?)\s*</g)];
    if (!found.length) { console.log(`  列表第 ${p} 页无条目，停`); break; }
    for (const m of found) rows.push({ url: BASE + m[1], title: m[2].replace(/\s+/g, ' ').trim() });
    process.stdout.write(`  列表 ${p}: ${found.length} 条\n`);
    if (p < PAGES) execFileSync('sleep', ['0.2']);
  }
  const seen = new Set();
  return rows.filter((r) => (seen.has(r.url) ? false : (seen.add(r.url), true)));
}

/* ---------- 2. 正文抽限额 ---------- */
const NOISE = /预约数量|兑换数量|进度|核查|分配数量|库存|监督检查/;
const KEEP = /中国人民银行公告|发行|工作安排|预约兑换|兑换工作/;

const LIMIT_PATTERNS = [
  /(?:每人|每位|每个有效身份证件)[^。；]{0,30}?限额[^。；]{0,30}/g,
  /限额[为是]?\s*\d+\s*(?:枚|张|套)/g,
  /每人[^。；]{0,20}?限[购兑][^。；]{0,20}/g
];

function extractLimits(t) {
  const out = [];
  for (const re of LIMIT_PATTERNS) {
    for (const s of t.match(re) || []) {
      const m = /(\d+)\s*(枚|张|套)/.exec(s);
      if (m) out.push({ sentence: s.trim(), n: Number(m[1]), unit: m[2] });
    }
  }
  // 去重（同一句被多条正则命中）
  const seen = new Set();
  return out.filter((x) => (seen.has(x.sentence) ? false : (seen.add(x.sentence), true)));
}

function main() {
  const cache = fs.existsSync(CACHE) ? JSON.parse(fs.readFileSync(CACHE, 'utf8')) : {};
  console.log('[1/2] 抓栏目列表…');
  const all = listPages();
  console.log('  合计', all.length, '条');
  fs.writeFileSync(path.join(__dirname, '_data', '_pbc_list_all.json'), JSON.stringify(all, null, 1));

  const cands = all.filter((e) => {
    if (NOISE.test(e.title)) return false;
    if (!KEEP.test(e.title)) return false;
    const y = /(20\d\d)/.exec(e.title);
    return !y || Number(y[1]) >= 2015;
  });
  console.log('[2/2] 取正文', cands.length, '条…');

  const items = [];
  cands.forEach((e, i) => {
    let body = cache[e.url];
    if (body == null) {
      try { body = text(curl(e.url)); } catch { body = ''; }
      cache[e.url] = body;
      if ((i + 1) % 10 === 0) fs.writeFileSync(CACHE, JSON.stringify(cache));
      execFileSync('sleep', ['0.2']);
    }
    const limits = extractLimits(body);
    items.push({ title: e.title, url: e.url, len: body.length, limits, head: body.slice(0, 120) });
    const brief = limits.map((l) => `${l.n}${l.unit}`).join('/') || '—';
    console.log(`  ${String(i + 1).padStart(3)} ${brief.padEnd(6)} ${e.title.slice(0, 42)}`);
  });

  fs.writeFileSync(CACHE, JSON.stringify(cache));
  fs.writeFileSync(OUT, JSON.stringify({ fetchedAt: new Date().toISOString(), total: items.length, items }, null, 1));
  const hit = items.filter((x) => x.limits.length).length;
  console.log(`\n完成：${items.length} 条，${hit} 条抽到限额 → ${OUT}`);
}

main();
