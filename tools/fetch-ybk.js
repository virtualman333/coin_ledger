'use strict';
/* 从「元禾收藏」普通纪念币库补充参数：厚度 / 重量 / 铸造单位 / 边齿 / 正背面图案。
 * 站点是 GB2312，字段在表格里，先转成「|字段：|值|」再正则抠。
 *
 * 用法：node tools/fetch-ybk.js
 * 输出：tools/_data/ybk.json
 * 说明：只抓很少的页面（百来页，间隔 350ms），别把人家站点打疼。
 */
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const BASE = 'https://www.ybkinfo.com/jinianbi/';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const CATS = ['', 'shengxiao.html', 'zalei.html', 'tiyu.html', 'hezhishufa.html', 'weiren.html', 'yichan.html', 'zizhiqu.html', 'zhenxidongwu.html'];
const OUT = path.join(__dirname, '_data', 'ybk.json');
const CACHE = path.join(__dirname, '_data', '_ybk_cache.json');
const RAW_DIR = path.join(__dirname, '_data', '_ybk_html');

const sleep = (ms) => execFileSync('sleep', [String(ms / 1000)]);

function rawGet(url, id) {
  const f = path.join(RAW_DIR, 'p' + id + '.html');
  if (fs.existsSync(f)) return new TextDecoder('gbk').decode(fs.readFileSync(f));
  const buf = execFileSync('curl', ['-s', '-m', '25', '-A', UA, url], { maxBuffer: 1 << 24 });
  try { fs.writeFileSync(f, buf); } catch (e) { /* 目录没建好就算了 */ }
  return new TextDecoder('gbk').decode(buf);
}

function get(url) {
  const buf = execFileSync('curl', ['-s', '-m', '25', '-A', UA, url], { maxBuffer: 1 << 24 });
  return new TextDecoder('gbk').decode(buf);
}

/** 把 HTML 压成「|字段：|值|」的长串，方便正则逐项取 */
function toText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, '|')
    .replace(/&nbsp;/g, ' ')
    .replace(/\|{2,}/g, '|')
    .replace(/[ \t\r\n]+/g, ' ');
}

function pick(text, label) {
  // 表格单元格压成管道后形如「商品名称：| |2025年蛇年…」，直接按位置切更稳
  const i = text.indexOf(label + '：');
  if (i < 0) return '';
  const rest = text.slice(i + label.length + 1);
  const m = /^(?:[ \t]*\|)*[ \t]*([^|]{1,300})/.exec(rest);
  return m ? m[1].replace(/\s+/g, ' ').trim() : '';
}

function parse(html) {
  const t = toText(html);
  const titleM = /<title>([^<]+)<\/title>/i.exec(html);
  return {
    title: titleM ? titleM[1].trim() : '',
    name: pick(t, '商品名称'),
    year: pick(t, '发行时间'),
    mintage: pick(t, '发行数量'),
    face: pick(t, '面值'),
    thickness: pick(t, '厚度'),
    dia: pick(t, '直径'),
    material: pick(t, '材质'),
    weight: pick(t, '重量'),
    caster: pick(t, '铸造单位'),
    edge: pick(t, '边齿'),
    obverse: pick(t, '正面图案'),
    reverse: pick(t, '背面图案')
  };
}

function main() {
  fs.mkdirSync(RAW_DIR, { recursive: true });
  const cache = fs.existsSync(CACHE) ? JSON.parse(fs.readFileSync(CACHE, 'utf8')) : {};

  // 1) 收集详情页 id
  const ids = new Set();
  CATS.forEach((c) => {
    const url = BASE + c;
    try {
      const html = get(url);
      [...html.matchAll(/href="p(\d+)\.html"/g)].forEach((m) => ids.add(Number(m[1])));
    } catch (e) {
      console.log('列表页失败', url, e.message);
    }
    sleep(350);
  });
  const list = [...ids].sort((a, b) => a - b);
  console.log('收集到详情页', list.length, '个：', list[0], '…', list[list.length - 1]);

  // 2) 逐个抓
  const out = [];
  let n = 0;
  for (const id of list) {
    const key = 'p' + id;
    let rec = cache[key];
    if (!rec) {
      try {
        rec = parse(rawGet(BASE + key + '.html', id));
      } catch (e) {
        console.log('  跳过', key, e.message);
        continue;
      }
      cache[key] = rec;
      sleep(350);
    }
    if (rec.name) out.push({ id, ...rec });
    n++;
    if (n % 20 === 0) {
      fs.writeFileSync(CACHE, JSON.stringify(cache));
      process.stdout.write(`  已解析 ${n}/${list.length}\n`);
    }
  }

  fs.writeFileSync(CACHE, JSON.stringify(cache));
  out.sort((a, b) => a.id - b.id);
  fs.writeFileSync(OUT, JSON.stringify({ fetchedAt: new Date().toISOString(), total: out.length, items: out }, null, 1));
  const full = out.filter((x) => x.thickness || x.weight || x.caster || x.edge).length;
  console.log(`\n完成：${out.length} 个品种，其中 ${full} 个带厚度/重量/铸造/边齿 → ${OUT}`);
}

main();
