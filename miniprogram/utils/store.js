/**
 * 应用状态：账号 / 藏品 / 行情。
 * 权威数据在服务器（与网站共用一套库），本机只做一份缓存用于秒开。
 */
const api = require('./api');
const cat = require('./catalog');

const CACHE_KEY = 'cl_cache';

const state = {
  booted: false,
  user: null,
  isAdmin: false,
  holdings: [],
  prices: {},
  userCount: 0,
  rev: 0,
  synced: false,
  error: '',
};

function getState() {
  return state;
}

function saveCache() {
  try {
    wx.setStorageSync(CACHE_KEY, {
      user: state.user,
      holdings: state.holdings,
      prices: state.prices,
      rev: state.rev,
      userCount: state.userCount,
      synced: state.synced,
    });
  } catch (e) {
    // 缓存失败不影响主流程
  }
}

function hydrate() {
  try {
    const cache = wx.getStorageSync(CACHE_KEY);
    if (cache && cache.user) {
      state.user = cache.user;
      state.holdings = Array.isArray(cache.holdings) ? cache.holdings : [];
      state.prices = cache.prices || {};
      state.rev = cache.rev || 0;
      state.userCount = cache.userCount || 0;
      state.synced = !!cache.synced;
    }
  } catch (e) {
    // 忽略损坏的缓存
  }
  state.booted = true;
}

let inflight = null;
let refreshSeq = 0;   // 每次 refresh 递增；只有最新一次允许写 state，旧的慢响应一律作废

/** 从服务器拉一次全量状态。
 *  并发调用共用同一个请求；写操作之后要用 refresh({force:true})，
 *  否则可能拿到「写入之前就已发出」的那次响应，导致刚加的藏品不出现。
 *  注意：force 会发新请求，但旧请求并不会被取消，所以必须用序号把旧响应作废，
 *  否则旧响应晚到仍会覆盖 state 与缓存（这正是以前「刚加的藏品消失」的根因）。 */
function refresh(opts) {
  const force = !!(opts && opts.force);
  if (inflight && !force) return inflight;
  const my = ++refreshSeq;
  const p = api.get('/api/state').then((res) => {
    // 已被更新的 refresh 取代：丢弃这份旧快照，且不碰 inflight / state / 缓存
    if (my !== refreshSeq) return state;
    state.user = res.user || null;
    state.isAdmin = !!res.isAdmin;
    state.holdings = Array.isArray(res.holdings) ? res.holdings : [];
    state.prices = res.prices || {};
    state.userCount = res.userCount || 0;
    state.rev = res.rev || 0;
    state.synced = true;
    state.error = '';
    if (!state.user) {
      state.holdings = [];
    }
    saveCache();
    inflight = null;
    return state;
  }).catch((err) => {
    if (my !== refreshSeq) return state;   // 过期请求失败也别污染当前状态
    inflight = null;
    state.synced = false;
    state.error = err.message || '同步失败';
    throw err;
  });
  inflight = p;
  return p;
}

function isLogin() {
  return !!state.user;
}

/** 单件市价（服务器行情优先） */
function priceOf(coin) {
  const p = state.prices[String(coin.id - 1)];
  return typeof p === 'number' ? cat.round2(p) : coin.est;
}

/** 一套市价（件数由套系决定） */
function setPriceOf(coin) {
  return cat.round2(priceOf(coin) * cat.setSizeOf(coin));
}

function findHolding(name) {
  for (let i = 0; i < state.holdings.length; i += 1) {
    if (state.holdings[i].name === name) return state.holdings[i];
  }
  return null;
}

function ownedNames() {
  const map = {};
  state.holdings.forEach((h) => {
    map[h.name] = true;
  });
  return map;
}

function stats() {
  let face = 0;
  let cost = 0;
  let market = 0;
  let rolls = 0;
  state.holdings.forEach((h) => {
    const coin = cat.byName[h.name];
    if (!coin) return;
    const r = Number(h.rolls) || 0;
    face += coin.setFace * r;
    cost += Number(h.cost) || 0;
    market += Number(h.market) || 0;
    rolls += r;
  });
  return {
    face: cat.round2(face),
    cost: cat.round2(cost),
    market: cat.round2(market),
    profit: cat.round2(market - cost),
    rolls,
    kinds: state.holdings.length,
  };
}

