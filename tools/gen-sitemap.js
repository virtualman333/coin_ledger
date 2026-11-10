'use strict';
/* 生成 public/sitemap.xml —— 路由改成真实路径后，sitemap 里也要跟着换成 /coin/12 这种地址，
 * 否则提交给搜索引擎的还是打不开的 hash 链接。
 * 用法：node tools/gen-sitemap.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SITE = 'https://coin.virtualman.top';
const OUT = path.join(ROOT, 'public', 'sitemap.xml');
const seed = JSON.parse(fs.readFileSync(path.join(ROOT, 'public', 'data', 'coins.json'), 'utf8'));
// 哪些编号有真实实物图（示意图不收进图片 sitemap）
let REAL = new Set();
try {
  const imgDoc = JSON.parse(fs.readFileSync(path.join(ROOT, 'public', 'data', 'images.json'), 'utf8'));
  (imgDoc.real || []).forEach((n) => REAL.add(Number(n)));
} catch (e) {
  REAL = new Set(seed.coins.map((c, i) => i + 1));
}
const today = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10); // 按东八区取日期，UTC 16:00 后不会写成「昨天」

// 只需要登录才能看的页（holdings / cost / overview / account / admin）不进 sitemap
// /series 已于 v3.0.26 对未登录访客开放，是「按系列看套系」的入口页，必须进去
const PAGES = [
  { p: '/', pri: '1.0', freq: 'daily' },
  { p: '/all', pri: '0.9', freq: 'weekly' },
  { p: '/series', pri: '0.8', freq: 'weekly' },
  { p: '/plan', pri: '0.8', freq: 'weekly' },   // 发行计划：内容随央行公告更新，抓取端有价值
  { p: '/sitemap', pri: '0.5', freq: 'weekly' }, // HTML 站点地图：给爬虫一条能顺藤摸瓜的内链入口
  { p: '/legal.html', pri: '0.3', freq: 'yearly' }
];

const esc = (s) => String(s).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[ch]));

const rows = PAGES.map((x) => ({ loc: SITE + x.p, pri: x.pri, freq: x.freq }));
seed.coins.forEach((c, i) => {
  const no = i + 1;
  const row = {
    loc: SITE + '/coin/' + no,
    pri: i >= seed.coins.length - 20 ? '0.8' : '0.6',   // 近 20 个（最新发行）给高一点
    freq: 'monthly'
  };
  // 图片 sitemap：收藏站的图片搜索流量不可忽略，只填真有实拍图的
  if (REAL.has(no)) {
    row.img = {
      loc: SITE + '/img/' + String(no).padStart(3, '0') + '.jpg',
      title: c.name + '（' + c.year + ' ' + (c.kind === 'note' ? '纪念钞' : '纪念币') + '）实物图',
      caption: '面额 ' + c.face + ' 元 · ' + c.material + ' · 发行量 ' + c.mintage + ' 万' + (c.kind === 'note' ? '张' : '枚')
    };
  }
  rows.push(row);
});

const xml = ['<?xml version="1.0" encoding="UTF-8"?>',
  '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"',
  '        xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">']
  .concat(rows.map((r) =>
    '  <url>\n' +
    `    <loc>${r.loc}</loc>\n` +
    `    <lastmod>${today}</lastmod>\n` +
    `    <changefreq>${r.freq}</changefreq>\n` +
    `    <priority>${r.pri}</priority>\n` +
    (r.img
      ? '    <image:image>\n' +
        `      <image:loc>${r.img.loc}</image:loc>\n` +
        `      <image:title>${esc(r.img.title)}</image:title>\n` +
        `      <image:caption>${esc(r.img.caption)}</image:caption>\n` +
        '    </image:image>\n'
      : '') +
    '  </url>'))
  .concat(['</urlset>', ''])
  .join('\n');

fs.writeFileSync(OUT, xml);
const imgN = rows.filter((r) => r.img).length;
console.log(`已生成 ${rows.length} 条 URL（含 ${imgN} 张图片）→ ${OUT}`);
