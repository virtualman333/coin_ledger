'use strict';
/**
 * 小程序页面渲染测试：模拟 Page / wx 运行时，真实执行每个页面的
 * onLoad / onShow 与关键交互，检查 data 是否算得出来、有没有抛错。
 *
 *   node tools/mp_render.js
 */
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
const path = require('path');
const { URL } = require('url');

const mem = {};
const toasts = [];
const modals = [];
let pendingModalConfirm = true;

global.wx = {
  getStorageSync: (k) => (k in mem ? mem[k] : ''),
  setStorageSync: (k, v) => { mem[k] = v; },
  removeStorageSync: (k) => { delete mem[k]; },
  showToast: (o) => { toasts.push(o.title); },
  hideToast: () => {},
  showLoading: () => {},
  hideLoading: () => {},
  stopPullDownRefresh: () => {},
  switchTab: () => {},
  navigateTo: () => {},
  redirectTo: () => {},
  navigateBack: () => {},
  setClipboardData: () => {},
  // 测试里没有交互：actionSheet 默认选第一项（按套）
  showActionSheet: (o) => {
    if (o && typeof o.success === 'function') o.success({ tapIndex: 0 });
  },
  showModal: (o) => {
    modals.push(o.title);
    o.success && o.success({ confirm: pendingModalConfirm, cancel: !pendingModalConfirm });
  },
  request(opts) {
    const url = new URL(opts.url);
    const body = opts.data === undefined ? null : JSON.stringify(opts.data);
    const req = https.request({
      hostname: url.hostname,
      port: 443,
      path: url.pathname + url.search,
      method: opts.method || 'GET',
      headers: Object.assign({ 'content-type': 'application/json', 'Content-Length': body ? Buffer.byteLength(body) : 0 }, opts.header || {}),
      timeout: 15000,
    }, (res) => {
      let raw = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { raw += c; });
      res.on('end', () => {
        let data = raw;
        try { data = JSON.parse(raw); } catch (e) { /* 保持原样 */ }
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

let pass = 0;
let fail = 0;
function ok(cond, label, extra) {
  if (cond) { pass += 1; console.log('  ✓ ' + label); }
  else { fail += 1; console.log('  ✗ ' + label + (extra ? '  → ' + extra : '')); }
}

function loadPage(route) {
  captured = null;
  const file = path.join(MP, route + '.js');
  delete require.cache[require.resolve(file)];
  require(file);
  const cfg = captured;
  const inst = Object.assign({}, cfg);
  inst.data = JSON.parse(JSON.stringify(cfg.data || {}));
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
  require(path.join(MP, 'app.js'));   // 触发 store.hydrate()
  const store = require(path.join(MP, 'utils/store.js'));
  const api = require(path.join(MP, 'utils/api.js'));
  const cat = require(path.join(MP, 'utils/catalog.js'));
  const share = require(path.join(MP, 'utils/share.js'));

  console.log('[1] 首页');
  const home = loadPage('pages/index/index');
  home.onShow();
  await sleep(1200);
  ok(home.data.totalCoins === cat.total, '首页品种数 ' + home.data.totalCoins);
  ok(home.data.latest.length === 3, '最新发行 3 条（三等分一行）');
  ok(home.data.seriesTop.length === 6, '热门系列 6 个');
  ok(home.data.latest.every((x) => x.name && x.priceText), '最新发行都有名称与价格：' + home.data.latest[0].name + ' ' + home.data.latest[0].priceText);
  ok(home.data.stats.faceText === '0', '未登录时统计为 0');
  ok(home.data.progress.total === cat.total && home.data.progress.owned === 0, '全站进度 0 / ' + home.data.progress.total);
  ok(home.data.seriesTop.every((x) => x.label), '系列块都带进度文案：' + home.data.seriesTop[0].label);

  console.log('\n[1.5] 新分类与一套口径');
  const seriesCodes = Object.keys(cat.series);
  ok(seriesCodes.length === 18, '系列数 ' + seriesCodes.length + '（原 16）');
  ok(cat.series.AY === '奥运' && cat.series.TY === '体育赛事' && cat.series.EX === '盛会·博览',
    '奥运与体育赛事已拆分，盛会独立成类');
  const olympic = cat.coins.filter((c) => c.series === 'AY');
  ok(olympic.every((c) => /奥运会|冬奥会/.test(c.name)) && olympic.length === 10,
    '奥运系列 ' + olympic.length + ' 个且全为奥运题材');
  ok(cat.coins.filter((c) => c.series === 'CN').every((c) => c.kind === 'note'), '纪念钞仍独立成类，未混入奥运');
  const jg35 = cat.coins.filter((c) => c.name === '中华人民共和国成立三十五周年')[0];
  ok(jg35.setSize === 3 && jg35.setFace === 3, '建国 35 周年：一套 3 枚，发行价 ¥' + jg35.setFace);
  const cnyIce = cat.coins.filter((c) => c.name === '第24届冬奥会纪念钞·冰上运动')[0];
  const cnySnow = cat.coins.filter((c) => c.name === '第24届冬奥会纪念钞·雪上运动')[0];
  ok(!!cnyIce && !!cnySnow, '冬奥钞拆成冰上 / 雪上两个品种');
  ok(cnyIce.material === '塑料' && cnySnow.material === '纸质', '冰上为塑料钞、雪上为纸钞');
  ok(cnyIce.setSize === 2 && cnyIce.setFace === 40,
    '冬奥钞一套 2 张，成套面额 ¥' + cnyIce.setFace);
  // 口径：一套件数 = limit 字段（整卷/预约件数覆盖）> 套系声明 > 20
  const monkey = cat.coins.filter((c) => c.name.indexOf('2016年贺岁（猴）') === 0)[0];
  ok(monkey && monkey.setSize === 40,
    '二轮羊/猴/鸡按整卷 40 枚：2016 贺岁猴一套 ' + (monkey ? monkey.setSize : '?') + ' 枚');
  ok(cat.coins.filter((c) => c.imgUrl).every((c) => c.smallUrl.indexOf('/img/th/s/') > 0), '有图的品种都有 160px 小图地址');
  const sx = cat.coins.filter((c) => c.name === '2026年贺岁（马·二轮收官）')[0];
  ok(sx.setSize === 20, '生肖仍按整卷 20 枚');
  ok(cnyIce.faceUnit === 20 && cnyIce.faceText === '20 元/张',
    '单张面额 20 元（公告口径）：' + cnyIce.faceText);

  console.log('\n[2] 全套清单');
  const list = loadPage('pages/list/list');
  list.onLoad();
  list.onShow();
  ok(list.data.rows.length === cat.total, '默认列出全部 ' + list.data.rows.length + ' 条');
  ok(list.data.rows[0].year >= list.data.rows[list.data.rows.length - 1].year, '默认年份倒序');
  list.toggleSort();
  ok(list.data.rows[0].year <= list.data.rows[list.data.rows.length - 1].year, '切换后年份正序');
  list.toggleSort();
  list.onSearch({ detail: { value: '泰山' } });
  ok(list.data.rows.length >= 1 && /泰山/.test(list.data.rows[0].name), '搜索「泰山」命中 ' + list.data.rows.length + ' 条');
  list.clearSearch();
  list.applySeries('NP');
  ok(list.data.rows.length === 5, '国家公园系列 5 个品种');
  ok(list.data.rows.every((r) => r.setLabel && r.setLabel.indexOf('一套') === 0), '每行都有「一套」口径说明');
  ok(list.data.rows.filter((r) => r.mintageLabel).length >= 4, '每行都显示发行量：' + (list.data.rows[0] || {}).mintageLabel);
  list.applySeries('');
  list.clearSearch();
  list.toggleOwn();
  ok(list.data.rows.length === 0 && list.data.count === 0, '「只看已收」在无藏品时筛出 0 条');
  list.toggleOwn();
  ok(list.data.rows.length === cat.total, '关掉筛选回到全部');

  console.log('\n[3] 详情页');
  const detail = loadPage('pages/detail/detail');
  detail.onLoad({ id: '1' });
  detail.onShow();
  ok(detail.data.coin && detail.data.coin.name === cat.byId[1].name, '详情加载：' + (detail.data.coin || {}).name);
  const factKeys = detail.data.facts.map((f) => f.k);
  ok(detail.data.facts.length >= 6
    && ['面额', '材质', '发行量', '系列'].every((k) => factKeys.indexOf(k) >= 0),
    '发行信息 ' + detail.data.facts.length + ' 项：' + factKeys.join('/'));
  ok(!!detail.data.aiPrice && detail.data.aiPrice !== '0', '详情页显示 AI 推理价：¥' + detail.data.aiPrice);
  ok(/参考价(高|低)|一致/.test(detail.data.aiDiffText || ''), '给出与参考价的偏离：' + detail.data.aiDiffText);

  ok(detail.data.priceRows.length === 3, '价格 3 行');
  ok(detail.data.priceRows[1].v === cat.money(cat.byId[1].setFace), '一套发行价 = 面值×20：¥' + detail.data.priceRows[1].v);
  ok(detail.data.same.length > 0, '同系列推荐 ' + detail.data.same.length + ' 个');
  ok(cat.shortName('2026年贺岁纪念钞（马钞）') === '马钞' && cat.shortName('中国京剧艺术·净角') === '净角',
    '简称规则生效：马钞 / 净角');
  const detailJg = loadPage('pages/detail/detail');
  detailJg.onLoad({ id: String(jg35.id) });
  detailJg.onShow();
  ok(detailJg.data.setInfo && detailJg.data.setInfo.total === 1, '详情显示所属套系进度：' + JSON.stringify(detailJg.data.setInfo));
  ok(/一套参考价（3 枚）/.test(detailJg.data.priceRows[2].k), '价格行写清一套件数：' + detailJg.data.priceRows[2].k);
  detail.imgErr();
  ok(detail.data.imgFail === true, '图片失败时降级为占位');
  const beforeModal = modals.length;
  detail.addCoin();
  ok(modals.length === beforeModal + 1, '未登录点加入会提示登录');

  console.log('\n[4] 我的页与藏品列表（未登录）');
  const mine = loadPage('pages/mine/mine');
  mine.onShow();
  await sleep(1200);
  ok(mine.data.loggedIn === false, '未登录态正确');
  ok(mine.data.stats.kinds === 0, '未登录时统计为空');
  const holdGuest = loadPage('pages/holdings/holdings');
  holdGuest.onShow();
  await sleep(800);
  ok(holdGuest.data.loggedIn === false && (holdGuest.data.groups || []).length === 0, '未登录不显示分组');

  console.log('\n[5] 账户页');
  const acc = loadPage('pages/account/account');
  acc.onShow();
  await sleep(1200);
  ok(acc.data.loggedIn === false, '账户页未登录');
  ok(acc.data.totalCoins === cat.total, '展示全站品种数');

  console.log('\n[6] 登录 → 我的藏品有数据 → 详情页加藏品');
  const reg = await api.post('/api/auth/register', {
    name: 'mprender' + Date.now().toString(36).slice(-5),
    password: 'Render2026pw',
  });
  api.setToken(reg.token);
  await store.refresh();

  const detail2 = loadPage('pages/detail/detail');
  detail2.onLoad({ id: '2' });
  detail2.onShow();
  ok(detail2.data.loggedIn === true, '登录态已生效');
  detail2.addCoin();
  await sleep(1800);
  ok(toasts.indexOf('已加入我的藏品') >= 0, '加入成功提示：' + toasts.join(' / '));
  ok(detail2.data.owned === true, '按钮切换为「移出」');

  const mine2 = loadPage('pages/mine/mine');
  mine2.onShow();
  await sleep(1500);
  ok(mine2.data.loggedIn === true, '我的页已登录');
  ok(mine2.data.stats.kinds === 1 && mine2.data.stats.costText !== '0', '我的页统计：' + mine2.data.stats.costText + ' / ' + mine2.data.stats.marketText);
  ok(typeof mine2.goHoldings === 'function', '我的页有「我的藏品」二级页入口');

  const hold = loadPage('pages/holdings/holdings');
  hold.onShow();
  await sleep(1200);
  ok(hold.data.empty === false, '藏品列表非空');
  const firstGroup = hold.data.groups[0];
  ok(firstGroup && firstGroup.items.length === 1, '分组渲染：' + (firstGroup || {}).name + ' / ' + ((firstGroup || {}).items || []).length + ' 条');
  ok(hold.data.groups[0].items[0].qtyLabel && /枚|张/.test(hold.data.groups[0].items[0].qtyLabel),
    '持仓行显示件数：' + hold.data.groups[0].items[0].qtyLabel + ' · 面值 ' + hold.data.groups[0].items[0].faceText);
  ok(hold.data.groups[0].progLabel && hold.data.groups[0].pct >= 0,
    '分组进度：' + hold.data.groups[0].name + ' ' + hold.data.groups[0].progLabel);
  // 分组名必须跟系列主数据一致，不能退化成笼统的「独立藏品」
  const coinOfGroup = cat.byName[hold.data.groups[0].items[0].name];
  ok(firstGroup.name === coinOfGroup.seriesName,
    '分组名对齐系列：' + firstGroup.name + ' = ' + coinOfGroup.seriesName);
  ok(firstGroup.total === cat.inSeries(coinOfGroup.series).length,
    '分组总量按系列计：' + firstGroup.total);

  const hid = firstGroup.items[0].id;
  hold.changeRolls({ currentTarget: { dataset: { id: hid, delta: 1 } } });
  await sleep(1500);
  ok(hold.data.groups[0].items[0].rolls === 2, '套数加到 2：' + hold.data.groups[0].items[0].rolls);

  const acc2 = loadPage('pages/account/account');
  acc2.onShow();
  await sleep(1200);
  ok(acc2.data.loggedIn === true && acc2.data.user.name === reg.user.name, '账户页显示已登录用户');
  ok(acc2.data.holdingsCount === 1, '账户页藏品数 1');
  ok(acc2.data.avatarText.length === 1, '头像只取首字：' + acc2.data.avatarText);

  console.log('\n[6.2] 搜索框不自动聚焦');
  const listWxml = require('fs').readFileSync(path.join(MP, 'pages/list/list.wxml'), 'utf8');
  ok(listWxml.indexOf('search-fake') >= 0 && listWxml.indexOf('wx:if="{{!searchActive}}"') >= 0,
    '未激活时只渲染假搜索框，页面里没有 input');
  const listPage = loadPage('pages/list/list');
  listPage.onLoad();
  ok(listPage.data.searchActive === false && listPage.data.searchFocus === false,
    '进入清单页不激活搜索框（不弹输入法）');
  listPage.onShow();
  ok(listPage.data.searchActive === false, 'onShow 后仍是假框');
  listPage.activateSearch();
  ok(listPage.data.searchActive === true && listPage.data.searchFocus === true, '点击后挂上真输入框并聚焦');
  listPage.onSearch({ detail: { value: '马' } });
  ok(listPage.data.keyword === '马', '输入生效');
  listPage.onSearchBlur();
  ok(listPage.data.searchFocus === false && listPage.data.searchActive === true, '有关键词时保留输入框（可继续改）');
  listPage.clearSearch();
  ok(listPage.data.searchActive === false, '清空后收回假框');
  listPage.onShow();
  ok(listPage.data.searchActive === false && listPage.data.searchFocus === false, '再次进入仍不弹输入法');

  console.log('\n[6.5] 按钮居中');
  const appCss = require('fs').readFileSync(path.join(MP, 'app.wxss'), 'utf8');
  const btnRule = /button\s*\{([\s\S]*?)\}/.exec(appCss);
  const btnBody = btnRule ? btnRule[1] : '';
  ok(btnBody.indexOf('display: flex') >= 0 && btnBody.indexOf('align-items: center') >= 0,
    '按钮用 flex 垂直居中（不靠 line-height 撑）');
  ok(btnBody.indexOf('line-height: 1') >= 0, '按钮行高归零，避免与固定高度打架');

  console.log('\n[6.8] 账户与微信登录');
  const accPage = loadPage('pages/account/account');
  ['wxLogin', 'bindWx', 'setPassword', 'submit', 'logout'].forEach((fn) => {
    ok(typeof accPage[fn] === 'function', '账户页有 ' + fn + '()');
  });
  const accWxml = require('fs').readFileSync(path.join(MP, 'pages/account/account.wxml'), 'utf8');
  ok(accWxml.indexOf('password="{{true}}"') >= 0, '密码框用 {{true}} 声明（裸写 password 会被当成空串）');
  ok(!/(^|[^="{])password\s*\n/.test(accWxml.replace(/password="\{\{true\}\}"/g, '')), '没有裸 password 属性');

  console.log('\n[6.8] 发行计划');
  const planPage = loadPage('pages/plan/plan');
  planPage.onLoad();
  ok(Array.isArray(planPage.data.years) && planPage.data.years.length > 0,
    '发行计划有年度分组：' + planPage.data.years.length);
  const planItems = (planPage.data.years[0] || {}).items || [];
  ok(planItems.length > 0, '首个年度有计划条目：' + planItems.length);
  ok(planItems.every((it) => it.name && it.key), '每条都有名称与 key');
  ok(planPage.data.years.some((y) => (y.items || []).some((it) => it.cdText)),
    '待发行条目带倒计时文案');
  ok(typeof planPage.remind === 'function', '计划页有订阅提醒入口');
  ok(planPage.data.years[0].year === 2026, '年度倒序：最新年度在最前');
  const firstItem = (planPage.data.years[0].items || [])[0];
  ok(firstItem && firstItem.dateFull === '2026-11-24',
    '条目按发行日倒序：最新一条是 ' + (firstItem ? firstItem.dateFull + ' ' + firstItem.short : '无'));
  const upItem = planPage.data.years.reduce((a, y) => a.concat((y.items || []).filter((i) => i.isUp)), [])[0];
  ok(!!upItem && !!upItem.key, '待发行条目带 key（订阅要用）：' + (upItem ? upItem.key : '无'));

  console.log('\n[6.79] 我的藏品卡片与长按编辑');
  const holdPg = loadPage('pages/holdings/holdings');
  ok(typeof holdPg.openSheet === 'function' && typeof holdPg.saveSheet === 'function',
    '藏品卡长按进操作面板（数量/成本/移出）');
  ok(typeof holdPg.closeSheet === 'function' && holdPg.data.sheet === null,
    '面板默认关闭');

  console.log('\n[6.8] 详情页同系列弹窗');
  const detailPg = loadPage('pages/detail/detail');
  detailPg.onLoad({ id: '104' });
  ok(typeof detailPg.onSwiper === 'function', '主图支持左右滑动切换');
  ok(typeof detailPg.peekCoin === 'function' && typeof detailPg.goPeek === 'function',
    '同系列点击走「弹窗 → 查看详情」两步');
  ok(Array.isArray(detailPg.data.same) && detailPg.data.same.length > 0,
    '同系列有列表：' + (detailPg.data.same || []).length + ' 个');

  console.log('\n[6.81] 小程序管理端');
  const adminPage = loadPage('pages/admin/admin');
  const mods = (adminPage.data.modules || []).reduce((a, g) => a.concat(g.items || []), []);
  ok(mods.length === 6 && mods.some((m) => m.k === 'series') && mods.some((m) => m.k === 'visitors'),
    '管理端六个入口（含系列与访客）：' + mods.map((m) => m.t).join('/'));
  ok(adminPage.data.viewMode === 'home' && typeof adminPage.openModule === 'function'
    && typeof adminPage.backHome === 'function' && typeof adminPage.saveEdit === 'function',
    '管理端首页卡片可进模块、可返回、可编辑品种');
  ok(typeof adminPage.pickAndUpload === 'function', '管理端可上传图片');
  const minePage = loadPage('pages/mine/mine');
  ok(typeof minePage.goAdmin === 'function', '我的页有管理端入口方法');

  console.log('\n[6.82] 更多功能页');
  const morePg = loadPage('pages/more/more');
  ok(typeof morePg.submit === 'function', '更多功能页可提交建议');
  ok(Array.isArray(morePg.data.features) && morePg.data.features.length >= 4,
    '更多功能页列出已有能力：' + (morePg.data.features || []).length + ' 项');
  const aboutPg = loadPage('pages/about/about');
  ok(typeof aboutPg.goMore === 'function', '关于页有「更多功能」入口');
  ok(aboutPg.data.isTest === false, '关于页默认不是测试账号（入口可见）');

  console.log('\n[6.83] 账户与关于入口');
  const mineMenu = loadPage('pages/mine/mine');
  ok(typeof mineMenu.goAbout === 'function' && typeof mineMenu.goAccount === 'function', '我的页有「关于」「账户」跳转');
  const mineXml = require('fs').readFileSync(path.join(MP, 'pages/mine/mine.wxml'), 'utf8');
  ok(mineXml.indexOf('账户与安全') > 0 && mineXml.indexOf('关于藏币录') > 0, '我的页底部菜单含账户与关于');
  const appJson = JSON.parse(require('fs').readFileSync(path.join(MP, 'app.json'), 'utf8'));
  ok(appJson.pages.indexOf('pages/about/about') >= 0, '关于页已注册');
  const aboutPage = loadPage('pages/about/about');
  aboutPage.onLoad();
  ok(!!aboutPage.data.version, '关于页显示版本：v' + aboutPage.data.version);
  ok(aboutPage.data.totalCoins > 100, '关于页显示收录数量：' + aboutPage.data.totalCoins);

  console.log('\n[6.85] 我的藏品折叠');
  const mineFold = loadPage('pages/holdings/holdings');
  mineFold.onShow();
  if (mineFold.data.groups.length) {
    ok(mineFold.data.groups.every((g) => g.open === true), '默认全部展开');
    mineFold.toggleGroup({ currentTarget: { dataset: { gi: 0 } } });
    ok(mineFold.data.groups[0].open === false, '点分组标题可收起');
    ok(mineFold.data.allOpen === false, 'allOpen 同步为 false');
    mineFold.toggleAll();
    ok(mineFold.data.groups.every((g) => g.open === true), '「全部展开」后都展开');
    mineFold.toggleAll();
    ok(mineFold.data.groups.every((g) => g.open === false), '再点变「全部收起」');
    const saved = wx.getStorageSync('cl_mine_collapsed');
    ok(Array.isArray(saved) && saved.length === mineFold.data.groups.length, '折叠状态写入本地：' + saved.length + ' 个分组');
    mineFold.toggleAll();
  } else {
    ok(false, '我的藏品没有分组，无法验证折叠');
  }

  console.log('\n[6.9] 多图');
  const withMulti = cat.coins.filter((c) => c.imgs && c.imgs.length > 1);
  ok(withMulti.length >= 50, '有多个图的品种：' + withMulti.length + ' / ' + cat.total);
  const sample = withMulti[0];
  const dpage = loadPage('pages/detail/detail');
  dpage.onLoad({ id: String(sample.id) });
  dpage.onShow();
  ok(dpage.data.gal.length === sample.imgs.length, '详情页拿到全部图：' + dpage.data.gal.map((g) => g.label).join('/'));
  ok(!!dpage.data.mainUrl && dpage.data.mainIdx === 0, '默认显示第一张');
  if (dpage.data.gal.length > 1) {
    dpage.pickImg({ currentTarget: { dataset: { i: 1 } } });
    ok(dpage.data.mainIdx === 1 && dpage.data.mainUrl === sample.imgs[1].url, '点缩略图能切图：' + dpage.data.mainLabel);
  }
  ok(cat.coins.every((c) => c.imgs.every((g) => g.url.indexOf('https://') === 0 && g.url.indexOf('/img/') > 0)), '图片地址都是绝对 URL');

  console.log('[6.95] 加入藏品时指定数量');
  await sleep(1500);   // 等上一段的 changeRolls 写完，避免两个 persist 竞态
  const qtyCoin = cat.coins.filter((c) => c.id !== 2)[0];
  await store.addCoin(qtyCoin, 'set', 3);
  await sleep(1200);
  const qtyRows = store.getState().holdings;
  const qtyRow = qtyRows.filter((x) => x.name === qtyCoin.name)[0] || qtyRows[qtyRows.length - 1];
  ok(qtyRow && qtyRow.rolls === 3, '加入时数量生效：3 份');
  ok(qtyRow && Math.abs(qtyRow.cost - qtyCoin.setFace * 3) < 0.01, '成本按数量累加：' + (qtyRow && qtyRow.cost));
  if (qtyRow) await store.removeHolding(qtyRow.id);

  console.log('\n[7] 转发分享');
  ['pages/index/index', 'pages/list/list', 'pages/mine/mine', 'pages/detail/detail'].forEach((route) => {
    const pg = loadPage(route);
    ok(typeof pg.onShareAppMessage === 'function' && typeof pg.onShareTimeline === 'function',
      route + ' 同时支持转发与朋友圈');
  });
  const accShare = loadPage('pages/account/account');
  ok(typeof accShare.onShareAppMessage === 'undefined', '账户页不提供转发（避免分享登录页）');
  const dShare = detail.onShareAppMessage();
  ok(dShare.path === '/pages/detail/detail?id=' + detail.data.id, '详情转发落地到品种：' + dShare.path);
  ok(dShare.title.indexOf(String(detail.data.coin.year)) > 0, '转发标题含年份：' + dShare.title);
  ok(/^\/images\/share-cover\.png$/.test(share.COVER) && require('fs').existsSync(path.join(MP, 'images/share-cover.png')),
    '分享封面图存在：' + share.COVER);
  const lShare = list.onShareAppMessage();
  ok(lShare.path === '/pages/list/list', '清单转发落地到清单页：' + lShare.path);

  console.log('\n[8] 清理');
  const admin = await api.post('/api/auth/login', { name: 'virtualman', password: readAdminPw() });
  api.setToken(admin.token);
  const users = await api.get('/api/admin/users');
  const target = (users.users || []).filter((u) => u.name === reg.user.name)[0];
  const targetId = target && target.id;
  await new Promise((resolve) => {
    const req = https.request({
      hostname: 'coin.virtualman.top',
      path: '/api/admin/users/' + (target ? target.id : 'x'),
      method: 'DELETE',
      headers: { Authorization: 'Bearer ' + admin.token },
      timeout: 15000,
    }, (res) => { res.resume(); res.on('end', resolve); });
    req.on('error', resolve);
    req.end();
  });
  const mark = await api.patch('/api/admin/users/' + targetId, { isTest: true });
  ok(mark && mark.ok !== false, '临时账号标记为测试账号');
  await new Promise((resolve) => {
    const https3 = require('https');
    const req = https3.request({
      hostname: 'coin.virtualman.top', path: '/api/admin/users/' + targetId, method: 'DELETE',
      headers: { Authorization: 'Bearer ' + admin.token }, timeout: 15000,
    }, (res) => { res.resume(); res.on('end', resolve); });
    req.on('error', resolve);
    req.end();
  });
  const after = await api.get('/api/admin/users');
  ok(!(after.users || []).some((u) => u.name === reg.user.name), '测试账号已清理');

  console.log('\n结果：' + pass + ' 通过，' + fail + ' 失败');
  process.exit(fail === 0 ? 0 : 1);
})().catch((err) => {
  console.error('渲染测试中断：' + (err && err.stack ? err.stack : err));
  process.exit(1);
});