function requireLogin() {
  if (!state.user) {
    const err = new Error('登录后才能记录藏品');
    err.needLogin = true;
    throw err;
  }
}

/**
 * 全量 PUT 串行化：多次写操作并发时会各自生成快照，若后发先至，
 * 旧快照会覆盖新快照导致号码/图片/数量丢失。这里在调用时先冻结 payload，
 * 再按调用顺序排队发送，保证服务端最终收到的一定是最后一次完整状态。
 * 失败时标记 unsynced，页面据此提示「未同步」。
 */
let persistTail = null;       // 最后一个未决的写；为空时表示当前没有排队

function persist() {
  const payload = state.holdings.map((h) => ({
    id: h.id,
    name: h.name,
    rolls: h.rolls,
    cost: cat.round2(h.cost),
    market: cat.round2(h.market),
    group: h.group,
    // 这三个字段必须一起回传，否则贵金属藏品服务端刷新后会退化成普通币：
    // category 决定「我的藏品-贵金属」页签与 isOwned 去重，thumb 是缩略图，
    // unit='piece' 决定按单枚而非按套记。服务端 migration 007 已存这三列。
    category: h.category,
    thumb: h.thumb,
    unit: h.unit,
    // 藏品增强（migration 008）：号码 / 整套单个 / 图片，必须一起回传否则保存后丢失
    serials: Array.isArray(h.serials) ? h.serials : [],
    form: h.form === 'single' || h.form === 'set' ? h.form : '',
    images: Array.isArray(h.images) ? h.images : [],
  }));                                     // 冻结本次快照，绝不在队列里再读 state
  const put = api.put;                     // 调用时捕获，避免排队期间被替换（测试/热更场景）
  const prev = persistTail;
  // 队列为空时同步发起，保持「写操作立即落库」的原有语义；
  // 已有写在飞才排队，保证服务端收到的是按顺序的完整快照。
  const run = prev
    ? prev.then(() => put('/api/holdings', { holdings: payload }))
    : put('/api/holdings', { holdings: payload });
  const tail = run.catch(() => {});        // 一次失败不能让后续写全部卡死
  persistTail = tail;
  tail.then(() => { if (persistTail === tail) persistTail = null; });
  return run.then((res) => {
    state.rev = res.rev || state.rev;
    state.synced = true;
    state.error = '';
    saveCache();
    return res;
  }).catch((err) => {
    state.synced = false;
    state.error = err.message || '保存失败，尚未同步';
    throw err;
  });
}

function newId() {
  return 'h' + Date.now().toString(36) + Math.floor(Math.random() * 1000).toString(36);
}

/** 加入我的藏品（1 套） */
/**
 * 加入藏品。
 * unit='set' 按整套/整卷记；unit='piece' 按单枚（单张）记。
 * 单枚的成本与市价按「一套 ÷ 件数」折算，账本里仍然是纯数量。
 */
function addCoin(coin, unit, qty) {
  requireLogin();
  if (findHolding(coin.name)) {
    const err = new Error('这一枚已经在你的藏品里了');
    err.duplicate = true;
    throw err;
  }
  const size = Math.max(1, Number(cat.setSizeOf(coin)) || 1);
  const isPiece = unit === 'piece' && size > 1;
  const n = Math.max(1, Math.min(9999, Math.floor(Number(qty) || 1)));
  const setFace = coin.setFace;
  const setMarket = setPriceOf(coin);
  const oneCost = isPiece ? setFace / size : setFace;
  const oneMarket = isPiece ? setMarket / size : setMarket;
  state.holdings.push({
    id: newId(),
    name: coin.name,
    unit: isPiece ? 'piece' : 'set',
    rolls: n,
    cost: Math.round(oneCost * n * 100) / 100,
    market: Math.round(oneMarket * n * 100) / 100,
    group: coin.group,
  });
  return persist();
}

