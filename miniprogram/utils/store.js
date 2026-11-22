/**
 * 应用状态：账号 / 收藏 / 行情。
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
 *  否则可能拿到「写入之前就已发出」的那次响应，导致刚加的收藏不出现。
 *  注意：force 会发新请求，但旧请求并不会被取消，所以必须用序号把旧响应作废，
 *  否则旧响应晚到仍会覆盖 state 与缓存（这正是以前「刚加的收藏消失」的根因）。 */
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
  let kinds = 0;
  let pmKinds = 0;   // 贵金属不在本地 catalog，面值/推理价都算不出来，只能单独计数
  let pmRolls = 0;
  state.holdings.forEach((h) => {
    if (h.category === 'pm') {
      pmKinds += 1;
      pmRolls += Number(h.rolls) || 0;
      cost += Number(h.cost) || 0;
      return;
    }
    const coin = cat.byName[h.name];
    if (!coin) return;
    const r = Number(h.rolls) || 0;
    face += coin.setFace * r;
    cost += Number(h.cost) || 0;
    market += Number(h.market) || 0;
    rolls += r;
    kinds += 1;
  });
  return {
    face: cat.round2(face),
    cost: cat.round2(cost),
    market: cat.round2(market),
    profit: cat.round2(market - cost),
    rolls,
    kinds,
    pmKinds,
    pmRolls,
  };
}

