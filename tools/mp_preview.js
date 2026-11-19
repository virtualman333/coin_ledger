'use strict';
/**
 * 生成小程序页面的视觉预览 HTML（用真实数据）。
 *   node tools/mp_preview.js
 * 之后用无头浏览器截图查看。
 */
const path = require('path');
const https = require('https');
const fsx = require('fs');

/** 管理员口令：优先环境变量，其次本地 .secrets（已在 .gitignore 里，不进仓库） */
/** 支持 setData 的路径写法：groups[0].open */
function setByPath(obj, path, val) {
  const parts = String(path).replace(/\[(\d+)\]/g, '.$1').split('.');
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i += 1) {
    const k = parts[i];
    if (cur[k] == null) cur[k] = /^\d+$/.test(parts[i + 1]) ? [] : {};
    cur = cur[k];
  }
  cur[parts[parts.length - 1]] = val;
}

function readAdminPw() {
  if (process.env.ADMIN_PASSWORD) return process.env.ADMIN_PASSWORD;
  try {
    return fsx.readFileSync(path.join(__dirname, '..', '.secrets', 'admin-password.txt'), 'utf8').trim();
  } catch (e) {
    return '';
  }
}
const { URL } = require('url');

const mem = {};
global.wx = {
  getStorageSync: (k) => (k in mem ? mem[k] : ''),
  setStorageSync: (k, v) => { mem[k] = v; },
  removeStorageSync: (k) => { delete mem[k]; },
  showToast: () => {},
  hideToast: () => {},
  showLoading: () => {},
  hideLoading: () => {},
  stopPullDownRefresh: () => {},
  switchTab: () => {},
  navigateTo: () => {},
  redirectTo: () => {},
  navigateBack: () => {},
  setClipboardData: () => {},
  showModal: (o) => o.success && o.success({ confirm: false }),
  request(opts) {
    const url = new URL(opts.url);
    const body = opts.data === undefined ? null : JSON.stringify(opts.data);
    const req = https.request({
      hostname: url.hostname, port: 443, path: url.pathname + url.search,
      method: opts.method || 'GET',
      headers: Object.assign({ 'content-type': 'application/json', 'Content-Length': body ? Buffer.byteLength(body) : 0 }, opts.header || {}),
      timeout: 15000,
    }, (res) => {
      let raw = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { raw += c; });
      res.on('end', () => {
        let data = raw;
        try { data = JSON.parse(raw); } catch (e) { /* keep */ }
        opts.success && opts.success({ statusCode: res.statusCode, data, header: res.headers });
      });
    });
    req.on('error', (err) => opts.fail && opts.fail({ errMsg: err.message }));
    req.on('timeout', () => req.destroy(new Error('timeout')));
    if (body) req.write(body);
    req.end();
  },
};
global.getCurrentPages = () => [{ route: 'pages/index/index' }];

const MP = path.join(__dirname, '..', 'miniprogram');
let captured = null;
global.Page = (cfg) => { captured = cfg; };
let appConfig = {};
global.App = (cfg) => { appConfig = cfg || {}; };
global.getApp = () => ({ globalData: appConfig.globalData || {} });

