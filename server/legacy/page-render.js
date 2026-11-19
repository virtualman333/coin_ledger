'use strict';
/**
 * 页面渲染（从 server/index.js 原样裁出，逐字保留）
 *
 * 负责三件事，逻辑一行未改：
 *   1. SPA 回落 + 按路由替换 title / description / canonical / og:*
 *      （抓取端不跑 JS，标题只能在这一层换）；
 *   2. /coin/N 的静态正文块（ssrCoinBlock）与 /sitemap 的纯 HTML 链接块；
 *   3. 品种页 JSON-LD（Product + BreadcrumbList）。
 *
 * 数据靠注入：legacy/api-handler 在 loadSeed() 之后调用 setData() 注入同一份对象。
 * 这样做是为了让下面的渲染代码保持「自由变量 SEED/DESC」的原样写法 ——
 * 141 个 URL 的 HTML 必须逐字不变，把几十处 SEED 改写成 ctx.seed 反而制造漂移风险。
 */
const fs = require('fs');
const path = require('path');

const config = require('../config');

const PUBLIC_DIR = config.PUBLIC_DIR;

/* 注入前先给一份空壳，保证函数被误调用时也不抛 */
let SEED = { coins: [], series: {}, sets: {}, defaults: [] };
let DESC = {};

/**
 * 注入目录数据。只在 loadSeed() 之后调用一次；
 * 之后管理端的增删改都是对同一批对象的原地修改，不需要重复注入。
 */
function setData(next) {
  if (!next) return;
  if (next.seed) SEED = next.seed;
  if (next.desc) DESC = next.desc;
}

/* ---------------------------------------------------------
   前端路由（真实路径）+ 页面级 meta 注入
   /coin/12、/all 这类地址没有对应文件，落到这里回 index.html；
   抓取端不跑 JS，标题/描述只能在这一层按路由换掉，否则全站一个标题。
   --------------------------------------------------------- */
const SITE = 'https://coin.virtualman.top';
const SPA_TABS = new Set(['home', 'plan', 'overview', 'series', 'holdings', 'cost', 'all', 'sitemap', 'account', 'admin']);
/* 标题/描述里不要再写死数字：{n}=品种数 {s}=系列数，渲染时按 coins.json 现算。
   之前 /all 的描述一直是「135 个普通纪念币」（数据早已 136），
   因为上一轮的兜底替换只认「N 个品种」这个句式，抓不到「N 个普通纪念币」。 */
const TAB_SEO = {
  sitemap: ['站点地图 | 藏币录',
    '藏币录全部页面与 136 个纪念币／纪念钞品种的索引，按系列分类，可直接进入任一品种详情。'],
  plan: ['发行计划 | 藏币录',
    '中国人民银行普通纪念币（钞）年度发行计划：哪些已发行、哪些待发行，含预约与发行日期、面额与发行量。'],
  home: ['藏币录 · 1984—2026 纪念币收藏管理与发行清单',
    '1984—2026 年中国普通纪念币与纪念钞全景档案：{n} 个品种的发行信息、币面实物图、套系进度，以及属于你自己的收藏账本。'],
  all: ['全套发行清单 · 1984—2026 普通纪念币与纪念钞 | 藏币录',
    '按年份排列的 {n} 个普通纪念币、纪念钞品种清单，含面额、发行量、材质与单枚／整套参考市价。'],
  series: ['按系列看套系进度 | 藏币录', '把 {n} 个品种归入 {s} 个系列，一眼看出每个系列还差哪几枚。'],
  overview: ['收藏概览 | 藏币录', '品种数、套系完成度、成本与盈亏的汇总视图。'],
  cost: ['收齐成本估算 | 藏币录', '按单枚与整套两种口径，估算把全套收齐需要多少钱。'],
  holdings: ['我的藏品 | 藏币录', '记录持仓数量、成本与市值，自动算浮动盈亏。'],
  account: ['账户 | 藏币录', '登录、注册与账户设置。'],
  admin: ['用户管理 | 藏币录', '管理员后台。']
};