function requireLogin() {
  if (!state.user) {
    const err = new Error('登录后才能记录收藏');
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

/* ---------------- 收藏的导出 / 导入（CSV 表格） ---------------- */

const HOLDING_EXPORT_FIELDS = [
  'name', 'category', 'id', 'unit', 'rolls', 'cost', 'market',
  'group', 'thumb', 'serials', 'form', 'images',
];

/**
 * 旧版 JSON 导出（全字段、含图片数组），只保留给兼容与测试；
 * 界面上的「导出收藏」已经改成 CSV 表格。
 */
function exportHoldings() {
  const holdings = (state.holdings || []).map((h) => {
    const out = {};
    HOLDING_EXPORT_FIELDS.forEach((k) => { out[k] = h[k]; });
    out.category = h.category === 'pm' ? 'pm' : (h.category || '');
    out.unit = h.unit === 'piece' ? 'piece' : 'set';
    out.rolls = Number(h.rolls) || 0;
    out.cost = cat.round2(Number(h.cost) || 0);
    out.market = cat.round2(Number(h.market) || 0);
    out.group = h.group || '';
    out.thumb = h.thumb || '';
    out.id = h.id || '';
    out.serials = Array.isArray(h.serials) ? h.serials.slice(0, 50) : [];
    out.form = h.form === 'single' || h.form === 'set' ? h.form : '';
    out.images = Array.isArray(h.images) ? h.images.slice(0, 20) : [];
    return out;
  });
  return {
    app: 'coin-ledger',
    type: 'holdings',
    version: 1,
    exportedAt: new Date().toISOString(),
    count: holdings.length,
    holdings,
  };
}

/* 列顺序固定；导入按表头名匹配，用户调换列顺序也能读 */
const CSV_COLUMNS = [
  ['name', '名称'], ['category', '类别'], ['id', '编号'], ['unit', '单位'],
  ['rolls', '数量'], ['cost', '成本合计'], ['market', '市值合计'], ['group', '分组'],
  ['serials', '冠号'], ['form', '形态'], ['thumb', '缩略图'], ['images', '图片'], ['sep', '独立'],
];

const CSV_HEAD_ALIAS = {
  '名称': 'name', '品种': 'name', 'name': 'name',
  '类别': 'category', '品类': 'category', 'category': 'category',
  '编号': 'id', '代码': 'id', 'id': 'id',
  '单位': 'unit', 'unit': 'unit',
  '数量': 'rolls', '份数': 'rolls', '套数': 'rolls', 'rolls': 'rolls',
  '成本': 'cost', '成本合计': 'cost', 'cost': 'cost',
  '市值': 'market', '市值合计': 'market', 'market': 'market',
  '分组': 'group', 'group': 'group',
  '冠号': 'serials', '号码': 'serials', 'serials': 'serials',
  '形态': 'form', 'form': 'form',
  '缩略图': 'thumb', 'thumb': 'thumb',
  '图片': 'images', 'images': 'images',
  '独立': 'sep', 'sep': 'sep',
};

const CSV_CAT_LABEL = { coin: '普通纪念币', note: '纪念钞', pm: '贵金属纪念币' };
const CSV_UNIT_LABEL = { piece: '枚', set: '套' };
const CSV_FORM_LABEL = { single: '单个', set: '整套' };

/** 单元格转义：含逗号 / 引号 / 换行的加引号，内部引号翻倍（RFC4180） */
function csvCell(v) {
  const s = (v == null) ? '' : String(v);
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

function csvCatLabel(c) {
  return CSV_CAT_LABEL[c === 'pm' ? 'pm' : (c === 'note' ? 'note' : 'coin')];
}

function csvFormLabel(f) {
  return f === 'single' ? '单个' : (f === 'set' ? '整套' : '');
}

/** 当前账本 → CSV 文本（不含 BOM，落文件时再加） */
function holdingsCsv() {
  const lines = [CSV_COLUMNS.map((c) => c[1])];
  (state.holdings || []).forEach((h) => {
    lines.push(CSV_COLUMNS.map((col) => {
      const k = col[0];
      if (k === 'category') return csvCatLabel(h.category);
      if (k === 'unit') return CSV_UNIT_LABEL[h.unit === 'piece' ? 'piece' : 'set'];
      if (k === 'form') return csvFormLabel(h.form);
      if (k === 'serials') return Array.isArray(h.serials) ? h.serials.slice(0, 50).join('|') : '';
      if (k === 'images') return Array.isArray(h.images) ? h.images.slice(0, 20).join('|') : '';
      if (k === 'sep') return h.sep ? '是' : '';
      if (k === 'rolls') return Number(h.rolls) || 0;
      if (k === 'cost' || k === 'market') return cat.round2(Number(h[k]) || 0);
      return h[k] == null ? '' : String(h[k]);
    }).map(csvCell));
  });
  return lines.map((r) => r.join(',')).join('\r\n') + '\r\n';
}

/** 导出成表格：{ count, csv } */
function exportCsv() {
  return { count: (state.holdings || []).length, csv: holdingsCsv() };
}

/** 去重键：贵金属按编号（同名不同年份很常见），普通币/钞按名称 */
function holdingKey(h) {
  if (h.category === 'pm' && h.id) return 'pm|' + h.id;
  return (h.category || 'coin') + '|' + h.name;
}

/** CSV 文本 → 二维数组。逗号 / 制表符自适应（Excel 复制粘贴是制表符） */
function parseCsvRows(raw) {
  const src = String(raw == null ? '' : raw).replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  const head = src.split('\n')[0] || '';
  const commas = (head.match(/,/g) || []).length;
  const tabs = (head.match(/\t/g) || []).length;
  const sep = tabs > commas ? '\t' : ',';
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src.charAt(i);
    if (quoted) {
      if (ch === '"') {
        if (src.charAt(i + 1) === '"') { cell += '"'; i++; } else { quoted = false; }
      } else { cell += ch; }
      continue;
    }
    if (ch === '"') { quoted = true; continue; }
    if (ch === sep) { row.push(cell); cell = ''; continue; }
    if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; continue; }
    cell += ch;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((c) => String(c).trim() !== ''));
}

function csvCategory(v) {
  const s = String(v == null ? '' : v).trim();
  if (!s) return '';
  if (/贵金属|^pm$/i.test(s)) return 'pm';
  if (/纪念钞|^note$/i.test(s)) return 'note';
  if (/普通|纪念币|^coin$/i.test(s)) return 'coin';
  return '';
}

function csvUnitOf(v) {
  return /枚|piece/i.test(String(v == null ? '' : v)) ? 'piece' : 'set';
}

function csvFormOf(v) {
  const s = String(v == null ? '' : v).trim();
  if (!s) return '';
  if (/单个|单枚|single/i.test(s)) return 'single';
  if (/整套|set|^套$/i.test(s)) return 'set';
  return '';
}

function csvNumber(v) {
  const s = String(v == null ? '' : v).replace(/[,，\s¥￥元]/g, '');
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : 0;
}

function csvList(v) {
  return String(v == null ? '' : v)
    .split(/[|｜、;；\n]+/)
    .map((x) => x.trim())
    .filter((x) => x !== '');
}

/** 逐条校验并归一化；JSON 与 CSV 共用，非法条目丢弃计数 */
function normalizeItem(it) {
  if (!it || typeof it !== 'object') return null;
  const name = String(it.name || '').trim();
  if (!name || name.length > 60) return null;
  const rollsNum = Math.floor(Number(it.rolls));
  if (!(rollsNum >= 1)) return null;
  const category = it.category === 'pm' ? 'pm' : (it.category === 'note' ? 'note' : (it.category === 'coin' ? 'coin' : ''));
  // 贵金属必须有编号，否则无法定位到全量库里的那一枚
  const id = String(it.id || '').trim().slice(0, 40);
  if (category === 'pm' && !id) return null;
  return {
    id: id || newId(),
    name,
    category,
    unit: it.unit === 'piece' ? 'piece' : 'set',
    rolls: Math.min(9999, rollsNum),
    cost: csvNumber(it.cost),
    market: csvNumber(it.market),
    group: String(it.group || '').slice(0, 30),
    thumb: String(it.thumb || '').slice(0, 200),
    serials: Array.isArray(it.serials) ? it.serials.slice(0, 50).map(String) : [],
    form: it.form === 'single' || it.form === 'set' ? it.form : '',
    images: Array.isArray(it.images) ? it.images.slice(0, 20).map(String) : [],
  };
}

function collectItems(list) {
  const items = [];
  let dropped = 0;
  (list || []).forEach((it) => {
    const ok = normalizeItem(it);
    if (ok) items.push(ok); else dropped += 1;
  });
  if (!items.length) {
    return { ok: false, items: [], error: dropped ? '没有一条能识别的收藏' : '收藏是空的', dropped };
  }
  return { ok: true, items, error: '', dropped };
}

/** CSV → 收藏条目 */
function csvToItems(raw) {
  const rows = parseCsvRows(raw);
  if (rows.length < 2) return { ok: false, items: [], error: '表格里没有数据行', dropped: 0 };
  const head = rows[0].map((h) => CSV_HEAD_ALIAS[String(h).trim()] || '');
  if (head.indexOf('name') < 0) {
    return { ok: false, items: [], error: '表格缺少「名称」列，第一行要是表头', dropped: 0 };
  }
  const list = [];
  for (let r = 1; r < rows.length; r++) {
    const item = {};
    const row = rows[r];
    for (let i = 0; i < row.length; i++) {
      const k = head[i];
      if (!k) continue;
      const v = String(row[i] == null ? '' : row[i]).trim();
      if (k === 'category') item.category = csvCategory(v);
      else if (k === 'unit') item.unit = csvUnitOf(v);
      else if (k === 'form') item.form = csvFormOf(v);
      else if (k === 'serials') item.serials = csvList(v);
      else if (k === 'images') item.images = csvList(v);
      else if (k === 'sep') item.sep = /^(是|y|yes|true|1)$/i.test(v);
      else if (k === 'rolls' || k === 'cost' || k === 'market') item[k] = csvNumber(v);
      else item[k] = v;
    }
    list.push(item);
  }
  return collectItems(list);
}

/**
 * 解析导入内容。CSV 表格为主；旧版 { holdings: [...] } JSON 备份照样能读。
 * 逐条校验，非法条目丢弃并计数，不让脏数据进账本。
 * @returns {{ok: boolean, items: Array, error: string, dropped: number}}
 */
function parseImport(raw) {
  let text = String(raw == null ? '' : raw).trim();
  if (!text) return { ok: false, items: [], error: '内容是空的', dropped: 0 };
  text = text.replace(/^\uFEFF/, '');
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) text = fence[1].trim();

  if (text.charAt(0) === '{' || text.charAt(0) === '[') {
    let data;
    try {
      data = JSON.parse(text);
    } catch (e) {
      return { ok: false, items: [], error: '不是合法的 JSON', dropped: 0 };
    }
    const arr = Array.isArray(data) ? data : (data && Array.isArray(data.holdings) ? data.holdings : null);
    if (!arr) return { ok: false, items: [], error: '找不到 holdings 列表', dropped: 0 };
    return collectItems(arr);
  }
  return csvToItems(text);
}

