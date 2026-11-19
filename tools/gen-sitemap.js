'use strict';
/**
 * 生成 public/sitemap.xml（T03：数据源改为 repository / catalog.service）
 *
 *   node tools/gen-sitemap.js                 # 写 public/sitemap.xml
 *   node tools/gen-sitemap.js --out /tmp/x    # 只写指定文件（验收用）
 *   node tools/gen-sitemap.js --date 2026-01-01  # 固定 lastmod，便于逐字比对
 *
 * 不再直接 `fs.readFileSync(public/data/coins.json)`：
 * 目录事实源切到 db 后，sitemap 必须跟着看同一份数据，否则库里上架的品种
 * 永远进不了 sitemap（三端同源）。json 模式下 `legacyCoins()` 拿的是 coins.json
 * 原对象，因此产物与改造前逐字一致。
 */
const fs = require('fs');
const path = require('path');

const config = require('../server/config');
const { createDataSource } = require('../server/services/data-source');
const catalog = require('../server/services/catalog.service');

const ROOT = path.join(__dirname, '..');
const SITE = 'https://coin.virtualman.top';
const DEFAULT_OUT = path.join(ROOT, 'public', 'sitemap.xml');

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

/**
 * 取当前数据源（db 模式自建连接池，用完关闭）。
 *
 * @returns {Promise<{ds: object, close: Function}>} 数据源与清理函数
 */
async function openDataSource() {
  if (config.DATA_SOURCE === 'db') {
    const mysql = require('mysql2/promise');
    const pool = mysql.createPool(config.mysqlOptions());
    await pool.query('SELECT 1');
    return {
      ds: createDataSource({ mode: 'db', pool: pool }),
      close: async () => { try { await pool.end(); } catch (e) { /* ignore */ } }
    };
  }
  return { ds: createDataSource({ mode: 'json' }), close: async () => {} };
}

/**
 * 生成 sitemap 文本（纯函数，便于测试逐字比对）。
 *
 * @param {object[]} coins 老形态品种对象
 * @param {number[]} real 有实拍图的品种编号
 * @param {string} today lastmod
 * @returns {string} XML
 */
function buildXml(coins, real, today) {
  const REAL = new Set(real.map(Number));
  const rows = PAGES.map((x) => ({ loc: SITE + x.p, pri: x.pri, freq: x.freq }));
  // 贵金属固定 0.5，不稀释普通币的 0.8/0.9（arch 7.4）
  const ordinaryCount = coins.filter((c) => c.category !== 'precious_metal').length;

  coins.forEach((c, i) => {
    const no = c.i === undefined ? i + 1 : Number(c.i) + 1;
    const isNote = c.kind === 'note';
    const isPm = c.category === 'precious_metal';
    const row = {
      loc: SITE + '/coin/' + no,
      pri: isPm ? '0.5' : (i >= ordinaryCount - 20 ? '0.8' : '0.6'),  // 近 20 个普通币给高一点
      freq: 'monthly'
    };
    // 图片 sitemap：收藏站的图片搜索流量不可忽略，只填真有实拍图的
    if (REAL.has(no)) {
      // 贵金属套级 mintage 恒 NULL（A3），发行量改由 mintage_note 说明；
      // 普通币钞保持 legacy 的「万枚/万张」文案逐字不变
      const mintageText = isPm
        ? String(c.mintage_note || '发行量逐枚不同，见规格明细')
        : c.mintage + ' 万' + (isNote ? '张' : '枚');
      row.img = {
        loc: SITE + '/img/' + String(no).padStart(3, '0') + '.jpg',
        title: c.name + '（' + c.year + ' ' + (isNote ? '纪念钞' : '纪念币') + '）实物图',
        caption: '面额 ' + c.face + ' 元 · ' + c.material + ' · 发行量 ' + mintageText
      };
    }
    rows.push(row);
  });

  return ['<?xml version="1.0" encoding="UTF-8"?>',
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
}

/**
 * CLI 主流程。
 *
 * @param {string[]} argv 参数
 * @returns {Promise<void>} 完成
 */
async function main(argv) {
  const args = argv.slice(2);
  const get = (flag, def) => {
    const i = args.indexOf(flag);
    return i >= 0 ? args[i + 1] : def;
  };
  const out = path.resolve(get('--out', DEFAULT_OUT));
  const date = get('--date', new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10)); // 东八区

  const handle = await openDataSource();
  try {
    const svc = catalog.create(handle.ds);
    const pmSvc = require('../server/services/pm.service').create({
      dataSource: handle.ds,
      withTx: async () => {}
    });
    const [legacyCoins, pmPublished, real] = await Promise.all([
      svc.legacyCoins(),
      pmSvc.listPublished(),
      handle.ds.repos.images.realMainNos()
    ]);
    // 贵金属只取已上架的；字段按 sitemap 所需最小集合投影，mintage 恒 NULL 不传
    const pmCoins = pmPublished.map((r) => ({
      i: Number(r.no) - 1,
      no: Number(r.no),
      year: r.year,
      name: r.name,
      kind: r.kind || 'coin',
      face: r.face,
      material: r.material,
      mintage: null,
      mintage_note: r.mintageNote || '',
      category: 'precious_metal'
    }));
    const coins = legacyCoins.concat(pmCoins);
    const xml = buildXml(coins, real, date);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, xml, 'utf8');
    console.log(`已生成 ${PAGES.length + coins.length} 条 URL（含 ${real.length} 张图片）→ ${out}`);
  } finally {
    await handle.close();
  }
}

module.exports = { PAGES: PAGES, buildXml: buildXml, openDataSource: openDataSource };

if (require.main === module) {
  main(process.argv).catch((e) => {
    console.error('[gen-sitemap] 失败：', e.message || e);
    process.exit(1);
  });
}