/** 贵金属入账本：按枚记，不套用普通币的整卷口径；成本默认按面值 × 数量 */
function addPm(item) {
  requireLogin();
  const hit = state.holdings.filter((h) => h.category === 'pm' && h.id === item.code)[0];
  if (hit) { const err = new Error('这枚已经在你的藏品里了'); err.duplicate = true; throw err; }
  // 面值优先取入参 item.face（贵金属详情接口提供），再退回目录同名品种；没有则维持 0
  const coin = cat.byName[item.name];
  const face = Number(item && item.face) || (coin ? Number(coin.face) || 0 : 0);
  const qty = Math.max(1, Number(item && item.rolls) || 1);
  state.holdings.push({
    id: item.code,
    name: item.name,
    category: 'pm',
    thumb: item.thumb || '',
    unit: 'piece', rolls: qty,
    cost: Math.round(face * qty * 100) / 100,
    market: 0, group: '贵金属',
  });
  return persist();
}

function removeHolding(id) {
  requireLogin();
  state.holdings = state.holdings.filter((h) => h.id !== id);
  return persist();
}

/** 设定每套成本（按套数换算总成本；市值不动，它是估值不是成交价） */
function setCost(id, unitCost) {
  requireLogin();
  const target = state.holdings.filter((h) => h.id === id)[0];
  if (!target) return Promise.resolve(null);
  const rolls = Number(target.rolls) || 1;
  const unit = Math.max(0, Number(unitCost) || 0);
  target.cost = Math.round(unit * rolls * 100) / 100;
  return persist();
}

/** 调整套数（同时按单价重算成本与市值） */
function setRolls(id, rolls) {
  requireLogin();
  const next = Math.max(1, Math.min(99, Number(rolls) || 1));
  const target = state.holdings.filter((h) => h.id === id)[0];
  if (!target) return Promise.resolve(null);
  const oldRolls = Number(target.rolls) || 1;
  const unitCost = (Number(target.cost) || 0) / oldRolls;
  const unitMarket = (Number(target.market) || 0) / oldRolls;
  target.rolls = next;
  target.cost = cat.round2(unitCost * next);
  target.market = cat.round2(unitMarket * next);
  return persist();
}

/** 局部更新藏品的可选字段（号码/形态/图片），白名单收敛后落库 */
function patchHolding(id, patch) {
  requireLogin();
  const target = state.holdings.filter((h) => h.id === id)[0];
  if (!target) return Promise.resolve(null);
  const p = patch || {};
  if (Array.isArray(p.serials)) target.serials = p.serials.slice(0, 200).map((s) => String(s || '').trim()).filter(Boolean);
  if (p.form === 'single' || p.form === 'set' || p.form === '') target.form = p.form;
  if (Array.isArray(p.images)) target.images = p.images.slice(0, 3);
  return persist();
}

/** 上传藏品图片（base64），返回 /collection/xxx 路径 */
function uploadImage(dataUrl) {
  requireLogin();
  return api.post('/api/holding/image', { image: dataUrl });
}

/**
 * 会话失效/登出：清干净所有用户相关字段，并作废所有在飞的 refresh。
 * 以前只清 user/isAdmin/holdings，prices/rev 会串到下一个账号；
 * 且有 refresh 在飞时其回调会把旧账号数据重新写回 state 与缓存（串号）。
 */
function clearUser() {
  refreshSeq++;            // 让所有在飞 refresh 的回调变成过期响应
  inflight = null;
  state.user = null;
  state.isAdmin = false;
  state.holdings = [];
  state.prices = {};
  state.userCount = 0;
  state.rev = 0;
  state.synced = false;
  state.error = '';
  try { wx.removeStorageSync(CACHE_KEY); } catch (e) { /* 缓存不可用时忽略 */ }
}

/** 登录态失效（401）：与主动登出同一套清理，供 api 层调用 */
function onSessionExpired() {
  clearUser();
}

module.exports = {
  state,
  getState,
  hydrate,
  refresh,
  saveCache,
  isLogin,
  priceOf,
  setPriceOf,
  findHolding,
  ownedNames,
  stats,
  addCoin,
  addPm,
  removeHolding,
  setRolls,
  setCost,
  patchHolding,
  uploadImage,
  clearUser,
  onSessionExpired,
  persist,
};
