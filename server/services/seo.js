'use strict';
/**
 * SEO / SSR 渲染（T03：从 legacy/page-render.js 原样搬入 services 层）
 *
 * 负责三件事，逻辑一行未改：
 *   1. SPA 回落 + 按路由替换 title / description / canonical / og:*
 *      （抓取端不跑 JS，标题只能在这一层换）；
 *   2. /coin/N 的静态正文块（ssrCoinBlock）与 /sitemap 的纯 HTML 链接块；
 *   3. 品种页 JSON-LD（Product + BreadcrumbList）。
 *
 * 数据靠注入：state/catalog 在 loadSeed() 之后调用 setData() 注入同一份对象。
 * T03 铁律：下面的渲染逻辑一行都没改 —— 141 个 URL 的 HTML 必须与基线逐字相同。
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
let PLAN = { years: [] };

/**
 * 注入目录数据。只在 loadSeed() 之后调用一次；
 * 之后管理端的增删改都是对同一批对象的原地修改，不需要重复注入。
 */
function setData(next) {
  if (!next) return;
  if (next.seed) SEED = next.seed;
  if (next.desc) DESC = next.desc;
  if (next.plan) PLAN = next.plan;
}

/* ---------------------------------------------------------
   前端路由（真实路径）+ 页面级 meta 注入
   /coin/12、/all 这类地址没有对应文件，落到这里回 index.html；
   抓取端不跑 JS，标题/描述只能在这一层按路由换掉，否则全站一个标题。
   --------------------------------------------------------- */
const SITE = 'https://coin.virtualman.top';
const SPA_TABS = new Set(['home', 'plan', 'overview', 'series', 'holdings', 'cost', 'all', 'sitemap', 'account', 'myfeedback', 'admin']);
/* 标题/描述里不要再写死数字：{n}=品种数 {s}=系列数，渲染时按 coins.json 现算。
   之前 /all 的描述一直是「135 个普通纪念币」（数据早已 136），
   因为上一轮的兜底替换只认「N 个品种」这个句式，抓不到「N 个普通纪念币」。 */