function importHoldings(items, mode) {
  // 统一返回 Promise：未登录时不抛同步异常，调用方才能用 .catch 提示
  try {
    requireLogin();
  } catch (e) {
    return Promise.reject(e);
  }
  const list = Array.isArray(items) ? items : [];
  if (mode === 'replace') {
    state.holdings = list.map((h) => Object.assign({}, h));
    return persist().then(() => ({ added: list.length, skipped: 0, total: state.holdings.length }));
  }
  const seen = {};
  (state.holdings || []).forEach((h) => { seen[holdingKey(h)] = true; });
  let added = 0;
  let skipped = 0;
  list.forEach((h) => {
    const k = holdingKey(h);
    if (seen[k]) { skipped += 1; return; }
    seen[k] = true;
    state.holdings.push(Object.assign({}, h));
    added += 1;
  });
  if (!added) return Promise.resolve({ added: 0, skipped, total: state.holdings.length });
  return persist().then(() => ({ added, skipped, total: state.holdings.length }));
}

function persist() {
  const payload = state.holdings.map((h) => ({
    id: h.id,
    name: h.name,
    rolls: h.rolls,
    cost: cat.round2(h.cost),
    market: cat.round2(h.market),
    group: h.group,
    // 这三个字段必须一起回传，否则贵金属收藏服务端刷新后会退化成普通币：
    // category 决定「我的收藏-贵金属」页签与 isOwned 去重，thumb 是缩略图，
    // unit='piece' 决定按单枚而非按套记。服务端 migration 007 已存这三列。
    category: h.category,
    thumb: h.thumb,
    unit: h.unit,
    // 收藏增强（migration 008）：号码 / 整套单个 / 图片，必须一起回传否则保存后丢失
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

/** 加入我的收藏（1 套） */
/**
 * 加入收藏。
 * unit='set' 按整套/整卷记；unit='piece' 按单枚（单张）记。
 * 单枚的成本与市价按「一套 ÷ 件数」折算，账本里仍然是纯数量。
 */
function addCoin(coin, unit, qty) {
  requireLogin();
  if (findHolding(coin.name)) {
    const err = new Error('这一枚已经在你的收藏里了');
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
  if (hit) { const err = new Error('这枚已经在你的收藏里了'); err.duplicate = true; throw err; }
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
  // 按单枚记时数量可能过百（一套 20 枚），上限不能卡在 99
  const next = Math.max(1, Math.min(999, Number(rolls) || 1));
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

/**
 * 切换记账口径：整套 ↔ 单个。
 *
 * 为什么不能复用 setRolls —— 它按「新旧 rolls 之比」缩放市值，
 * 1 套改成 20 枚时会把市值放大 20 倍。这里按「件数」换算：
 * 同一批货件数没变，市值就该一分不动。
 *
 * @param {string} id
 * @param {'piece'|'set'} unit 目标口径
 * @param {number} rolls 目标口径下的数量（枚 / 套）
 * @param {number} totalCost 这一批货的总成本
 */
function setUnitForm(id, unit, rolls, totalCost) {
  requireLogin();
  const target = state.holdings.filter((h) => h.id === id)[0];
  if (!target) return Promise.resolve(null);

  const coin = cat.byName[target.name];
  const size = Math.max(1, Number(coin ? (coin.setSizeBase || coin.setSize) : 1) || 1);
  const oldRolls = Math.max(1, Number(target.rolls) || 1);
  const oldQty = target.unit === 'piece' ? oldRolls : oldRolls * size;

  const nextUnit = unit === 'piece' ? 'piece' : 'set';
  const nextRolls = Math.max(1, Math.min(999, Math.floor(Number(rolls) || 1)));
  const nextQty = nextUnit === 'piece' ? nextRolls : nextRolls * size;
  const oldMarket = Number(target.market) || 0;

  target.unit = nextUnit;
  target.rolls = nextRolls;
  target.cost = cat.round2(Math.max(0, Number(totalCost) || 0));
  target.market = oldQty > 0 ? cat.round2((oldMarket / oldQty) * nextQty) : oldMarket;
  return persist();
}

/** 局部更新收藏的可选字段（号码/形态/图片），白名单收敛后落库 */
function patchHolding(id, patch) {
  requireLogin();
  const target = state.holdings.filter((h) => h.id === id)[0];
  if (!target) return Promise.resolve(null);
  const p = patch || {};
  if (Array.isArray(p.serials)) target.serials = p.serials.slice(0, 200).map((s) => String(s || '').trim()).filter(Boolean);
  if (p.form === 'single' || p.form === 'set' || p.form === '') target.form = p.form;
  // 整套 / 单个的记账口径：单位是数据本身，不能只存展示标记
  if (p.unit === 'piece' || p.unit === 'set') target.unit = p.unit;
  if (Array.isArray(p.images)) target.images = p.images.slice(0, 3);
  return persist();
}

/** 上传收藏图片（base64），返回 /collection/xxx 路径 */
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
  setUnitForm,
  patchHolding,
  uploadImage,
  clearUser,
  onSessionExpired,
  persist,
  exportHoldings,
  exportCsv,
  holdingsCsv,
  parseCsvRows,
  parseImport,
  importHoldings,
};
