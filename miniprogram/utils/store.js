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

/** 从服务器拉一次全量状态。
 *  并发调用共用同一个请求；写操作之后要用 refresh({force:true})，
 *  否则可能拿到「写入之前就已发出」的那次响应，导致刚加的藏品不出现。 */
function refresh(opts) {
  const force = !!(opts && opts.force);
  if (inflight && !force) return inflight;
  inflight = api.get('/api/state').then((res) => {
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
    inflight = null;
    state.synced = false;
    state.error = err.message || '同步失败';
    throw err;
  });
  return inflight;
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
  }));
  return api.put('/api/holdings', { holdings: payload }).then((res) => {
    state.rev = res.rev || state.rev;
    saveCache();
    return res;
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

/** 贵金属入账本：按枚记，不套用普通币的整卷口径，成本/市价留空 */
function addPm(item) {
  requireLogin();
  const hit = state.holdings.filter((h) => h.category === 'pm' && h.id === item.code)[0];
  if (hit) { const err = new Error('这枚已经在你的藏品里了'); err.duplicate = true; throw err; }
  state.holdings.push({
    id: item.code,
    name: item.name,
    category: 'pm',
    thumb: item.thumb || '',
    unit: 'piece', rolls: 1, cost: 0, market: 0, group: '贵金属',
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

function clearUser() {
  state.user = null;
  state.isAdmin = false;
  state.holdings = [];
  state.synced = false;
  saveCache();
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
  clearUser,
};