const TAB_SEO = {
  myfeedback: ['我的反馈 | 藏币录', '查看自己提交的纠错与建议，以及管理员的处理结果与回复。'],
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
  holdings: ['我的收藏 | 藏币录', '记录持仓数量、成本与市值，自动算浮动盈亏。'],
  account: ['账户 | 藏币录', '登录、注册与账户设置。'],
  admin: ['用户管理 | 藏币录', '管理员后台。']
};
/* 页面级 keywords：原来全站写死首页那一串，tab 页换成各自主题，利于长尾词命中 */
const TAB_KEYWORDS = {
  myfeedback: '藏币录,用户反馈,数据纠错,纪念币勘误',
  sitemap: '藏币录,站点地图,纪念币索引,纪念钞目录',
  plan: '纪念币发行计划,央行发行计划,纪念币预约,纪念钞发行,预约兑换',
  home: '纪念币,纪念钞,普通纪念币,发行清单,纪念币收藏,币面图案,国家公园纪念币,生肖纪念币,纪念币价格',
  all: '普通纪念币清单,纪念钞清单,1984至2026纪念币,纪念币发行量,纪念币面额,纪念币材质',
  series: '纪念币系列,套系收藏,生肖纪念币系列,国家公园纪念币,纪念币套系进度',
  overview: '收藏概览,纪念币统计,套系完成度',
  cost: '纪念币收藏成本,收齐全套多少钱,纪念币预算,整卷成本',
  holdings: '我的收藏,纪念币账本,收藏记账,浮动盈亏',
  account: '藏币录账号,纪念币账本登录,多端同步',
  admin: '藏币录管理后台'
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

/**
 * 统一注入页面级 head meta。
 * 原来 renderIndex / renderPmIndex / renderPmItemIndex 各写一遍替换串，
 * 结果 twitter:* / keywords / og:image 漏替换（全站停留在首页模板的写死值）。
 * 收敛到这里：三处都传 {title, desc, url}，可选 keywords / image / type / noindex。
 * 正则只匹配模板里已存在的标签，缺失的标签不会凭空插入——保持与旧行为的兼容。
 */
function applyHead(tpl, o) {
  const t = escHtml(o.title);
  const d = escHtml(o.desc);
  const u = escHtml(o.url);
  const kw = escHtml(o.keywords != null ? o.keywords : TAB_KEYWORDS.home);
  const img = escHtml(o.image || (SITE + '/icons/og-cover.png'));
  let out = tpl
    .replace(/<title>[\s\S]*?<\/title>/, '<title>' + t + '</title>')
    .replace(/(<meta name="description" content=")[^"]*(">)/, '$1' + d + '$2')
    .replace(/(<meta name="keywords" content=")[^"]*(">)/, '$1' + kw + '$2')
    .replace(/(<meta property="og:title" content=")[^"]*(">)/, '$1' + t + '$2')
    .replace(/(<meta property="og:description" content=")[^"]*(">)/, '$1' + d + '$2')
    .replace(/(<meta property="og:url" content=")[^"]*(")/, '$1' + u + '$2')
    .replace(/(<meta property="og:image" content=")[^"]*(")/, '$1' + img + '$2')
    .replace(/(<meta name="twitter:title" content=")[^"]*(">)/, '$1' + t + '$2')
    .replace(/(<meta name="twitter:description" content=")[^"]*(">)/, '$1' + d + '$2')
    .replace(/(<meta name="twitter:image" content=")[^"]*(")/, '$1' + img + '$2')
    .replace(/(<link rel="canonical" href=")[^"]*(")/, '$1' + u + '$2');
  if (o.noindex) {
    out = out.replace(/(<meta name="robots" content=")[^"]*(">)/, '$1noindex,nofollow$2');
  }
  return out;
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
    if (i >= 0 && i < SEED.coins.length) return { tab: 'coin', i };
    // 贵金属不进 SEED（bootstrap 必须逐字不变），单独从 PM_COINS 命中
    const no = Number(m[1]);
    return PM_COINS.some((c) => Number(c.no) === no) ? { tab: 'coin', i, pm: true, no } : null;
  }
  // 贵金属单枚独立页 /pm/<code>：由 routes/seo.js 查库后走 sendPmItemIndex，
  // 这里只做「是否前端路由」的识别（sendIndex 兜底时用通用 meta）。
  const pm = /^\/pm\/([A-Za-z0-9_-]{1,32})$/.exec(p);
  if (pm) return { tab: 'pm', i: null, code: pm[1].toUpperCase() };
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
  if (c && c.category === 'precious_metal') return pmSsrBlock(c);
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

/* 面包屑里 tab 页的显示名（TAB_SEO 的 title 带后缀，不适合直接当面包屑末级） */
const TAB_LABEL = {
  home: '首页', plan: '发行计划', all: '全套发行清单', series: '全部系列',
  overview: '收藏概览', cost: '收齐成本', holdings: '我的收藏', sitemap: '站点地图',
  account: '账户', myfeedback: '我的反馈', admin: '管理后台'
};

/* ---------------------------------------------------------
   tab 页静态正文（给不跑 JS 的抓取端）
   /all /series /plan 原来只换 meta、正文全靠 JS 渲染，抓取端看到空壳。
   这三页是站内主力入口，用同一份 SEED/PLAN 拼可读正文 + 内链。
   前端 finishBoot() → dropSsr() 会整块移除（id=ssrCoin），用户看到的仍是原页面。
   --------------------------------------------------------- */

/** /all：按系列分组列出全部品种内链 */
function ssrAllBlock() {
  const bySeries = {};
  SEED.coins.forEach((c) => { (bySeries[c.series] = bySeries[c.series] || []).push(c); });
  let html = '<article class="sx" id="ssrCoin">'
    + '<nav class="sx-crumb"><a href="/">藏币录</a> › <span>全套发行清单</span></nav>'
    + '<h1>1984—2026 全套发行清单</h1>'
    + '<p>本站收录 ' + SEED.coins.length + ' 个中国普通纪念币与纪念钞品种，按系列归类、按年份排列。'
    + '点开任一品种可查看面额、发行量、材质、直径／票幅、币面图案与央行发行公告原文。</p>';
  Object.keys(bySeries).forEach((k) => {
    const name = (SEED.series && SEED.series[k]) || '其他';
    const list = bySeries[k].slice().sort((a, b) => Number(b.year) - Number(a.year));
    html += '<h2>' + escHtml(name) + '（' + list.length + ' 个品种）</h2><ul class="sx-links">'
      + list.map((x) => '<li><a href="/coin/' + (Number(x.i) + 1) + '">' + escHtml(x.name)
        + '（' + x.year + ' 年）</a></li>').join('')
      + '</ul>';
  });
  html += '<p class="sx-cta">回到<a href="/">首页</a>，或<a href="/series">按系列看套系进度</a>、'
    + '<a href="/plan">看央行年度发行计划</a>。</p>'
    + '<p class="sx-note">数据来源：中国人民银行发行公告及公开收藏资料；发行量与规格以官方公告为准。推理价仅供参考，不作为交易依据。</p>'
    + '</article>';
  return html;
}

/** /series：列出全部系列及各自的品种内链 */
function ssrSeriesBlock() {
  const bySeries = {};
  SEED.coins.forEach((c) => { (bySeries[c.series] = bySeries[c.series] || []).push(c); });
  const keys = Object.keys(bySeries);
  let html = '<article class="sx" id="ssrCoin">'
    + '<nav class="sx-crumb"><a href="/">藏币录</a> › <span>全部系列</span></nav>'
    + '<h1>中国纪念币全部系列</h1>'
    + '<p>按官方发行口径，本站把 ' + SEED.coins.length + ' 个品种归入 ' + keys.length
    + ' 个系列。每个系列列出已收录的品种，登录后还能看到自己的集齐进度。</p>';
  keys.forEach((k) => {
    const name = (SEED.series && SEED.series[k]) || '其他';
    const list = bySeries[k];
    html += '<h2>' + escHtml(name) + '（' + list.length + ' 个品种）</h2><p>'
      + list.slice(0, 12).map((x) => '<a href="/coin/' + (Number(x.i) + 1) + '">' + escHtml(x.name) + '</a>').join('、')
      + (list.length > 12 ? ' 等' : '') + '。</p>';
  });
  html += '<p class="sx-cta">查看<a href="/all">全套发行清单</a>，或<a href="/plan">央行年度发行计划</a>。</p>'
    + '</article>';
  return html;
}

/** /plan：按年度列出央行发行计划项目（含状态与发行日） */
function ssrPlanBlock() {
  const years = (PLAN && PLAN.years) || [];
  if (!years.length) return '';
  const label = { issued: '已发行', scheduled: '待发行', planned: '计划中', extra: '计划外增发' };
  let html = '<article class="sx" id="ssrCoin">'
    + '<nav class="sx-crumb"><a href="/">藏币录</a> › <span>发行计划</span></nav>'
    + '<h1>普通纪念币（钞）年度发行计划</h1>'
    + '<p>中国人民银行公布的年度发行计划与单项公告汇总：哪些已发行、哪些待发行，含面额、发行量与预约兑换日期。</p>';
  years.slice().reverse().forEach((y) => {
    const items = y.items || [];
    html += '<h2>' + escHtml(String(y.year)) + ' 年（' + items.length + ' 项）</h2>';
    if (y.sourceText) html += '<p>' + escHtml(y.sourceText) + '</p>';
    html += '<ul class="sx-links">' + items.map((it) => {
      const bits = [it.name, it.status && ('（' + (label[it.status] || it.status) + '）'),
        it.date && ('发行日 ' + it.date), it.face != null && ('面额 ' + it.face + ' 元')].filter(Boolean);
      const text = escHtml(bits.join(' · '));
      return it.coinNo
        ? '<li><a href="/coin/' + Number(it.coinNo) + '">' + text + '</a></li>'
        : '<li>' + text + '</li>';
    }).join('') + '</ul>';
  });
  html += '<p class="sx-note">年度清单以中国人民银行每年 12 月公布的次年计划为准；单项发行日、预约期取自各品种发行公告。</p>'
    + '<p class="sx-cta">查看<a href="/all">全套发行清单</a>与<a href="/series">全部系列</a>。</p>'
    + '</article>';
  return html;
}

function renderIndex(route) {
  if (route && route.pm) return renderPmIndex(route);
  if (route && route.tab === 'pm') return renderPmItemIndex(route);
  const tpl = indexTemplate();
  if (!tpl) return null;
  const total = SEED.coins.length;
  /* 系列页按套系分组展示，这里用同一个口径，免得首页写 18、点进去是 21 */
  const seriesN = Object.keys(SEED.sets || {}).length;
  const fill = (s) => String(s).replace(/\{n\}/g, total).replace(/\{s\}/g, seriesN);
  const c = route.tab === 'coin' ? SEED.coins[route.i] : null;
  let title, desc, path, keywords, image;
  if (c) {
    const isNote = c.kind === 'note';
    const unit = isNote ? '张' : '枚';
    const n = setSize(c);
    const est = Number(c.est) || 0;
    const no = String(route.i + 1).padStart(3, '0');
    path = '/coin/' + (route.i + 1);
    title = `${c.name}（${c.year} ${isNote ? '纪念钞' : '纪念币'}）面额 ${c.face} 元 · 发行量 ${fmMint(c.mintage)}${unit} | 藏币录`;
    desc = `${c.year} 年发行的${isNote ? '纪念钞' : '普通纪念币'}「${c.name}」，面额 ${c.face} 元／${unit}，`
         + `${c.material}，${isNote ? '票幅' : '直径'} ${isNote ? (c.size ? String(c.size).replace('×', ' × ') + ' 毫米' : '—') : (c.dia === '—' ? '—' : c.dia + ' 毫米')}，发行量 ${fmMint(c.mintage)}${unit}。`
         + `单${unit}参考市价约 ${est} 元，一套（${n} ${unit}）约 ${est * n} 元。`;
    keywords = [c.name, c.year + (isNote ? '纪念钞' : '普通纪念币'), c.material,
      '纪念币收藏', '发行量' + fmMint(c.mintage) + unit].join(',');
    // 有实物图的品种页用实物图做社交分享封面，没有则沿用站点通用封面
    image = /\d{3}/.test(no) ? `${SITE}/img/${no}.jpg` : undefined;
  } else {
    const pair = TAB_SEO[route.tab] || TAB_SEO.home;
    path = route.tab === 'home' ? '/' : '/' + route.tab;
    title = fill(pair[0]);
    desc = fill(pair[1]);
    keywords = fill(TAB_KEYWORDS[route.tab] || TAB_KEYWORDS.home);
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
  } else {
    /* tab 页结构化数据：
       - 面包屑：首页 › 当前栏目（首页本身不加，避免出现「首页›首页」）
       - /all 清单页给 ItemList，让搜索引擎理解这是一份有序品种目录 */
    if (route.tab !== 'home') {
      const crumb = {
        '@context': 'https://schema.org',
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: '首页', item: SITE + '/' },
          { '@type': 'ListItem', position: 2, name: TAB_LABEL[route.tab] || (TAB_SEO[route.tab] ? TAB_SEO[route.tab][0] : '栏目'), item: url }
        ]
      };
      ld += `<script type="application/ld+json">${JSON.stringify(crumb)}</script>\n`;
    }
    if (route.tab === 'all') {
      const itemList = {
        '@context': 'https://schema.org',
        '@type': 'ItemList',
        name: '1984—2026 中国普通纪念币与纪念钞全套发行清单',
        numberOfItems: total,
        itemListElement: SEED.coins.map((x, idx) => ({
          '@type': 'ListItem',
          position: idx + 1,
          name: x.name,
          url: SITE + '/coin/' + (Number(x.i === undefined ? idx : x.i) + 1)
        }))
      };
      ld += `<script type="application/ld+json">${JSON.stringify(itemList)}</script>\n`;
    }
  }

  let head = ld;
  let out = applyHead(tpl, { title: title, desc: desc, url: url, keywords: keywords, image: image });

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
  /* /all /series /plan 补 SSR 正文（抓取端可读，前端装配后移除）。
     首页 /tab 的 feature grid 本身就是静态文字，不重复铺正文。 */
  const tabBlock = route.tab === 'all' ? ssrAllBlock()
    : route.tab === 'series' ? ssrSeriesBlock()
    : route.tab === 'plan' ? ssrPlanBlock() : '';
  if (tabBlock) {
    out = out.replace('<main class="wrap" id="main" tabindex="-1">',
      '<main class="wrap" id="main" tabindex="-1">' + tabBlock);
    head += SX_CSS;
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

/* 贵金属目录（由 routes/seo.js 从 pm.service 注入；不进 SEED，避免污染 bootstrap） */
let PM_COINS = [];

/**
 * 注入已上架的贵金属套（SSR 专用）。
 *
 * @param {object[]} list 行（camelCase）
 * @returns {void}
 */
function setPmCoins(list) {
  PM_COINS = Array.isArray(list) ? list : [];
}

/**
 * 该路径是否由 routes/seo.js 的原生路由处理（其余非 /api 请求才落静态层）。
 * 只认真实存在的 SPA 路径：/ 、10 个 tab、/coin/<数字>。
 *
 * @param {string} pathname 不含 query 的路径
 * @returns {boolean} 判定
 */
function isRoutePath(pathname) {
  const p = String(pathname || '/').replace(/\/{2,}/g, '/').replace(/\/+$/, '');
  if (p === '' || p === '/') return true;
  if (p === '/plaza') return true;   // 广场已下线，留给 routes/seo.js 做 301 回首页
  if (/^\/coin\/\d{1,3}$/.test(p)) return true;
  if (/^\/pm\/[A-Za-z0-9_-]{1,32}$/.test(p)) return true;   // 贵金属单枚独立页
  const name = p.replace(/^\//, '');
  return SPA_TABS.has(name);
}

/**
 * 贵金属 SSR 正文块：只列公告事实与套内规格，**不出现任何价格文字**。
 * 尤其不能拼「收藏参考／单枚约 X 元」—— 贵金属 est 恒 NULL，
 * 拼出来就是「约 0 元」，爬虫抓到会直接误导用户（arch 6.4）。
 *
 * @param {object} c 贵金属行（camelCase）
 * @returns {string} HTML
 */
function pmSsrBlock(c) {
  const pieces = Array.isArray(c.pieces) ? c.pieces : [];
  const fact = (k, v) => '<div><span>' + k + '</span>' + escHtml(v) + '</div>';
  const facts = [
    fact('整套面额合计', c.face + ' 元'),
    fact('材质', c.material || '—'),
    fact('成色', c.purity ? (Number(c.purity) * 100).toFixed(1) + '%' : '—'),
    fact('总克重', c.setWeightG !== null && c.setWeightG !== undefined ? c.setWeightG + ' 克' : '—'),
    fact('套内枚数', c.setPieces + ' 枚'),
    fact('发行方式', c.issueMethod || '—'),
    fact('发行日期', c.issueDate || '—'),
    fact('销售渠道', c.salesChannel || '—'),
    fact('经销单位', c.dealer || '—')
  ].join('');
  const rows = pieces.map((p) => '<tr>'
    + '<td>' + escHtml(p.seq) + '</td>'
    + '<td>' + escHtml(p.name) + '</td>'
    + '<td>' + escHtml(p.metal) + '</td>'
    + '<td>' + escHtml(p.weightG) + ' 克</td>'
    + '<td>' + escHtml(p.face) + ' 元</td>'
    + '<td>' + escHtml(p.purity ? (Number(p.purity) * 100).toFixed(1) + '%' : '—') + '</td>'
    + '<td>' + escHtml(p.maxMintage) + ' 枚</td>'
    + '</tr>').join('');
  return '<article class="sx" id="ssrCoin">'
    + '<nav class="sx-crumb"><a href="/">藏币录</a> › <a href="/all">全套发行清单</a>'
    + ' › <a href="/all?category=pm">贵金属</a> › <span>' + escHtml(c.name) + '</span></nav>'
    + '<div class="sx-fig"><img src="/img/' + String(c.no).padStart(3, '0') + '.jpg" alt="'
    + escHtml(c.name) + ' 实物图" width="480" height="480"></div>'
    + '<h1>' + escHtml(c.name) + '（' + c.year + ' 年贵金属纪念币）</h1>'
    + '<p>' + c.year + ' 年中国人民银行发行的贵金属纪念币，' + escHtml(c.name)
    + '，全套 ' + c.setPieces + ' 枚，总面额 ' + c.face + ' 元，总克重 ' + c.setWeightG + ' 克。'
    + (c.mintageNote ? '最大发行量逐枚不同，见下方规格表。' : '') + '</p>'
    + '<div class="sx-facts">' + facts + '</div>'
    + (c.obverse || c.reverse
      ? '<h2>币面图案</h2>'
        + (c.obverse ? '<h3>正面</h3><p>' + escHtml(c.obverse) + '</p>' : '')
        + (c.reverse ? '<h3>背面</h3><p>' + escHtml(c.reverse) + '</p>' : '')
      : '')
    + '<h2>套内规格（发行量单位：枚）</h2>'
    + '<table class="sx-pm"><thead><tr><th>序号</th><th>名称</th><th>材质</th><th>克重</th><th>面额</th><th>成色</th><th>最大发行量</th></tr></thead>'
    + '<tbody>' + rows + '</tbody></table>'
    + '<p class="sx-note">贵金属纪念币无稳定二级市场报价，本站不提供参考估值。发行量与克重均以中国人民银行公告为准。</p>'
    + '</article>';
}

/**
 * 贵金属页面整页渲染（独立 meta，不复用普通币的「参考市价」文案）。
 *
 * @param {object} route {pm:true,no}
 * @returns {string|null} HTML
 */
function renderPmIndex(route) {
  const tpl = indexTemplate();
  if (!tpl) return null;
  const c = PM_COINS.filter((x) => Number(x.no) === Number(route.no))[0];
  if (!c) return null;

  const path = '/coin/' + c.no;
  const url = SITE + path;
  const title = c.name + '（' + c.year + ' 贵金属纪念币）全套 ' + c.setPieces + ' 枚 · 总面额 ' + c.face + ' 元 | 藏币录';
  const desc = c.year + ' 年发行的贵金属纪念币「' + c.name + '」，全套 ' + c.setPieces + ' 枚，'
    + '总克重 ' + c.setWeightG + ' 克，整套面额合计 ' + c.face + ' 元，发行量逐枚见规格明细。';
  const product = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: c.name,
    image: SITE + '/img/' + String(c.no).padStart(3, '0') + '.jpg',
    description: desc,
    category: '贵金属纪念币',
    brand: { '@type': 'Organization', name: '中国人民银行' },
    additionalProperty: [
      { '@type': 'PropertyValue', name: '材质', value: c.material || '' },
      { '@type': 'PropertyValue', name: '总克重', value: c.setWeightG + ' 克' },
      { '@type': 'PropertyValue', name: '整套面额合计', value: c.face + ' 元' },
      { '@type': 'PropertyValue', name: '套内枚数', value: c.setPieces + ' 枚' }
    ]
  };
  const crumb = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: '首页', item: SITE + '/' },
      { '@type': 'ListItem', position: 2, name: '贵金属', item: SITE + '/all?category=pm' },
      { '@type': 'ListItem', position: 3, name: c.name, item: url }
    ]
  };
  const ld = '<script type="application/ld+json">' + JSON.stringify(product) + '</script>\n'
    + '<script type="application/ld+json">' + JSON.stringify(crumb) + '</script>\n';

  let out = applyHead(tpl, {
    title: title, desc: desc, url: url,
    keywords: [c.name, c.year + '贵金属纪念币', c.material, '贵金属纪念币收藏', '套内规格'].join(','),
    image: SITE + '/img/' + String(c.no).padStart(3, '0') + '.jpg'
  });

  out = out
    .replace(/(id="coinTotalA">)\d+(<)/g, '$1' + SEED.coins.length + '$2')
    .replace(/(id="coinTotalB">)\d+(<)/g, '$1' + SEED.coins.length + '$2')
    .replace(/(id="filterCount">)\d+(<)/g, '$1' + SEED.coins.length + '$2')
    .replace(/(id="cntAll">)\d+(<)/g, '$1' + SEED.coins.length + '$2')
    .replace(/(data-copy="total">)\d+(<)/g, '$1' + SEED.coins.length + '$2');

  // 模板里两处通用的「参考价」文案对贵金属不成立（est 恒 NULL），页面级替换掉，
  // 否则爬虫仍会在贵金属页抓到「136 个品种…市场参考价」这类误导文字
  out = out.replace(/(<meta name="twitter:description" content=")[^"]*(">)/,
    '$1贵金属纪念币发行信息与套内规格，本站不提供参考估值。$2');
  out = out.replace(/<span class="muted">[^<]*二级市场参考价[^<]*<\/span>/g, '');

  out = out.replace('<main class="wrap" id="main" tabindex="-1">',
    '<main class="wrap" id="main" tabindex="-1">' + pmSsrBlock(c));
  return out.replace('</head>', ld + SX_CSS + '</head>');
}

/**
 * 直接输出贵金属页面（routes/seo.js 用）。
 *
 * @param {import('http').ServerResponse} res 原始响应
 * @param {object} row 贵金属行
 * @returns {void}
 */
function sendPmIndex(res, row) {
  setPmCoins([row]);
  const html = renderPmIndex({ pm: true, no: row.no });
  if (!html) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('404 Not Found'); return; }
  res.writeHead(200, {
    'Content-Type': 'text/html; charset=utf-8',
    'Content-Length': Buffer.byteLength(html),
    'Cache-Control': 'no-cache'
  });
  res.end(html);
}

/* ---------------------------------------------------------
   贵金属单枚独立页 /pm/<code>（2823 条全量库）
   每枚币要有自己的 URL 与页面级 meta，否则抓取端看到的是 2823 张
   「标题不同、正文相同」的重复页。这里用库里的公告事实拼静态正文，
   前端装配完成后 dropSsr() 会移除它，用户看到的仍是完整详情页。
   铁律：不出现任何价格/估值文字（贵金属 est 恒 NULL）。
   --------------------------------------------------------- */
function pmItemSsrBlock(code, d) {
  const fact = (k, v) => '<div><span>' + k + '</span>' + escHtml(v || '—') + '</div>';
  const name = (d && d.name) || code;
  const year = (d && d.year) || '';
  const facts = [
    fact('编号', code),
    fact('项目名称', d && d.projectName),
    fact('发行年份', year),
    fact('材质', d && d.material),
    fact('克重', d && d.weight ? d.weight + ' 克' : ''),
    fact('面额', d && d.face != null ? d.face + ' 元' : ''),
    // 发售价是中国金币公布的官方初始发行价，属于公告事实，不是市场估值
    fact('发售价', d && d.issuePrice != null ? '¥' + Number(d.issuePrice).toLocaleString('zh-CN') : ''),
    fact('成色', d && d.fineness ? d.fineness + '%' : ''),
    fact('最大发行量', d && d.circulation ? d.circulation + ' 枚' : ''),
    fact('质量', d && d.quality),
    fact('铸造单位', d && d.castingUnit)
  ].join('');
  const desc = d && d.announce ? '<p>' + escHtml(String(d.announce).slice(0, 400)) + '</p>' : '';
  return '<article class="sx" id="ssrCoin">'
    + '<nav class="sx-crumb"><a href="/">藏币录</a> › <a href="/all">全套发行清单</a>'
    + ' › <a href="/all?category=pm">贵金属</a> › <span>' + escHtml(name) + '</span></nav>'
    + '<h1>' + escHtml(name) + (year ? '（' + year + ' 贵金属纪念币）' : '') + '</h1>'
    + '<p>' + (year ? year + ' 年发行的' : '') + '中国贵金属纪念币「' + escHtml(name)
    + '」，编号 ' + escHtml(code) + '。以下为发行公告事实与规格，资料以中国人民银行公告为准。</p>'
    + '<div class="sx-facts">' + facts + '</div>'
    + desc
    + '<p class="sx-note">贵金属纪念币无稳定二级市场报价，本站不提供参考估值。</p>'
    + '</article>';
}

/**
 * @param {object} route {tab:'pm', code, pmItem?} pmItem 为查库得到的公告字段
 * @returns {string|null} HTML
 */
function renderPmItemIndex(route) {
  const tpl = indexTemplate();
  if (!tpl) return null;
  const code = String(route.code || '').toUpperCase();
  const d = route.pmItem || null;
  const path = '/pm/' + code;
  const url = SITE + path;
  const name = (d && d.name) || '';
  const year = (d && d.year) || '';
  // 查不到的编号不编造币名，也不让抓取端收录一个空页
  const title = name
    ? name + (year ? '（' + year + ' 贵金属纪念币）' : '') + ' 编号 ' + code + ' · 发行档案 | 藏币录'
    : '贵金属纪念币 ' + code + ' · 藏币录';
  const detail = [
    d && d.projectName ? '属于「' + d.projectName + '」项目' : '',
    d && d.material ? '材质 ' + d.material : '',
    d && d.weight ? '克重 ' + d.weight : '',
    d && d.face != null ? '面额 ' + d.face + ' 元' : ''
  ].filter(Boolean).join('，');
  const desc = name
    ? (year ? year + ' 年发行的' : '') + '贵金属纪念币「' + name + '」' + (detail ? '，' + detail : '')
      + '。发行信息以中国人民银行公告为准，本站不提供参考估值。'
    : '在藏币录查看贵金属纪念币的发行档案、币面图案与规格，资料以中国人民银行公告为准。';
  // 查不到具体品种时不要输出 Product 结构化数据（名称为空会被判作弊）
  const product = name ? {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: name,
    description: desc,
    category: '贵金属纪念币',
    brand: { '@type': 'Organization', name: '中国人民银行' },
    additionalProperty: [
      { '@type': 'PropertyValue', name: '编号', value: code },
      { '@type': 'PropertyValue', name: '发行年份', value: String(year) },
      { '@type': 'PropertyValue', name: '材质', value: (d && d.material) || '' },
      { '@type': 'PropertyValue', name: '面额', value: d && d.face != null ? d.face + ' 元' : '' }
    ]
  } : null;
  const crumb = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: '首页', item: SITE + '/' },
      { '@type': 'ListItem', position: 2, name: '贵金属', item: SITE + '/all?category=pm' },
      { '@type': 'ListItem', position: 3, name: name || code, item: url }
    ]
  };
  const ld = (product ? '<script type="application/ld+json">' + JSON.stringify(product) + '</script>\n' : '')
    + '<script type="application/ld+json">' + JSON.stringify(crumb) + '</script>\n';

  let out = applyHead(tpl, {
    title: title, desc: desc, url: url, noindex: !name,
    keywords: [name || ('贵金属纪念币 ' + code), (d && d.material ? d.material + '贵金属纪念币' : '贵金属纪念币'),
      '发行档案', '编号' + code].join(',')
    // 单枚页没有独立实物图（code 是字母编号，不是图片序号），沿用通用封面
  });
  out = out
    .replace(/(id="coinTotalA">)\d+(<)/g, '$1' + SEED.coins.length + '$2')
    .replace(/(id="coinTotalB">)\d+(<)/g, '$1' + SEED.coins.length + '$2')
    .replace(/(id="filterCount">)\d+(<)/g, '$1' + SEED.coins.length + '$2')
    .replace(/(id="cntAll">)\d+(<)/g, '$1' + SEED.coins.length + '$2')
    .replace(/(data-copy="total">)\d+(<)/g, '$1' + SEED.coins.length + '$2');
  // 通用模板里的「二级市场参考价」对贵金属不成立，页面级抹掉
  out = out.replace(/<span class="muted">[^<]*二级市场参考价[^<]*<\/span>/g, '');
  // twitter:description 是首页模板写死的「…推理价…」，贵金属页必须换掉，
  // 否则抓取端仍会读到与贵金属无关的价格口径（与 renderPmIndex 保持一致）
  out = out.replace(/(<meta name="twitter:description" content=")[^"]*(">)/,
    '$1贵金属纪念币发行信息与规格，资料以中国人民银行公告为准，本站不提供参考估值。$2');
  out = out.replace('<main class="wrap" id="main" tabindex="-1">',
    '<main class="wrap" id="main" tabindex="-1">' + pmItemSsrBlock(code, d));
  return out.replace('</head>', ld + SX_CSS + '</head>');
}

/** 由 routes/seo.js 查库后调用；查不到币时仍返回 200 让前端给出可读的空态 */
function sendPmItemIndex(res, route) {
  const html = renderPmItemIndex(route);
  if (!html) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('404 Not Found'); return; }
  res.writeHead(200, {
    'Content-Type': 'text/html; charset=utf-8',
    'Content-Length': Buffer.byteLength(html),
    'Cache-Control': 'no-cache'
  });
  res.end(html);
}

module.exports = {
  setData: setData,
  setPmCoins: setPmCoins,
  renderPmIndex: renderPmIndex,
  sendPmIndex: sendPmIndex,
  renderPmItemIndex: renderPmItemIndex,
  sendPmItemIndex: sendPmItemIndex,
  pmItemSsrBlock: pmItemSsrBlock,
  pmSsrBlock: pmSsrBlock,
  isRoutePath: isRoutePath,
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