function loadPage(route) {
  captured = null;
  const file = path.join(MP, route + '.js');
  delete require.cache[require.resolve(file)];
  require(file);
  const inst = Object.assign({}, captured);
  inst.data = JSON.parse(JSON.stringify(captured.data || {}));
  inst.setData = function (patch) {
    Object.keys(patch).forEach((k) => {
      if (k.indexOf('.') >= 0 || k.indexOf('[') >= 0) setByPath(this.data, k, patch[k]);
      else this.data[k] = patch[k];
    });
  };
  return inst;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  require(path.join(MP, 'app.js'));
  const store = require(path.join(MP, 'utils/store.js'));
  const cat = require(path.join(MP, 'utils/catalog.js'));
  const { buildPage, OUT } = require('./mp_preview_lib.js');
  const W = Number(process.env.MP_WIDTH || 375);           // 320 = iPhone SE 宽度，用来查溢出
  const suffix = W === 375 ? '' : '-' + W;
  const build = (o) => buildPage(Object.assign({ width: W }, o, { name: o.name + suffix }));
  await store.refresh().catch(() => {});

  /* MP_LIVE=1 时用线上真实账号的数据渲染，便于核对金额 */
  if (process.env.MP_LIVE === '1') {
    const api = require(path.join(MP, 'utils/api.js'));
    const login = await api.post('/api/auth/login', { name: 'virtualman', password: readAdminPw() });
    api.setToken(login.token || '');
    await store.refresh().catch(() => {});
    console.log('已载入线上真实持仓：' + store.getState().holdings.length + ' 条');
  }

  const files = [];

  /* 预置一份已登录的假数据，让进度条、分组进度都能看到 */
  if (process.env.MP_LIVE !== '1') {
  store.state.user = { name: 'virtualman', role: 'admin' };
  store.state.isAdmin = true;
  store.state.synced = true;
  store.state.holdings = [
    { id: 'h1', name: '三江源国家公园', rolls: 1, cost: 200, market: 210, group: '国家公园（2023—2026）' },
    { id: 'h2', name: '大熊猫国家公园', rolls: 2, cost: 400, market: 420, group: '国家公园（2023—2026）' },
    { id: 'h3', name: '2026年贺岁纪念钞（马钞）', rolls: 1, cost: 400, market: 700, group: '独立藏品' },
  ].filter((h) => cat.byName[h.name]);
  }

  /* 首页（已登录） */
  const home = loadPage('pages/index/index');
  home.render();
  files.push(build({ name: 'home', wxml: 'pages/index/index.wxml', wxss: 'pages/index/index.wxss', data: home.data, height: true }));

  /* 清单 */
  const list = loadPage('pages/list/list');
  list.onLoad();
  list.onShow();
  files.push(build({ name: 'list', wxml: 'pages/list/list.wxml', wxss: 'pages/list/list.wxss', data: list.data, height: true }));

  /* 详情：用成套品种，能看到所属套系进度 */
  const target = cat.coins.filter((c) => c.imgs && c.imgs.length > 1)[0]
    || cat.coins.filter((c) => c.set === 'np')[0]
    || cat.coins.slice().sort((a, b) => b.name.length - a.name.length)[0];
  const detail = loadPage('pages/detail/detail');
  detail.onLoad({ id: String(target.id) });
  detail.onShow();
  files.push(build({ name: 'detail', wxml: 'pages/detail/detail.wxml', wxss: 'pages/detail/detail.wxss', data: detail.data }));

  /* 我的藏品 */
  const mine = loadPage('pages/mine/mine');
  mine.render();
  files.push(build({ name: 'mine', wxml: 'pages/mine/mine.wxml', wxss: 'pages/mine/mine.wxss', data: mine.data, height: true }));

  /* 更多功能 */
  const morePage = loadPage('pages/more/more');
  files.push(build({ name: 'more', wxml: 'pages/more/more.wxml', wxss: 'pages/more/more.wxss', data: morePage.data }));

  /* 注册态（含确认密码） */
  const ar = loadPage('pages/account/account');
  ar.render();
  ar.setData({ loggedIn: false, mode: 'register', password: 'abc12345', password2: 'abc12345', pwdVisible: true });
  files.push(build({ name: 'account-reg', wxml: 'pages/account/account.wxml', wxss: 'pages/account/account.wxss', data: ar.data }));

  /* 登录后完善资料 */
  const ap = loadPage('pages/account/account');
  ap.render();
  ap.setData({ profileSheet: true, profileNick: '', loggedIn: false });
  files.push(build({ name: 'account-profile', wxml: 'pages/account/account.wxml', wxss: 'pages/account/account.wxss', data: ap.data }));

  /* 小程序管理端：首页卡片 + 访客统计 */
  const adm = loadPage('pages/admin/admin');
  adm.setData({
    viewMode: 'home', userCount: 19, coinCount: 136, openCount: 3,
  });
  files.push(build({ name: 'admin', wxml: 'pages/admin/admin.wxml', wxss: 'pages/admin/admin.wxss', data: adm.data }));

  // 用线上真实返回结构渲染，避免手写样例掩盖字段变化
  const admv = loadPage('pages/admin/admin');
  const realVis = JSON.parse(fsx.readFileSync(process.env.VIS_JSON || 'C:/Users/15155/AppData/Local/Temp/visitors.json', 'utf8'));
  admv.data = Object.assign(admv.data, { viewMode: 'module', tab: 'visitors', vsShowVisitors: true, vsError: '' });
  admv.data.visitors = realVis;
  admv.data.visRows = admv.mapVisRows.call(admv, realVis).slice(0, 12);
  files.push(build({ name: 'admin-visitors-mp', wxml: 'pages/admin/admin.wxml', wxss: 'pages/admin/admin.wxss', data: admv.data }));

  const admDetail = loadPage('pages/admin/admin');
  admDetail.setData({
    viewMode: 'module',
    tab: 'visitors',
    vsDetail: {
      title: '223.74.122.90',
      total: 12,
      rows: [
        { at: '11-15 21:04', tab: '品种详情', src: '小程序', srcCls: 'mp', user: '藏友' },
        { at: '11-15 21:02', tab: '全套清单', src: '小程序', srcCls: 'mp', user: '藏友' },
        { at: '11-15 21:00', tab: '首页', src: '小程序', srcCls: 'mp', user: '藏友' },
      ],
    },
  });
  files.push(build({ name: 'admin-vdetail', wxml: 'pages/admin/admin.wxml', wxss: 'pages/admin/admin.wxss', data: admDetail.data }));

  /* 管理端：某用户的藏品 */
  const au = loadPage('pages/admin-user/admin-user');
  const ca = cat.coins.filter((c) => c.name.indexOf('蛇钞') >= 0)[0] || cat.coins[0];
  const cb = cat.coins.filter((c) => c.year >= 2025)[0] || cat.coins[1];
  au.setData({
    loading: false,
    userName: '藏友SBX4',
    avatarText: '藏',
    roleText: '普通用户',
    createdText: '2026/11/09',
    items: [
      { id: 'a1', name: ca.name, imgUrl: ca.smallUrl, qtyLabel: '40 枚', faceText: '20', costText: '560', marketText: '700', unitCostText: '280', pnlText: '+¥140', pnlCls: 'up' },
      { id: 'a2', name: cb.name, imgUrl: cb.smallUrl, qtyLabel: '20 枚', faceText: '10', costText: '220', marketText: '205', unitCostText: '220', pnlText: '-¥15', pnlCls: 'down' },
    ],
    summary: { kinds: 2, costText: '780', marketText: '905', pnlText: '+¥125', up: true },
  });
  files.push(build({ name: 'admin-user', wxml: 'pages/admin-user/admin-user.wxml', wxss: 'pages/admin-user/admin-user.wxss', data: au.data }));

  /* 发行计划：丑角详情弹层 */
  const pd = loadPage('pages/plan/plan');
  pd.build();
  const allPd = (pd.data.years || []).reduce((a, y) => a.concat(y.items), []);
  const ugly = allPd.filter((x) => x.key === 'jingju-2026')[0] || allPd[0];
  if (ugly) {
    pd.setData({ detail: ugly });
    files.push(build({ name: 'plan-detail', wxml: 'pages/plan/plan.wxml', wxss: 'pages/plan/plan.wxss', data: pd.data }));
  }

  /* 系列页 */
  const seriesPage = loadPage('pages/series/series');
  seriesPage.build();
  files.push(build({ name: 'series', wxml: 'pages/series/series.wxml', wxss: 'pages/series/series.wxss', data: seriesPage.data, height: true }));

  /* 管理端（用假数据看排版） */
  const adminPage = loadPage('pages/admin/admin');
  adminPage.setData({
    userCount: 6, coinCount: 136, openCount: 2,
    users: [
      { id: 'u1', name: 'virtualman', role: 'admin', holdings: 14, createdAtText: '2026/11/8' },
      { id: 'u2', name: '藏友G6M4', role: 'user', holdings: 0, createdAtText: '2026/11/9' },
    ],
    tab: 'users',
  });
  files.push(build({ name: 'admin-users', wxml: 'pages/admin/admin.wxml', wxss: 'pages/admin/admin.wxss', data: adminPage.data }));

  /* 详情页·同系列弹窗 */
  const dp = loadPage('pages/detail/detail');
  dp.onLoad({ id: '104' });
  const firstSame = (dp.data.same || [])[0];
  if (firstSame) {
    dp.peekCoin({ currentTarget: { dataset: { id: firstSame.id } } });
    files.push(build({ name: 'detail-peek', wxml: 'pages/detail/detail.wxml', wxss: 'pages/detail/detail.wxss', data: dp.data }));
  }

  /* 发行计划 */
  const planPage = loadPage('pages/plan/plan');
  planPage.onLoad();
  files.push(build({ name: 'plan', wxml: 'pages/plan/plan.wxml', wxss: 'pages/plan/plan.wxss', data: planPage.data, height: true }));

  /* 我的藏品：带假数据的卡片形态 */
  const hd = loadPage('pages/holdings/holdings');
  const c1 = cat.coins.filter((c) => c.name.indexOf('蛇钞') >= 0)[0] || cat.coins[0];
  const c2 = cat.coins.filter((c) => c.name.indexOf('马') >= 0)[0] || cat.coins[1];
  const c3 = cat.coins.filter((c) => c.year >= 2025)[0] || cat.coins[2];
  hd.setData({
    loggedIn: true,
    empty: false,
    summary: { kinds: 3, rolls: 4, marketText: '1,860' },
    stats: { faceText: '90', costText: '1,420', marketText: '1,860', pnlText: '+¥440', pnlPct: 31, up: true },
    groups: [
      {
        name: '生肖贺岁', open: true, progLabel: '已收 2 / 24', pct: 8, sumLabel: '1,240',
        items: [
          { id: 'h1', coinId: c1.id, name: c1.name, imgUrl: c1.smallUrl, rolls: 2, qtyLabel: '2 张', faceText: '40', costText: '800', marketText: '1,050', unitCostText: '400', pnlText: '+¥250', pnlCls: 'up', pnlPct: 31, aiText: '820', aiDiffText: '市价高 28%' },
          { id: 'h2', coinId: c2.id, name: c2.name, imgUrl: c2.smallUrl, rolls: 1, qtyLabel: '10 枚', faceText: '10', costText: '120', marketText: '190', unitCostText: '120', pnlText: '+¥70', pnlCls: 'up', pnlPct: 58, aiText: '246', aiDiffText: '市价低 23%' },
        ],
      },
      {
        name: '独立藏品', open: true, progLabel: '已收 1 / 112', pct: 1, sumLabel: '620',
        items: [
          { id: 'h3', coinId: c3.id, name: c3.name, imgUrl: c3.smallUrl, rolls: 1, qtyLabel: '20 枚', faceText: '40', costText: '500', marketText: '620', unitCostText: '500', pnlText: '+¥120', pnlCls: 'up', pnlPct: 24 },
        ],
      },
    ],
  });
  files.push(build({ name: 'holdings-demo', wxml: 'pages/holdings/holdings.wxml', wxss: 'pages/holdings/holdings.wxss', data: hd.data }));

  /* 我的页：空账本形态 */
  store.state.holdings = [];
  const mineEmpty = loadPage('pages/mine/mine');
  mineEmpty.render();
  files.push(build({ name: 'mine-empty', wxml: 'pages/mine/mine.wxml', wxss: 'pages/mine/mine.wxss', data: mineEmpty.data }));
  store.refresh && null;

  /* 藏品列表（二级页） */
  const hold = loadPage('pages/holdings/holdings');
  hold.onShow();
  files.push(build({ name: 'holdings', wxml: 'pages/holdings/holdings.wxml', wxss: 'pages/holdings/holdings.wxss', data: hold.data, height: true }));

  /* 账户：已登录 + 未登录两种 */
  const acc = loadPage('pages/account/account');
  acc.render();
  files.push(build({ name: 'account-in', wxml: 'pages/account/account.wxml', wxss: 'pages/account/account.wxss', data: acc.data }));

  store.state.user = null;
  store.state.isAdmin = false;
  store.state.holdings = [];
  const acc2 = loadPage('pages/account/account');
  acc2.render();
  files.push(build({ name: 'account-out', wxml: 'pages/account/account.wxml', wxss: 'pages/account/account.wxss', data: acc2.data }));

  /* 纠错反馈 */
  const fb = loadPage('pages/feedback/feedback');
  fb.onLoad({ id: '120' });
  fb.setData({ text: '发行量好像写错了，公告是 1000 万枚，不是 800 万枚。' });
  files.push(build({ name: 'feedback', wxml: 'pages/feedback/feedback.wxml', wxss: 'pages/feedback/feedback.wxss', data: fb.data }));

  /* 隐私政策弹层形态 */
  const accPolicy = loadPage('pages/account/account');
  accPolicy.render();
  accPolicy.setData({ loggedIn: false, showPolicy: true });
  files.push(build({ name: 'account-policy', wxml: 'pages/account/account.wxml', wxss: 'pages/account/account.wxss', data: accPolicy.data }));

  /* 关于页 */
  const about = loadPage('pages/about/about');
  about.onLoad();
  files.push(build({ name: 'about', wxml: 'pages/about/about.wxml', wxss: 'pages/about/about.wxss', data: about.data }));

  console.log('已生成 ' + files.length + ' 个预览页：');
  files.forEach((f) => console.log('  ' + path.relative(process.cwd(), f)));
  console.log('输出目录：' + path.relative(process.cwd(), OUT));
})();