let INDEX_TPL = '';
let INDEX_MTIME = 0;
/** 首页模板按 mtime 缓存，改完 index.html 不用重启 */
function indexTemplate() {
  const f = path.join(PUBLIC_DIR, 'index.html');
  try {
    const st = fs.statSync(f);
    if (st.mtimeMs !== INDEX_MTIME) {
      INDEX_TPL = fs.readFileSync(f, 'utf8');
      INDEX_MTIME = st.mtimeMs;
    }
  } catch { /* 读不到就沿用上一份 */ }
  return INDEX_TPL;
}
function escHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function fmMint(w) {
  const n = Number(w) || 0;
  if (n >= 10000) return (Math.round((n / 10000) * 10) / 10) + '亿';
  return n + '万';
}
/** 与前端 setSizeOf 同口径：限额 > 套系件数 > 20 */
function setSize(d) {
  if (!d) return 20;
  if (d.limit > 0) return d.limit;
  const meta = SEED.sets && SEED.sets[d.set];
  return (meta && meta.size) ? meta.size : 20;
}
/** 命中前端路由就返回 { tab, i }，否则 null（→ 正常 404） */
function spaRoute(pathname) {
  const p = String(pathname || '/').replace(/\/{2,}/g, '/').replace(/\/+$/, '');
  const m = /^\/coin\/(\d{1,3})$/.exec(p);
  if (m) {
    const i = Number(m[1]) - 1;
    return (i >= 0 && i < SEED.coins.length) ? { tab: 'coin', i } : null;
  }
  const name = p.replace(/^\//, '');
  if (!name) return { tab: 'home', i: null };
  if (SPA_TABS.has(name)) return { tab: name, i: null };
  return null;
}
/* ---------------------------------------------------------
   品种页静态正文（给不跑 JS 的抓取端）
   前端是纯 JS 渲染，/coin/N 返回的 HTML 原本与首页一字不差 —— 136 个品种页
   在抓取端就是 136 张「标题不同、正文相同」的重复页，这是收录不进来的主因。
   这里用 coins.json 的既有事实拼一段真正文（面额/材质/发行量/币面图案/同套系内链），
   内容与详情页完全一致，只是排版简陋；app.js 装配完成后会把它整块移除，
   用户看到的仍是原来的详情页，所以不存在「给爬虫看另一套内容」。
   --------------------------------------------------------- */
const SX_CSS = '<style>'
  + '.sx{max-width:760px;margin:26px auto 40px;padding:22px 20px 18px;border-radius:14px;'
  + 'background:#fff;color:#242424;font:15px/1.78 -apple-system,"PingFang SC","Microsoft YaHei",sans-serif;'
  + 'box-shadow:0 1px 3px rgba(0,0,0,.07)}'
  + '.sx a{color:#8a6314}'
  + '.sx-crumb{font-size:12px;color:#777;margin-bottom:10px}'
  + '.sx-crumb a{color:#777}'
  + '.sx h1{font-size:23px;line-height:1.45;margin:0 0 10px;font-family:"Songti SC","Noto Serif SC",serif}'
  + '.sx h2{font-size:16px;margin:22px 0 8px;padding-top:14px;border-top:1px solid #ececec}'
  + '.sx h3{font-size:14px;margin:12px 0 4px;color:#555}'
  + '.sx p{margin:0 0 10px}'
  + '.sx-facts{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:8px 18px;margin:14px 0 4px}'
  + '.sx-facts div{font-size:13px;border-bottom:1px dotted #ececec;padding-bottom:5px}'
  + '.sx-facts span{color:#888;margin-right:8px}'
  + '.sx-fig{float:right;width:190px;margin:0 0 12px 16px}'
  + '.sx-fig img{width:100%;height:auto;border-radius:10px;display:block;background:#f4f1ea}'
  + '.sx-links{margin:6px 0 0;padding-left:18px;font-size:14px;line-height:1.9}'
  + '.sx-note{font-size:12px;color:#888;margin-top:10px}'
  + '.sx-cta{margin-top:16px;padding:12px 14px;background:#faf6ec;border-radius:10px;font-size:14px}'
  + '@media (prefers-color-scheme:dark){.sx{background:#15181e;color:#e6e3db}'
  + '.sx h1,.sx h2{color:#f2eee4}.sx-facts div{border-color:#2a2f38}'
  + '.sx h2{border-color:#262b33}.sx-cta{background:#1d2128}.sx a{color:#d8b062}}'
  + '@media (max-width:640px){.sx{margin:14px 12px 30px;padding:16px 14px}'
  + '.sx h1{font-size:20px}.sx-fig{float:none;width:auto;max-width:260px;margin:0 0 12px}}'
  + '</style>';

function ssrCoinBlock(c, idx) {
  const isNote = c.kind === 'note';
  const unit = isNote ? '张' : '枚';
  const no = String(idx + 1).padStart(3, '0');
  const seriesName = (SEED.series && SEED.series[c.series]) || '';
  const setMeta = (c.set && SEED.sets) ? SEED.sets[c.set] : null;
  const setUnit = (setMeta && setMeta.unit) || unit;
  const n = setSize(c);
  const est = Number(c.est) || 0;
  const diaLabel = isNote ? '票幅' : '直径';
  const diaVal = isNote
    ? (c.size ? String(c.size).replace('×', ' × ') + ' 毫米' : '')
    : (c.dia && String(c.dia) !== '—' ? String(c.dia) + ' 毫米' : '');

  const facts = [['面额', c.face + ' 元']];
  if (c.material) facts.push(['材质', c.material]);
  if (diaVal) facts.push([diaLabel, diaVal]);
  if (c.mintage) facts.push(['发行量', fmMint(c.mintage) + unit]);
  if (c.thickness) facts.push(['厚度', c.thickness + (c.specFrom ? '（推定）' : '')]);
  if (c.weight) facts.push(['重量', c.weight + (c.specFrom ? '（推定）' : '')]);
  if (c.caster) facts.push(['铸造单位', String(c.caster).replace(/造币$/, '')]);
  if (c.edge) facts.push(['边齿', c.edge]);
  facts.push(['发行年份', c.year + ' 年']);
  if (seriesName) facts.push(['系列', seriesName]);
  if (setMeta) facts.push(['所属套系', setMeta.name + '（全套 ' + setMeta.total + ' ' + setUnit + '）']);

  const members = (setMeta && setMeta.members > 1)
    ? SEED.coins.filter((x) => x.set === c.set && x.i !== c.i) : [];
  /* 同套系多半就落在同系列里，两段列出同一批链接既啰嗦又浪费内链位 */
  const memberI = new Set(members.map((x) => x.i));
  const sibs = SEED.coins
    .filter((x) => x.series === c.series && x.i !== c.i && !memberI.has(x.i))
    .slice(-24).sort((a, b) => Math.abs(a.i - c.i) - Math.abs(b.i - c.i)).slice(0, 6);

  const link = (x) => '<li><a href="/coin/' + (x.i + 1) + '">'
    + escHtml(x.name) + '（' + x.year + '）</a></li>';

  let html = '<article class="sx" id="ssrCoin">'
    + '<nav class="sx-crumb"><a href="/">藏币录</a> › <a href="/all">全套发行清单</a>'
    + (seriesName ? ' › <a href="/series">' + seriesName + '</a>' : '')
    + ' › <span>' + escHtml(c.name) + '</span></nav>'
    + '<div class="sx-fig"><img src="/img/th/' + no + '.jpg" alt="'
    + escHtml(c.name) + ' ' + (isNote ? '纪念钞' : '纪念币') + ' 实物图" width="480" height="480"></div>'
    + '<h1>' + escHtml(c.name) + '（' + c.year + ' 年' + (isNote ? '纪念钞' : '普通纪念币') + '）</h1>'
    + '<p>' + c.year + ' 年，中国人民银行发行' + (isNote ? '纪念钞' : '普通纪念币') + '「'
    + escHtml(c.name) + '」，面额 ' + c.face + ' 元，'
    + (c.material ? escHtml(c.material) + '材质，' : '')
    + (diaVal ? diaLabel + ' ' + diaVal + '，' : '')
    + '发行量 ' + fmMint(c.mintage) + unit + '。'
    + (setMeta ? '该品种属于「' + escHtml(setMeta.name) + '」套系，全套 ' + setMeta.total + ' '
      + setUnit + '，本站已收录其中 ' + setMeta.members + ' 个品种。' : '')
    + (seriesName ? '按发行口径归入「' + seriesName + '」系列。' : '')
    + '</p>';

  html += '<div class="sx-facts">'
    + facts.map((f) => '<div><span>' + f[0] + '</span>' + escHtml(f[1]) + '</div>').join('')
    + '</div>';

  if (c.obverse || c.reverse) {
    html += '<h2>币面图案</h2>';
    if (c.obverse) html += '<h3>正面</h3><p>' + escHtml(c.obverse) + '</p>';
    if (c.reverse) html += '<h3>背面</h3><p>' + escHtml(c.reverse) + '</p>';
  }

  /* 央行发行公告原文（descriptions.json，127 个品种有）。详情页本来就展示它，
     这里一并给抓取端 —— 公告原文是最有分量的一段独有内容，顺带带上公告链接。 */
  const nt = DESC[String(idx + 1)];
  if (nt && nt.text) {
    html += '<h2>央行发行公告</h2>';
    if (nt.title) {
      html += '<p class="sx-note">' + escHtml(nt.title) + (nt.date ? '（' + escHtml(nt.date) + '）' : '')
        + (nt.url ? '，<a href="' + escHtml(nt.url) + '" target="_blank" rel="noopener">查看公告原文</a>' : '')
        + '</p>';
    }
    html += '<p>' + escHtml(nt.text) + '</p>';
  }

  html += '<h2>收藏参考</h2><p>按当前参考估值，单' + unit + '约 ' + est + ' 元'
    + (setMeta && n > 1 ? '；一套（' + n + ' ' + setUnit + '）约 ' + est * n + ' 元' : '')
    + '。估值随行情浮动，仅供参考，不是官方定价。</p>'
    + '<p>记账口径上，藏币录按「' + (isNote ? '刀' : '卷') + '」记录数量：1 '
    + (isNote ? '刀' : '卷') + ' = ' + n + ' ' + unit + '，成本与市值都按整' + (isNote ? '刀' : '卷')
    + '录入后自动折算成单' + unit + '与浮动盈亏。</p>';

  if (members.length || sibs.length) {
    html += '<h2>相关的' + (isNote ? '纪念钞' : '纪念币') + '</h2>';
    if (members.length) html += '<h3>同套系</h3><ul class="sx-links">'
      + members.slice(0, 12).map(link).join('') + '</ul>';
    if (sibs.length) html += '<h3>同系列（' + seriesName + '）</h3><ul class="sx-links">'
      + sibs.map(link).join('') + '</ul>';
  }

  html += '<p class="sx-cta"><a href="/account">免费注册</a>，把这枚币记进你的收藏账本：'
    + '按' + (isNote ? '刀' : '卷') + '记录数量与买入成本，自动算出市值和浮动盈亏。'
    + '也可以先<a href="/all">看全套发行清单</a>，确认自己还差哪几枚。</p>'
    + (c.specFrom ? '<p class="sx-note">注：该品种央行公告未公布厚度与重量，此处按同系列同规格推定。</p>' : '')
    + '<p class="sx-note">数据来源：中国人民银行发行公告及公开收藏资料；本站逐条核对面额、材质、发行量与票幅／直径。</p>'
    + '</article>';

  return html;
}

/* /sitemap 的正文由前端 JS 渲染，抓取端看不到那些链接 —— 服务端补一份纯 HTML 的，
   前端 renderSitemap() 会用更漂亮的网格覆盖它。两边内容一致，只是排版不同。 */
function sitemapStaticBlock() {
  const bySeries = {};
  SEED.coins.forEach((c) => { (bySeries[c.series] = bySeries[c.series] || []).push(c); });
  let html = '<nav class="sm-static">';
  Object.keys(bySeries).forEach((k) => {
    html += `<h3>${escHtml(SEED.series[k] || '其他')}</h3><ul>`;
    bySeries[k]
      .slice()
      .sort((a, b) => Number(a.year) - Number(b.year))
      .forEach((c) => { html += `<li><a href="/coin/${Number(c.i) + 1}">${escHtml(c.name)}</a></li>`; });
    html += '</ul>';
  });
  return html + '</nav>';
}

function renderIndex(route) {
  const tpl = indexTemplate();
  if (!tpl) return null;
  const total = SEED.coins.length;
  /* 系列页按套系分组展示，这里用同一个口径，免得首页写 18、点进去是 21 */
  const seriesN = Object.keys(SEED.sets || {}).length;
  const fill = (s) => String(s).replace(/\{n\}/g, total).replace(/\{s\}/g, seriesN);
  const c = route.tab === 'coin' ? SEED.coins[route.i] : null;
  let title, desc, path;
  if (c) {
    const isNote = c.kind === 'note';
    const unit = isNote ? '张' : '枚';
    const n = setSize(c);
    const est = Number(c.est) || 0;
    path = '/coin/' + (route.i + 1);
    title = `${c.name}（${c.year} ${isNote ? '纪念钞' : '纪念币'}）面额 ${c.face} 元 · 发行量 ${fmMint(c.mintage)}${unit} | 藏币录`;
    desc = `${c.year} 年发行的${isNote ? '纪念钞' : '普通纪念币'}「${c.name}」，面额 ${c.face} 元／${unit}，`
         + `${c.material}，${isNote ? '票幅' : '直径'} ${isNote ? (c.size ? String(c.size).replace('×', ' × ') + ' 毫米' : '—') : (c.dia === '—' ? '—' : c.dia + ' 毫米')}，发行量 ${fmMint(c.mintage)}${unit}。`
         + `单${unit}参考市价约 ${est} 元，一套（${n} ${unit}）约 ${est * n} 元。`;
  } else {
    const pair = TAB_SEO[route.tab] || TAB_SEO.home;
    path = route.tab === 'home' ? '/' : '/' + route.tab;
    title = fill(pair[0]);
    desc = fill(pair[1]);
  }
  const url = SITE + path;

  /* 品种页给搜索引擎一份结构化数据：
     - BreadcrumbList：百度/Google 会把层级显示在结果里（首页 › 清单 › 品种名）
     - Product（不带 offers）：面额/年份/发行量/材质作为 additionalProperty。
       故意不给 price —— 我们的是参考估值，不是真实售价，标成 Offer 容易被判作弊。 */
  let ld = '';
  if (c) {
    const isNote = c.kind === 'note';
    const unit = isNote ? '张' : '枚';
    const no = String(route.i + 1).padStart(3, '0');
    const product = {
      '@context': 'https://schema.org',
      '@type': 'Product',
      name: c.name,
      image: `${SITE}/img/${no}.jpg`,
      description: desc,
      category: isNote ? '纪念钞' : '普通纪念币',
      brand: { '@type': 'Organization', name: '中国人民银行' },
      additionalProperty: [
        { '@type': 'PropertyValue', name: '面额', value: `${c.face} 元` },
        { '@type': 'PropertyValue', name: '发行年份', value: String(c.year) },
        { '@type': 'PropertyValue', name: '发行量', value: `${fmMint(c.mintage)}${unit}` },
        { '@type': 'PropertyValue', name: '材质', value: c.material }
      ]
    };
    const crumb = {
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: '首页', item: `${SITE}/` },
        { '@type': 'ListItem', position: 2, name: '发行清单', item: `${SITE}/all` },
        { '@type': 'ListItem', position: 3, name: c.name, item: url }
      ]
    };
    ld = `<script type="application/ld+json">${JSON.stringify(product)}</script>\n`
       + `<script type="application/ld+json">${JSON.stringify(crumb)}</script>\n`;
  }

  let head = ld;
  let out = tpl
    .replace(/<title>[\s\S]*?<\/title>/, `<title>${escHtml(title)}</title>`)
    .replace(/(<meta name="description" content=")[\s\S]*?(">)/, `$1${escHtml(desc)}$2`)
    .replace(/(<meta property="og:title" content=")[\s\S]*?(">)/, `$1${escHtml(title)}$2`)
    .replace(/(<meta property="og:description" content=")[\s\S]*?(">)/, `$1${escHtml(desc)}$2`)
    .replace(/(<meta property="og:url" content=")[^"]*(")/, `$1${url}$2`)
    .replace(/(<link rel="canonical" href=")[^"]*(")/, `$1${url}$2`);

  /* 首页里的品种数/系列数是写死在 HTML 里的（数据涨到 136 条后还停在 135）。
     按元素 id 定位替换而不是替换固定数字，数据再涨也不用回来改这里。
     注意：站点根路径 / 由 nginx 直接吐静态文件、不经过这层，index.html 里也要写对。 */
  out = out
    .replace(/(id="coinTotalA">)\d+(<)/g, `$1${total}$2`)
    .replace(/(id="coinTotalB">)\d+(<)/g, `$1${total}$2`)
    .replace(/(id="filterCount">)\d+(<)/g, `$1${total}$2`)
    .replace(/(id="cntAll">)\d+(<)/g, `$1${total}$2`)
    .replace(/(data-copy="total">)\d+(<)/g, `$1${total}$2`)
    .replace(/\d+ 个品种/g, `${total} 个品种`)
    .replace(/\d+ 个系列/g, `${seriesN} 个系列`);

  if (c) {
    out = out.replace('<main class="wrap" id="main" tabindex="-1">',
      '<main class="wrap" id="main" tabindex="-1">' + ssrCoinBlock(c, route.i));
    head += SX_CSS;
  }
  if (route.tab === 'sitemap') {
    out = out.replace('<div id="sitemapBody"></div>', '<div id="sitemapBody">' + sitemapStaticBlock() + '</div>');
  }
  return out.replace('</head>', head + '</head>');
}
function sendIndex(res, route) {
  const html = renderIndex(route);
  if (!html) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('404 Not Found'); return; }
  res.writeHead(200, {
    'Content-Type': 'text/html; charset=utf-8',
    'Content-Length': Buffer.byteLength(html),
    'Cache-Control': 'no-cache'
    // 安全头由 Nginx 统一加（这里再加会出现重复头）
  });
  res.end(html);
}

module.exports = {
  setData: setData,
  // 路由与渲染
  spaRoute: spaRoute,
  renderIndex: renderIndex,
  sendIndex: sendIndex,
  ssrCoinBlock: ssrCoinBlock,
  sitemapStaticBlock: sitemapStaticBlock,
  // 展示工具（静态层与后续 SEO service 共用）
  escHtml: escHtml,
  fmMint: fmMint,
  setSize: setSize,
  TAB_SEO: TAB_SEO,
  SX_CSS: SX_CSS
};
