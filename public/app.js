/* =========================================================
   1. 数据层 —— 由后端 /api/bootstrap 下发
   拿不到后端时退化为同源 data/coins.json，再退化为本地缓存，
   所以前端单独放到静态站也能跑（只是没有账号与多端同步）。
   ========================================================= */
var DB = [];              // 发行清单（est 已含行情覆盖）
var PM_DB = [];           // 已上架贵金属套（3 套央行公告种子，独立从 /api/catalog?category=pm 拉取）
var PM_FULL = {           // 贵金属全量库（金币云集 2823 条，分页加载，来自 /api/catalog/pm）
  items: [], page: 0, pages: 0, total: 0, loading: false, loaded: false, q: '', project: ''
};
var VIEW_CATEGORY = 'coin'; // /all 分段：默认普通纪念币，贵金属首屏 0 条
var DEFAULTS = [];        // 服务端初始藏品种子
var SERIES = {};          // 系列代码 -> 中文名
var SET_META = {};        // 套系定义：setId -> {name,total,unit,members}
var IMG_SET = {};         // 有图的品种编号（由 /api/bootstrap 下发）
var REAL_SET = {};        // 其中属于官方实拍的编号
var GALLERY = {};         // 多图：品种编号（1 基） -> [{f,k}]  f=文件名 k=main|reverse|set
var IMG_VER = '';         // 图片版本号（gallery 的 mtime）：/img/ 缓存 7 天，换图后靠它失效
var PLAN = { years: [] }; // 普通纪念币（钞）年度发行计划
var PLAN_PM = { years: [] }; // 贵金属年度发行计划（独立数据源）
var PLAN_TAB = 'coin';       // 发行计划当前 tab：coin | pm
var CATEGORIES = { categories: [] };  // 顶层品类注册表（统一 API 下发）
var PM_SERIES = [];                   // 贵金属独立系列（= 发行项目，与普通币系列隔离）
var DESC = {};            // 官方介绍：编号 -> {title,url,text,date}
var GROUP_ORDER = ['国家公园系列','世界文化和自然遗产','赛事与贺岁','独立藏品'];
var STORE_KEY = 'coin-ledger-v3';
var coll = [];            // 当前登录用户的持仓

var APP = {
  version: '1.2.0',
  online: false,          // 是否连上后端
  user: null,             // { id, name, role, createdAt, lastLogin }
  isAdmin: false,
  rev: 0,
  source: '-',            // api | static | cache
  userCount: 0,
  saving: false,
  pending: false
};

function isLoggedIn(){ return !!(APP.user && APP.user.name); }

/* 访客在公开清单点「+ 加入」想记的那一枚：记下来，注册后落到账本时置顶，
   避免「点了加入却看不到、注册后又被清掉」的断头路。 */
var pendingGuestAdd = null;

/* ---------- 数据装配 ---------- */
function applyPayload(p){
  if (p.series && Object.keys(p.series).length) SERIES = p.series;
  // 系列主数据（series.json）是权威来源：名称以它为准，且可能包含 coins.json 里没有的新系列
  if (Array.isArray(p.seriesMeta) && p.seriesMeta.length) {
    var merged = {};
    Object.keys(SERIES).forEach(function (k) { merged[k] = SERIES[k]; });
    p.seriesMeta.forEach(function (m) { if (m && m.key) merged[m.key] = m.name; });
    SERIES = merged;
  }
  if (p.sets && Object.keys(p.sets).length) SET_META = p.sets;
  if (Array.isArray(p.coins) && p.coins.length) { DB = p.coins; SET_STATS = null; }
  if (Array.isArray(p.defaults)) DEFAULTS = p.defaults;
  if (Array.isArray(p.imgSet)) {
    var m = {};
    p.imgSet.forEach(function(n){ m[n] = 1; });
    IMG_SET = m;
  }
  if (p.desc && typeof p.desc === 'object') DESC = p.desc;
  if (p.gallery && typeof p.gallery === 'object') GALLERY = p.gallery;
  if (p.galleryVer) IMG_VER = String(p.galleryVer);
  if (p.plan && Array.isArray(p.plan.years)) PLAN = p.plan;
  // 发行计划与品类注册表走按需接口 /api/plans，不塞进 bootstrap（首屏不需要）
  if (Array.isArray(p.imgReal)) {
    var mr = {};
    p.imgReal.forEach(function(n){ mr[n] = 1; });
    REAL_SET = mr;
  }
  if ('user' in p) APP.user = p.user || null;
  if ('isAdmin' in p) APP.isAdmin = !!p.isAdmin;
  if (typeof p.rev === 'number') APP.rev = p.rev;
  if (typeof p.userCount === 'number') APP.userCount = p.userCount;
  if (p.version) APP.version = p.version;

  if (isLoggedIn()) {
    if (Array.isArray(p.holdings)) coll = p.holdings;
    else if (!coll.length) coll = [];
  } else {
    coll = [];                 // 没登录就没有账本
    APP.isAdmin = false;
  }
  APP.online = true;
  rebuildGroupOrder();
  if (normalizeGroups() && isLoggedIn()) {
    // 历史分组已按套系规则校正，顺手同步到服务器（只在这一刻触发一次）
    APP.pending = true;
    setTimeout(function(){ if (APP.pending) saveState(); }, 200);
  }
  document.body.classList.toggle('anon', !isLoggedIn());
}

function cloneDefaults(){
  return (DEFAULTS || []).map(function(d){
    var o = {};
    for (var k in d) o[k] = d[k];
    return o;
  });
}

/* ---------- 本地缓存（断网兜底，只对已登录用户） ---------- */
function loadCache(){
  try{
    var raw = localStorage.getItem(STORE_KEY);
    if (!raw) return null;
    var o = JSON.parse(raw);
    if (o && Array.isArray(o.holdings) && o.holdings.length && o.user) return o;
  }catch(e){}
  return null;
}
function saveCache(){
  if (!isLoggedIn()) return;
  try{
    localStorage.setItem(STORE_KEY, JSON.stringify({ user: APP.user, holdings: coll, ts: Date.now() }));
  }catch(e){}
}
function clearCache(){
  try{ localStorage.removeItem(STORE_KEY); }catch(e){}
}

/* ---------- HTTP ---------- */
function api(path, opts){
  opts = opts || {};
  opts.credentials = 'same-origin';
  opts.headers = Object.assign({ 'Content-Type': 'application/json' }, opts.headers || {});
  return fetch(path, opts).then(function(r){
    return r.text().then(function(t){
      var j = {};
      try{ j = t ? JSON.parse(t) : {}; }catch(e){ j = { error: t.slice(0,200) }; }
      if (!r.ok) {
        var err = new Error(j.error || ('HTTP ' + r.status));
        err.status = r.status;
        err.body = j;
        throw err;
      }
      return j;
    });
  });
}

/* ---------- 启动：三级回退 ---------- */
function boot(){
  return api('/api/bootstrap')
    .then(function(p){ APP.source = 'api'; applyPayload(p); saveCache(); })
    .catch(function(e){
      console.warn('[boot] 后端不可用，改用静态数据：', e.message);
      return fetch('data/coins.json', { cache: 'no-store' })
        .then(function(r){ if (!r.ok) throw new Error('静态数据 404'); return r.json(); })
        .then(function(p){
          APP.source = 'static';
          applyPayload(p);
          var cached = loadCache();
          if (cached) { APP.user = cached.user; coll = cached.holdings; }
          document.body.classList.toggle('anon', !isLoggedIn());
        })
        .catch(function(e2){
          console.warn('[boot] 静态数据也不可用：', e2.message);
          APP.source = 'cache';
          var cached = loadCache();
          if (cached) { APP.user = cached.user; coll = cached.holdings; }
          document.body.classList.toggle('anon', !isLoggedIn());
          if (!DB.length) throw new Error('没有可用的数据源');
        });
    });
}

/* ---------- 持久化（只有登录后才会真正写服务器） ---------- */
var saveTimer = null;
function saveState(){
  saveCache();
  if (!APP.online || !isLoggedIn()) {
    setSync(APP.online ? 'local' : 'offline');
    return;
  }
  APP.pending = true;
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(flushSave, 450);
}

function flushSave(){
  saveTimer = null;
  if (APP.saving || !APP.pending) return;
  APP.pending = false;
  APP.saving = true;
  setSync('saving');
  api('/api/holdings', { method: 'PUT', body: JSON.stringify({ holdings: coll }) })
    .then(function(j){ APP.rev = j.rev; setSync('synced'); })
    .catch(function(e){
      APP.pending = true;
      setSync('error', e.message);
      if (e.status === 401) {
        APP.user = null;
        APP.isAdmin = false;
        document.body.classList.add('anon');
        updateChrome();
      }
    })
    .then(function(){
      APP.saving = false;
      if (APP.pending) saveTimer = setTimeout(flushSave, 1500);
    });
}

function findDB(name){
  for(var i=0;i<DB.length;i++){ if(DB[i].name===name) return DB[i]; }
  return null;
}
/* 纪念钞没有直径，只有票幅（145×70mm）；以前一律显示「直径 —」，属于参数缺失。
 * 这里统一派生：币看直径，钞看票幅。 */
function sizeLabel(d){ return d && d.kind === 'note' ? '票幅' : '直径'; }
function sizeText(d){
  if (!d) return '—';
  if (d.kind === 'note') return d.size ? String(d.size).replace('×', ' × ') + ' mm' : '—';
  return d.dia === '—' || !d.dia ? '—' : d.dia + ' mm';
}

/** 单件（枚/张）的面额与估值。face 统一按单件存，不再有「对钞折半」的特例 */
function unitPrice(d){
  return { face: Number(d.face) || 0, est: Number(d.est) || 0 };
}
/** 一「套」包含几件：整卷类 20 枚/20 张；多枚套币按套系声明的件数（建国 35 周年 3 枚、冬奥对钞 2 张…） */
/** 一「套」包含几件（清单展示口径）。
 *  优先级：央行公告的「每人预约、兑换限额」> 套系声明的件数 > 20。
 *  用户口径：「一套」= 一次预约能约到的最大数量，所以 limit 放在最前面。
 */
/**
 * 藏品卡片里的 推理价：单枚理论价 × 这件持仓的件数。
 * 件数口径跟随持仓单位（按套记就乘每套件数，按枚记本身就是件数）。
 */
function aiLine(d, c){
  if (!d) return '';
  var perSet = c.unit === 'piece' ? 1 : holdingUnitSize(d);
  var qty = (Number(c.rolls) || 0) * perSet;
  var aiUnit = aiPrice(d);
  var aiTotal = aiUnit * qty;
  if (!aiTotal) return '';
  return '<div class="ai-line"><i>推理价</i><b>' + money(aiTotal) + '</b></div>';
}

// 推理价（与小程序 catalog.aiPriceOf 同一套系数）
var AI_MAT = {
  '双色铜合金': 0.8456, '钢芯镀镍': 0.0384, '紫铜合金': 0.8331, '铜镍合金': 1.4898,
  '纸质': 1.1127, '塑料': 0.7390, '铜锌合金': 1.7983, '镍包钢': -1.3443
};
function aiPrice(d){
  if (!d) return 0;
  var thisYear = new Date().getFullYear();
  var M = Math.max(1, Number(d.mintage) || 1000);
  var age = Math.max(0, thisYear - (Number(d.year) || thisYear));
  var lm = Math.log(M);
  var ln = 12.605 - 2.2721 * lm + 0.1102 * lm * lm + 0.3325 * Math.log(1 + age);
  ln += AI_MAT[d.material] || 0;
  if (d.kind === 'note') ln += 1.8516;
  var p = Math.exp(ln);
  // 下限：面值 × 1.2 与「面值按 2.5%/年折到今天」取大者
  var face = Number(d.face) || 1;
  var floor = Math.max(face * 1.2, face * Math.pow(1.025, age));
  if (!isFinite(p) || p < floor) p = floor;
  return Math.round(p * 10) / 10;
}
/** 推理价计算方式，公开给用户在详情页查看（口径与 aiPrice 一致） */
var AI_FORMULA_TEXT = '计算方式：用发行量、材质、发行年份三项公开参数，按对数回归模型推算 ln(价) = 12.605 − 2.2721·ln(量) + 0.1102·ln(量)² + 0.3325·ln(1+年数) + 材质系数 + 钞券系数；量按万枚/万张计，年数=今年−发行年，材质与钞券系数取固定值。结果不低于面值按年化 2.5% 折算至今的购买力。模型由在册品种拟合而成（R²≈0.83），不含题材溢价，仅供参考。';

function setSizeOf(d){
  if (!d) return 20;
  if (Number(d.setSize) > 0) return Number(d.setSize);   // 管理端显式设置优先
  // 展示口径：央行预约限额优先（二轮羊/猴/鸡是 40 枚一卷，2018 起 20 枚）
  var n = Number(d.limit);
  if (n > 0) return n;
  return setSizeBase(d);
}
/** 物理成套件数：整卷 20 枚 / 多枚套币按套系声明（建国 35 周年 3 枚、冬奥对钞 2 张…）。
 *  只给账本用——账本记的是手里实际几卷几套，不跟预约限额走。 */
function setSizeBase(d){
  if (!d) return 20;
  if (Number(d.setSize) > 0) return Number(d.setSize);
  var meta = SET_META[d.set];
  return (meta && meta.size) ? meta.size : 20;
}
/** 一套的面额与估值（清单展示口径） */
function setPriceOf(d){
  var up = unitPrice(d), n = setSizeOf(d);
  return { size: n, face: up.face * n, est: up.est * n };
}

/* ---------- 多图：正面 / 背面 / 整卷 ----------
 * 后端把 public/data/gallery.json 的 coins 字段原样下发：
 *   { "135": [{ "f": "135.jpg", "k": "main" }, ...] }
 * 键是 1 基编号（与 img/001.jpg 对齐），f 是 img/ 下的文件名。
 * 数据里可能混进形状不对的条目，这里一律跳过而不是让整页崩掉。
 */
/** 列表行用 160px 小图，详情主图用 480px，点击看大图才用原图 */
function imgVer(u){ return IMG_VER ? u + '?v=' + IMG_VER : u; }
function imgSmall(no){ return imgVer('img/th/s/' + pad3(no) + '.jpg'); }
function imgMid(no){ return imgVer('img/th/' + pad3(no) + '.jpg'); }
function imgFull(no){ return imgVer('img/' + pad3(no) + '.jpg'); }

var GAL_ORDER = ['main', 'reverse', 'set'];
var GAL_LABEL = { main: '主图', obverse: '正面', reverse: '背面', set: '整卷 / 套装' };

function coinKey(d){
  var i = (typeof d.i === 'number') ? d.i : DB.indexOf(d);
  return i >= 0 ? String(i + 1) : '';
}
function galSrc(f){
  return /^(https?:|\/|img\/)/.test(f) ? f : 'img/' + f;
}
function galleryOf(d){
  if (!d) return [];
  var list = GALLERY[coinKey(d)];
  if (!Array.isArray(list) || !list.length) return [];
  var out = [], seen = {};
  function push(f, kind){
    if (typeof f !== 'string' || !f) return;      // 脏条目：跳过
    var src = galSrc(f);
    if (seen[src]) return;
    seen[src] = 1;
    // 主图有 480/160 两档缩略图；其它图（背面、整卷）只有原图
    var isMain = /^\d{3}\.jpg$/.test(f);
    var no = isMain ? parseInt(f.slice(0, 3), 10) : 0;
    // 纪念钞是宽扁的，480 方形缩略图会把票面压成中间一条；详情主图直接用原图
    var wideNote = d.kind === 'note';
    out.push({
      src: isMain ? (wideNote ? imgFull(no) : imgMid(no)) : src,
      small: isMain ? imgSmall(no) : src,
      full: src,
      label: GAL_LABEL[kind] || '图案',
      kind: kind
    });
  }
  // 先按 主图 → 背面 → 整卷 排，保证打开详情页时第一张是主图
  for (var k = 0; k < GAL_ORDER.length; k++) {
    for (var j = 0; j < list.length; j++) {
      var it = list[j];
      if (it && (it.k || 'main') === GAL_ORDER[k]) push(it.f, GAL_ORDER[k]);
    }
  }
  // 认不出的 k 也照收，排在最后，不丢图
  for (var j2 = 0; j2 < list.length; j2++) {
    var it2 = list[j2];
    if (it2 && GAL_ORDER.indexOf(it2.k || 'main') < 0) push(it2.f, 'other');
  }
  return out;
}

/** 账本口径：一条持仓记录里的「1 份」是几件。
 *  - 整卷纪念币 / 套系藏品：1 份 = setSizeOf(d) 件（通常 20 枚，冬奥对钞 2 张）
 *  - 独立发行的纪念钞（set=single，无套系声明）：账本按「张」记，1 份 = 1 张
 *    这类钞在清单里仍按 20 张一套展示，但账本不能跟着乘 20，
 *    否则「20 张 × 20 元」会被算成 8000 元（多乘一次 20）。
 */
function holdingUnitSize(d){
  if (!d) return 20;
  if (d.kind === 'note' && (!d.set || d.set === 'single' || !SET_META[d.set])) return 1;
  return setSizeBase(d);
}
/** 账本里「1 份」的量词：卷 / 套 / 张 / 枚，说不清时用「份」 */
function holdingUnitName(d){
  if (!d) return '份';
  var n = holdingUnitSize(d);
  if (d.kind === 'note') return n > 1 ? '套' : '张';   // 对钞 2 张=1 套；独立钞按张
  if (n === 20) return '卷';                           // 整卷 20 枚
  return n > 1 ? '套' : '枚';
}
/** 持仓的总面值：单件面额 × 每份件数 × 份数 */
function itemFace(d, rolls){
  if(!d) return 0;
  return unitPrice(d).face * holdingUnitSize(d) * rolls;
}

/* 币面图灯箱：点图片看大图，Esc / 点遮罩关闭 */
(function bindLightbox(){
  var box = null;
  function ensure(){
    if (box) return box;
    box = document.createElement('div');
    box.className = 'lightbox';
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-label', '币面大图');
    box.innerHTML = '<img alt=""><span class="lb-close" role="button" tabindex="0" aria-label="关闭">×</span>' +
                    '<span class="lb-cap"></span>';
    box.addEventListener('click', close);
    document.body.appendChild(box);
    return box;
  }
  function open(src, name){
    var b = ensure();
    b.querySelector('img').src = src;
    b.querySelector('img').alt = name || '币面图';
    b.querySelector('.lb-cap').textContent = name || '';
    b.classList.add('on');
    document.body.classList.add('lb-open');
  }
  function close(){
    if (!box) return;
    box.classList.remove('on');
    document.body.classList.remove('lb-open');
  }
  document.addEventListener('click', function(e){
    var th = e.target.closest && e.target.closest('.fig-th');
    if (th) {
      var fig = document.querySelector('.coin-fig');
      var main = fig && fig.querySelector('img.fig-main');
      if (main) {
        main.src = th.getAttribute('data-src');
        var fullSrc = th.getAttribute('data-full');
        if (fullSrc) main.setAttribute('data-full', fullSrc);
      }
      var all = document.querySelectorAll('.fig-th');
      for (var i = 0; i < all.length; i++) all[i].classList.toggle('on', all[i] === th);
      return;
    }
    var img = e.target.closest && e.target.closest('.coin-fig img.fig-main');
    if (img) { e.preventDefault(); open(img.getAttribute('data-full') || img.getAttribute('src'), img.getAttribute('alt')); }
  });
  document.addEventListener('keydown', function(e){ if (e.key === 'Escape') close(); });
})();

/* 「为什么从 1984 年起算」角标：桌面靠 hover，手机没有 hover，点一下切换 */
(function bindWhy(){
  document.addEventListener('click', function(e){
    var btn = e.target.closest && e.target.closest('.why');
    var openOnes = document.querySelectorAll('.why.on');
    for (var i = 0; i < openOnes.length; i++) if (openOnes[i] !== btn) openOnes[i].classList.remove('on');
    if (!btn) return;
    btn.classList.toggle('on');
    e.preventDefault();      // 别让外层文本被选中/触发别的点击逻辑
  });
  document.addEventListener('keydown', function(e){
    if (e.key !== 'Escape') return;
    var openOnes = document.querySelectorAll('.why.on');
    for (var i = 0; i < openOnes.length; i++) openOnes[i].classList.remove('on');
  });
})();

/* 推理价计算方式：问号点一下弹层显示（长文案不适合 tooltip，且用户要求默认收起） */
(function bindAiFormula(){
  document.addEventListener('click', function(e){
    var btn = e.target.closest && e.target.closest('[data-ai-formula]');
    if (!btn) return;
    e.preventDefault();
    var mask = document.createElement('div');
    mask.className = 'pz-modal-mask';
    mask.innerHTML = '<div class="pz-modal ai-formula-modal" role="dialog" aria-modal="true" aria-label="推理价计算方式">' +
      '<div class="pz-modal-h"><b>推理价怎么算的</b><button type="button" class="pz-modal-x" aria-label="关闭">×</button></div>' +
      '<div class="ai-fm-body">' + esc(AI_FORMULA_TEXT) + '</div>' +
      '</div>';
    document.body.appendChild(mask);
    function close(){ if (mask.parentNode) mask.parentNode.removeChild(mask); }
    mask.addEventListener('click', function(ev){
      if (ev.target === mask || (ev.target.closest && ev.target.closest('.pz-modal-x'))) close();
    });
    document.addEventListener('keydown', function onKey(ev){
      if (ev.key !== 'Escape') return;
      close();
      document.removeEventListener('keydown', onKey);
    });
  });
})();

/* 顶部用户名胶囊：点一下进账户页（手机端顶栏空间不够，账户按钮会被隐藏） */
(function bindUserChip(){
  var chip = document.getElementById('userChip');
  if (!chip) return;
  chip.setAttribute('role', 'button');
  chip.setAttribute('tabindex', '0');
  chip.addEventListener('click', function(){ if (isLoggedIn()) goTab('account'); });
  chip.addEventListener('keydown', function(e){
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (isLoggedIn()) goTab('account'); }
  });
})();

/* 回到顶部：清单 136 条滚到底后没有回顶入口，手机上尤其难返 */
(function initToTop(){
  var btn = document.getElementById('toTop');
  if (!btn) return;
  var ticking = false;
  function sync(){
    var y = window.pageYOffset || document.documentElement.scrollTop || 0;
    btn.classList.toggle('on', y > 1200);
    ticking = false;
  }
  window.addEventListener('scroll', function(){
    if (!ticking) { ticking = true; requestAnimationFrame(sync); }
  }, { passive: true });
  btn.addEventListener('click', function(){
    var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    window.scrollTo({ top: 0, behavior: reduce ? 'auto' : 'smooth' });
  });
  sync();
})();

/* 清单整行可点：手机上手指点在名称以外的空白处（面额、估值那一行）没反应，
   体验很别扭。这里让整行除了按钮/链接都能进详情。 */
(function(){
  var tb = document.getElementById('tbody');
  if (!tb) return;
  tb.addEventListener('click', function(e){
    if (e.target.closest('button, a, input, select, label')) return;   // 看图/加入按钮自己处理
    var tr = e.target.closest('tr[data-i]');
    if (tr) goCoin(parseInt(tr.getAttribute('data-i'), 10));
  });
})();

/* 小屏下搜索框只有 ~200px，长 placeholder 会被截成半句，换短的 */
(function(){
  var q = document.getElementById('q');
  if (!q) return;
  var full = q.getAttribute('placeholder') || '';
  function syncPh(){
    q.setAttribute('placeholder', window.innerWidth <= 640 ? '搜索名称或年份' : full);
  }
  syncPh();
  window.addEventListener('resize', syncPh, { passive: true });
})();

initAdvFilters();

/* 手机端筛选面板折叠：桌面端 .fpanel 用 display:contents，不受影响 */
(function bindFilterToggle(){
  var btn = document.getElementById('filterToggle');
  var bar = document.querySelector('.toolbar');
  if (!btn || !bar) return;
  btn.addEventListener('click', function(){
    var open = bar.classList.toggle('open');
    btn.setAttribute('aria-expanded', open ? 'true' : 'false');
    btn.textContent = open ? '收起筛选' : '筛选';
  });
})();

/* 页脚微信号：点一下复制 */
(function bindWxCopy(){
  var el = document.getElementById('wxId');
  if (!el) return;
  function copy(){
    var id = 'virtualman2001';
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(id).then(function(){ tip('微信号已复制：' + id); }, fallback);
    } else { fallback(); }
    function fallback(){
      var ta = document.createElement('textarea');
      ta.value = id; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); tip('微信号已复制：' + id); } catch (e) { tip('请手动复制：' + id); }
      document.body.removeChild(ta);
    }
  }
  el.addEventListener('click', copy);
  el.addEventListener('keydown', function(e){ if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); copy(); } });
})();

/* =========================================================
   4. 格式化
   ========================================================= */
function money(n){
  return '¥' + Math.round(n).toLocaleString('zh-CN');
}
function signed(n){
  var s = n > 0 ? '+' : (n < 0 ? '-' : '');
  return s + money(Math.abs(n)).replace('¥','¥');
}
function fmMint(w){
  // 一万万 = 一亿：超过 1 亿改用「亿」，否则保留「万」
  if(w >= 10000){
    var y = Math.round((w/10000)*10)/10;
    return y + ' 亿';
  }
  return w + ' 万';
}
function pct(n){ return (Math.round(n*10)/10) + '%'; }

/* =========================================================
   5. 计算
   ========================================================= */
function calc(){
  var main = {face:0, cost:0, market:0, rolls:0, kinds:0, coins:0};
  var sep  = {face:0, cost:0, market:0, rolls:0, kinds:0};
  coll.forEach(function(c){
    var d = findDB(c.name);
    var f = itemFace(d, c.rolls);
    var target = c.sep ? sep : main;
    target.face += f;
    target.cost += Number(c.cost) || 0;
    target.market += Number(c.market) || 0;
    target.rolls += Number(c.rolls) || 0;
    target.kinds += 1;
    if(d && d.kind !== 'note') main.coins += setSizeBase(d) * c.rolls;
  });
  main.pnl = main.market - main.cost;
  main.rate = main.cost ? (main.pnl / main.cost * 100) : 0;
  sep.pnl = sep.market - sep.cost;
  return {main:main, sep:sep};
}

/* =========================================================
   6. 渲染：KPI
   ========================================================= */
function renderKPI(){
  var r = calc(), m = r.main, s = r.sep;

  document.getElementById('kFace').textContent = money(m.face);
  document.getElementById('kFaceNote').textContent = m.rolls + ' 份藏品 · 其中纪念币 ' + m.coins + ' 枚';

  document.getElementById('kCost').textContent = money(m.cost);
  document.getElementById('kMarket').textContent = money(m.market);

  var pnlEl = document.getElementById('kPnl');
  pnlEl.textContent = (m.pnl >= 0 ? '+' : '-') + money(Math.abs(m.pnl));
  pnlEl.style.color = m.pnl >= 0 ? 'var(--up)' : 'var(--down)';
  document.getElementById('kPnlNote').textContent =
    (m.pnl >= 0 ? '+' : '') + pct(m.rate) + ' · 相对投入';

  var cNote = document.getElementById('cashNote');
  if(cNote && s.kinds > 0){
    var sepItems = coll.filter(function(x){ return x.sep; });
    var sepItem = sepItems[0];
    // 只有一项时用它的真实量词（张/卷），多项混在一起才退回中性「份」
    var sepUnit = sepItems.length === 1 ? holdingUnitName(findDB(sepItem.name)) : '份';
    cNote.textContent = (sepItem ? sepItem.name : '独立藏品') + ' · ' + s.rolls + ' ' + sepUnit +
      ' · 面值 ' + money(s.face) + ' · 推理价 ' + money(s.market) +
      '，未计入上方 ' + m.rolls + ' 份合计';
  }
}

/* =========================================================
   7. 渲染：藏品卡片
   ========================================================= */
var HOLD_CAT = 'all';
function setHoldCat(cat){
  HOLD_CAT = cat;
  var bar = document.getElementById('holdCats');
  if (bar) Array.prototype.forEach.call(bar.querySelectorAll('button'), function(b){
    b.className = b.getAttribute('data-hcat') === cat ? 'on' : '';
  });
  renderHoldings();
}

/** 藏品增强区：纪念钞号码+花样、整套/单个标记、自有图片、分享到广场 */
function luckyTagsHtml(serials){
  if (!window.SerialAnalyze || !serials || !serials.length) return '';
  var tagMap = {};
  serials.forEach(function(no){
    var r = window.SerialAnalyze.analyze(no);
    r.tags.forEach(function(t){ tagMap[t.name] = Math.max(tagMap[t.name] || 0, t.rarity); });
  });
  var names = Object.keys(tagMap).sort(function(a, b){ return tagMap[b] - tagMap[a]; });
  if (!names.length) return '';
  return '<div class="hx-tags">' + names.map(function(n){
    return '<span class="hx-tag rar' + Math.min(5, tagMap[n]) + '">' + esc(n) + '</span>';
  }).join('') + '</div>';
}

function holdingExtraHtml(c, d){
  var isNote = d && d.kind === 'note' || c.category === 'note';
  var serials = Array.isArray(c.serials) ? c.serials : [];
  var images = Array.isArray(c.images) ? c.images : [];
  var form = c.form === 'set' || c.form === 'single' ? c.form : '';
  var html = '<div class="hx">';

  // 号码：纪念钞主打，其它藏品也可录（贵金属按编号意义不大，隐藏号码输入）
  if (isNote) {
    html += '<div class="hx-row hx-serial">' +
      '<span class="hx-label">号码</span>' +
      '<textarea class="hx-serial-input" rows="1" placeholder="输入冠字号码，多个换行，如 J12345678" ' +
        'data-field-ex="serials" data-name="' + esc(c.name) + '">' + esc(serials.join('\n')) + '</textarea>' +
      '</div>';
    html += '<div class="hx-row hx-lucky" data-lucky="' + esc(c.name) + '">' +
      '<span class="hx-label">花样</span>' + (luckyTagsHtml(serials) || '<span class="hx-muted">普通号</span>') + '</div>';
  }

  // 整套 / 单个标记
  html += '<div class="hx-row hx-form">' +
    '<span class="hx-label">形态</span>' +
    '<button type="button" class="hx-seg' + (form !== 'single' ? ' on' : '') + '" data-ex-act="form-set" data-name="' + esc(c.name) + '">整套</button>' +
    '<button type="button" class="hx-seg' + (form === 'single' ? ' on' : '') + '" data-ex-act="form-single" data-name="' + esc(c.name) + '">单个</button>' +
    '</div>';

  // 自有图片（最多 3 张）
  html += '<div class="hx-row hx-imgs"><span class="hx-label">图片</span><div class="hx-thumbs" data-imgs="' + esc(c.name) + '">';
  images.slice(0, 3).forEach(function(p, i){
    html += '<span class="hx-thumb"><img src="' + esc(p) + '" alt="我的藏品图" loading="lazy">' +
      '<b data-ex-act="img-del" data-name="' + esc(c.name) + '" data-idx="' + i + '" title="删除">×</b></span>';
  });
  if (images.length < 3) {
    html += '<label class="hx-add" title="上传我的图片（≤2MB）">+' +
      '<input type="file" accept="image/jpeg,image/png,image/webp" data-ex-file="' + esc(c.name) + '" hidden></label>';
  }
  html += '</div></div>';

  // 分享到广场
  html += '<button type="button" class="hx-share" data-ex-act="share" data-name="' + esc(c.name) + '">分享到藏品广场 →</button>';
  html += '</div>';
  return html;
}

function renderHoldings(){
  var box = document.getElementById('holdingsBox');
  var html = '';
  /* 这里必须从 coll 取：写成 var visible = visible.filter(...) 会因为 var 提升拿到 undefined，
   * 直接抛 TypeError，导致 start() 中断——首页统计、清单、系列全部渲染不出来。 */
  var visible = coll.filter(function(c){
    if (HOLD_CAT === 'all') return true;
    if (HOLD_CAT === 'pm') return c.category === 'pm';
    if (HOLD_CAT === 'coin') return c.category !== 'pm' && (!findDB(c.name) || findDB(c.name).kind !== 'note');
    if (HOLD_CAT === 'note') { var d = findDB(c.name); return d && d.kind === 'note'; }
    return true;
  });

  // 分组顺序：按各组藏品数量降序，独立藏品垫底
  var counts = {}, firstSeen = {};
  visible.forEach(function(c, idx){
    var d = findDB(c.name);
    var g = (d && SERIES[d.series]) || c.group || '其他收藏';
    counts[g] = (counts[g] || 0) + 1;
    if (firstSeen[g] === undefined) firstSeen[g] = idx;
  });
  var groups = Object.keys(counts).sort(function(a, b){
    var sa = a === '独立藏品' ? 1 : 0, sb = b === '独立藏品' ? 1 : 0;
    if (sa !== sb) return sa - sb;                 // 独立藏品最后
    if (counts[b] !== counts[a]) return counts[b] - counts[a];
    return firstSeen[a] - firstSeen[b];
  });

  groups.forEach(function(g){
    var items = visible.filter(function(c){
      var d = findDB(c.name);
      var grp = (d && SERIES[d.series]) || c.group || '其他';
      return grp === g;
    });
    if(!items.length) return;

    var sumFace = 0, sumRolls = 0, sumCost = 0, sumMarket = 0;
    var unitSet = {};
    items.forEach(function(c){
      var d = findDB(c.name);
      if (c.category !== 'pm') sumFace += itemFace(d, c.rolls);
      sumRolls += Number(c.rolls) || 0;
      sumCost += Number(c.cost) || 0;
      sumMarket += Number(c.market) || 0;
      unitSet[holdingUnitName(d)] = 1;
    });
    // 同一组里既有按卷的币又有按张的钞时，用中性量词，别把张数写成「卷」
    var unitKeys = Object.keys(unitSet);
    var groupUnit = unitKeys.length === 1 ? unitKeys[0] : '份';

    html += '<div class="group">';
    html += '<div class="group-head"><span class="bar"></span>' + g +
            '<span class="tot">' + sumRolls + ' ' + groupUnit + ' · 面值 <b>' + money(sumFace) +
            '</b> · 推理价 <b>' + money(sumMarket) + '</b></span></div>';
    html += '<div class="grid">';

    items.forEach(function(c){
      var d = findDB(c.name);
      var face = c.category === 'pm' ? 0 : itemFace(d, c.rolls);
      // 件数只在「1 份多于 1 件」时才补写：整卷 20 枚要写「共 400 枚」，
      // 按张记的独立钞「20 张」本身已是件数，再写一遍反而糊。
      var perSet = (d && !isPiece) ? holdingUnitSize(d) : 0;
      var qtyUnit = d && d.kind === 'note' ? '张' : '枚';
      var qtyTxt = perSet > 1 ? ('共 ' + (Number(c.rolls) || 0) * perSet + ' ' + qtyUnit + ' · ') : '';
      var pnl = (Number(c.market)||0) - (Number(c.cost)||0);
      var pnlCls = pnl >= 0 ? 'gain' : 'loss';
      var pnlTxt = (pnl >= 0 ? '+' : '-') + money(Math.abs(pnl));
      var meta = d ? (d.year + ' · ' + d.face + '元 · ' + fmMint(d.mintage) + (d.kind==='note'?'张':'枚')) : '';
      var isPiece = c.unit === 'piece';
      var unit = isPiece ? (d && d.kind === 'note' ? '张' : '枚') : holdingUnitName(d);
      var label = d && d.kind === 'note' ? d.face : (d ? d.face : '');

      var thumb = (c.category === 'pm' && c.thumb) ? c.thumb : (d ? imgSmall(d.i + 1) : '');
      if (c.category === 'pm') meta = '贵金属 · ' + String(c.id || '').slice(0, 12);
      html += '<div class="hcard">' +
        '<div class="hcard-top">' +
          (thumb
            ? '<img class="hthumb" src="' + thumb + '" alt="' + esc(c.name) + '" width="46" height="46" loading="lazy">'
            : '<div class="coin">' + label + '</div>') +
          '<div>' +
            '<div class="name"' + (d ? ' data-coin="' + d.i + '" title="查看详情"' : '') + '>' + (d ? d.name : c.name) + '</div>' +
            '<div class="meta">' + meta + '</div>' +
          '</div>' +
        '</div>' +
        '<div class="rolls">' +
          '<button data-act="minus" data-name="' + c.name + '">−</button>' +
          '<span class="num"><b>' + c.rolls + '</b> ' + unit + '</span>' +
          '<button data-act="plus" data-name="' + c.name + '">+</button>' +
          '<span style="margin-left:auto;font-size:11.5px;color:var(--dim)">' +
            qtyTxt + '面值 ' + money(face) + '</span>' +
        '</div>' +
        '<div class="nums">' +
          '<div><span>成本</span><input type="number" min="0" step="1" inputmode="numeric" autocomplete="off" data-form-type="other" data-lpignore="true" data-1p-ignore data-bwignore value="' + c.cost + '" data-field="cost" data-name="' + c.name + '"></div>' +
          '<div><span>单' + unit + '成本</span><b>' + money(c.rolls ? (Number(c.cost)||0)/c.rolls : 0) + '</b></div>' +
        '</div>' +
        '<div class="pnl"><span>浮动</span><b class="' + pnlCls + '" data-pnl="' + c.name + '">' + pnlTxt + '</b></div>' +
        holdingExtraHtml(c, d) +
        aiLine(d, c) +
        '<button class="del" data-act="del" data-name="' + c.name + '">移除</button>' +
      '</div>';
    });

    html += '</div></div>';
  });

  // 「恢复初始数据」按钮已移除（用户 2026-11-09 要求）：账本以服务器为准，不需要一键覆盖
  box.innerHTML = html || emptyLedgerHtml();
}

/** 空账本 = 新用户注册后的第一屏。
 *  原来这里只有一行「还没有藏品，去下面的清单里勾选吧」，可这一页下面
 *  没有任何清单（滚下去直接是数据说明和页脚），照做的用户只会走到死路。
 *  现在给出真正可点的下一步：单价最低的 4 枚一点即入，或者去完整清单。 */
function emptyLedgerHtml(){
  // 访客加过但被引导去登录的那一枚，置顶成一枚「接着记」的卡，别让人注册完重新找。
  var pending = pendingGuestAdd ? findDB(pendingGuestAdd) : null;
  var picks = DB.filter(function(d){
    return REAL_SET[d.i + 1] && aiPrice(d) > 0;
  }).sort(function(a, b){
    return (aiPrice(a) - aiPrice(b)) || (a.i - b.i);
  }).slice(0, 4);
  if (pending && REAL_SET[pending.i + 1] && !isOwned(pending.name)) {
    picks = [pending].concat(picks.filter(function(d){ return d.i !== pending.i; })).slice(0, 4);
  }
  var cards = picks.map(function(d){
    var isPending = pending && d.i === pending.i;
    return '<button class="lt-card' + (isPending ? ' pending' : '') + '" data-empty-add="' + esc(d.name) + '">' +
      (isPending ? '<span class="lt-pending-tag">接着记这枚</span>' : '') +
      '<img src="' + imgSmall(d.i + 1) + '" alt="' + esc(d.name) + '" ' +
        'width="120" height="120" decoding="async">' +
      '<span class="lt-name">' + esc(d.name) + '</span>' +
      '<span class="lt-meta">' + d.year + ' 年 · 面额 ' + d.face + ' 元 · 推理价 ' + money(aiPrice(d)) + '</span>' +
      '<span style="font-size:11px;font-weight:600;color:var(--gold)">＋ 加入我的藏品</span>' +
    '</button>';
  }).join('');
  return '<div style="padding:34px 18px 6px;text-align:center">' +
    '<div class="gate-ico">藏</div>' +
    '<h3 style="font-size:16px;font-weight:600;letter-spacing:.01em">你的账本还是空的</h3>' +
    '<p style="margin:8px auto 0;max-width:520px;font-size:12.5px;line-height:1.8;color:var(--dim)">' +
      '点下面任意一枚就能先记上；也可以去「清单」逐个「＋ 加入」。' +
      '按卷记录数量，成本随时能改，套系进度会自动算好。</p>' +
    (cards
      ? '<div style="margin-top:20px;font-size:11.5px;color:var(--dim);letter-spacing:.02em">' +
          (pending ? '你刚想记的那枚已置顶，点一下就记上' : '先试手：这 4 枚单价最低') +
        '</div>' +
        '<div class="latest-grid" style="margin-top:10px">' + cards + '</div>'
      : '') +
    '<div class="gate-actions" style="margin-top:20px">' +
      '<button class="btn primary" data-goto="all">去完整清单挑（' + DB.length + ' 个品种）</button>' +
    '</div>' +
  '</div>';
}

/* =========================================================
   8. 渲染：套系进度
   ========================================================= */
function ownedIn(pred){
  var n = 0;
  coll.forEach(function(c){
    var d = findDB(c.name);
    if(d && pred(d)) n++;
  });
  return n;
}
/** 藏品分组：有归属套系的用套系名，独立发行的归「独立藏品」 */
function groupOf(coin){
  if (!coin) return '独立藏品';
  var meta = SET_META[coin.set];
  if (coin.set && coin.set !== 'single' && meta && meta.name) return meta.name;
  return '独立藏品';
}

/** 按数据顺序重建分组顺序，保证列表里系列前后稳定 */
function rebuildGroupOrder(){
  var order = [];
  DB.forEach(function(d){
    var g = groupOf(d);
    if (order.indexOf(g) < 0) order.push(g);
  });
  if (order.indexOf('独立藏品') >= 0) {
    order.splice(order.indexOf('独立藏品'), 1);
    order.push('独立藏品');          // 独立藏品永远放最后
  }
  GROUP_ORDER = order;
}

/** 旧数据校正：把历史记录的分组对齐到当前套系规则 */
function normalizeGroups(){
  var changed = false;
  coll.forEach(function(c){
    var d = findDB(c.name);
    if (!d) return;
    var g = groupOf(d);
    if (c.group !== g) { c.group = g; changed = true; }
  });
  if (changed) saveCache();
  return changed;
}

/** 品种简称：用于系列内跳转、缺项列表 */
function shortName(n){
  var head = String(n).split('（')[0];
  if (head.indexOf('·') >= 0) return head.split('·').pop().trim();
  var m = String(n).match(/（(.+?)）/);
  if (m) {
    var inner = m[1].split('·')[0];
    if (inner.length <= 4) return inner;
  }
  return head.replace(/^\d{4}年贺岁/, '').trim() || n;
}

function holdingOf(name){
  for (var i = 0; i < coll.length; i++) { if (coll[i].name === name) return coll[i]; }
  return null;
}

/** 按套系聚合出每个系列的统计（品种数、整套面额/推理价、已藏情况） */
/* 系列名单里去掉「世界文化遗产·」这类系列前缀，只留品种名。
 * 注意「2015年贺岁（羊·二轮首发）」的点在括号里，是品名的一部分，
 * 原来的 /^.*·/ 会把前半句一起吃掉，剩一个「二轮首发）」。 */
function shortCoinName(n){
  var cut = String(n).indexOf('·');
  if (cut < 0) return n;
  var open = String(n).indexOf('（');
  if (open >= 0 && open < cut) return n;
  return String(n).slice(cut + 1);
}

function buildSeriesList(){
  var stats = setStats();
  var list = [];

  Object.keys(SET_META).forEach(function(id){
    var meta = SET_META[id], st = stats[id];
    if (!st) return;
    var owned = [], face = 0, market = 0;
    st.coins.forEach(function(c){
      if (isOwned(c.name)) {
        owned.push(c);
        var h = holdingOf(c.name);
        face += h ? (Number(h.cost) || 0) : 0;      // 已藏按实际投入算
        market += h ? (Number(h.market) || 0) : 0;
      }
    });
    // 大品类：成员以纪念钞为主归入 note，否则 coin（普通纪念币）
    var noteN = st.coins.filter(function(c){ return c.kind === 'note'; }).length;
    list.push({
      id: id, name: meta.name, unit: meta.unit,
      total: meta.total, members: st.members,
      setFace: st.face, setEst: st.est,
      ownCount: owned.length, ownCost: face, ownMarket: market,
      missing: st.coins.filter(function(c){ return !isOwned(c.name); })
                       .map(function(c){ return shortCoinName(c.name); }),
      isSingle: false,
      cat: noteN > st.coins.length / 2 ? 'note' : 'coin'
    });
  });

  // 独立发行（无量产系列归属）：按纪念币 / 纪念钞拆成两张卡
  var singles = DB.filter(function(d){ return !d.set || d.set === 'single'; });
  function pushSingles(cat, label){
    var group = singles.filter(function(d){ return (d.kind === 'note') === (cat === 'note'); });
    if (!group.length) return;
    var so = group.filter(function(d){ return isOwned(d.name); });
    list.push({
      id: 'single-' + cat, name: label, unit: cat === 'note' ? '张' : '枚',
      total: group.length, members: group.length,
      setFace: group.reduce(function(a, c){ return a + (Number(c.face) || 0); }, 0),
      setEst: group.reduce(function(a, c){ return a + aiPrice(c); }, 0),
      ownCount: so.length,
      ownCost: so.reduce(function(a, c){ var h = holdingOf(c.name); return a + (h ? Number(h.cost) || 0 : 0); }, 0),
      ownMarket: so.reduce(function(a, c){ var h = holdingOf(c.name); return a + (h ? Number(h.market) || 0 : 0); }, 0),
      missing: group.filter(function(c){ return !isOwned(c.name); })
                    .map(function(c){ return shortCoinName(c.name); }),
      isSingle: true, cat: cat
    });
  }
  pushSingles('coin', '独立发行 · 纪念币（周年 · 人物 · 航天等）');
  pushSingles('note', '独立发行 · 纪念钞');

  list.sort(function(a, b){
    if (a.isSingle !== b.isSingle) return a.isSingle ? 1 : -1;      // 独立发行放最后
    var ra = a.total ? a.ownCount / a.total : 0, rb = b.total ? b.ownCount / b.total : 0;
    var da = ra >= 1 ? 1 : 0, db = rb >= 1 ? 1 : 0;
    if (da !== db) return da - db;
    if (ra !== rb) return ra - rb;
    return b.total - a.total;
  });
  return list;
}

/** 概览：紧凑摘要 */
function renderSets(){
  var box = document.getElementById('setsBox');
  if (!box) return;
  var list = buildSeriesList();
  var sets = list.filter(function(x){ return !x.isSingle; });
  var done = sets.filter(function(x){ return x.ownCount >= x.total; }).length;
  var totalKinds = DB.length;
  var ownKinds = DB.filter(function(d){ return isOwned(d.name); }).length;
  var next = sets.filter(function(x){ return x.ownCount < x.total; })
                 .sort(function(a, b){ return (a.total - a.ownCount) - (b.total - b.ownCount); })[0];

  box.innerHTML =
    '<div class="ss-cell"><i>系列</i><b>' + sets.length + '</b></div>' +
    '<div class="ss-cell"><i>已集齐</i><b class="gold">' + done + '</b></div>' +
    '<div class="ss-cell"><i>品种</i><b>' + ownKinds + ' / ' + totalKinds + '</b></div>' +
    '<div class="ss-next">' +
      (next
        ? '下一步：<b>' + next.name + '</b> 还差 ' + (next.total - next.ownCount) + ' 个' +
          (function(){
            // 只差一个时，括号里的名字会跟系列名一模一样，就不要再写一遍
            var rest = next.missing.filter(function(n){ return n !== next.name; });
            if (!rest.length) return '';
            return '（' + rest.slice(0, 2).join(' · ') + (rest.length > 2 ? ' 等' : '') + '）';
          })()
        : '全部系列已集齐') +
    '</div>';
}

/* 系列卡片里的缺项名单：把每个名字前面与系列名重复的部分裁掉，
 * 「中国珍稀野生动物——大熊猫 · 中国珍稀野生动物——金丝猴」→「大熊猫 · 金丝猴」，
 * 手机上能少占一行。只在至少两个名字共有同一前缀时才裁。 */
function shortNames(names, seriesName){
  if (!names || names.length < 2) return names || [];
  var pre = String(seriesName || '');
  if (!pre) return names;
  var allHave = names.every(function(n){ return n.indexOf(pre) === 0; });
  if (!allHave) return names;
  return names.map(function(n){
    var rest = n.slice(pre.length).replace(/^[\s——·・\-—]+/, '');
    return rest || n;
  });
}

/** 全部系列页：卡片网格 */
function renderSeries(){
  var box = document.getElementById('seriesBox');
  if (!box) return;
  var list = buildSeriesList();
  var anon = !isLoggedIn();
  var hint = document.getElementById('seriesHint');
  if (hint) {
    var sets = list.filter(function(x){ return !x.isSingle; });
    hint.textContent = sets.length + ' 个系列' +
      (list.length > sets.length ? ' + 独立发行' : '') +
      ' · ' + DB.length + ' 个品种' +
      (anon ? ' · 登录后显示你的集齐进度' : '');
  }

  function cardHtml(x){
    var rate = x.total ? Math.min(100, x.ownCount / x.total * 100) : 0;
    var done = x.ownCount >= x.total;
    var unit = x.isSingle ? (x.cat === 'note' ? ' 张' : ' 枚') : ' 个品种';
    var missNames = shortNames(x.missing.slice(0, 4), x.name);
    var miss = anon
      ? missNames.join(' · ') + (x.missing.length > 4 ? ' 等' : '')
      : (done
        ? '<span class="sc-done">已集齐</span>'
        : '缺 ' + x.missing.length + ' 个' +
          (x.missing.length ? '：' + missNames.join(' · ') + (x.missing.length > 4 ? ' 等' : '') : ''));

    return '<button class="scard' + (done ? ' done' : '') + (x.isSingle ? ' single' : '') + '"' +
        ' data-set="' + esc(x.id) + '" data-name="' + esc(x.name) + '"' +
        ' data-cat="' + (x.cat === 'note' ? 'note' : 'coin') + '">' +
      '<div class="sc-top">' +
        '<span class="sc-name">' + esc(x.name) + '</span>' +
        '<span class="sc-prog">' + (anon ? x.total + unit : x.ownCount + ' / ' + x.total + (x.isSingle ? '' : ' 品种')) + '</span>' +
      '</div>' +
      (anon ? '' : '<div class="track"><div class="fill' + (done ? ' done' : '') + '" style="width:' + rate + '%"></div></div>') +
      '<div class="sc-stats">' +
        '<span>' + (x.isSingle ? '合计面额' : '整套发行') + ' <b>' + money(x.setFace) + '</b></span>' +
        '<span>' + (x.isSingle ? '合计推理价' : '整套推理价') + ' <b class="gold">' + money(x.setEst) + '</b></span>' +
      '</div>' +
      (anon ? ''
        : (x.ownCount
          ? '<div class="sc-own">已藏 ' + x.ownCount + ' 项 · 推理价 <b>' + money(x.ownMarket) + '</b></div>'
          : '<div class="sc-own dim">还没有这个系列的藏品</div>')) +
      (miss ? '<div class="sc-miss">' + miss + '</div>' : '') +
    '</button>';
  }

  function section(title, cls, cards, count){
    if (cards === null || cards === undefined) return '';
    // cards 是拼好的 HTML 字符串，不能用 cards.length 当卡片数（那是字符长度）
    return '<div class="sc-group ' + cls + '"><div class="sc-group-h"><b>' + title + '</b>' +
      '<span>' + (Number(count) || 0) + ' 项</span></div><div class="sc-group-grid">' + cards + '</div></div>';
  }

  var coinList = list.filter(function(x){ return x.cat !== 'note'; });
  var noteList = list.filter(function(x){ return x.cat === 'note'; });
  var coinCards = coinList.map(cardHtml).join('');
  var noteCards = noteList.map(cardHtml).join('');

  // 贵金属系列：来自 /api/series?category=pm（项目=一套），未加载时先提示并在回调里补渲染
  var pmCards = PM_SERIES.map(function(s){
    return '<button class="scard pm-card" data-pm-project="' + esc(s.code) + '">' +
      '<div class="sc-top"><span class="sc-name">' + esc(s.name) + '</span>' +
      '<span class="sc-prog">' + Number(s.count || 0) + ' 枚</span></div>' +
      '<div class="sc-desc">' + esc(s.code) + '</div>' +
      '<div class="sc-own dim">点开看该套全部规格</div></button>';
  }).join('');

  box.innerHTML =
    section('纪念币', 'g-coin', coinCards, coinList.length) +
    section('纪念钞', 'g-note', noteCards, noteList.length) +
    section('贵金属纪念币', 'g-pm', PM_SERIES_LOADED
      ? (pmCards || '<div class="sc-group-empty">暂无贵金属项目</div>')
      : '<div class="sc-group-empty">正在加载贵金属项目…</div>', PM_SERIES.length);

  if (!PM_SERIES_LOADED) {
    loadPmSeries(function(){ if (document.getElementById('seriesBox') === box) renderSeries(); });
  }

  box.onclick = function(e){
    var card = e.target.closest('.scard');
    if (!card) return;
    var project = card.getAttribute('data-pm-project');
    if (project) {
      PM_FULL.project = project; PM_FULL.q = ''; PM_FULL.loaded = false; PM_FULL.page = 0;
      VIEW_CATEGORY = 'pm';
      goTab('all');
      resetPmFull('', project);
      return;
    }
    // 从系列页进来时清掉其它筛选条件，避免叠加成空结果
    filterSet = card.getAttribute('data-set');
    // 切到卡片所属品类视角，否则从贵金属视角点普通系列会筛出空结果
    VIEW_CATEGORY = card.getAttribute('data-cat') === 'note' ? 'note' : 'coin';
    var catTabs = document.getElementById('catTabs');
    if (catTabs) {
      Array.prototype.forEach.call(catTabs.querySelectorAll('[data-cat]'), function(t){
        t.className = t.getAttribute('data-cat') === VIEW_CATEGORY ? 'on' : '';
      });
    }
    document.getElementById('q').value = '';
    document.getElementById('fSeries').value = '';
    document.getElementById('fYear').value = '';
    document.getElementById('fMine').checked = false;
    syncSetFilter();
    goTab('all');
    renderTable();
  };
}

/* =========================================================
   14.4 首页
   ========================================================= */
/* 页面静态文案统一按当前清单派生，扩库后不会再出现写死的旧数字。
   <head> 里的 SEO/分享元数据保留正确静态值（爬虫不一定执行 JS），这里只做运行时校准。 */
/* 清单不保证按年份排列（例如后补的纪念钞可能排在数组末尾），
 * 所以年份跨度一律取最小/最大，不能拿首尾元素当端点。 */
function yearBounds(){
  var lo = 0, hi = 0;
  for (var i = 0; i < DB.length; i++) {
    var y = Number(DB[i].year) || 0;
    if (!y) continue;
    if (!lo || y < lo) lo = y;
    if (y > hi) hi = y;
  }
  return lo ? { lo: lo, hi: hi } : { lo: 1984, hi: 2026 };
}
function yearRange(){
  var b = yearBounds();
  return b.lo + '—' + b.hi;
}

function syncStaticCopy(){
  if (!DB.length) return;
  var total = DB.length;
  var range = yearRange();
  var imgTotal = Object.keys(IMG_SET).length;
  var real = Object.keys(REAL_SET).length;
  var mock = Math.max(0, imgTotal - real);
  var noImg = Math.max(0, total - imgTotal);

  var nodes = document.querySelectorAll('[data-copy]');
  for (var i = 0; i < nodes.length; i++) {
    var k = nodes[i].getAttribute('data-copy');
    if (k === 'total') nodes[i].textContent = total;
    else if (k === 'range') nodes[i].textContent = range;
    else if (k === 'real') nodes[i].textContent = real;
  }

  var note = document.getElementById('imgNote');
  if (note) {
    var txt = '共 ' + total + ' 个品种，其中 ' + real + ' 张真实币面照片';
    if (mock) txt += '、' + mock + ' 张示意图';
    if (noImg) txt += '，另有 ' + noImg + ' 个品种以矢量示意呈现';
    note.textContent = txt + '，取自中国人民银行发行公告及公开图源，逐张人工核验后收录。';
  }

  document.title = document.title.replace(/\d{4}—\d{4}/, range);
  var metas = document.querySelectorAll(
    'meta[name="description"], meta[property="og:title"], meta[property="og:description"],' +
    ' meta[name="twitter:title"], meta[name="twitter:description"]');
  for (var j = 0; j < metas.length; j++) {
    var c = metas[j].getAttribute('content');
    if (!c) continue;
    metas[j].setAttribute('content',
      c.replace(/\d{4}—\d{4}/g, range).replace(/\d+ 个品种/g, total + ' 个品种'));
  }
}

/* ---------------------------------------------------------
   首页主视觉轮播
   原来固定显示「泰山」一枚。现在按一组候选自动轮播，规则：
   - 鼠标移入 / 键盘聚焦 / 首屏不可见 / 切到别的标签页 → 暂停
   - 系统开了「减少动效」→ 只显示首张，不自动播
   - 点圆点手动切，手动切完重新计时
   --------------------------------------------------------- */
var HERO = { list: [], idx: 0, timer: null, started: false, hover: false, visible: true };

/** 轮播候选：优先挑图案辨识度高的，找不到就退回最近发行的实拍品种 */
function heroSlides(){
  var wants = ['泰山', '黄山', '三江源', '京剧', '龙钞', '马钞', '峨眉山', '大熊猫国家公园'];   // 大致按年份递进
  var out = [];
  wants.forEach(function(k){
    if (out.length >= 6) return;
    var hit = DB.filter(function(d){ return d.name.indexOf(k) >= 0 && REAL_SET[d.i + 1]; })[0];
    if (hit && out.indexOf(hit) < 0) out.push(hit);
  });
  if (out.length < 3) {
    DB.slice().sort(function(a, b){ return b.year - a.year || b.i - a.i; }).forEach(function(d){
      if (out.length < 6 && REAL_SET[d.i + 1] && out.indexOf(d) < 0) out.push(d);
    });
  }
  return out;
}

function heroApply(){
  var box = document.getElementById('homeHeroCard');
  var img = document.getElementById('homeHeroImg');
  var tag = document.getElementById('homeHeroTag');
  var dots = document.getElementById('homeHeroDots');
  if (!box || !img) return;
  var d = HERO.list[HERO.idx];
  if (!d) return;
  img.src = 'img/' + pad3(d.i + 1) + '.jpg';
  img.alt = d.name;
  if (tag) tag.textContent = shortName(d.name) + ' · ' + d.year;
  box.setAttribute('data-coin', d.i);
  box.setAttribute('aria-label', d.name + '，查看详情');
  if (dots) {
    for (var i = 0; i < dots.children.length; i++) {
      var on = i === HERO.idx;
      dots.children[i].classList.toggle('on', on);
      dots.children[i].setAttribute('aria-selected', on ? 'true' : 'false');
    }
  }
  // 预取下一张，切图时不闪白
  var nx = HERO.list[(HERO.idx + 1) % HERO.list.length];
  if (nx && nx !== d) { var pre = new Image(); pre.src = 'img/' + pad3(nx.i + 1) + '.jpg'; }
}

function heroGoto(n, instant){
  if (!HERO.list.length) return;
  var target = ((n % HERO.list.length) + HERO.list.length) % HERO.list.length;
  if (target === HERO.idx && !instant) return;
  HERO.idx = target;
  var box = document.getElementById('homeHeroCard');
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (instant || reduce || !box) { heroApply(); return; }
  box.classList.add('swapping');
  setTimeout(function(){ heroApply(); box.classList.remove('swapping'); }, 230);
}

function heroStop(){ if (HERO.timer) { clearInterval(HERO.timer); HERO.timer = null; } }
function heroStart(){
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduce) return;                       // 用户不想要动效，就停在首张
  heroStop();
  HERO.timer = setInterval(function(){
    if (document.hidden || HERO.hover || !HERO.visible) return;
    heroGoto(HERO.idx + 1);
  }, 4600);
}

function initHomeHero(){
  var box = document.getElementById('homeHeroCard');
  var dots = document.getElementById('homeHeroDots');
  if (!box) return;
  if (!HERO.list.length) HERO.list = heroSlides();
  if (!HERO.list.length) return;
  if (HERO.started) { heroApply(); return; }   // 来回切页签不重建定时器
  HERO.started = true;

  if (dots) {
    dots.innerHTML = HERO.list.map(function(d, i){
      return '<button class="hh-dot' + (i === 0 ? ' on' : '') + '" type="button" role="tab"' +
        ' aria-selected="' + (i === 0) + '"' +
        ' aria-label="第 ' + (i + 1) + ' 张：' + esc(d.name) + '"' +
        ' data-slide="' + i + '"></button>';
    }).join('');
    dots.addEventListener('click', function(e){
      var b = e.target.closest('[data-slide]');
      if (!b) return;
      e.preventDefault();
      heroGoto(parseInt(b.getAttribute('data-slide'), 10));
      heroStart();                            // 手动切完重新计时
    });
    dots.addEventListener('keydown', function(e){
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      e.preventDefault();
      heroGoto(HERO.idx + (e.key === 'ArrowRight' ? 1 : -1));
      var next = dots.children[HERO.idx];
      if (next) next.focus();
    });
  }

  var wrap = box.parentNode;
  wrap.addEventListener('mouseenter', function(){ HERO.hover = true; });
  wrap.addEventListener('mouseleave', function(){ HERO.hover = false; });
  wrap.addEventListener('focusin', function(){ HERO.hover = true; });
  wrap.addEventListener('focusout', function(){ HERO.hover = false; });

  if ('IntersectionObserver' in window) {
    new IntersectionObserver(function(list){
      HERO.visible = list[0].isIntersecting;
    }, { threshold: 0.2 }).observe(wrap);
  }

  heroApply();
  heroStart();
}

function renderHome(){
  syncStaticCopy();
  var stats = document.getElementById('homeStats');
  if (!stats) return;

  var yb = yearBounds();
  var years = DB.length ? (yb.hi - yb.lo + 1) : 0;
  var setCount = Object.keys(SET_META).length;
  var owned = DB.filter(function(d){ return isOwned(d.name); }).length;

  ['coinTotalA', 'coinTotalB'].forEach(function(id){
    var el = document.getElementById(id);
    if (el) el.textContent = DB.length;
  });
  var lc = document.getElementById('listCount');
  if (lc) {
    var nCoin = DB.filter(function(d){ return d.kind !== 'note'; }).length;
    var nNote = DB.length - nCoin;
    var y0 = DB.length ? yb.lo : '';
    var y1 = DB.length ? yb.hi : '';
    lc.textContent = y0 + '—' + y1 + ' · 普通纪念币 ' + nCoin + ' 个品种 · 纪念钞 ' + nNote + ' 个品种';
  }

  stats.innerHTML =
    '<div class="hs"><b>' + DB.length + '</b><i>个品种</i></div>' +
    '<div class="hs"><b>' + years + '</b><i>年跨度</i></div>' +
    '<div class="hs"><b>' + setCount + '</b><i>个系列</i></div>' +
    '<div class="hs"><b>' + Object.keys(REAL_SET).length + '</b><i>张实物图</i></div>' +
    '<div class="hs"><b>' + (APP.userCount || 1) + '</b><i>位藏家</i></div>';

  // 已登录时换掉首屏 CTA
  var join = document.getElementById('homeJoin');
  var note = document.getElementById('homeNote');
  if (join && note) {
    if (isLoggedIn()) {
      join.textContent = '回到我的藏品';
      join.setAttribute('data-goto', 'holdings');
      note.innerHTML = '你已收藏 <b>' + owned + '</b> / ' + DB.length + ' 个品种' +
        (owned ? '，继续加油' : '，去清单里挑第一枚吧');
    } else {
      join.textContent = '免费注册，开始记录';
      join.setAttribute('data-goto', 'account');
      note.textContent = '无需下载，注册即可拥有自己的收藏账本';
    }
  }

  // 首页「即将发行」横幅：把下一枚还没发的币顶到最显眼的位置（回访钩子）
  (function(){
    var el = document.getElementById('planBanner');
    if (!el) return;
    var years = (PLAN && PLAN.years) || [];
    var next = null;
    years.forEach(function(y){
      (y.items || []).forEach(function(it){
        if (it.status !== 'upcoming') return;
        var d = planDaysUntil(it.date);
        if (d === null || d < 0) return;
        if (!next || d < planDaysUntil(next.date)) next = it;
      });
    });
    if (!next) { el.hidden = true; return; }
    var days = planDaysUntil(next.date);
    var nameEl = document.getElementById('pbName');
    var metaEl = document.getElementById('pbMeta');
    if (nameEl) nameEl.textContent = next.short || next.name;
    if (metaEl) {
      metaEl.textContent = next.date.slice(5).replace('-', ' 月 ') + ' 日发行'
        + (days > 0 ? ' · 还有 ' + days + ' 天' : (days === 0 ? ' · 今天' : ''))
        + (next.reserve ? ' · ' + next.reserve.slice(5).replace('-', '/').replace('-', '/').split(' 至 ')[0] + ' 起预约' : '');
    }
    el.hidden = false;
  })();

  var hc = document.getElementById('holdCats');
  if (hc) hc.addEventListener('click', function(e){
    var b = e.target.closest('[data-hcat]'); if (b) setHoldCat(b.getAttribute('data-hcat'));
  });

  initHomeHero();

  // 最近发行
  var latest = DB.slice().sort(function(a, b){ return b.year - a.year || b.i - a.i; }).slice(0, 6);
  var box = document.getElementById('homeLatest');
  if (box) {
    box.innerHTML = latest.map(function(d){
      return '<button class="lt-card" data-coin="' + d.i + '">' +
        '<img src="' + imgSmall(d.i + 1) + '" alt="' + esc(d.name) + '" ' +
          'width="120" height="120" decoding="async" loading="lazy">' +
        '<span class="lt-name">' + esc(d.name) + '</span>' +
        '<span class="lt-meta">' + d.year + ' · ' + (SERIES[d.series] || '') + ' · 推理价 ' + money(aiPrice(d)) + '</span>' +
      '</button>';
    }).join('');
  }

  // 热门系列
  var list = buildSeriesList().filter(function(x){ return !x.isSingle; });
  // 首页热门系列固定 4 个：刚好铺满一行，不会在宽屏右侧空出一格
  var HOME_SETS = ['np', 'sx2', 'wh', 'jj'];
  var pick = HOME_SETS.map(function(id){
    return list.filter(function(x){ return x.id === id; })[0];
  }).filter(Boolean);
  if (pick.length < HOME_SETS.length) {
    list.forEach(function(x){
      if (pick.length < HOME_SETS.length && pick.indexOf(x) < 0) pick.push(x);
    });
  }
  var sb = document.getElementById('homeSets');
  if (sb) {
    sb.innerHTML = pick.map(function(x){
      var rate = x.total ? Math.min(100, x.ownCount / x.total * 100) : 0;
      return '<button class="hs-card" data-goto="series">' +
        '<div class="hs-top"><span>' + esc(x.name) + '</span>' +
          '<i>' + (isLoggedIn() ? x.ownCount + ' / ' + x.total : x.total + ' 个品种') + '</i></div>' +
        (isLoggedIn()
          ? '<div class="track"><div class="fill' + (x.ownCount >= x.total ? ' done' : '') +
            '" style="width:' + rate + '%"></div></div>'
          : '') +
        '<div class="hs-sub">整套推理价 <b>' + money(x.setEst) + '</b></div>' +
      '</button>';
    }).join('');
  }

  // 未登录时给需要登录的功能卡加标记
  var gatedCards = document.querySelectorAll('.feature[data-gated]');
  for (var gi = 0; gi < gatedCards.length; gi++) {
    gatedCards[gi].classList.toggle('locked', !isLoggedIn());
  }

  // 首页卡片点击进详情
  document.getElementById('pane-home').onclick = function(e){
    var c = e.target.closest('[data-coin]');
    if (c) { goCoin(parseInt(c.getAttribute('data-coin'), 10)); return; }
    var g = e.target.closest('[data-goto]');
    if (g) goTab(g.getAttribute('data-goto'));
  };
}

/* =========================================================
   14.5 品种详情页
   ========================================================= */
function renderCoin(i){
  var box = document.getElementById('coinBox');
  if (!box) return;
  var d = DB[i];
  if (!d && i >= DB.length && PM_DB[i - DB.length]) { renderPmCoin(PM_DB[i - DB.length], i); return; }
  if (!d) { goTab('all'); return; }

  var up = unitPrice(d);
  var isNote = d.kind === 'note';
  var unit = isNote ? '张' : '枚';
  var meta = SET_META[d.set];
  var h = holdingOf(d.name);
  var no = i + 1;
  var img = imgMid(no);
  var isReal = !!REAL_SET[no];

  function fact(k, v, cls, note){
    return '<div class="cf"><i>' + k + '</i><b' + (cls ? ' class="' + cls + '"' : '') + '>' + v +
      (note ? '<span class="cf-note-inline">' + note + '</span>' : '') + '</b></div>';
  }

  var sibs = DB.filter(function(x){ return x.set === d.set && x.i !== i; });
  var sibHtml = sibs.length
    ? sibs.map(function(x){
        return '<button class="sib" data-coin="' + x.i + '">' +
               esc(shortName(x.name)) + '<i>' + x.year + '</i>' +
               (isOwned(x.name) ? '<span class="dot-ok" title="已收藏"></span>' : '') +
               '</button>';
      }).join('')
    : (meta
        ? '<span class="muted">该套系只有这一个品种，已完整</span>'
        : '<span class="muted">该品种为独立发行，没有同系列其他品种</span>');

  var ownHtml;
  if (h) {
    var pnl = (Number(h.market) || 0) - (Number(h.cost) || 0);
    ownHtml =
      '<div class="own-card">' +
        '<div class="oc-head"><span>我的持仓</span><b class="oc-ok">已收藏</b></div>' +
        '<div class="oc-grid">' +
          '<div><i>数量</i><b>' + (h.rolls || 0) + ' 套</b></div>' +
          '<div><i>成本</i><b>' + money(h.cost) + '</b></div>' +
          '<div><i>推理价</i><b class="gold">' + money(h.market) + '</b></div>' +
          '<div><i>浮动</i><b class="' + (pnl >= 0 ? 'up' : 'down') + '">' +
            (pnl >= 0 ? '+' : '−') + money(Math.abs(pnl)) + '</b></div>' +
        '</div>' +
        '<button class="btn ghost xs" data-goto="holdings">去「我的藏品」修改</button>' +
      '</div>';
  } else if (isLoggedIn()) {
    ownHtml = '<div class="own-card oc-empty"><span>还没有加入我的藏品</span>' +
      '<button class="btn primary xs" id="coinAdd">＋ 加入我的藏品</button></div>';
  } else {
    ownHtml = '<div class="own-card oc-empty"><span>登录后可记录你的持仓</span>' +
      '<button class="btn xs" data-goto="account">登录 / 注册</button></div>';
  }

  var gal = galleryOf(d);
  if (!gal.length) gal = [{ src: img, label: '实物图案', kind: 'main' }];
  var sp = setPriceOf(d);          // 一套的件数 / 面额 / 估值（多枚套币按发行套计）
  box.innerHTML =
    '<div class="coin-top">' +
      '<button class="btn ghost xs" data-goto="all">← 返回清单</button>' +
      (APP.isAdmin && APP.user && APP.user.role === 'admin'
        ? '<button class="btn ghost xs" id="coinAdmin" data-admin-coin="' + (d.i + 1) + '">管理这个品种</button>'
        : '') +
      '<span class="muted">第 ' + no + ' / ' + DB.length + ' 个品种</span>' +
    '</div>' +
    '<div class="coin-hero">' +
      '<div class="coin-media">' +
        '<div class="coin-fig' + (isNote ? ' is-note' : '') + '">' +
          '<img class="fig-main" src="' + gal[0].src + '" data-full="' + gal[0].full + '" alt="' + esc(d.name) + '" width="320" height="320" decoding="async" loading="lazy" data-zoom="' + esc(d.name) + '">' +
          (isReal ? '' : '<span class="fig-tag">示意图</span>') +
          (isReal ? '<span class="fig-zoom">点击看大图</span>' : '') +
        '</div>' +
        (gal.length > 1
          ? '<div class="fig-thumbs">' + gal.map(function(it, ix){
              return '<button class="fig-th' + (ix === 0 ? ' on' : '') + '" type="button" data-src="' + it.src + '" data-full="' + it.full +
                     '" aria-label="第 ' + (ix + 1) + ' 张图">' +
                     '<img src="' + it.small + '" alt="' + esc(d.name) + ' 第 ' + (ix + 1) + ' 张图" loading="lazy"></button>';
            }).join('') + '</div>'
          : '') +
      '</div>' +
      '<div class="coin-main">' +
        '<div class="coin-kicker">' + d.year + '　·　' + esc(SERIES[d.series] || '') + '</div>' +
        '<h2 class="coin-title">' + esc(d.name) + '</h2>' +
        '<div class="coin-tags">' +
          (meta
            ? '<span class="tag-chip">' + esc(meta.name) + ' · 共 ' + meta.total + ' ' + meta.unit + '</span>'
            : '<span class="tag-chip">独立发行</span>') +
          (isOwned(d.name) ? '<span class="tag-chip ok">已收藏</span>' : '') +
        '</div>' +
        '<div class="coin-facts">' +
          fact('面额', d.face + ' 元/' + (isNote ? '张' : '枚')) +
          fact('材质', d.material) +
          fact(sizeLabel(d), sizeText(d)) +
          fact('发行量', fmMint(d.mintage) + (isNote ? '张' : '枚')) +
          // 下面几项来自「元禾收藏」补充的实物参数，缺就不占位
          (d.thickness ? fact(d.specFrom ? '厚度*' : '厚度', d.thickness) : '') +
          (d.weight ? fact(d.specFrom ? '重量*' : '重量', d.weight) : '') +
          (d.caster ? fact('铸造单位', d.caster) : '') +
          (d.edge ? fact('边齿', d.edge) : '') +
          (d.specFrom
            ? '<div class="cf-note">* 该品种央行公告未公布厚度与重量，这里按同系列同规格推定</div>'
            : '') +
        '</div>' +
        '<div class="coin-price single-price">' +
          fact('推理价（单' + unit + '）', money(aiPrice(d)), 'ai') +
          '<button type="button" class="ai-formula-q" data-ai-formula="1" aria-label="推理价计算方式" title="推理价计算方式">?</button>' +
        '</div>' +
        ownHtml +
      '</div>' +
    '</div>' +
    '<div class="coin-desc">' +
      '<h3>发行信息</h3>' +
      (DESC[no]
        ? renderDescMd(DESC[no].textMd || DESC[no].text) +
          '<div class="cd-src">' +
            (DESC[no].source === 'baike'
              ? '百科资料：' + esc(DESC[no].title) +
                (DESC[no].date ? '　·　' + DESC[no].date : '') +
                '　·　<a href="' + esc(DESC[no].url) + '" target="_blank" rel="noopener noreferrer">查看词条 →</a>'
              : '官方来源：' + esc(DESC[no].title.replace(/^.*第\d+号$/, '中国人民银行公告')) +
                (DESC[no].date ? '　·　' + DESC[no].date : '') +
                '　·　<a href="' + esc(DESC[no].url) + '" target="_blank" rel="noopener noreferrer">查看公告原文 →</a>') +
          '</div>'
        : '<p class="cd-empty">暂无公开资料摘录，可前往中国人民银行官网或百度百科查询该品种。</p>') +
      (d.obverse || d.reverse
        ? '<div class="coin-patterns">' +
            (d.obverse ? '<div><i>正面图案</i><span>' + esc(d.obverse) + '</span></div>' : '') +
            (d.reverse ? '<div><i>背面图案</i><span>' + esc(d.reverse) + '</span></div>' : '') +
          '</div>'
        : '') +
    '</div>' +
    '<div class="coin-sibs">' +
      '<div class="sec-head" style="margin-bottom:12px"><h2 style="font-size:16px">同系列其他品种</h2>' +
      (sibs.length ? '<span class="muted">共 ' + sibs.length + ' 个</span>' : '') + '</div>' +
      '<div class="sib-wrap">' + sibHtml + '</div>' +
    '</div>' +
    '<div class="coin-nav">' +
      '<button class="btn ghost"' + (i > 0 ? ' data-coin="' + (i - 1) + '"' : ' disabled') + '>← 上一个</button>' +
      '<button class="btn ghost"' + (i < DB.length - 1 ? ' data-coin="' + (i + 1) + '"' : ' disabled') + '>下一个 →</button>' +
    '</div>';

  var addBtn = document.getElementById('coinAdd');
  if (addBtn) addBtn.addEventListener('click', function(){
    requestAddHolding(d.name, function(){ renderCoin(i); });
  });

  box.onclick = function(e){
    var sib = e.target.closest('[data-coin]');
    if (sib) goCoin(parseInt(sib.getAttribute('data-coin'), 10));
  };
}

/* 清单页的「按系列筛选」状态 */
var filterSet = '';
/* 「全部系列」页把独立发行拆成 single-coin / single-note 两张卡，
 * 这里统一识别，避免筛选把新 id 当普通 set 而筛出空结果。 */
function filterSetIsSingle(){ return filterSet === 'single' || filterSet.indexOf('single-') === 0; }
function filterSetSingleKind(){ return filterSet === 'single-note' ? 'note' : (filterSet === 'single-coin' ? 'coin' : ''); }
function syncSetFilter(){
  var el = document.getElementById('setFilter');
  if (!el) return;
  if (!filterSet) { el.hidden = true; el.innerHTML = ''; return; }
  var name = filterSetIsSingle()
    ? (filterSet === 'single' ? '独立发行' : (filterSet === 'single-note' ? '独立发行 · 纪念钞' : '独立发行 · 纪念币'))
    : ((SET_META[filterSet] && SET_META[filterSet].name) || filterSet);
  el.hidden = false;
  el.innerHTML = '<span>系列：' + esc(name) + '</span><b class="x" title="清除筛选">×</b>';
  el.onclick = function(){
    filterSet = '';
    syncSetFilter();
    renderTable();
  };
}

/* =========================================================
   9. 渲染：全收成本估算
   ========================================================= */
function costStats(){
  var s = { faceOne:0, estOne:0, faceRoll:0, estRoll:0, gapFace:0, gapEst:0, gapCount:0, noteOver:0, twoNoteOver:0 };
  DB.forEach(function(d){
    var sp = setPriceOf(d);
    var f = sp.face;
    var e = aiPrice(d) * sp.size;   // 一套推理价（件数由套系决定）
    s.faceOne += d.face;
    s.estOne  += aiPrice(d);        // 单枚推理价
    s.faceRoll += f;
    s.estRoll  += e;
    if(d.kind === 'note') s.noteOver += (aiPrice(d) - d.face);
    if(!isOwned(d.name)){
      s.gapCount++;
      s.gapFace += f;
      s.gapEst  += e;
    }
  });
  // 千禧龙钞 + 奥运钞 两张钞的溢价（按推理价）
  var a = findDB('迎接新世纪纪念钞（千禧龙钞）');
  var b = findDB('第29届奥运会纪念钞（奥运钞）');
  s.twoNoteOver = (aiPrice(a) - a.face) + (aiPrice(b) - b.face);
  s.twoNoteEst = aiPrice(a) + aiPrice(b);   // 绕开这两张时要从单枚推理价总数里减掉它们
  s.overOne = s.estOne - s.faceOne;
  return s;
}

/* 未登录访客的「收齐成本」：两个口径都只用全站发行数据，不需要账本。
 * 原来这里是登录墙，而「整套收齐要多少钱」恰恰是访客最想知道的一个数。 */
function renderCostGate(s){
  var gate = document.querySelector('#pane-cost .anon-gate');
  if (!gate) return;
  var facePct = s.estOne ? Math.round(s.faceOne / s.estOne * 100) : 0;
  var twoPct  = s.overOne ? Math.round(s.twoNoteOver / s.overOne * 100) : 0;
  var avoid   = s.estOne - s.twoNoteEst;

  function card(k, d, num, face){
    return '<div class="ccard' + (k === '单枚口径' ? ' hl' : '') + '" style="text-align:left">' +
      '<div class="ck">' + k + '</div>' +
      '<div class="cd">' + d + '</div>' +
      '<div class="cnum">' + money(num) + '</div>' +
      '<div class="cface">其中面值 ' + money(face) + ' · 溢价 ' + money(num - face) + '</div>' +
    '</div>';
  }

  gate.innerHTML =
    '<div class="gate-ico">算</div>' +
    '<h3>全部收齐，要花多少钱</h3>' +
    '<p>按推理价（发行量、材质、年份等公开参数推算）估算。' + DB.length +
      ' 个品种，整卷按 20 枚 / 整刀 20 张、多枚套币按发行套计。</p>' +
    '<div style="display:grid;gap:14px;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));margin-top:20px">' +
      card('单枚口径', '全部 ' + DB.length + ' 个品种 · 各 1 枚 / 1 张', s.estOne, s.faceOne) +
      card('整卷口径', '全部 ' + DB.length + ' 个品种 · 整卷 / 整刀', s.estRoll, s.faceRoll) +
    '</div>' +
    '<p style="max-width:640px">单枚口径里，面值只占 <b>' + facePct + '%</b>，其余 <b>' +
      money(s.overOne) + '</b> 全是溢价；其中约 <b>' + twoPct + '%</b> 来自两张钞（千禧龙钞、奥运钞）。' +
      '只想「品种齐全」的话，绕开这两张约 <b class="gold">' + money(avoid) + '</b> 就能拿下。</p>' +
    '<div class="gate-actions">' +
      '<button class="btn primary" data-goto="account">登录，算我自己的缺口</button>' +
      '<button class="btn ghost" data-goto="all">先看全套清单</button>' +
    '</div>';
}

function renderCost(){
  var s = costStats();
  if (!isLoggedIn()) { renderCostGate(s); return; }
  var cards = [
    { hl:1, k:'你要补的', d:s.gapCount + ' 个品种 · 整卷 20 枚 / 整刀 20 张，多枚套币按发行套计', num:s.gapEst,  face:s.gapFace },
    { hl:0, k:'全部收齐 · 整卷', d:DB.length + ' 个品种 · 整卷 20 枚 / 整刀 20 张，多枚套币按发行套计', num:s.estRoll, face:s.faceRoll },
    { hl:0, k:'全部收齐 · 单枚', d:DB.length + ' 个品种 · 各 1 枚 / 1 张', num:s.estOne,  face:s.faceOne }
  ];

  var html = '';
  cards.forEach(function(c){
    var fp = c.num ? Math.max(4, c.face / c.num * 100) : 0;
    var ep = 100 - fp;
    html += '<div class="ccard' + (c.hl?' hl':'') + '">' +
      '<div class="ck">' + c.k + '</div>' +
      '<div class="cd">' + c.d + '</div>' +
      '<div class="cnum">' + money(c.num) + '</div>' +
      '<div class="cface">其中面值 ' + money(c.face) + ' · 溢价 ' + money(c.num - c.face) + '</div>' +
      '<div class="stack"><i class="sf" style="width:' + fp + '%"></i><i class="se" style="width:' + ep + '%"></i></div>' +
      '<div class="legend"><span>面值</span><span class="e">溢价</span></div>' +
    '</div>';
  });
  document.getElementById('costBox').innerHTML = html;

  var twoPct = s.overOne ? Math.round(s.twoNoteOver / s.overOne * 100) : 0;
  var avoidTwo = s.estOne - s.twoNoteEst;
  var notePct = Math.round(s.noteOver / s.estRoll * 100);
  var coinTotal = DB.filter(function(d){ return d.kind === 'coin'; })
                   .reduce(function(a, d){ return a + setSizeBase(d); }, 0);
  document.getElementById('conclBox').innerHTML =
    '单枚口径的 <em>' + money(s.estOne) + '</em> 里，面值只占 ' + money(s.faceOne) +
    '，其余 <b>' + money(s.overOne) + '</b> 全是溢价；而其中 <b>' + money(s.twoNoteOver) +
    '</b> 来自两张钞（千禧龙钞、奥运钞），占全部溢价的 <b>' + twoPct + '%</b>。' +
    '只想「品种齐全」的话，先绕开这两张，单枚全集约 <b>' + money(avoidTwo) + '</b> 就能拿下。' +
    '整卷口径则相反：纪念钞的溢价只占总额的约 ' + notePct + '%，钱几乎全压在这 ' +
    coinTotal.toLocaleString('zh-CN') + ' 枚币本身。';
}

/* =========================================================
   10. 渲染：全量清单
   ========================================================= */
function renderFilters(){
  var sSel = document.getElementById('fSeries');
  var ySel = document.getElementById('fYear');

  var usedSeries = {};
  DB.forEach(function(d){
    (d.seriesKeys && d.seriesKeys.length ? d.seriesKeys : [d.series]).forEach(function (k) { if (k) usedSeries[k] = true; });
  });

  Object.keys(SERIES).forEach(function(k){
    if(!usedSeries[k]) return;
    var o = document.createElement('option');
    o.value = k; o.textContent = SERIES[k];
    sSel.appendChild(o);
  });

  var years = {};
  DB.forEach(function(d){ years[d.year] = true; });
  Object.keys(years).sort().reverse().forEach(function(y){
    var o = document.createElement('option');
    o.value = y; o.textContent = y + ' 年';
    ySel.appendChild(o);
  });

  document.getElementById('cntAll').textContent = DB.length;
}

function isOwned(name){
  for(var i=0;i<coll.length;i++){ if(coll[i].name===name) return true; }
  return false;
}

var sortDir = 'desc';       // 年份排序方向（默认最新在前）
var SET_STATS = null;       // 套系聚合：setId -> {name,unit,total,face,est,coins[]}

function setStats(){
  if (SET_STATS) return SET_STATS;
  var m = {};
  DB.forEach(function(d){
    var sid = d.set;
    if (!sid || sid === 'single') return;
    var meta = SET_META[sid] || { name:'', unit: d.kind === 'note' ? '张' : '枚', total: 0 };
    var s = m[sid] || (m[sid] = {
      id: sid, name: meta.name, unit: meta.unit, total: meta.total,
      face: 0, est: 0, coins: []
    });
    var upc = unitPrice(d);
    var boxN = (meta.kind === 'box' && meta.size) ? meta.size : 1;
    s.face += upc.face * boxN;
    s.est += aiPrice(d) * boxN;   // 整套推理价（原为参考价）
    s.coins.push(d);
  });
  SET_STATS = m;
  return m;
}

function syncSortHead(){
  var th = document.getElementById('sortYear');
  if (!th) return;
  var arw = th.querySelector('.arw');
  if (arw) arw.textContent = sortDir === 'asc' ? '▲' : '▼';
  th.classList.add('on');
  var asc = sortDir === 'asc';
  th.title = asc ? '当前：年份升序，点击改为降序' : '当前：年份降序，点击改为升序';
  th.setAttribute('aria-sort', asc ? 'ascending' : 'descending');
  th.setAttribute('aria-label', asc ? '按年份排序，当前升序，按回车切换' : '按年份排序，当前降序，按回车切换');
}

/* ---------------------------------------------------------
   清单页「高级筛选」
   维度：面额 / 材质 / 铸造单位 / 发行量档位（多选，取并集；不同维度之间取交集）
   芯片上的数字是「按当前其它条件过滤后，这一项还能筛出几个」，避免点出空结果。
   --------------------------------------------------------- */
var FADV = { face: {}, material: {}, caster: {}, mintage: '' };

var MINT_BUCKETS = [
  { k: 'lt1000', label: '1000 万以内', test: function(n){ return n < 1000; } },
  { k: 'mid', label: '1000 万–1 亿', test: function(n){ return n >= 1000 && n <= 10000; } },
  { k: 'gt1y', label: '1 亿以上', test: function(n){ return n > 10000; } }
];

function fadvHas(dim){ return Object.keys(FADV[dim] || {}).length > 0; }
function fadvAny(){
  return fadvHas('face') || fadvHas('material') || fadvHas('caster') || !!FADV.mintage;
}

/** 基础过滤（不含高级维度），用于算每个芯片还能命中多少 */
function baseRows(){
  var q = document.getElementById('q').value.trim().toLowerCase();
  var fs = document.getElementById('fSeries').value;
  var fy = document.getElementById('fYear').value;
  var onlyMine = document.getElementById('fMine').checked;
  return DB.filter(function(d){
    if(q){
      var hay = (d.name + ' ' + d.year + ' ' + (SERIES[d.series] || '') + ' ' + d.material).toLowerCase();
      if(hay.indexOf(q) < 0) return false;
    }
    if(fs && (d.seriesKeys && d.seriesKeys.length ? d.seriesKeys : [d.series]).indexOf(fs) < 0) return false;
    if(fy && String(d.year) !== fy) return false;
    if(onlyMine && !isOwned(d.name)) return false;
    if(filterSet){
      if(filterSetIsSingle()){
        if(d.set && d.set !== 'single') return false;
        var singleKind = filterSetSingleKind();
        if(singleKind && (d.kind || 'coin') !== singleKind) return false;
      }
      else if(d.set !== filterSet) return false;
    }
    return true;
  });
}

/* 铸造单位原文是「上海造币厂和沈阳造币厂」「上海造币有限公司」这种，
 * 直接当选项会碎成十几个，统一归到厂名标签上。 */
function casterTags(v){
  var s = String(v || '');
  var out = [];
  if (/上海/.test(s)) out.push('上海');
  if (/沈阳/.test(s)) out.push('沈阳');
  if (/深圳|国宝/.test(s)) out.push('深圳国宝');
  if (!out.length && s) out.push(s.replace(/有限公司|造币厂|铸造/g, '').trim() || s);
  return out;
}

function facetValues(dim, list){
  var map = {};
  list.forEach(function(d){
    if (dim === 'caster') {
      casterTags(d.caster).forEach(function(t){ map[t] = (map[t] || 0) + 1; });
      return;
    }
    var v = d[dim];
    if (v === undefined || v === null || v === '') return;
    if (dim === 'face') v = String(v);
    map[v] = (map[v] || 0) + 1;
  });
  return map;
}

function chipHtml(dim, key, label, n){
  var on = dim === 'mintage' ? FADV.mintage === key : !!FADV[dim][key];
  return '<button type="button" class="fchip' + (on ? ' on' : '') + '" data-dim="' + dim + '" data-key="' + esc(key) + '">' +
    esc(label) + '<span class="n">' + n + '</span></button>';
}

function renderAdvFilters(){
  var list = baseRows();
  var faceBox = document.getElementById('fadvFace');
  var matBox = document.getElementById('fadvMat');
  var castBox = document.getElementById('fadvCaster');
  var mintBox = document.getElementById('fadvMint');
  if (!faceBox) return;

  // 只保留还能命中的选项；已选中的即使命中 0 个也留着，否则没法取消
  function grp(box, dim, map, fmt, order){
    if (!box) return;
    box.setAttribute('data-label', { face: '面额', material: '材质', caster: '铸造', mintage: '发行量' }[dim] || dim);
    var keys = Object.keys(map).sort(order || function(a, b){ return map[b] - map[a]; });
    var html = keys.map(function(k){ return chipHtml(dim, k, fmt ? fmt(k) : k, map[k]); }).join('');
    // 选中的但当前列表里没有的，补一个 0 计数，方便取消
    Object.keys(FADV[dim] || {}).forEach(function(k){
      if (!map[k]) html += chipHtml(dim, k, fmt ? fmt(k) : k, 0);
    });
    html += '<div class="plan-next-src">2027 年普通纪念币发行计划一般在当年 12 月公布，届时本页会自动更新。</div>';
  box.innerHTML = html;
  }

  grp(faceBox, 'face', facetValues('face', list), function(k){ return k + ' 元'; },
      function(a, b){ return Number(a) - Number(b); });
  grp(matBox, 'material', facetValues('material', list));
  grp(castBox, 'caster', facetValues('caster', list));

  if (mintBox) {
    mintBox.setAttribute('data-label', '发行量');
    mintBox.innerHTML = MINT_BUCKETS.map(function(b){
      var n = list.filter(function(d){ return b.test(Number(d.mintage) || 0); }).length;
      return chipHtml('mintage', b.k, b.label, n);
    }).join('');
  }
}

function initAdvFilters(){
  var toggle = document.getElementById('fAdvToggle');
  var panel = document.getElementById('fAdv');
  if (toggle && panel) {
    toggle.addEventListener('click', function(){
      var open = panel.hidden;
      panel.hidden = !open;
      toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
      toggle.classList.toggle('on', open);
      toggle.textContent = open ? '收起高级筛选' : '高级筛选';
      if (open) renderAdvFilters();
    });
  }
  var wrap = document.getElementById('fAdv');
  if (wrap) {
    wrap.addEventListener('click', function(e){
      var b = e.target.closest('.fchip');
      if (!b) return;
      var dim = b.getAttribute('data-dim');
      var key = b.getAttribute('data-key');
      if (dim === 'mintage') FADV.mintage = FADV.mintage === key ? '' : key;
      else {
        if (FADV[dim][key]) delete FADV[dim][key];
        else FADV[dim][key] = 1;
      }
      syncSearchUI();
      renderTable();
    });
  }
}

/* =========================================================
   T04：目录分段 + 贵金属（只读参考数据，不进藏品/成本口径）
   ========================================================= */
/** 当前分段看到的品种：coin=普通纪念币、note=纪念钞、pm=贵金属 */
function activeCatalog(){
  if (VIEW_CATEGORY === 'pm') return PM_DB;
  if (VIEW_CATEGORY === 'note') return DB.filter(function(d){ return d.kind === 'note'; });
  return DB.filter(function(d){ return d.kind !== 'note'; });
}

/** 已上架贵金属（公开接口，draft 不会出现）；失败时静默降级为空 */
function loadPmCatalog(){
  return fetch('/api/catalog?category=pm&size=200', { cache: 'no-store' })
    .then(function(r){ return r.ok ? r.json() : { items: [] }; })
    .then(function(j){ PM_DB = Array.isArray(j.items) ? j.items : []; return j; })
    .catch(function(){ PM_DB = []; return { items: [] }; });
}

/* ---- 贵金属全量库（金币云集 2823 条）：分页 + 占位图 ---- */
/** 材质→占位色（ecgci 图片被 WAF 拦，真图暂不可用，用色块+材质字占位） */
function pmPlaceholder(item){
  var m = String(item.material || '');
  var bg = /金/.test(m) ? '#d4a72c' : (/银/.test(m) ? '#b9c0c8' : (/铂/.test(m) ? '#8d95a0' : '#c9a227'));
  var ch = /金/.test(m) ? '金' : (/银/.test(m) ? '银' : (/铂/.test(m) ? '铂' : '币'));
  return '<div class="pm-ph" style="background:linear-gradient(145deg,' + bg + ',' + bg + 'cc)"><span>' + ch + '</span></div>';
}
/** 拉一页贵金属全量库（append=true 追加到现有列表） */
function loadPmFull(page, append){
  if (PM_FULL.loading) return Promise.resolve();
  PM_FULL.loading = true;
  var qs = '?page=' + page + '&pageSize=30';
  if (PM_FULL.q) qs += '&q=' + encodeURIComponent(PM_FULL.q);
  if (PM_FULL.project) qs += '&project=' + encodeURIComponent(PM_FULL.project);
  return fetch('/api/catalog/pm' + qs, { cache: 'no-store' })
    .then(function(r){ return r.ok ? r.json() : { items: [], total: 0, pages: 0 }; })
    .then(function(j){
      var items = Array.isArray(j.items) ? j.items : [];
      PM_FULL.items = append ? PM_FULL.items.concat(items) : items;
      PM_FULL.page = Number(j.page) || page;
      PM_FULL.pages = Number(j.pages) || 0;
      PM_FULL.total = Number(j.total) || 0;
      PM_FULL.loaded = true;
      PM_FULL.loading = false;
      renderPmFull();
      return j;
    })
    .catch(function(){ PM_FULL.loading = false; renderPmFull(); });
}
/** 重置并重新拉第一页 */
var PM_SERIES_LOADED = false;
/** 贵金属系列独立接口：绝对不能混用普通币的 series.json */
function loadPmSeries(cb){
  if (PM_SERIES_LOADED) { if (cb) cb(); return; }
  PM_SERIES_LOADED = true;
  fetch('/api/series?category=pm', { credentials:'same-origin' })
    .then(function(r){ return r.ok ? r.json() : null; })
    .then(function(j){
      if (j && j.ok && Array.isArray(j.items)) PM_SERIES = j.items;
      if (cb) cb();
    })
    .catch(function(){});
}

function resetPmFull(q, project){
  PM_FULL.items = []; PM_FULL.page = 0; PM_FULL.pages = 0; PM_FULL.total = 0;
  PM_FULL.q = q || ''; PM_FULL.project = project || ''; PM_FULL.loaded = false;
  return loadPmFull(1, false);
}
/** 渲染贵金属全量库清单（卡片网格 + 加载更多） */
function renderPmFull(){
  var box = document.getElementById('tbody'); if (!box) return;
  // 表格容器换成卡片区：pm 全量库用独立 DOM，避免污染普通清单的表头
  var tbox = box.closest('.tablebox'); if (tbox) tbox.style.display = 'none';
  var host = document.getElementById('pmFullBox');
  if (!host) {
    host = document.createElement('div'); host.id = 'pmFullBox'; host.className = 'pm-full';
    // 插在 .tablebox 之后、emptyTip 之前（表格外的合法位置）
    if (tbox && tbox.parentNode) tbox.parentNode.insertBefore(host, tbox.nextSibling);
    else box.parentNode.appendChild(host);
  }
  host.style.display = '';
  var opts = ['<option value="">全部项目</option>'].concat(PM_SERIES.map(function(s){
    return '<option value="' + esc(s.code) + '"' + (PM_FULL.project === s.code ? ' selected' : '') + '>' +
      esc(s.name) + '（' + s.count + '）</option>';
  })).join('');
  var head = '<div class="pm-full-bar"><span>贵金属纪念币 · 共 ' + (PM_FULL.total || '…') + ' 条</span>'
    + '<input id="pmFullQ" class="pm-full-q" type="search" placeholder="搜名称 / 编号" value="' + esc(PM_FULL.q) + '">'
    + '<select id="pmFullSeries" class="pm-full-q">' + opts + '</select></div>';
  if (!PM_FULL.loaded) { host.innerHTML = head + '<div class="pm-full-msg">正在加载贵金属目录…</div>'; return; }
  if (!PM_FULL.items.length) { host.innerHTML = head + '<div class="pm-full-msg">没有匹配的贵金属品种，换个关键词试试。</div>'; return; }
  var cards = PM_FULL.items.map(function(it){
    var owned = coll.some(function(c){ return c.category === 'pm' && c.id === it.code; });
    var meta = [it.year, it.material, it.weightG ? it.weightG + '克' : '', it.quality].filter(Boolean).join(' · ');
    return '<div class="pm-card" data-code="' + esc(it.code) + '">'
      + (it.thumb
          ? '<img class="pm-thumb" src="' + esc(it.thumb) + '" alt="' + esc(it.name) + '" loading="lazy">'
          : pmPlaceholder(it))
      + '<div class="pm-card-b"><div class="pm-card-t">' + esc(it.name) + '</div>'
      + '<div class="pm-card-m">' + esc(meta) + '</div>'
      + '<div class="pm-card-f">面额 ' + (it.face != null ? it.face + ' 元' : '—')
      + ' · 成色 ' + (it.fineness ? esc(it.fineness) + '%' : '—') + '</div>'
      + '<div class="pm-card-c">' + esc(it.code) + '</div>'
      + '<button type="button" class="pm-add' + (owned ? ' is-owned' : '') + '" data-addpm="' + esc(it.code) + '">' +
        (owned ? '✓ 已收藏 · 取消' : '＋ 收藏') + '</button></div></div>';
  }).join('');
  var more = (PM_FULL.page < PM_FULL.pages)
    ? '<button type="button" id="pmMore" class="pm-more">加载更多（' + PM_FULL.page + '/' + PM_FULL.pages + '）</button>'
    : '<div class="pm-full-end">已显示全部 ' + PM_FULL.total + ' 条</div>';
  host.innerHTML = head + '<div class="pm-grid">' + cards + '</div>' + more;
  // 绑定
  var qi = document.getElementById('pmFullQ');
  if (qi) qi.onchange = function(){ resetPmFull(this.value.trim(), PM_FULL.project); };
  var si = document.getElementById('pmFullSeries');
  if (si) si.onchange = function(){ resetPmFull(PM_FULL.q, this.value); };
  var mb = document.getElementById('pmMore');
  if (mb) mb.onclick = function(){ loadPmFull(PM_FULL.page + 1, true); };
  var ab = host.querySelector('.pm-add');
  if (ab) ab.onclick = null;
  host.onclick = host.onclick || function(e){
    var a = e.target.closest('[data-addpm]');
    if (a) {
      e.stopPropagation();
      var code = a.getAttribute('data-addpm');
      var hit = PM_FULL.items.filter(function(x){ return x.code === code; })[0];
      var it = hit || { code: code, name: code, thumb: '' };
      if (pmIsOwned(code)) {
        if (!window.confirm('把「' + (it.name || code) + '」从我的藏品里移出？')) return;
        for (var k = 0; k < coll.length; k++) {
          if (coll[k].category === 'pm' && coll[k].id === code) { coll.splice(k, 1); break; }
        }
        reRenderAll();
        a.className = 'pm-add'; a.textContent = '＋ 收藏';
        toast('已移出藏品');
      } else {
        if (!isLoggedIn()) { toast('请先登录再加入藏品'); return; }
        if (addPmHolding(it.code, it.name, it.thumb)) {
          a.className = 'pm-add is-owned'; a.textContent = '✓ 已收藏 · 取消';
          toast('已加入藏品');
        }
      }
      return;
    }
    var c = e.target.closest('.pm-card');
    if (c) showPmCard(c.getAttribute('data-code'));
  };
  Array.prototype.forEach.call(host.querySelectorAll('.pm-card'), function(c){
    c.onclick = null;
  });
  var et = document.getElementById('emptyTip'); if (et) et.style.display = 'none';
}
/** 点卡片 → 进入独立页面 /pm/<code>（不再是弹窗）；直达链接也能独立打开 */
function showPmCard(code){
  if (!code) return;
  goPm(code);
}

/** 贵金属单枚独立页：激活 pane、写历史、渲染，和普通币详情页同级的导航语义 */
function goPm(code, opts){
  opts = opts || {};
  code = String(code || '').toUpperCase();
  if (!/^[A-Za-z0-9_-]{1,32}$/.test(code)) { goTab('all'); return; }
  if (currentTab() === 'all') LAST_ALL_SCROLL = window.pageYOffset || 0;
  // 从分享/直达链接进入时，返回清单也要落在贵金属分类，而不是默认普通币
  VIEW_CATEGORY = 'pm';
  reportVisit('pm');
  activatePane('pm');
  if (opts.push !== false) {
    try {
      if (opts.replace) history.replaceState(null, '', pathOf('pm', code));
      else history.pushState(null, '', pathOf('pm', code));
    } catch (e) { location.assign(pathOf('pm', code)); }
  }
  syncSeo('pm');
  renderPmDetail(code);
  if (opts.scroll !== false) scrollToTop();
}

/** 渲染贵金属详情到 #pmBox：只用公告事实，不编造价格；失败给可点的重试/返回 */
function renderPmDetail(code){
  var box = document.getElementById('pmBox');
  if (!box) return;
  var fact = function(k, v){ return '<div class="cf"><i>' + k + '</i><b>' + esc(v || '—') + '</b></div>'; };
  var crumb = '<div class="coin-top">'
    + '<button type="button" class="btn ghost xs" data-goto="all">← 返回清单</button>'
    + '<span class="pm-crumb">首页 › 全套发行清单 › 贵金属 › <b>' + esc(code) + '</b></span></div>';
  box.innerHTML = crumb + '<div class="pm-page-loading">正在加载「' + esc(code) + '」的发行档案…</div>';

  fetch('/api/catalog/pm/' + encodeURIComponent(code), { credentials: 'same-origin' })
    .then(function(r){ return r.ok ? r.json() : null; })
    .then(function(j){
      // 用户可能已经切走；避免把旧请求结果写进别的页面
      if (currentPmCode() !== code) return;
      if (!j || !j.ok) { renderPmDetailError(code, (j && j.error) || '未找到该贵金属币'); return; }
      var d = j.item || {};
      var it = { code: code, name: d.name || code, thumb: d.thumbUrl || '', material: d.material };
      var isOwned = coll.some(function(c){ return c.category === 'pm' && c.id === code; });
      var figs = '';
      [['正面', d.frontUrl, d.frontDesc], ['背面', d.backUrl, d.backDesc]].forEach(function(pair){
        if (!pair[1] && !pair[2] && !(pair[0] === '正面' && d.thumbUrl)) return;
        var src = pair[1] || (pair[0] === '正面' ? d.thumbUrl : '');
        figs += '<figure class="pm-fig">' +
          (src
            ? '<img src="' + esc(src) + '" alt="' + pair[0] + '图案" loading="lazy" data-pmimg="' + esc(src) + '" onerror="this.style.display=\'none\'">'
            : '<div class="pm-fig-na">' + pmPlaceholder(it) + '</div>') +
          '<figcaption><b>' + pair[0] + '</b>' + (pair[2] ? '<span>' + esc(pair[2]) + '</span>' : '') + '</figcaption>' +
        '</figure>';
      });
      var more = [
        ['规格', d.spec], ['质量', d.quality],
        ['工艺', Array.isArray(d.craft) ? d.craft.join('、') : d.craft],
        ['铸造单位', d.castingUnit], ['设计', d.designer], ['雕刻', d.sculptor],
        ['题材', Array.isArray(d.theme) ? d.theme.join('、') : d.theme],
        ['系列', Array.isArray(d.series) ? d.series.join('、') : d.series]
      ].filter(function(x){ return x[1]; });
      var announce = String(d.announce || '').trim();
      var annHtml = announce
        ? '<details class="pm-announce"><summary>发行公告（' + announce.length + ' 字）</summary><div class="pm-ann-text">' + esc(announce) + '</div></details>'
        : '';
      var mvHtml = metalValueHtml(d.metalValue);

      box.innerHTML = crumb
        + '<article class="pm-page">'
        + '<header class="pm-page-h">' + pmPlaceholder(it)
        + '<div><h1>' + esc(it.name) + '</h1>'
        + '<p>' + esc(d.projectName || '') + (d.year ? ' · ' + esc(d.year) + ' 年' : '') + ' · 编号 ' + esc(code) + '</p></div></header>'
        + '<div class="pm-modal-facts" id="pmFacts">'
        + fact('编号', code) + fact('材质', d.material) + fact('克重', d.weight ? d.weight + ' 克' : '')
        + fact('面额', d.face != null ? d.face + ' 元' : '') + fact('成色', d.fineness ? d.fineness + '%' : '')
        + fact('最大发行量', d.circulation ? d.circulation + ' 枚' : '') + fact('质量', d.quality)
        + (mvHtml ? '<div class="pm-mv-wrap">' + mvHtml + '</div>' : '')
        + '</div>'
        + (figs ? '<div class="pm-figs">' + figs + '</div>' : '')
        + (more.length ? '<div class="pm-more-facts">' + more.map(function(x){ return fact(x[0], x[1]); }).join('') + '</div>' : '')
        + annHtml
        + '<div class="pm-detail-actions">'
        + '<button type="button" class="btn ' + (isOwned ? 'ghost pm-fav-owned' : 'primary') + '" data-pmfav="' + esc(code) + '">'
        + (isOwned ? '✓ 已在藏品 · 点此取消' : '＋ 加入我的藏品') + '</button>'
        + '<button type="button" class="btn ghost" data-pmcopy="' + SITE + pathOf('pm', code) + '">复制本页链接</button>'
        + '</div>'
        + '<p class="cd-empty">贵金属纪念币无稳定二级市场报价，本站不提供参考估值。</p>'
        + '<div class="pm-src">资料来源：中国人民银行发行公告 · 中国金币集团</div>'
        + '</article>';
      syncPmSeo(code, d);
      bindPmPageActions(box, code, it);
    })
    .catch(function(){ if (currentPmCode() === code) renderPmDetailError(code, '详情加载失败'); });
}

function renderPmDetailError(code, msg){
  var box = document.getElementById('pmBox');
  if (!box) return;
  box.innerHTML = '<div class="coin-top">'
    + '<button type="button" class="btn ghost xs" data-goto="all">← 返回清单</button></div>'
    + '<div class="pm-page-error"><h1>暂时看不到这枚币</h1><p>' + esc(msg) + '（' + esc(code) + '）</p>'
    + '<div class="pm-err-acts"><button type="button" class="btn primary" data-pmretry="' + esc(code) + '">重新加载</button>'
    + '<button type="button" class="btn ghost" data-goto="all">回到贵金属清单</button></div></div>';
  bindPmPageActions(box, code, { name: code, thumb: '' });
}

/** 当前贵金属是否已在我的藏品（与 addPmHolding 的判定同口径） */
function pmIsOwned(code){
  return coll.some(function(c){ return c.category === 'pm' && c.id === code; });
}

/** 已收藏 → 从账本移出（二次确认）；未收藏 → 加入。按钮即时切换，不刷新整页 */
function togglePmFav(code, it, btn){
  var owned = pmIsOwned(code);
  if (owned) {
    if (!window.confirm('把「' + (it.name || code) + '」从我的藏品里移出？')) return;
    for (var i = 0; i < coll.length; i++) {
      if (coll[i].category === 'pm' && coll[i].id === code) { coll.splice(i, 1); break; }
    }
    // 独立页只需持久化并更新本页按钮；不跑 reRenderAll（它会重建清单、
    // 在 pm 分类下还会额外请求贵金属目录，纯浪费且可能把卡片区插回 pane-all）
    saveState();
    renderKPI();
    btn.className = 'btn primary';
    btn.textContent = '＋ 加入我的藏品';
    toast('已移出藏品');
    return;
  }
  if (!isLoggedIn()) { toast('请先登录再加入藏品'); return; }
  if (addPmHolding(code, it.name, it.thumb, { light: true })) {
    btn.className = 'btn ghost pm-fav-owned';
    btn.textContent = '✓ 已在藏品 · 点此取消';
    toast('已加入藏品');
  }
}

/** 独立页内的图片放大 / 加入或取消藏品 / 重试 / 复制链接 */
function bindPmPageActions(box, code, it){
  box.onclick = function(e){
    var big = e.target.closest('[data-pmimg]');
    if (big) { window.open(big.getAttribute('data-pmimg'), '_blank', 'noopener'); return; }
    var fav = e.target.closest('[data-pmfav]');
    if (fav) { togglePmFav(code, it, fav); return; }
    var cp = e.target.closest('[data-pmcopy]');
    if (cp) {
      var url = cp.getAttribute('data-pmcopy');
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(url).then(function(){ toast('链接已复制'); })
          .catch(function(){ toast('复制失败，请手动复制地址栏'); });
      } else toast('请手动复制地址栏链接');
      return;
    }
    var retry = e.target.closest('[data-pmretry]');
    if (retry) renderPmDetail(code);
  };
}

/** 从贵金属模式切回时，恢复表格显示、藏起卡片区 */
function exitPmFull(){
  var box = document.getElementById('tbody');
  var tbox = box ? box.closest('.tablebox') : null; if (tbox) tbox.style.display = '';
  var host = document.getElementById('pmFullBox'); if (host) host.style.display = 'none';
  var pane = document.getElementById('pane-all');
  if (pane) {
    var tb = pane.querySelector('.toolbar'); if (tb) tb.style.display = '';
    var ls = pane.querySelector('.liststats'); if (ls) ls.style.display = '';
    var sh = pane.querySelector('.sec-head'); if (sh) {
      var t = sh.querySelector('#listCount');
      if (t) {
        var nc = DB.filter(function(d){ return d.kind !== 'note'; }).length;
        var nn = DB.filter(function(d){ return d.kind === 'note'; }).length;
        var y0 = DB.length ? Math.min.apply(null, DB.map(function(d){ return d.year; })) : 1984;
        var y1 = DB.length ? Math.max.apply(null, DB.map(function(d){ return d.year; })) : 2026;
        t.textContent = y0 + '—' + y1 + ' · 普通纪念币 ' + nc + ' 个品种 · 纪念钞 ' + nn + ' 个品种';
      }
      var hint = sh.querySelector('#listHint'); if (hint) hint.textContent = '点名称看详情';
    }
  }
}

/** 注入分段控件（不改 index.html，保证 SSR 的 HTML 基线逐字不变） */
function ensureCategoryTabs(){
  var pane = document.getElementById('pane-all');
  if (!pane || document.getElementById('catTabs')) return;
  var q = new URLSearchParams(location.search || '');
  var want = q.get('category');
  if (want === 'coin' || want === 'note' || want === 'pm') VIEW_CATEGORY = want;
  var box = document.createElement('div');
  box.className = 'cat-tabs'; box.id = 'catTabs';
  var cats = (CATEGORIES && CATEGORIES.categories) || [];
  if (!cats.length) cats = [
    { code:'coin', name:'普通纪念币', status:'active' },
    { code:'note', name:'纪念钞', status:'active' },
    { code:'pm', name:'贵金属', status:'active' }
  ];
  box.innerHTML = cats.map(function(x){
    var planned = x.status === 'planned';
    return '<button type="button" data-cat="' + x.code + '"' +
      (VIEW_CATEGORY === x.code ? ' class="on"' : '') +
      (planned ? ' class="planned" disabled title="即将上线"' : '') + '>' +
      esc(x.name || x.short || x.code) + (planned ? ' · 即将上线' : '') + '</button>';
  }).join('');
  pane.insertBefore(box, pane.querySelector('.toolbar'));
  box.onclick = function(e){
    var b = e.target.closest('[data-cat]'); if (!b || b.disabled) return;
    VIEW_CATEGORY = b.getAttribute('data-cat');
    Array.prototype.forEach.call(box.querySelectorAll('button'), function(x){ x.className = x === b ? 'on' : ''; });
    try {
      var u = new URL(location.href);
      if (VIEW_CATEGORY === 'coin') u.searchParams.delete('category'); else u.searchParams.set('category', VIEW_CATEGORY);
      history.replaceState(null, '', u.pathname + u.search);
    } catch (err) { /* 老浏览器忽略 */ }
    renderTable();
  };
}

/** 贵金属详情页：只有公告事实 + 规格表，绝不渲染价格/藏品/成本 */
function renderPmCoin(d, i){
  var box = document.getElementById('coinBox'); if (!box) return;
  var no = d.no;
  var fact = function(k, v){ return '<div class="cf"><i>' + esc(k) + '</i><b>' + esc(v) + '</b></div>'; };
  var rows = (d.pm && d.pm.pieces ? d.pm.pieces : []).map(function(p){
    return '<tr><td>' + p.seq + '</td><td>' + esc(p.name) + '</td><td>' + esc(p.metal) + '</td>'
      + '<td>' + p.weightG + ' 克</td><td>' + p.face + ' 元</td><td>' + p.maxMintage + ' 枚</td></tr>';
  }).join('');
  box.innerHTML = '<div class="coin-top"><button class="btn ghost xs" data-goto="all">← 返回清单</button>'
    + '<span class="muted">贵金属 · 第 ' + no + ' 号</span></div>'
    + '<div class="coin-hero"><div class="coin-media"><div class="coin-fig">'
      + '<img class="fig-main" src="' + imgMid(no) + '" alt="' + esc(d.name) + '" width="320" height="320"></div></div>'
    + '<div class="coin-main"><div class="coin-kicker">' + d.year + ' · 贵金属纪念币</div>'
      + '<h2 class="coin-title">' + esc(d.name) + '</h2>'
      + '<div class="coin-tags"><span class="tag-chip">全套 ' + (d.pm ? d.pm.setPieces : d.pieces) + ' 枚</span></div>'
      + '<div class="coin-facts">'
      + fact('整套面额合计', d.face + ' 元') + fact('材质', d.material || '—')
      + fact('成色', d.pm && d.pm.purity ? (d.pm.purity * 100).toFixed(1) + '%' : '—')
      + fact('总克重', d.pm && d.pm.setWeightG ? d.pm.setWeightG + ' 克' : '—')
      + fact('发行方式', d.pm && d.pm.issueMethod ? d.pm.issueMethod : '—')
      + fact('销售渠道', d.pm && d.pm.salesChannel ? d.pm.salesChannel : '—')
      + '</div></div></div>'
    + '<div class="coin-desc"><h3>套内规格（发行量单位：枚）</h3>'
      + '<table class="pm-pieces"><thead><tr><th>序号</th><th>名称</th><th>材质</th><th>克重</th><th>面额</th><th>最大发行量</th></tr></thead>'
      + '<tbody>' + rows + '</tbody></table>'
      + '<p class="cd-empty">贵金属纪念币无稳定二级市场报价，本站不提供参考估值。</p></div>';
  box.onclick = function(e){ var b = e.target.closest('[data-goto]'); if (b) goTab(b.getAttribute('data-goto')); };
}

function renderTable(){
  // 贵金属分段：走金币云集 2823 条全量库（分页接口），不走本地表格
  if (VIEW_CATEGORY === 'pm') {
    var pane = document.getElementById('pane-all');
    if (pane) {
      var tb = pane.querySelector('.toolbar'); if (tb) tb.style.display = 'none';
      var ls = pane.querySelector('.liststats'); if (ls) ls.style.display = 'none';
      var sh = pane.querySelector('.sec-head'); if (sh) {
        var t = sh.querySelector('#listCount'); if (t) t.textContent = '贵金属纪念币 · 2823 条';
        var h = sh.querySelector('#listHint'); if (h) h.textContent = '';
      }
    }
    loadPmSeries(function(){ renderPmFull(); });
    if (!PM_FULL.loaded) resetPmFull('', ''); else renderPmFull();
    return;
  }
  exitPmFull();
  var q = document.getElementById('q').value.trim().toLowerCase();
  var fs = document.getElementById('fSeries').value;
  var fy = document.getElementById('fYear').value;
  var onlyMine = document.getElementById('fMine').checked;

  var rows = activeCatalog().filter(function(d){
    if(q){
      var hay = (d.name + ' ' + d.year + ' ' + SERIES[d.series] + ' ' + d.material).toLowerCase();
      if(hay.indexOf(q) < 0) return false;
    }
    if(fs && (d.seriesKeys && d.seriesKeys.length ? d.seriesKeys : [d.series]).indexOf(fs) < 0) return false;
    if(fy && String(d.year) !== fy) return false;
    if(onlyMine && !isOwned(d.name)) return false;
    if(filterSet){
      if(filterSetIsSingle()){
        if(d.set && d.set !== 'single') return false;
        var singleKind = filterSetSingleKind();
        if(singleKind && (d.kind || 'coin') !== singleKind) return false;
      }
      else if(d.set !== filterSet) return false;
    }
    // 高级筛选：同维度内取并集，不同维度之间取交集
    if(fadvHas('face') && !FADV.face[String(d.face)]) return false;
    if(fadvHas('material') && !FADV.material[d.material]) return false;
    if(fadvHas('caster')){
      var tags = casterTags(d.caster);
      var hitTag = false;
      for(var ti = 0; ti < tags.length; ti++) if(FADV.caster[tags[ti]]) { hitTag = true; break; }
      if(!hitTag) return false;
    }
    if(FADV.mintage){
      var bucket = MINT_BUCKETS.filter(function(b){ return b.k === FADV.mintage; })[0];
      if(bucket && !bucket.test(Number(d.mintage) || 0)) return false;
    }
    return true;
  });

  // 年份排序（同年内保持清单原序）
  rows.sort(function(a, b){
    var d = a.year - b.year;
    if (d === 0) d = a.i - b.i;
    return sortDir === 'asc' ? d : -d;
  });

  var stats = setStats();
  var html = '';
  rows.forEach(function(d){
    if (d.category === 'precious_metal') {      var pidx = DB.length + PM_DB.indexOf(d);      html += '<tr class="pm" data-pm="' + d.no + '">'        + '<td class="y">' + d.year + '</td>'        + '<td class="nm"><a href="/coin/' + d.no + '">' + esc(d.name) + '</a><small>贵金属 · ' + esc(d.material || '') + '</small></td>'        + '<td><span class="tag PM">贵金属</span></td>'        + '<td class="price plain">全套 ' + d.face + ' 元</td>'        + '<td class="price">—</td><td class="price plain">全套 ' + (d.pm ? d.pm.setPieces : d.pieces) + ' 枚</td>'        + '<td class="mint">逐枚见详情</td><td>—</td></tr>';      return;    }    var own = isOwned(d.name);
    // 一套件数由套系声明：整卷 20 枚、整刀 20 张，多枚套币按发行套（如 3 枚）
    var isNote = d.kind === 'note';
    var sp = setPriceOf(d);
    var perSet = sp.size;
    var unit = isNote ? '张' : '枚';
    var setFace = sp.face;
    var setAi = aiPrice(d) * perSet;
    var setCell = '<b>' + perSet + '</b> <span class="unit">' + unit + '</span>' +
      '<span class="sub"><span class="sface">发行 ' + money(setFace) + '</span>' +
      '<span class="sest"> · 推理价 ' + money(setAi) + '</span></span>';
    html += '<tr class="' + (own?'mine':'') + '" data-i="' + d.i + '">' +
      '<td class="y">' + d.year + '</td>' +
      '<td class="nm"><span class="nmtext">' + esc(d.name) + '</span>' +
        '<button type="button" class="peek-btn" data-peek="' + d.i + '" ' +
          'aria-label="查看' + esc(d.name) + '的币面与发行信息" title="查看币面与发行信息">看图</button>' +
        '<small>' + (d.kind === 'note' ? '纪念钞 · ' : '') + esc(d.material) + '</small></td>' +
      '<td><span class="tag ' + d.series + '">' + SERIES[d.series] + '</span></td>' +
      '<td class="price plain">' + d.face + ' 元/' + (isNote ? '张' : '枚') + '</td>' +
      '<td class="price">' + money(aiPrice(d)) + '</td>' +
      '<td class="price plain setcell" title="' +
        (d.reserveLimit > 0
          ? ((isNote ? '整刀 20 张' : '整卷 20 枚') + '＝一套，每人限约 ' + d.reserveLimit + (isNote ? ' 张' : ' 枚') +
             '；发行价＝单件面额×' + setSizeOf(d) + '，推理价＝单件推理价×' + setSizeOf(d))
          : (setSizeOf(d) === 20
            ? ((isNote ? '整刀 20 张' : '整卷 20 枚') + '＝一套；发行价＝单件面额×20，推理价＝单件推理价×20')
            : ('一套 ' + setSizeOf(d) + ' ' + (isNote ? '张' : '枚') + '（发行即成套）；发行价＝单件面额×' + setSizeOf(d) + '，推理价＝单件推理价×' + setSizeOf(d)))) + '">' + setCell + '</td>' +
      '<td class="mint">' + fmMint(d.mintage) + (d.kind==='note'?'张':'枚') + '</td>' +
      '<td>' + (own
        ? '<span class="own">已藏</span>'
        : '<button class="add" data-add="' + d.name + '">+ 加入</button>') + '</td>' +
    '</tr>';
  });

  document.getElementById('tbody').innerHTML = html;
  var advBox = document.getElementById('fAdv');
  if (advBox && !advBox.hidden) renderAdvFilters();
  document.getElementById('emptyTip').style.display = rows.length ? 'none' : '';
  document.getElementById('cnt').textContent = coll.length;
  var fc = document.getElementById('filterCount');
  if (fc) fc.textContent = rows.length;
  syncSearchUI();
  syncSortHead();
  renderListStats(rows);
  hideTip();
}

/* 清单页顶部的「我的藏品」合计：总面值 / 推理价 / 浮动 */
function renderListStats(rows){
  var box = document.getElementById('listStats');
  if (!box) return;

  if (!isLoggedIn()) {
    box.innerHTML = '<span class="ls-empty">登录后可在这里看到你藏品的总面值与推理价</span>';
    return;
  }

  var r = calc();
  var face = r.main.face + r.sep.face;         // 含独立藏品（纪念钞）
  var market = r.main.market + r.sep.market;
  var cost = r.main.cost + r.sep.cost;
  var pnl = market - cost;
  var pnlCls = pnl > 0 ? 'up' : (pnl < 0 ? 'down' : '');

  var filtering = hasFilters();
  var shown = rows ? rows.length : 0;
  var ownedShown = rows ? rows.filter(function(d){ return isOwned(d.name); }).length : 0;

  box.innerHTML =
    '<div class="ls-main">' +
      '<span class="ls-tag">我的藏品</span>' +
      '<span class="ls-sub">' + (r.main.rolls + r.sep.rolls) + ' 项 · 含独立藏品</span>' +
    '</div>' +
    '<div class="ls-cells">' +
      '<div class="ls-cell"><i>总面值</i><b>' + money(face) + '</b></div>' +
      '<div class="ls-cell"><i>推理价合计</i><b class="gold">' + money(market) + '</b></div>' +
      '<div class="ls-cell"><i>浮动</i><b class="' + pnlCls + '">' +
        (pnl >= 0 ? '+' : '−') + money(Math.abs(pnl)) + '</b></div>' +
    '</div>' +
    (filtering
      ? '<div class="ls-filter">当前筛选 ' + shown + ' 个品种 · 其中已藏 ' + ownedShown + '</div>'
      : '');
}

/* =========================================================
   10.5 悬停币面预览
   ========================================================= */
var tipEl = null, tipFor = null;

function pad3(n){ return ('00' + n).slice(-3); }

function svgCoin(d){
  var g = 'cg' + d.i, arc = 'ca' + d.i;
  return '<svg viewBox="0 0 128 128" width="120" height="120">' +
    '<defs>' +
      '<radialGradient id="' + g + '" cx="34%" cy="26%" r="80%">' +
        '<stop offset="0" stop-color="#fdf8e0"/>' +
        '<stop offset="40%" stop-color="#e8c98a"/>' +
        '<stop offset="76%" stop-color="#bb9243"/>' +
        '<stop offset="100%" stop-color="#7a5f22"/>' +
      '</radialGradient>' +
      '<path id="' + arc + '" d="M 24 64 A 40 40 0 0 1 104 64" fill="none"/>' +
    '</defs>' +
    '<circle cx="64" cy="64" r="61" fill="#6b5320" opacity=".5"/>' +
    '<circle cx="64" cy="64" r="61" fill="none" stroke="#efdba6" stroke-width="5" stroke-dasharray="1.9 3.2"/>' +
    '<circle cx="64" cy="64" r="55" fill="url(#' + g + ')"/>' +
    '<circle cx="64" cy="64" r="47" fill="none" stroke="#6d5420" stroke-width=".9" stroke-dasharray="2.4 3.6" opacity=".45"/>' +
    '<text font-size="7.6" letter-spacing="1.6" fill="#6d5520" opacity=".9">' +
      '<textPath href="#' + arc + '" startOffset="50%" text-anchor="middle">中国人民银行</textPath>' +
    '</text>' +
    '<text x="64" y="77" text-anchor="middle" font-family="Songti SC,serif" font-size="30" font-weight="700" fill="#463410">' + d.face +
      '<tspan font-size="13" dx="2">元</tspan></text>' +
    '<text x="64" y="99" text-anchor="middle" font-size="9.5" letter-spacing="1.4" fill="#6d5520" opacity=".85">' + d.year + '</text>' +
  '</svg>';
}

function svgNote(d){
  var g = 'cn' + d.i;
  return '<svg viewBox="0 0 200 106" width="166" height="88">' +
    '<defs><linearGradient id="' + g + '" x1="0" y1="0" x2="1" y2="1">' +
      '<stop offset="0" stop-color="#5b7fa3"/><stop offset="46%" stop-color="#33506d"/><stop offset="100%" stop-color="#46688a"/>' +
    '</linearGradient></defs>' +
    '<rect x="1.5" y="1.5" width="197" height="103" rx="7" fill="url(#' + g + ')"/>' +
    '<rect x="1.5" y="1.5" width="197" height="103" rx="7" fill="none" stroke="rgba(200,225,255,.4)"/>' +
    '<rect x="10" y="10" width="180" height="86" rx="3.5" fill="none" stroke="rgba(195,220,250,.34)" stroke-dasharray="3.5 2.5"/>' +
    '<circle cx="40" cy="53" r="20" fill="none" stroke="rgba(210,232,255,.3)"/>' +
    '<text x="115" y="63" text-anchor="middle" font-family="Songti SC,serif" font-size="32" font-weight="700" fill="#eaf3ff">' + d.face +
      '<tspan font-size="13" dx="2">元</tspan></text>' +
    '<text x="115" y="85" text-anchor="middle" font-size="8.6" letter-spacing="1.2" fill="rgba(215,232,250,.72)">' + d.year + ' 年 · 纪念钞</text>' +
  '</svg>';
}

/* 兜底白名单（img/NNN.jpg，编号 = 清单序号，从 1 开始）
   正常走后端时以服务端扫描 img/ 目录下发的列表为准 */
var IMG_SET_FALLBACK = {68:1,73:1,74:1,75:1,76:1,77:1,78:1,79:1,80:1,81:1,82:1,
               84:1,85:1,87:1,88:1,89:1,91:1,92:1,93:1,94:1,95:1};
if (!Object.keys(IMG_SET).length) IMG_SET = IMG_SET_FALLBACK;

function buildTip(d){
  var no = d.i + 1;
  var hasImg = !!IMG_SET[no];
  var isReal = !!REAL_SET[no];
  var img = imgSmall(no);
  return '<div class="cvis' + (hasImg ? ' hasimg' : '') + '">' +
      (hasImg
        ? '<img class="realimg" src="' + img + '" alt="' + esc(d.name) + '币面图" ' +
          'width="126" height="126" decoding="async" loading="lazy" onerror="this.remove()">' +
          (isReal ? '' : '<span class="mockbadge">示意</span>')
        : (d.kind === 'note' ? svgNote(d) : svgCoin(d))) +
    '</div>' +
    '<div class="cinfo">' +
      '<div class="cname">' + d.name + '</div>' +
      '<div class="cser"><span class="tag ' + d.series + '">' + SERIES[d.series] + '</span></div>' +
      '<div class="ckv">' +
        '<div><span>面额</span><b>' + d.face + ' 元</b></div>' +
        '<div><span>发行量</span><b>' + fmMint(d.mintage) + (d.kind==='note'?'张':'枚') + '</b></div>' +
        '<div><span>材质</span><b>' + d.material + '</b></div>' +
        '<div><span>' + sizeLabel(d) + '</span><b>' + sizeText(d) + '</b></div>' +
      '</div>' +
      '<div class="cprice"><span>推理价 / 单' + (d.kind==='note'?'张':'枚') + '</span><b>' + money(aiPrice(d)) + '</b></div>' +
      '<div class="hint">' + (isReal ? '实物图案 · 中国人民银行发行公告' : '示意图 · 依据面额与发行信息生成') + '</div>' +
    '</div>';
}

function placeTip(e){
  if(!tipEl || !tipEl.classList.contains('on')) return;
  var w = tipEl.offsetWidth || 378;
  var h = tipEl.offsetHeight || 170;
  var pad = 14;
  var x = e.clientX + 18;
  var y = e.clientY - h / 2;
  if(x + w > window.innerWidth - pad) x = e.clientX - w - 18;
  if(x < pad) x = pad;
  if(y < pad) y = pad;
  if(y + h > window.innerHeight - pad) y = window.innerHeight - h - pad;
  tipEl.style.left = Math.round(x) + 'px';
  tipEl.style.top = Math.round(y) + 'px';
}

function hideTip(){
  if(!tipEl) return;
  tipEl.classList.remove('on');
  tipFor = null;
}

function bindTip(){
  tipEl = document.getElementById('ctip');
  var tbody = document.getElementById('tbody');

  tbody.addEventListener('mouseover', function(e){
    var td = e.target.closest('td.nm');
    if(!td) return;
    var tr = td.parentNode;
    if(tr === tipFor) return;
    var d = DB[Number(tr.getAttribute('data-i'))];
    if(!d) return;
    tipFor = tr;
    tipEl.innerHTML = buildTip(d);
    tipEl.classList.add('on');
    placeTip(e);
  });

  tbody.addEventListener('mousemove', function(e){
    if(tipFor) placeTip(e);
  });

  tbody.addEventListener('mouseout', function(e){
    var tr = e.target.closest('tr');
    if(!tr || tr !== tipFor) return;
    var to = e.relatedTarget;
    if(to && tr.contains(to)) return;
    hideTip();
  });
}

/* =========================================================
   10.6 触屏看图：桌面端的悬停卡片在手机上完全看不到，补齐这条路
   ========================================================= */
var peekTrigger = null;
function peekOpen(){
  var l = document.getElementById('peekLayer');
  return !!(l && l.classList.contains('on'));
}
function openPeek(i){
  var d = DB[i];
  var layer = document.getElementById('peekLayer');
  var body = document.getElementById('peekBody');
  if (!d || !layer || !body) return;
  peekTrigger = document.activeElement;
  body.innerHTML = buildTip(d);
  layer.classList.add('on');
  layer.setAttribute('aria-hidden', 'false');
  document.body.classList.add('peek-open');
  var close = layer.querySelector('.peek-close');
  if (close) close.focus();
}
function closePeek(){
  var layer = document.getElementById('peekLayer');
  if (!layer) return;
  layer.classList.remove('on');
  layer.setAttribute('aria-hidden', 'true');
  document.body.classList.remove('peek-open');
  if (peekTrigger && peekTrigger.isConnected && peekTrigger.focus) {
    try { peekTrigger.focus(); } catch (e) {}
  }
  peekTrigger = null;
}
function initPeek(){
  var layer = document.getElementById('peekLayer');
  if (!layer) return;
  layer.addEventListener('click', function(e){
    if (e.target.closest('[data-peek-close]')) closePeek();
  });
}

/* =========================================================
   10. 交互
   ========================================================= */
function reRenderAll(){
  saveState();
  renderKPI();
  renderHoldings();
  renderSets();
  renderSeries();
  renderCost();
  renderTable();
  renderHome();
  hardenInputs();
}

document.getElementById('holdingsBox').addEventListener('click', function(e){
  var nmEl = e.target.closest('.name[data-coin]');
  if (nmEl) { goCoin(parseInt(nmEl.getAttribute('data-coin'), 10)); return; }

  /* ---- 藏品增强交互 ---- */
  var ex = e.target.closest('[data-ex-act]');
  if (ex) {
    var exAct = ex.getAttribute('data-ex-act');
    var exName = ex.getAttribute('data-name');
    var exIdx = findHoldingIdx(exName);
    if (exIdx >= 0) {
      if (exAct === 'form-set' || exAct === 'form-single') {
        coll[exIdx].form = exAct === 'form-single' ? 'single' : '';
        saveState(); renderHoldings(); return;
      }
      if (exAct === 'img-del') {
        var ii = Number(ex.getAttribute('data-idx'));
        if (Array.isArray(coll[exIdx].images)) coll[exIdx].images.splice(ii, 1);
        saveState(); renderHoldings(); return;
      }
      if (exAct === 'share') { openShareDialog(exName); return; }
    }
  }
  var btn = e.target.closest('button[data-act]');
  if(!btn) return;
  var name = btn.getAttribute('data-name');
  var act = btn.getAttribute('data-act');
  var idx = -1;
  for(var i=0;i<coll.length;i++){ if(coll[i].name===name){ idx=i; break; } }
  if(idx < 0) return;

  if(act === 'plus'){
    var d = findDB(name);
    var unitCost = coll[idx].rolls ? (Number(coll[idx].cost)||0)/coll[idx].rolls : (d ? (d.kind==='note'?d.face:d.face*20) : 0);
    var unitMarket = coll[idx].rolls ? (Number(coll[idx].market)||0)/coll[idx].rolls : unitCost;
    coll[idx].rolls += 1;
    coll[idx].cost = Math.round((Number(coll[idx].cost)||0) + unitCost);
    coll[idx].market = Math.round((Number(coll[idx].market)||0) + unitMarket);
    reRenderAll();
  } else if(act === 'minus'){
    if(coll[idx].rolls <= 1) return;
    var uC = (Number(coll[idx].cost)||0) / coll[idx].rolls;
    var uM = (Number(coll[idx].market)||0) / coll[idx].rolls;
    coll[idx].rolls -= 1;
    coll[idx].cost = Math.round((Number(coll[idx].cost)||0) - uC);
    coll[idx].market = Math.round((Number(coll[idx].market)||0) - uM);
    reRenderAll();
  } else if(act === 'del'){
    coll.splice(idx,1);
    reRenderAll();
  }
});

document.getElementById('holdingsBox').addEventListener('input', function(e){
  var inp = e.target;
  if(inp.tagName !== 'INPUT' || !inp.getAttribute('data-field')) return;
  var name = inp.getAttribute('data-name');
  var field = inp.getAttribute('data-field');
  var raw = Number(inp.value);
  // 浏览器自动填充 / 滚轮误改都可能塞进非法值，这里统一收敛，不写坏账目
  var val = isFinite(raw) ? Math.max(0, Math.min(1e8, Math.round(raw))) : 0;
  for(var i=0;i<coll.length;i++){
    if(coll[i].name === name){
      coll[i][field] = val;
      break;
    }
  }
  saveState();
  renderKPI();
  renderSets();
  // 局部更新浮动
  var item = coll.filter(function(c){ return c.name===name; })[0];
  var pnlEl = document.querySelector('[data-pnl="' + name + '"]');
  if(item && pnlEl){
    var p = (Number(item.market)||0) - (Number(item.cost)||0);
    pnlEl.textContent = (p>=0?'+':'-') + money(Math.abs(p));
    pnlEl.className = p>=0 ? 'gain' : 'loss';
  }
});

/* 号码输入：textarea 输入即存 + 即时刷新花样标签 */
document.getElementById('holdingsBox').addEventListener('input', function(e){
  var ta = e.target;
  if (ta.tagName !== 'TEXTAREA' || ta.getAttribute('data-field-ex') !== 'serials') return;
  var name = ta.getAttribute('data-name');
  var nos = ta.value.split(/[\n,，\s]+/).map(function(s){ return s.trim(); }).filter(Boolean).slice(0, 200);
  var idx = findHoldingIdx(name);
  if (idx < 0) return;
  coll[idx].serials = nos;
  saveState();
  var lucky = document.querySelector('[data-lucky="' + name + '"]');
  if (lucky) lucky.innerHTML = '<span class="hx-label">花样</span>' + (luckyTagsHtml(nos) || '<span class="hx-muted">普通号</span>');
});

/* 图片上传：走 /api/holding/image，base64 落盘，成功后回写 holding */
document.getElementById('holdingsBox').addEventListener('change', function(e){
  var inp = e.target;
  if (inp.tagName !== 'INPUT' || !inp.getAttribute('data-ex-file')) return;
  var name = inp.getAttribute('data-ex-file');
  var file = inp.files && inp.files[0];
  if (!file) return;
  if (file.size > 2 * 1024 * 1024) { if (window.toast) toast('图片不能超过 2MB'); return; }
  var reader = new FileReader();
  reader.onload = function(){
    api('/api/holding/image', { method: 'POST', body: { image: reader.result } }).then(function(r){
      if (!r || !r.ok) throw new Error((r && r.error) || '上传失败');
      var idx = findHoldingIdx(name);
      if (idx < 0) return;
      if (!Array.isArray(coll[idx].images)) coll[idx].images = [];
      if (coll[idx].images.length >= 3) { if (window.toast) toast('最多 3 张图片'); return; }
      coll[idx].images.push(r.path);
      saveState(); renderHoldings();
    }).catch(function(err){ if (window.toast) toast(err.message || '上传失败'); });
  };
  reader.readAsDataURL(file);
  inp.value = '';
});

function findHoldingIdx(name){
  for (var i = 0; i < coll.length; i++) if (coll[i].name === name) return i;
  return -1;
}

/**
 * 把某个品种加入我的藏品。
 * unit='set' 按整套/整卷记；unit='piece' 按单枚（单张）记。
 * 按枚时成本按单枚面额起算，rolls 表示件数。
 */
/* 贵金属入账本：不参与旧一套的「按卷/估值」口径，按枚记，成本留空由用户自己填 */
function addPmHolding(code, name, thumb, opts){
  if (!code || !name) return false;
  for (var i = 0; i < coll.length; i++) {
    if (coll[i].category === 'pm' && coll[i].id === code) return false;
  }
  coll.push({
    id: code, name: name, category: 'pm', thumb: thumb || '',
    rolls: 1, unit: 'piece', cost: 0, market: 0, group: '贵金属'
  });
  rebuildGroupOrder();
  // 独立页传 {light:true}：只持久化 + 更新统计，不重建清单
  if (opts && opts.light) { saveState(); renderKPI(); } else reRenderAll();
  return true;
}

function addHolding(name, unit, qty){
  var d = findDB(name);
  if (!d || isOwned(name)) return false;
  var up = unitPrice(d);
  var size = holdingUnitSize(d);
  var isPiece = unit === 'piece' && size > 1;
  var n = Math.floor(Number(qty) || 1);
  n = Math.max(1, Math.min(9999, n));
  var unitPriceOne = isPiece ? up.face : up.face * size;
  coll.push({
    name: name,
    rolls: n,
    unit: isPiece ? 'piece' : 'set',
    cost: unitPriceOne * n,
    market: unitPriceOne * n,
    group: groupOf(d)
  });
  rebuildGroupOrder();
  reRenderAll();
  return true;
}

/** 多枚一套的品种：先让用户决定按套还是按单枚，避免自动塞进一整卷 */
function requestAddHolding(name, after){
  var d = findDB(name);
  if (!d || isOwned(name)) return;
  // 访客点「+ 加入」不能假成功：旧逻辑把它塞进本机 coll、弹「已加入」，
  // 但「我的藏品」入口对访客隐藏、注册后又被空账本覆盖 —— 记了等于没记。
  // 改成引导去登录，并记住这一枚，注册后落到空账本时置顶让它一点即入。
  if (!isLoggedIn()) { showGuestAddGuide(name); return; }
  var size = holdingUnitSize(d);
  function done(unit, qty){
    if (addHolding(name, unit, qty)) {
      if (pendingGuestAdd === name) pendingGuestAdd = null;
      toast('已加入「' + name + '」× ' + qty + (unit === 'piece' ? ' 枚' : ''));
      if (after) after();
    }
  }
  showAddUnitChooser(d, size, done);
}

/** 访客「+ 加入」的登录引导：说清为什么要登录，并带上刚想记的品种名。
 *  两个按钮都落到账户页、切到对应表单；品种名存进 pendingGuestAdd，
 *  注册成功后 emptyLedgerHtml 把它排在快速添加卡第一位。 */
function showGuestAddGuide(name){
  pendingGuestAdd = name;
  var old = document.getElementById('guestAddMask');
  if (old && old.parentNode) old.parentNode.removeChild(old);
  var mask = document.createElement('div');
  mask.id = 'guestAddMask';
  mask.className = 'au-mask';
  mask.innerHTML =
    '<div class="au-sheet" role="dialog" aria-modal="true" aria-label="登录后记录藏品">' +
      '<b>记下「' + esc(name) + '」</b>' +
      '<p>藏品要存进你自己的账本，换设备登录也在。免费注册只要用户名 + 密码。</p>' +
      '<button type="button" data-guest-go="register">免费注册并记下这枚</button>' +
      '<button type="button" data-guest-go="login">已有账号，去登录</button>' +
      '<button type="button" class="au-x" data-guest-go="cancel">再看看</button>' +
    '</div>';
  document.body.appendChild(mask);
  mask.onclick = function(e){
    var b = e.target.closest('[data-guest-go]');
    if (!b) return;
    var act = b.getAttribute('data-guest-go');
    if (mask.parentNode) mask.parentNode.removeChild(mask);
    if (act === 'cancel') { if (pendingGuestAdd === name) pendingGuestAdd = null; return; }
    goTab('account');
    showAuthMode(act);
  };
  document.addEventListener('keydown', function escKey(e){
    if (e.key === 'Escape') {
      var m = document.getElementById('guestAddMask');
      if (m && m.parentNode) m.parentNode.removeChild(m);
      document.removeEventListener('keydown', escKey);
    }
  });
}

function showAddUnitChooser(d, size, cb){
  var old = document.getElementById('addUnitMask');
  if (old && old.parentNode) old.parentNode.removeChild(old);
  var u = d.kind === 'note' ? '张' : '枚';
  var mask = document.createElement('div');
  mask.id = 'addUnitMask';
  mask.className = 'au-mask';
  mask.innerHTML =
    '<div class="au-sheet" role="dialog" aria-modal="true">' +
      '<b>怎么记这一笔？</b>' +
      '<p>' + esc(d.name) + '</p>' +
      '<div class="au-qty"><span>数量</span>' +
        '<button type="button" data-step="-1" aria-label="减少">−</button>' +
        '<input id="auQty" type="number" min="1" max="9999" step="1" value="1" inputmode="numeric">' +
        '<button type="button" data-step="1" aria-label="增加">＋</button>' +
      '</div>' +
      '<div class="au-hint" id="auHint"></div>' +
      (size > 1
        ? '<button type="button" data-u="set">按套记 <i>每套 ' + size + ' ' + u + '</i></button>' +
          '<button type="button" data-u="piece">按单' + u + '记 <i>1 个就是 1 ' + u + '</i></button>'
        : '<button type="button" data-u="set">加入 <i>每份 1 ' + u + '</i></button>') +
      '<button type="button" class="au-x">取消</button>' +
    '</div>';
  document.body.appendChild(mask);

  var qtyEl = mask.querySelector('#auQty');
  var hint = mask.querySelector('#auHint');
  function qty(){
    var n = Math.floor(Number(qtyEl.value) || 1);
    return Math.max(1, Math.min(9999, n));
  }
  function syncHint(){
    var n = qty();
    hint.textContent = size > 1
      ? n + ' 份 · 按套 = ' + (n * size) + ' ' + u + '，按单' + u + ' = ' + n + ' ' + u
      : n + ' ' + u;
  }
  syncHint();
  qtyEl.addEventListener('input', syncHint);
  qtyEl.focus();
  qtyEl.select();

  function close(){ if (mask.parentNode) mask.parentNode.removeChild(mask); }
  mask.addEventListener('click', function(e){
    var step = e.target.closest('[data-step]');
    if (step) {
      qtyEl.value = Math.max(1, Math.min(9999, qty() + Number(step.getAttribute('data-step'))));
      syncHint();
      return;
    }
    var btn = e.target.closest('[data-u]');
    if (btn) { var n = qty(); close(); cb(btn.getAttribute('data-u'), n); return; }
    if (e.target === mask || e.target.closest('.au-x')) close();
  });
  document.addEventListener('keydown', function escKey(e){
    if (e.key === 'Escape') { close(); document.removeEventListener('keydown', escKey); }
  });
}

document.getElementById('tbody').addEventListener('click', function(e){
  var pb = e.target.closest('button[data-peek]');
  if (pb) { openPeek(Number(pb.getAttribute('data-peek'))); return; }
  if (e.target.closest('button[data-add]')) {
    var b = e.target.closest('button[data-add]');
    requestAddHolding(b.getAttribute('data-add'));
    return;
  }
  // 点名称进详情
  var nm = e.target.closest('td.nm');
  if (nm) {
    var row = nm.parentNode;
    if (row && row.getAttribute('data-i') !== null) goCoin(parseInt(row.getAttribute('data-i'), 10));
  }
});

/* 空账本里的「＋ 加入」按钮。监听挂在容器上（renderHoldings 只换 innerHTML，
   容器本身不重建），所以加完一枚、列表重渲染后依然有效。 */
document.getElementById('holdingsBox').addEventListener('click', function(e){
  var b = e.target.closest('button[data-empty-add]');
  if (!b) return;
  var name = b.getAttribute('data-empty-add');
  requestAddHolding(name);
});

/* ---------- 清单筛选：输入防抖 / 一键清空 / 结果反馈 ---------- */
var qTimer = null;
function hasFilters(){
  return !!(
    document.getElementById('q').value.trim() ||
    document.getElementById('fSeries').value ||
    document.getElementById('fYear').value ||
    document.getElementById('fMine').checked ||
    filterSet ||
    fadvAny()
  );
}
function syncSearchUI(){
  var q = document.getElementById('q');
  var qc = document.getElementById('qClear');
  if (qc) qc.hidden = !q.value;
  var cf = document.getElementById('clearFilters');
  if (cf) cf.hidden = !hasFilters();
}
function clearAllFilters(){
  document.getElementById('q').value = '';
  document.getElementById('fSeries').value = '';
  document.getElementById('fYear').value = '';
  document.getElementById('fMine').checked = false;
  filterSet = '';
  FADV = { face: {}, material: {}, caster: {}, mintage: '' };
  syncSetFilter();
  renderTable();
}
function scheduleTable(){
  if (qTimer) clearTimeout(qTimer);
  qTimer = setTimeout(function(){ qTimer = null; renderTable(); }, 120);
}

['q','fSeries','fYear','fMine'].forEach(function(id){
  var el = document.getElementById(id);
  var isText = el.tagName === 'INPUT' && el.type === 'text';
  el.addEventListener(isText ? 'input' : 'change', function(){
    if (isText) scheduleTable(); else renderTable();
  });
});

var qClearBtn = document.getElementById('qClear');
if (qClearBtn) qClearBtn.addEventListener('click', function(){
  var q = document.getElementById('q');
  q.value = '';
  if (qTimer) { clearTimeout(qTimer); qTimer = null; }
  renderTable();
  q.focus();
});
['clearFilters','emptyClear'].forEach(function(id){
  var b = document.getElementById(id);
  if (b) b.addEventListener('click', clearAllFilters);
});

// 年份排序：鼠标点击与键盘回车 / 空格都可切换
function toggleYearSort(){
  sortDir = sortDir === 'asc' ? 'desc' : 'asc';
  renderTable();
}
var sortHead = document.getElementById('sortYear');
sortHead.addEventListener('click', toggleYearSort);
sortHead.addEventListener('keydown', function(e){
  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleYearSort(); }
});

/* 快捷键：清单页按 / 聚焦搜索，Esc 清空搜索或关闭看图弹层 */
document.addEventListener('keydown', function(e){
  var t = e.target;
  var typing = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' ||
                     t.tagName === 'SELECT' || t.isContentEditable);
  if (e.key === 'Escape') {
    if (peekOpen()) { closePeek(); return; }
    var q = document.getElementById('q');
    if (q && document.activeElement === q && q.value) {
      q.value = '';
      if (qTimer) { clearTimeout(qTimer); qTimer = null; }
      renderTable();
      q.blur();
    }
    return;
  }
  if (e.key === '/' && !typing && !e.ctrlKey && !e.metaKey && !e.altKey && currentTab() === 'all') {
    var qEl = document.getElementById('q');
    if (qEl) { e.preventDefault(); qEl.focus(); qEl.select(); }
  }
});

/* =========================================================
   11. 同步状态 / 提示
   ========================================================= */
var SYNC_TEXT = {
  saving:  ['同步中…', 'busy'],
  synced:  ['已同步', 'ok'],
  error:   ['同步失败', 'err'],
  local:   ['未保存·仅本机', 'warn'],
  guest:   ['未登录', 'warn'],
  readonly:['只读', 'warn'],
  offline: ['离线模式', 'warn']
};

function setSync(state, detail){
  var el = document.getElementById('syncState');
  if (!el) return;
  var s = SYNC_TEXT[state] || SYNC_TEXT.offline;
  el.className = 'sync ' + s[1];
  el.textContent = s[0];
  el.title = detail || (APP.online ? ('数据源 ' + APP.source + ' · rev ' + APP.rev) : '未能连接后端');
  // 失败态本身就是可点的重试入口，不用让用户刷新整个页面
  if (state === 'error') {
    el.setAttribute('role', 'button');
    el.tabIndex = 0;
    el.title = (detail ? detail + ' · ' : '') + '点击重试同步';
  } else {
    el.setAttribute('role', 'status');
    el.removeAttribute('tabindex');
  }
}

function initSyncRetry(){
  var el = document.getElementById('syncState');
  if (!el) return;
  var retry = function(e){
    if (e.type === 'keydown' && e.key !== 'Enter' && e.key !== ' ') return;
    if (!el.classList.contains('err')) return;
    e.preventDefault();
    if (!isLoggedIn()) { toast('请先登录再重试同步'); return; }
    APP.saving = false;
    APP.pending = true;
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(flushSave, 50);
    toast('正在重新同步…');
  };
  el.addEventListener('click', retry);
  el.addEventListener('keydown', retry);
}

var toastTimer = null;
function toast(msg){
  var el = document.getElementById('toast');
  if (!el) return;
  el.textContent = msg;
  el.classList.add('on');
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(function(){ el.classList.remove('on'); }, 2400);
}

function esc(s){
  return String(s == null ? '' : s).replace(/[&<>"']/g, function(c){
    return { '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c];
  });
}

/** 贵金属克重价展示块：按实时金银价 × 成色净重算材料价值 */
function metalValueHtml(mv){
  if (!mv || mv.value == null || !(mv.pureGram > 0)) return '';
  var tip = '按今日' + esc(mv.name) + ' ¥' + mv.cnyPerGram + '/克 × 净重 ' + mv.pureGram + ' 克（' + mv.grossGram + ' 克 × 成色 ' + mv.fineness + '%）';
  return '<div class="mv-box"><div class="mv-row"><i>克重价</i><b>≈ ¥' + money(mv.value) + '</b><span>' + esc(mv.name) + ' ¥' + mv.cnyPerGram + '/克</span></div>'
    + '<div class="mv-tip">' + tip + '。仅材料价值，不含铸造成本与纪念溢价，随行情浮动，仅供参考。</div></div>';
}

/* ---------------------------------------------------------
   发行信息富文本（轻量标记 → 安全 HTML）
   数据侧只产出两种标记：空行分段、**加粗**（见 tools/format_desc.js）。
   这里先整段 esc 再做替换，页面上没有任何「未经转义就被当 HTML 解析」的路径，
   所以即使将来数据里混进 <script> 也只会被显示成文字。
   --------------------------------------------------------- */
function renderDescMd(md){
  if (!md) return '';
  var blocks = String(md).split(/\n{2,}/);
  var out = [];
  blocks.forEach(function(block){
    if (!block.trim()) return;
    // 列表块：每行以 "- " 开头
    if (/^-\s/.test(block.trim())) {
      var items = block.split(/\n/).filter(function(l){ return l.trim(); }).map(function(l){
        return '<li>' + esc(l.replace(/^-\s*/, '')) + '</li>';
      }).join('');
      out.push('<ul class="cd-list">' + items + '</ul>');
      return;
    }
    var t = esc(block).replace(/\n/g, '<br>');
    t = t.replace(/\*\*([^*]{1,40})\*\*/g, '<strong>$1</strong>');
    out.push('<p class="cd-text">' + t + '</p>');
  });
  return out.join('');
}
function fmtDate(v){
  if (!v) return '—';
  var d = new Date(v);
  if (isNaN(d.getTime())) return '—';
  return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
}
/** 管理端要分辨「今天谁先注册」，只到日期不够用；当天显示「今天 19:12」，其余显示「11-08 19:12」 */
function fmtDateTime(v){
  if (!v) return '—';
  var d = new Date(v);
  if (isNaN(d.getTime())) return '—';
  var now = new Date();
  var hm = String(d.getHours()).padStart(2,'0') + ':' + String(d.getMinutes()).padStart(2,'0');
  var sameDay = d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
  if (sameDay) return '今天 ' + hm;
  var sameYear = d.getFullYear() === now.getFullYear();
  var md = String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
  return (sameYear ? md : d.getFullYear() + '-' + md) + ' ' + hm;
}

/* =========================================================
   12. 页签切换
   ========================================================= */
var TABS = ['home','plan','all','series','holdings','plaza','account','admin','myfeedback','sitemap'];

/* 访客记录：会话 ID 存在 sessionStorage（关掉标签页算新访客） */
function visitSid(){
  var sid = '';
  try { sid = sessionStorage.getItem('cl_vsid') || ''; } catch (e) {}
  if (!/^[A-Za-z0-9_-]{8,40}$/.test(sid)) {
    sid = 'w' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
    try { sessionStorage.setItem('cl_vsid', sid); } catch (e) {}
  }
  return sid;
}
function reportVisit(tab){
  try {
    fetch('/api/visit', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sid: visitSid(), tab: tab || 'home', path: location.pathname + location.hash }),
      keepalive: true,
      credentials: 'same-origin'
    }).catch(function(){});
  } catch (e) {}
}   // 概览/收齐成本已并入「我的藏品」
var TAB_ALIAS = { overview: 'holdings', cost: 'holdings' };  // 旧链接兼容
// 需要登录才能查看的页签（未登录时连入口都不展示）
// series 原本也在这里，但系列页展示的是公开数据的套系分组（全套 N 枚、整套推理价），
// 未登录时个人进度显示 0 完全可用 —— 首页「全部系列 →」把人送到登录页反而劝退首次来访。
// cost 同理：三张卡里「整卷收齐」「单枚收齐」只用全站发行数据，跟账本无关，
// 只有「你要补的」才需要账号。收齐要花多少钱是访客最想知道的一个数，别用登录墙挡住。
var GATED = ['holdings'];

/* ---------- 路由：真实路径，不用 #hash ----------
 * #/coin/12 这种地址搜索引擎基本不收录（# 之后的内容根本不会发给服务器），
 * 所以改成 /coin/12、/all、/series，由 Nginx + 后端一起兜住并注入页面级 meta。
 * 老链接（#/coin/12）打开时会自动换成 /coin/12，外链不会失效。
 */
function pathOf(tab, arg){
  if (tab === 'coin') return '/coin/' + (Number(arg) + 1);
  if (tab === 'pm') return '/pm/' + String(arg || '').toUpperCase();
  if (!tab || tab === 'home') return '/';
  return '/' + tab;
}
function routeParts(){
  var p = String(location.pathname || '/').replace(/\/{2,}/g, '/').replace(/\/+$/, '');
  if (!p) p = '/';
  var m = p.match(/^\/coin\/(\d{1,3})$/);
  if (m) return { tab: 'coin', coin: parseInt(m[1], 10) - 1, code: null };
  // 贵金属单枚独立页：/pm/G19790101（code 为纯字母数字，与 /api/catalog/pm/:code 一致）
  var pm = p.match(/^\/pm\/([A-Za-z0-9_-]{1,32})$/);
  if (pm) return { tab: 'pm', coin: null, code: pm[1].toUpperCase() };
  if (p === '/' || p === '/home' || p === '/index.html') return { tab: 'home', coin: null, code: null };
  var name = p.slice(1);
  return { tab: TABS.indexOf(name) >= 0 ? name : 'home', coin: null, code: null };
}
/** 老 hash 链接 → 真实路径；没有 hash 返回 null */
function legacyPath(){
  var h = String(location.hash || '');
  if (!/^#\//.test(h)) return null;
  var raw = h.replace(/^#\/?/, '').trim();
  var m = raw.match(/^coin\/(\d{1,3})$/);
  if (m) return '/coin/' + parseInt(m[1], 10);
  var pm = raw.match(/^pm\/([A-Za-z0-9_-]{1,32})$/);
  if (pm) return '/pm/' + pm[1].toUpperCase();
  return TABS.indexOf(raw) >= 0 ? pathOf(raw) : '/';
}
function currentTab(){ return routeParts().tab; }
function currentCoin(){ return routeParts().coin; }
function currentPmCode(){ return routeParts().code; }

/* JS 路由如果不跟着改 title / description / canonical，抓取端看到的全站都是同一个标题，
 * 收录价值等于零。这里按路由重写这四样。 */
var SITE = 'https://coin.virtualman.top';
var TAB_SEO = {
  home:    ['藏币录 · 1984—2026 纪念币收藏管理与发行清单', '1984—2026 年中国普通纪念币与纪念钞全景档案：{n} 个品种的发行信息、币面实物图、套系进度，以及属于你自己的收藏账本。'],
  all:     ['全套发行清单 · 1984—2026 普通纪念币与纪念钞 | 藏币录', '按年份排列的 {n} 个普通纪念币、纪念钞品种清单，含面额、发行量、材质与单枚／整套推理价。'],
  series:  ['按系列看套系进度 | 藏币录', '把 {n} 个品种归入 {s} 个系列，一眼看出每个系列还差哪几枚。'],
  overview:['收藏概览 | 藏币录', '品种数、套系完成度、面值、推理价与成本的汇总视图。'],
  cost:    ['收齐成本估算 | 藏币录', '按单枚与整套两种口径，估算把全套收齐需要多少钱。'],
  holdings:['我的藏品 | 藏币录', '记录持仓数量、成本，自动汇总面值与推理价。'],
  plaza:   ['藏品广场 | 藏币录', '晒出你的纪念钞靓号藏品，识别豹子号、连号等花样，和藏友交流。'],
  account: ['账户 | 藏币录', '登录、注册与账户设置。'],
  myfeedback: ['我的反馈 | 藏币录', '查看自己提交的纠错与建议，以及管理员的处理结果与回复。'],
  sitemap: ['站点地图 | 藏币录', '藏币录全部页面与 136 个纪念币/纪念钞品种的索引，按系列分类。'],
  plan:    ['发行计划 | 藏币录', '中国人民银行普通纪念币（钞）年度发行计划：哪些已发行、哪些待发行，含预约与发行日期。'],
  admin:   ['管理端 | 藏币录', '管理员后台：用户、参数、图片与反馈。']
};
function setAttr(sel, attr, val){
  var el = document.querySelector(sel);
  if (el) el.setAttribute(attr, val);
}
/** 贵金属单枚页：详情异步返回后按真实字段重写 title/desc/canonical（含来源，不写价格） */
function syncPmSeo(code, d){
  var path = pathOf('pm', code);
  var name = (d && d.name) || code;
  var year = (d && d.year) || '';
  var proj = (d && d.projectName) ? '，属于「' + d.projectName + '」项目' : '';
  var material = (d && d.material) ? '，材质 ' + d.material : '';
  var weight = (d && d.weight) ? '，克重 ' + d.weight : '';
  var face = (d && d.face != null) ? '，面额 ' + d.face + ' 元' : '';
  var title = name + (year ? '（' + year + ' 贵金属纪念币）' : '') + ' 编号 ' + code + ' | 藏币录';
  var desc = (year ? year + ' 年发行的' : '') + '贵金属纪念币「' + name + '」' + proj + material + weight + face
    + '。发行信息以中国人民银行公告为准，本站不提供参考估值。';
  document.title = title;
  setAttr('meta[name="description"]', 'content', desc);
  setAttr('meta[property="og:title"]', 'content', title);
  setAttr('meta[property="og:description"]', 'content', desc);
  setAttr('meta[property="og:url"]', 'content', SITE + path);
  setAttr('link[rel="canonical"]', 'href', SITE + path);
}

function syncSeo(tab, coin){
  var d = (tab === 'coin' && coin != null) ? DB[coin] : null;
  var title, desc, path;
  if (tab === 'pm') {
    // 路由级兜底；renderPmDetail 拿到详情后会用 syncPmSeo 覆盖成完整信息
    var code = currentPmCode() || '';
    path = pathOf('pm', code);
    title = '贵金属纪念币 ' + code + ' · 发行档案 | 藏币录';
    desc = '中国贵金属纪念币「' + code + '」的发行信息、币面图案与规格，资料以中国人民银行公告为准，本站不提供参考估值。';
    document.title = title;
    setAttr('meta[name="description"]', 'content', desc);
    setAttr('meta[property="og:title"]', 'content', title);
    setAttr('meta[property="og:description"]', 'content', desc);
    setAttr('meta[property="og:url"]', 'content', SITE + path);
    setAttr('link[rel="canonical"]', 'href', SITE + path);
    return;
  }
  if (d) {
    var isNote = d.kind === 'note';
    var unit = isNote ? '张' : '枚';
    var sp = setPriceOf(d);
    path = pathOf('coin', coin);
    title = d.name + '（' + d.year + ' ' + (isNote ? '纪念钞' : '纪念币') + '）面额 ' + d.face + ' 元 · 发行量 ' + fmMint(d.mintage) + unit + ' | 藏币录';
    desc = d.year + ' 年发行的' + (isNote ? '纪念钞' : '普通纪念币') + '「' + d.name + '」，面额 ' + d.face + ' 元／' + unit +
           '，' + d.material + '，' + sizeLabel(d) + ' ' + sizeText(d).replace(' mm', ' 毫米') + '，发行量 ' + fmMint(d.mintage) + unit +
           '。单' + unit + '推理价约 ' + aiPrice(d) + ' 元，一套（' + sp.size + ' ' + unit + '）约 ' + (aiPrice(d) * sp.size).toFixed(1) + ' 元。';
  } else {
    var pair = (TAB_SEO[tab] || TAB_SEO.home).map(function(x){
      return x.replace(/{n}/g, DB.length).replace(/{s}/g, Object.keys(SET_META || {}).length);
    });
    path = pathOf(tab);
    title = pair[0];
    desc = pair[1];
  }
  document.title = title;
  setAttr('meta[name="description"]', 'content', desc);
  setAttr('meta[property="og:title"]', 'content', title);
  setAttr('meta[property="og:description"]', 'content', desc);
  setAttr('meta[property="og:url"]', 'content', SITE + path);
  setAttr('link[rel="canonical"]', 'href', SITE + path);
}

/* 移动端页签横向滚动时把当前项带进可视区，只滚容器，不带动整页 */
function revealActiveTab(sel){
  var box = document.getElementById('tabs');
  if (!box || !sel || !box.clientWidth) return;
  var b = box.getBoundingClientRect(), s = sel.getBoundingClientRect();
  if (s.left < b.left) box.scrollLeft -= (b.left - s.left + 8);
  else if (s.right > b.right) box.scrollLeft += (s.right - b.right + 8);
}

function scrollToTop(){
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  try { window.scrollTo({ top: 0, behavior: reduce ? 'auto' : 'smooth' }); }
  catch (e) { window.scrollTo(0, 0); }
}

function activatePane(name){
  var mark = (name === 'coin' || name === 'pm') ? 'all' : name;   // 详情页把高亮挂在「全套清单」上
  var tabs = document.querySelectorAll('#tabs .tab');
  var active = null;
  for (var i = 0; i < tabs.length; i++) {
    var on = tabs[i].getAttribute('data-tab') === mark;
    tabs[i].classList.toggle('on', on);
    tabs[i].setAttribute('aria-selected', on ? 'true' : 'false');
    if (on) active = tabs[i];
  }
  revealActiveTab(active);
  if (typeof syncTabOverflow === 'function') syncTabOverflow();
  // 账户 / 用户管理不在主导航里，选中态挂在右上角入口上
  var accBtn = document.getElementById('accountBtn');
  var admBtn = document.getElementById('adminBtn');
  if (accBtn) accBtn.classList.toggle('on', mark === 'account');
  if (admBtn) admBtn.classList.toggle('on', mark === 'admin');
  var panes = document.querySelectorAll('.pane');
  for (var j = 0; j < panes.length; j++) {
    panes[j].classList.toggle('on', panes[j].id === 'pane-' + name);
  }
  document.body.classList.toggle('in-detail', name === 'coin' || name === 'pm');
  document.body.classList.toggle('tab-home', name === 'home');   // 首页自带大标题，收起顶部 hero
}

/* ---------------------------------------------------------
   发行计划：央行每年 12 月公布次年普通纪念币（钞）计划，
   已发的链到品种详情，未发的显示倒计时与预约时间。
   --------------------------------------------------------- */
function planDaysUntil(dateStr){
  if (!dateStr) return null;
  var d = new Date(dateStr + 'T00:00:00');
  if (isNaN(d.getTime())) return null;
  var now = new Date();
  var today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((d - today) / 86400000);
}

/**
 * 解析预约区间。支持「2026-11-17 22:00 至 11-18 24:00」这种带时刻的写法，
 * 24:00 视为次日 00:00；只有日期的写法交给原来的按天倒计时。
 */
function planReserveRange(text) {
  if (!text) return null;
  var s = String(text).replace(/\s+/g, ' ').trim();
  var m = s.match(/^(\d{4}-\d{2}-\d{2})(?:\s+(\d{1,2}):(\d{2}))?\s*至\s*(?:(\d{4})-)?(\d{2})-(\d{2})(?:\s+(\d{1,2}):(\d{2}))?/);
  if (!m) return null;
  var y = m[1].slice(0, 4);
  var start = new Date(m[1] + 'T' + (m[2] || '00') + ':' + (m[3] || '00') + ':00');
  var endY = m[4] || y;
  var eh = m[7], em = m[8];
  var end;
  if (eh === '24') {
    end = new Date(endY + '-' + m[5] + '-' + m[6] + 'T00:00:00');
    end.setDate(end.getDate() + 1);
  } else {
    end = new Date(endY + '-' + m[5] + '-' + m[6] + 'T' + (eh || '23') + ':' + (em || '59') + ':00');
  }
  if (isNaN(start.getTime()) || isNaN(end.getTime())) return null;
  return { start: start, end: end };
}

/** 按「当前时刻」算预约状态；没有精确时刻的公告返回 null */
function planReserveState(text) {
  if (!/\d{1,2}:\d{2}/.test(String(text || ''))) return null;
  var r = planReserveRange(text);
  if (!r) return null;
  var now = new Date();
  if (now < r.start) {
    var h = Math.ceil((r.start - now) / 3600000);
    return { cls: 'soon', text: h < 24 ? ('距预约 ' + h + ' 小时') : ('距预约 ' + Math.ceil(h / 24) + ' 天') };
  }
  if (now <= r.end) {
    var rest = Math.ceil((r.end - now) / 3600000);
    return { cls: 'now', text: '预约中 · 剩 ' + rest + ' 小时' };
  }
  return { cls: 'end', text: '预约已结束' };
}

/** 计划项详情弹层：预约/兑换/承办银行/图案 */
function showPlanDetail(it){
  var old = document.getElementById('planModal');
  if (old) old.parentNode.removeChild(old);

  var isNote = it.kind === 'note';
  var unit = isNote ? '张' : '枚';
  var rows = (it.schedule || []).map(function(r){
    return '<div class="pd-row"><span class="pd-k">' + esc(r.k) + '</span><span class="pd-v">' + esc(r.v) + '</span></div>';
  }).join('');
  if (!rows) {
    if (it.date) rows += '<div class="pd-row"><span class="pd-k">发行日</span><span class="pd-v">' + esc(it.date) + '</span></div>';
    if (it.reserve) rows += '<div class="pd-row"><span class="pd-k">预约</span><span class="pd-v">' + esc(it.reserve) + '</span></div>';
    if (it.verify) rows += '<div class="pd-row"><span class="pd-k">核实</span><span class="pd-v">' + esc(it.verify) + '</span></div>';
    if (it.exchange) rows += '<div class="pd-row"><span class="pd-k">兑换</span><span class="pd-v">' + esc(it.exchange) + '</span></div>';
  }
  var spec = [it.face ? it.face + ' 元' : '', it.material || '', it.dia || '',
    it.mintage ? fmMint(it.mintage) + unit : ''].filter(Boolean).join(' · ');

  var wrap = document.createElement('div');
  wrap.id = 'planModal';
  wrap.className = 'pd-mask';
  wrap.innerHTML =
    '<div class="pd-sheet" role="dialog" aria-modal="true">' +
      '<div class="pd-head"><b class="pd-title">' + esc(it.name) + '</b>' +
        '<button class="pd-x" type="button" aria-label="关闭">✕</button></div>' +
      '<span class="pd-state' + (it.status === 'upcoming' ? ' up' : '') + '">' +
        (it.status === 'upcoming' ? '待发行' : '已发行') + '</span>' +
      (rows ? '<div class="pd-sched">' + rows + '</div>' : '') +
      (spec ? '<div class="pd-spec">' + esc(spec) + '</div>' : '') +
      (it.banks ? '<div class="pd-block"><span class="pd-h">承办银行</span><span class="pd-p">' + esc(it.banks) + '</span></div>' : '') +
      (it.limit ? '<div class="pd-block"><span class="pd-h">限额</span><span class="pd-p">每人限 ' + it.limit + ' ' + unit +
        (it.proxy ? '，最多代 ' + it.proxy + ' 人办理' : '') + '</span></div>' : '') +
      (it.design && it.design.obverse ? '<div class="pd-block"><span class="pd-h">正面图案</span><span class="pd-p">' + esc(it.design.obverse) + '</span></div>' : '') +
      (it.design && it.design.reverse ? '<div class="pd-block"><span class="pd-h">背面图案</span><span class="pd-p">' + esc(it.design.reverse) + '</span></div>' : '') +
      (it.sourceText ? '<div class="pd-src">' + esc(it.sourceText) + '</div>' : '') +
      (it.sourceUrl ? '<a class="pd-btn" href="' + esc(it.sourceUrl) + '" target="_blank" rel="noopener">查看央行公告原文 ↗</a>' : '') +
    '</div>';
  document.body.appendChild(wrap);
  document.body.style.overflow = 'hidden';
  function close(){
    document.body.style.overflow = '';
    if (wrap.parentNode) wrap.parentNode.removeChild(wrap);
  }
  wrap.addEventListener('click', function(e){
    if (e.target === wrap || e.target.closest('.pd-x')) close();
  });
  document.addEventListener('keydown', function esc2(e){
    if (e.key === 'Escape') { close(); document.removeEventListener('keydown', esc2); }
  });
}

var PLANS_LOADED = false;
/** 按需加载品类与双份发行计划（Web 与小程序共用同一个后端接口） */
function loadPlansOnce(cb){
  if (PLANS_LOADED) { if (cb) cb(); return; }
  PLANS_LOADED = true;
  fetch('/api/plans', { credentials:'same-origin' })
    .then(function(r){ return r.ok ? r.json() : null; })
    .then(function(j){
      if (!j || !j.ok) return;
      if (j.plan && Array.isArray(j.plan.years)) PLAN = j.plan;
      if (j.planPm && Array.isArray(j.planPm.years)) PLAN_PM = j.planPm;
      if (j.categories && Array.isArray(j.categories.categories)) CATEGORIES = j.categories;
      if (cb) cb();
    })
    .catch(function(){ /* 接口失败时沿用旧 plan，不白屏 */ });
}

function renderPlanTabs(){
  var el = document.getElementById('planTabs');
  if (!el) return;
  el.innerHTML = [['coin','普通纪念币（钞）'],['pm','贵金属纪念币']].map(function(x){
    return '<button type="button" data-ptab="' + x[0] + '"' + (PLAN_TAB === x[0] ? ' class="on"' : '') + '>' + x[1] + '</button>';
  }).join('');
  el.onclick = function(e){
    var b = e.target.closest('[data-ptab]'); if (!b) return;
    PLAN_TAB = b.getAttribute('data-ptab');
    renderPlan();
  };
}

/** 贵金属计划：按项目（套）展示，不做预约/倒计时 —— 贵金属不在预约兑换体系里 */
function renderPlanPm(box){
  var years = (PLAN_PM && PLAN_PM.years) || [];
  if (!years.length) { box.innerHTML = '<div class="plan-empty">还没有贵金属发行计划数据。</div>'; return; }
  var meta = document.getElementById('planMeta');
  var src = document.getElementById('planSource');
  var html = years.slice(0, 20).map(function(y){
    var totalPieces = y.items.reduce(function(a,it){ return a + (Number(it.pieces)||0); }, 0);
    return '<div class="plan-year">' +
      '<div class="plan-year-head"><b>' + y.year + ' 年</b>' +
      '<span class="muted">' + y.items.length + ' 个项目 · ' + totalPieces + ' 枚</span></div>' +
      '<div class="plan-list">' + y.items.map(function(it){
        var release = it.release || '';
        return '<div class="plan-item">' +
          '<div class="plan-main">' +
            '<div class="plan-name">' + esc(it.name) + '</div>' +
            '<div class="plan-sub"><span class="plan-tag">' + esc(it.code) + '</span>' +
            '<span>' + (it.pieces || 0) + ' 枚</span>' +
            (release ? '<span class="plan-note">' + esc(release) + ' 发行</span>' : '') + '</div>' +
          '</div>' +
          (it.announce ? '<div class="plan-pm-note" title="' + esc(it.announce.slice(0,240)) + '">央行公告摘录</div>' : '') +
        '</div>';
      }).join('') + '</div></div>';
  }).join('');
  if (meta) meta.textContent = '贵金属 · ' + years.length + ' 个年度（显示最近 20 年）';
  if (src) src.textContent = '按年度整理 · 以央行发行公告为准';
  box.innerHTML = html;
  box.onclick = null;
}

function renderPlan(){
  var box = document.getElementById('planBody');
  if (!box) return;
  if (!PLANS_LOADED) loadPlansOnce(function(){ renderPlan(); });  // 首屏先画旧数据，接口回来重绘一次
  renderPlanTabs();
  if (PLAN_TAB === 'pm') { renderPlanPm(box); return; }
  var years = (PLAN && PLAN.years) || [];
  if (!years.length) {
    box.innerHTML = '<div class="plan-empty">还没有可用的发行计划数据。</div>';
    return;
  }
  // 无品种的计划项：点开看公告详情
  box.onclick = function(e){
    var hit = e.target.closest('[data-plan]');
    if (!hit) return;
    var key = hit.getAttribute('data-plan');
    var found = null;
    (PLAN.years || []).forEach(function(y){
      (y.items || []).forEach(function(it){ if (it.key === key) found = it; });
    });
    if (found) showPlanDetail(found);
  };

  var metaEl = document.getElementById('planMeta');
  var srcEl = document.getElementById('planSource');

  var html = '';
  var upcomingAll = [];
  years.sort(function(a, b){ return b.year - a.year; });   // 新年度在前
  years.forEach(function(y){
    var items = (y.items || []).slice();
    // 一律按发行日倒序：最新的排在最前
    items.sort(function(a, b){ return String(b.date || '').localeCompare(String(a.date || '')); });
    var doneCount = items.filter(function(it){ return it.status !== 'upcoming'; }).length;

    html += '<div class="plan-year">' +
      '<div class="plan-year-head">' +
        '<b>' + y.year + ' 年</b>' +
        '<span class="muted">央行 ' + esc(y.publishedAt || '') + ' 公布 · 计划 ' + items.filter(function(i){ return !i.extra; }).length + ' 项' +
          (items.filter(function(i){ return i.extra; }).length ? ' · 增发 ' + items.filter(function(i){ return i.extra; }).length + ' 项' : '') +
          ' · 已发 ' + doneCount + ' 项</span>' +
      '</div>' +
      '<div class="plan-list">';

    items.forEach(function(it){
      var isNote = it.kind === 'note';
      var unit = isNote ? '张' : '枚';
      var up = it.status === 'upcoming';
      var days = up ? planDaysUntil(it.date) : null;
      if (up) upcomingAll.push(it);
      var c = it.coinNo ? DB[it.coinNo - 1] : null;
      // 有精确预约时刻的按「当前时刻」算，否则退回按天倒计时
      var rs = planReserveState(it.reserve);
      var reservingNow = !!(rs && rs.cls === 'now');
      var countdown = '';
      if (rs) {
        countdown = '<span class="plan-cd plan-cd-' + rs.cls + '">' + rs.text + '</span>';
      } else if (up && days !== null) {
        countdown = days > 0
          ? '<span class="plan-cd">还有 ' + days + ' 天</span>'
          : (days === 0 ? '<span class="plan-cd">今天发行</span>' : '<span class="plan-cd plan-cd-done">已过发行日</span>');
      }
      var hasDetail = !!(it.banks || it.schedule || (it.design && it.design.reverse) || it.verify);
      html += '<div class="plan-item' + (up ? ' is-upcoming' : '') + '"' +
          (c ? ' data-coin="' + c.i + '" role="button" tabindex="0"'
             : (hasDetail ? ' data-plan=\'' + esc(it.key) + '\' role="button" tabindex="0"' : '')) + '>' +
        '<div class="plan-main">' +
          '<div class="plan-name">' + esc(it.name) + '</div>' +
          '<div class="plan-sub">' +
            '<span class="plan-tag">' + (isNote ? '纪念钞' : '纪念币') + '</span>' +
            '<span>' + it.face + ' 元</span>' +
            (it.extra ? '<span class="plan-extra">增发</span>' : '') +
            (it.mintage ? '<span>' + fmMint(it.mintage) + unit + '</span>' : '') +
            (it.note ? '<span class="plan-note">' + esc(it.note) + '</span>' : '') +
          '</div>' +
        '</div>' +
        '<div class="plan-right">' +
          (reservingNow
            ? '<span class="plan-badge is-now">预约中</span>'
            : (up
              ? '<span class="plan-badge">待发行</span>'
              : '<span class="plan-badge is-done">已发行</span>')) +
          '<div class="plan-date">' + (it.date ? it.date.slice(5) + ' 发行' : '日期待定') + '</div>' +
          (it.reserve ? '<div class="plan-reserve">' + esc(it.reserve) + ' 预约</div>' : '') +
          (it.exchange ? '<div class="plan-exchange">' + esc(it.exchange) + ' 兑换</div>' : '') +
          countdown +
        '</div>' +
      '</div>';
    });

    html += '</div></div>';
    if (y.sourceUrl) {
      html += '<div class="plan-src">计划来源：中国人民银行 ' + (y.publishedAt || '') + ' 公布，具体发行信息以发行前公告为准。</div>';
    }
  });
  box.innerHTML = html;

  if (metaEl) metaEl.textContent = '普通纪念币（钞）· 共 ' + years.length + ' 个年度';
  if (srcEl) {
    var next = upcomingAll.filter(function(it){ return planDaysUntil(it.date) >= 0; })[0];
    srcEl.textContent = next
      ? ('下一枚：' + (next.short || next.name) + ' ' + next.date.slice(5))
      : '';
  }

  // 点已发行的行 → 进品种详情
  box.onclick = function(e){
    var el = e.target.closest('[data-coin]');
    if (el) goCoin(parseInt(el.getAttribute('data-coin'), 10));
  };
  box.onkeydown = function(e){
    if (e.key !== 'Enter' && e.key !== ' ') return;
    var el = e.target.closest('[data-coin]');
    if (el) { e.preventDefault(); goCoin(parseInt(el.getAttribute('data-coin'), 10)); }
  };
}

/* ---------------------------------------------------------
   站点地图：给搜索引擎和用户一张「全部页面」的表。
   这里刻意用真实的 <a href>，而不是站内其它地方的 button + JS 路由 ——
   爬虫不跑 JS，只有真链接才能顺着爬进去。
   --------------------------------------------------------- */
function renderSitemap(){
  var box = document.getElementById('sitemapBody');
  if (!box) return;
  var meta = document.getElementById('sitemapMeta');

  var PAGES = [
    { p: '/', n: '首页' },
    { p: '/all', n: '全套发行清单' },
    { p: '/series', n: '全部系列' },
    { p: '/plan', n: '发行计划' },
    { p: '/overview', n: '数据概览' },
    { p: '/holdings', n: '我的藏品' },
    { p: '/cost', n: '收齐成本' }
  ];

  var groups = {};
  DB.forEach(function(d){ (groups[d.series] = groups[d.series] || []).push(d); });
  var order = Object.keys(SERIES).filter(function(k){ return groups[k]; });
  Object.keys(groups).forEach(function(k){ if (order.indexOf(k) < 0) order.push(k); });

  var html = '<div class="sm-block"><h3>主要页面</h3><ul class="sm-list sm-pages">' +
    PAGES.map(function(x){
      return '<li><a href="' + x.p + '">' + esc(x.n) + '</a></li>';
    }).join('') + '</ul></div>';

  html += order.map(function(k){
    var list = groups[k].slice().sort(function(a, b){ return a.year - b.year || a.i - b.i; });
    return '<div class="sm-block"><h3>' + esc(SERIES[k] || '其他') +
      ' <span class="sm-count">' + list.length + '</span></h3><ul class="sm-list">' +
      list.map(function(d){
        return '<li><a href="/coin/' + (d.i + 1) + '">' + esc(shortName(d.name)) +
          '<i>' + d.year + '</i></a></li>';
      }).join('') + '</ul></div>';
  }).join('');

  box.innerHTML = html;
  if (meta) meta.textContent = order.length + ' 个系列 · ' + DB.length + ' 个品种';
}

/* 我的反馈：用户看到自己提交的条目、处理状态和管理员回复 */
function renderMyFeedback(){
  var box = document.getElementById('mfBody');
  if (!box) return;
  if (!APP.user) {
    box.innerHTML = '<div class="plan-empty">登录后才能查看自己的反馈。</div>';
    return;
  }
  box.innerHTML = '<div class="plan-empty">加载中…</div>';
  fetch('/api/feedback/mine', { credentials:'same-origin' })
    .then(function(r){ return r.ok ? r.json() : null; })
    .then(function(j){
      if (!j || !j.ok) { box.innerHTML = '<div class="plan-empty">加载失败，稍后再试。</div>'; return; }
      var items = j.items || [];
      var meta = document.getElementById('mfMeta');
      if (meta) meta.textContent = items.length + ' 条 · 待处理 ' + (j.open || 0) + ' 条';
      if (!items.length) { box.innerHTML = '<div class="plan-empty">还没有提交过反馈。在品种详情页或清单里点「反馈」就能提。</div>'; return; }
      box.innerHTML = items.map(function(it){
        var done = it.status === 'done';
        var imgs = (it.images || []).map(function(f){
          return '<img src="/feedback/' + esc(f) + '" alt="反馈图片" loading="lazy">';
        }).join('');
        return '<div class="mf-item">' +
          '<div class="mf-top"><b>' + esc(it.coinName || '功能建议') + '</b>' +
          '<span class="mf-badge' + (done ? ' done' : '') + '">' + (done ? '已处理' : '待处理') + '</span></div>' +
          '<p class="mf-text">' + esc(it.text) + '</p>' +
          (imgs ? '<div class="mf-imgs">' + imgs + '</div>' : '') +
          (it.reply ? '<div class="mf-reply"><b>管理员回复</b><p>' + esc(it.reply) + '</p></div>' : '') +
          '<div class="mf-date">' + esc(String(it.createdAt || '').slice(0,16).replace('T',' ')) + '</div>' +
        '</div>';
      }).join('');
    })
    .catch(function(){ box.innerHTML = '<div class="plan-empty">加载失败，稍后再试。</div>'; });
}

function goTab(name, opts){
  opts = opts || {};
  name = TAB_ALIAS[name] || name;      // #/overview、#/cost 归到我的藏品
  if (name === 'admin') { window.location.replace('/console/'); return; }
  var prev = currentTab();
  reportVisit(name);                   // 记一条访问（服务端 30 秒内同页去重）
  if (TABS.indexOf(name) < 0) name = 'home';
  if (GATED.indexOf(name) >= 0 && !isLoggedIn()) name = 'account';

  activatePane(name);
  // 从详情返回清单：回到原来的位置；从别的页签进清单：从顶部开始
  if (name === 'all') {
    // 从贵金属独立页返回：分类按钮高亮同步到 pm（VIEW_CATEGORY 已在 goPm 里设好）
    var ct = document.getElementById('catTabs');
    if (ct) Array.prototype.forEach.call(ct.querySelectorAll('button'), function(x){
      x.className = x.getAttribute('data-cat') === VIEW_CATEGORY ? 'on' : '';
    });
    var back = (prev === 'coin' || prev === 'pm') && LAST_ALL_SCROLL > 0;
    var target = back ? LAST_ALL_SCROLL : 0;
    setTimeout(function(){
      // 无动画，避免长列表里“飞回去”的观感
      window.scrollTo(0, target);
    }, 0);
    if (!back) LAST_ALL_SCROLL = 0;
  }
  if (opts.push !== false) {
    try {
      if (opts.replace) history.replaceState(null, '', pathOf(name));
      else history.pushState(null, '', pathOf(name));
    } catch(e) { location.assign(pathOf(name)); }
  }
  syncSeo(name, null);
  if (opts.scroll !== false) scrollToTop();
  if (name === 'plan') renderPlan();
  if (name === 'sitemap') renderSitemap();
  if (name === 'myfeedback') renderMyFeedback();
  if (name === 'all') { loadPlansOnce(ensureCategoryTabs); ensureCategoryTabs(); syncSetFilter(); }
  if (name === 'account') renderProfile();
  if (name === 'home') renderHome();
  if (name === 'plaza') loadPlaza();
}

/* 单个品种详情页 */
/* 手机上从清单点进详情，再点「← 返回清单」会回到顶部、要重滚一遍找刚才那枚。
   这里记住清单页的滚动位置，从详情返回时还原（浏览器后退本来就原生恢复，两条路一致）。 */
var LAST_ALL_SCROLL = 0;

function goCoin(i, opts){
  opts = opts || {};
  i = Number(i);
  if (!(i >= 0 && i < DB.length + PM_DB.length)) { goTab('all'); return; }
  if (currentTab() === 'all') LAST_ALL_SCROLL = window.pageYOffset || 0;
  activatePane('coin');
  if (opts.push !== false) {
    try {
      if (opts.replace) history.replaceState(null, '', pathOf('coin', i));
      else history.pushState(null, '', pathOf('coin', i));
    } catch(e) { location.assign(pathOf('coin', i)); }
  }
  renderCoin(i);
  syncSeo('coin', i);
  if (opts.scroll !== false) scrollToTop();
}

/* 页签超出宽度时才显示右侧渐隐，并用它提示「还能滑」 */
function syncTabOverflow(){
  var box = document.getElementById('tabs');
  var bar = box && box.closest('.tabbar');
  if (!bar) return;
  bar.classList.toggle('has-more', box.scrollWidth - box.clientWidth > 2);
}

function initTabs(){
  document.getElementById('tabs').addEventListener('click', function(e){
    var b = e.target.closest('.tab');
    if (!b) return;
    goTab(b.getAttribute('data-tab'));
  });

  // 空态里的「去登录 / 先看清单」按钮
  document.body.addEventListener('click', function(e){
    var b = e.target.closest('[data-goto]');
    if (!b) return;
    goTab(b.getAttribute('data-goto'));
  });

  // 前进/后退：路径变了就重渲染，别再写一次历史
  window.addEventListener('resize', syncTabOverflow);
  syncTabOverflow();
  window.addEventListener('popstate', function(){
    var rp = routeParts();
    if (rp.tab === 'coin' && rp.coin !== null) goCoin(rp.coin, { push: false });
    else if (rp.tab === 'pm' && rp.code) goPm(rp.code, { push: false });
    else goTab(rp.tab, { push: false });
  });
}

/* =========================================================
   13. 登录 / 注册
   ========================================================= */
function showAuthMode(mode){
  var isLogin = mode !== 'register';
  document.getElementById('loginForm').hidden = !isLogin;
  document.getElementById('regForm').hidden = isLogin;
  var aus = document.querySelectorAll('.authtabs .au');
  for (var i = 0; i < aus.length; i++) {
    aus[i].classList.toggle('on', aus[i].getAttribute('data-mode') === mode);
  }
  document.getElementById('loginMsg').textContent = '';
  document.getElementById('regMsg').textContent = '';
}

function afterAuth(extraMsg){
  return api('/api/bootstrap').then(function(p){
    applyPayload(p);
    saveCache();
    reRenderAll();
    updateChrome();
    if (extraMsg) toast(extraMsg);
  });
}

function doLogin(ev){
  ev.preventDefault();
  var name = document.getElementById('loginName').value.trim();
  var pwd = document.getElementById('loginPwd').value;
  var msg = document.getElementById('loginMsg');
  var btn = document.getElementById('loginBtn');
  if (!name || !pwd) { msg.textContent = '请输入用户名和密码'; return; }
  btn.disabled = true;
  msg.textContent = '';
  api('/api/auth/login', { method: 'POST', body: JSON.stringify({ name: name, password: pwd }) })
    .then(function(){ document.getElementById('loginPwd').value = ''; return afterAuth('登录成功'); })
    .catch(function(e){ msg.textContent = e.message; })
    .then(function(){ btn.disabled = false; });
}

function doRegister(ev){
  ev.preventDefault();
  var name = document.getElementById('regName').value.trim();
  var p1 = document.getElementById('regPwd').value;
  var p2 = document.getElementById('regPwd2').value;
  var msg = document.getElementById('regMsg');
  var btn = document.getElementById('regBtn');

  if (!name) { msg.textContent = '请输入用户名'; return; }
  if (p1.length < 8) { msg.textContent = '密码至少 8 位'; return; }
  if (/^\d+$/.test(p1)) { msg.textContent = '密码不能是纯数字'; return; }
  if (p1 !== p2) { msg.textContent = '两次输入的密码不一致'; return; }

  btn.disabled = true;
  msg.textContent = '';
  api('/api/auth/register', { method: 'POST', body: JSON.stringify({ name: name, password: p1 }) })
    .then(function(){
      document.getElementById('regPwd').value = '';
      document.getElementById('regPwd2').value = '';
      return afterAuth('');
    })
    .then(function(){
      /* 注册完直接落到自己的账本：新用户此刻只有这一件事可做，
         停在「账户」页只能看到退出登录与改密码，等于把入口留给了提示条。 */
      goTab('holdings');
      toast('注册成功，点任意一枚就能记上');
    })
    .catch(function(e){ msg.textContent = e.message; })
    .then(function(){ btn.disabled = false; });
}

function doLogout(){
  api('/api/auth/logout', { method: 'POST' })
    .then(function(){
      APP.user = null;
      APP.isAdmin = false;
      coll = [];
      clearCache();
      document.body.classList.add('anon');
      reRenderAll();
      updateChrome();
      goTab('home');
      toast('已退出登录');
    })
    .catch(function(e){ toast('退出失败：' + e.message); });
}

/* =========================================================
   14. 账户面板 / 用户管理
   ========================================================= */
function renderProfile(){
  var box = document.getElementById('profileBox');
  if (!box) return;
  if (!isLoggedIn()) { box.innerHTML = ''; return; }

  var u = APP.user;
  var initial = String(u.name).slice(0, 1).toUpperCase();

  box.innerHTML =
    '<div class="pcard">' +
      '<div class="pavatar">' + esc(initial) + '</div>' +
      '<div class="pinfo">' +
        '<div class="pname">' + esc(u.name) +
          '<span class="badge' + (APP.isAdmin ? ' admin' : '') + '">' +
            (APP.isAdmin ? '超级管理员' : '普通用户') + '</span>' +
        '</div>' +
        '<div class="pmeta">注册于 ' + fmtDate(u.createdAt) +
          '　·　最近登录 ' + fmtDate(u.lastLogin) +
          '　·　藏品 ' + coll.length + ' 项</div>' +
      '</div>' +
      '<button class="btn ghost" id="logoutBtn">退出登录</button>' +
    '</div>' +

    '<div class="pwcard">' +
      '<h4>修改密码</h4>' +
      '<div class="pwrow">' +
        '<input type="password" id="pwOld" placeholder="原密码" autocomplete="off" data-nofill="1" data-form-type="other" data-lpignore="true" data-1p-ignore data-bwignore>' +
        '<input type="password" id="pwNew" placeholder="新密码（至少 8 位）" autocomplete="off" data-nofill="1" data-form-type="other" data-lpignore="true" data-1p-ignore data-bwignore>' +
        '<button class="btn" id="pwBtn">保存</button>' +
      '</div>' +
      '<div class="authmsg" id="pwMsg"></div>' +
    '</div>';

  document.getElementById('logoutBtn').addEventListener('click', doLogout);
  document.getElementById('pwBtn').addEventListener('click', function(){
    var oldPw = document.getElementById('pwOld').value;
    var newPw = document.getElementById('pwNew').value;
    var m = document.getElementById('pwMsg');
    if (!oldPw || !newPw) { m.textContent = '请填写原密码和新密码'; return; }
    m.textContent = '';
    api('/api/auth/password', { method: 'POST', body: JSON.stringify({ oldPassword: oldPw, newPassword: newPw }) })
      .then(function(){
        document.getElementById('pwOld').value = '';
        document.getElementById('pwNew').value = '';
        m.style.color = '#7fc9a2';
        m.textContent = '密码已更新';
        setTimeout(function(){ m.textContent = ''; m.style.color = ''; }, 2500);
      })
      .catch(function(e){ m.style.color = ''; m.textContent = e.message; });
  });

  hardenInputs(box);
}

function updateChrome(){
  var logged = isLoggedIn();
  document.body.classList.toggle('anon', !logged);

  var chip = document.getElementById('userChip');
  var btn = document.getElementById('authBtn');
  if (chip) {
    if (logged) {
      chip.hidden = false;
      var shown = APP.user.nickname || APP.user.name;
      chip.innerHTML =
        (APP.user.avatar ? '<img class="chip-av" src="' + esc(APP.user.avatar) + '" alt="">' : '') +
        '<b>' + esc(shown) + '</b>' +
        (APP.isAdmin ? '<span class="badge admin">超管</span>' : '');
    } else {
      chip.hidden = true;
      chip.innerHTML = '';
    }
  }
  if (btn) btn.textContent = logged ? '退出' : '登录 / 注册';

  // 「账户 / 用户管理」放在右上角账号区：未登录时用「登录 / 注册」进账户页
  var accountBtn = document.getElementById('accountBtn');
  var adminBtn = document.getElementById('adminBtn');
  if (accountBtn) accountBtn.hidden = !logged;
  if (adminBtn) adminBtn.hidden = !(logged && APP.isAdmin);

  // 未登录时隐藏需要登录的页签，避免点进去只看到"无权限"
  var tabEls = document.querySelectorAll('#tabs .tab');
  for (var ti = 0; ti < tabEls.length; ti++) {
    var key = tabEls[ti].getAttribute('data-tab');
    if (GATED.indexOf(key) >= 0) tabEls[ti].hidden = !logged;
  }

  // 退出登录后若正停在受限页，退回首页
  if (!logged && GATED.indexOf(currentTab()) >= 0) {
    // 未登录停在前面的受限页（/holdings 等）→ 送到账户页，而不是默默跳回首页
    activatePane('account');
    try { history.replaceState(null, '', pathOf('account')); } catch (e) {}
    syncSeo('account', null);
  }

  var authForms = document.getElementById('authForms');
  if (authForms) authForms.hidden = logged;

  if (!APP.online) setSync('offline');
  else if (!logged) setSync('guest');
  else setSync(APP.saving ? 'saving' : 'synced');

  renderProfile();
}

/* =========================================================
   16. 主题切换
   ========================================================= */
var THEME_ICON = {
  sun: '<circle cx="12" cy="12" r="4.2"></circle>' +
       '<path d="M12 2.6v2.2M12 19.2v2.2M2.6 12h2.2M19.2 12h2.2M5.4 5.4l1.6 1.6M17 17l1.6 1.6M18.6 5.4L17 7M7 17l-1.6 1.6"></path>',
  moon: '<path d="M20.5 14.2A8.6 8.6 0 0 1 9.8 3.5a8.6 8.6 0 1 0 10.7 10.7z"></path>'
};

function currentTheme(){
  return document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
}

function syncThemeBtn(){
  var b = document.getElementById('themeBtn');
  if (!b) return;
  var light = currentTheme() === 'light';
  var svg = b.querySelector('svg');
  if (svg) svg.innerHTML = light ? THEME_ICON.moon : THEME_ICON.sun;
  b.title = light ? '切换到深色模式' : '切换到浅色模式';
  b.setAttribute('aria-label', b.title);
}

function applyTheme(theme, animate){
  var html = document.documentElement;
  if (animate) {
    html.classList.add('theme-anim');
    setTimeout(function(){ html.classList.remove('theme-anim'); }, 280);
  }
  html.setAttribute('data-theme', theme);
  try { localStorage.setItem('coin-theme', theme); } catch (e) {}
  syncThemeBtn();
}

/* ---------- 分享 ---------- */
function initShare(){
  var btn = document.getElementById('shareBtn');
  if (!btn) return;
  btn.addEventListener('click', function(){
    var url = location.origin + '/';
    var range = DB.length ? yearRange() : '1984—2026';
    var data = {
      title: '藏币录 · ' + range + ' 纪念币收藏管理与发行清单',
      text: (DB.length || 135) + ' 个品种的面额、发行量、推理价，按套系核算完整度',
      url: url
    };
    if (navigator.share) {
      navigator.share(data).catch(function(){});
      return;
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url)
        .then(function(){ toast('链接已复制，去分享吧'); })
        .catch(function(){ toast('复制失败，请手动复制地址栏'); });
    } else {
      toast('请手动复制地址栏链接');
    }
  });
}

/* ---------- 访问计数（同一浏览器会话只记一次，不采集 IP） ---------- */
function initVisit(){
  var el = document.getElementById('visitCount');
  if (!el || !APP.online) return;
  var KEY = 'coin-visit-mark';
  var today = new Date().toISOString().slice(0, 10);
  var marked = '';
  try { marked = sessionStorage.getItem(KEY) || ''; } catch(e) {}

  var req = (marked === today)
    ? api('/api/visit', { method: 'GET' })
    : api('/api/visit', { method: 'POST' });

  req.then(function(j){
    if (marked !== today) { try { sessionStorage.setItem(KEY, today); } catch(e) {} }
    if (typeof j.total === 'number' && j.total > 0) {
      el.textContent = '累计访问 ' + j.total.toLocaleString('zh-CN') + ' 次';
    }
  }).catch(function(){ /* 统计失败不影响页面 */ });
}

/* =========================================================
   17. 关闭浏览器自动填充 / 防误改
   ========================================================= */
function hardenInputs(root){
  var list = (root || document).querySelectorAll('input');
  for (var i = 0; i < list.length; i++) {
    var el = list[i];
    if (el.type === 'checkbox' || el.type === 'radio') continue;

    if (el.getAttribute('autocomplete') !== 'off') el.setAttribute('autocomplete', 'off');
    el.setAttribute('autocorrect', 'off');
    el.setAttribute('autocapitalize', 'off');
    el.setAttribute('spellcheck', 'false');
    if (!el.hasAttribute('data-form-type')) el.setAttribute('data-form-type', 'other');

    // Chrome 明确忽略 autocomplete="off" 的密码框，只能靠 readonly 上锁：
    // 页面加载时不可写，用户点进去（focus）才解锁，填充逻辑就无从下手。
    if (el.getAttribute('data-nofill') === '1' && !el.__nofillReady) {
      el.__nofillReady = true;
      el.readOnly = true;
      // 注意：这里必须用 currentTarget / this 取元素。
      // 用外层 el 会被 var 的循环变量捕获，所有监听器最后都指到最后一个输入框上。
      var unlock = function(e){ (e.currentTarget || this).readOnly = false; };
      ['focus', 'pointerdown', 'mousedown', 'touchstart', 'keydown'].forEach(function(ev){
        el.addEventListener(ev, unlock, { passive: true });
      });
      el.addEventListener('blur', function(){ if (!this.value) this.readOnly = true; });
    }
  }
}

/* 数值框在聚焦状态下被滚轮一滚就会静默改值，会直接改坏账目 */
document.addEventListener('wheel', function(e){
  var t = e.target;
  if (t && t.tagName === 'INPUT' && t.type === 'number' && document.activeElement === t) {
    t.blur();
  }
}, { passive: true, capture: true });

/* 动态插入的输入框（重绘、弹层）也要兜住 */
document.addEventListener('focusin', function(e){
  var t = e.target;
  if (t && t.tagName === 'INPUT' && t.getAttribute('autocomplete') !== 'off') hardenInputs(t.parentNode || document);
});

/* =========================================================
   18. 杂项绑定
   ========================================================= */
function initMisc(){
  document.getElementById('authBtn').addEventListener('click', function(){
    if (isLoggedIn()) doLogout();
    else goTab('account');
  });

  // 右上角的账户 / 用户管理入口（原主导航里的两项）
  var accountBtn = document.getElementById('accountBtn');
  if (accountBtn) accountBtn.addEventListener('click', function(){ goTab('account'); });
  var adminBtn = document.getElementById('adminBtn');
  if (adminBtn) adminBtn.addEventListener('click', function(){ window.location.href = '/console/'; });

  document.querySelector('.authtabs').addEventListener('click', function(e){
    var b = e.target.closest('.au');
    if (!b) return;
    showAuthMode(b.getAttribute('data-mode'));
  });

  document.getElementById('loginForm').addEventListener('submit', doLogin);
  document.getElementById('regForm').addEventListener('submit', doRegister);

  var reload = document.getElementById('reloadUsers');
  if (reload) reload.addEventListener('click', loadUsers);

  var mfBtn = document.getElementById('toMyFeedback');
  if (mfBtn) mfBtn.addEventListener('click', function(){ goTab('myfeedback'); });

  initShare();
  initVisit();

  var themeBtn = document.getElementById('themeBtn');
  if (themeBtn) {
    themeBtn.addEventListener('click', function(){
      applyTheme(currentTheme() === 'light' ? 'dark' : 'light', true);
    });
    syncThemeBtn();
  }

  // 跟随系统主题变化（用户没手动选过时）
  if (window.matchMedia) {
    var mq = window.matchMedia('(prefers-color-scheme: light)');
    var onSys = function(e){
      var saved = null;
      try { saved = localStorage.getItem('coin-theme'); } catch (err) {}
      if (!saved) applyTheme(e.matches ? 'light' : 'dark', true);
    };
    if (mq.addEventListener) mq.addEventListener('change', onSys);
    else if (mq.addListener) mq.addListener(onSys);
  }

  // 离开页面前把未提交的改动推上去
  window.addEventListener('beforeunload', function(){
    if (APP.pending && APP.online && isLoggedIn() && navigator.sendBeacon) {
      navigator.sendBeacon('/api/holdings',
        new Blob([JSON.stringify({ holdings: coll })], { type: 'application/json' }));
    }
  });
}

/* =========================================================
   19. 启动
   ========================================================= */
/* 首屏遮罩只在数据装配期间存在；异常与超时都有兜底，不会永久盖住页面 */
/* 服务端给抓取端铺了一份静态正文（#ssrCoin），真实详情页装配好之后就整块摘掉，
   否则它会留在详情页下方。装配失败时故意保留 —— 这时它就是用户唯一能读的内容 */
function dropSsr(){
  var sx = document.getElementById('ssrCoin');
  if (sx && sx.parentNode) sx.parentNode.removeChild(sx);
}
function finishBoot(failed){
  var mask = document.getElementById('bootMask');
  var sub = document.getElementById('bootSub');
  if (failed && sub) sub.textContent = '数据加载失败，可刷新页面重试';
  if (!failed) dropSsr();
  document.body.classList.remove('booting');
  if (mask) setTimeout(function(){ if (mask.parentNode) mask.parentNode.removeChild(mask); }, 260);
}


/* =========================================================
   14. 管理后台（参数 / 图片）
   ========================================================= */
function start(){
  renderFilters();
  renderKPI();
  renderHoldings();
  renderSets();
  renderSeries();
  renderCost();
  renderTable();
  renderHome();
  bindTip();
  initPeek();
  initSyncRetry();
  initTabs();
  initMisc();
  hardenInputs();
  // 老 hash 链接先迁到真实路径（#/coin/12 → /coin/12），再按路径渲染
  var legacy = legacyPath();
  if (legacy) { try { history.replaceState(null, '', legacy); } catch (e) {} }
  var rp = routeParts();
  // 认不出的路径（/foo、/home）统一收敛到规范地址，避免同一页面多个 URL
  var canonical = rp.tab === 'pm' ? pathOf('pm', rp.code) : pathOf(rp.tab, rp.coin);
  if (!legacy && canonical !== location.pathname) {
    try { history.replaceState(null, '', canonical); } catch (e) {}
  }
  if (rp.tab === 'coin' && rp.coin !== null) goCoin(rp.coin, { push: false, scroll: false });
  else if (rp.tab === 'pm' && rp.code) goPm(rp.code, { push: false, scroll: false });
  else goTab(rp.tab, { push: false, scroll: false });
  updateChrome();
  finishBoot(false);
}

setTimeout(function(){
  if (!document.body.classList.contains('booting')) return;
  var sub = document.getElementById('bootSub');
  if (sub) sub.textContent = '载入较慢，可刷新页面重试';
  dropSsr();
  document.body.classList.remove('booting');
}, 8000);

boot()
  .then(loadPmCatalog)
  .then(start)
  .catch(function(e){
    console.error(e);
    finishBoot(true);
    // 把「后端没起来」和「前端自己崩了」分开说，一律甩锅 systemctl 只会误导排查
    var msg = (e && (e.message || e)) || '未知错误';
    var netFail = !APP.online || (e && e.status) ||
                  /fetch|network|Failed to fetch|没有可用的数据源|静态数据/i.test(String(msg));
    var tip = netFail
      ? '可能是后端服务未启动（systemctl status coin-ledger），或网络中断，可刷新重试。'
      : '这是前端脚本异常，与后端无关：请按 Ctrl+F5 强制刷新；若仍出现，请把这条信息发给开发者。';
    document.body.insertAdjacentHTML('afterbegin',
      '<div class="boot-fail">页面数据加载失败：' + esc(String(msg)) + '<br>' + tip + '</div>');
  });

/* ---------------- 小程序引导 ---------------- */
/* 本脚本在 <body> 末尾、.mp-fab 之前同步执行：此时 mpBtn 还没进 DOM。
   必须等 DOMContentLoaded 再绑定，否则点「小程序」没反应、二维码永远不显示。 */
function initMpFab(){
  var btn = document.getElementById('mpBtn');
  var panel = document.getElementById('mpPanel');
  var close = document.getElementById('mpClose');
  if (!btn || !panel) return;

  function setOpen(open){
    panel.hidden = !open;
    btn.setAttribute('aria-expanded', open ? 'true' : 'false');
    if (open) { var q = panel.querySelector('.mp-qr'); if (q) q.focus && q.focus(); }
  }
  btn.addEventListener('click', function(e){
    e.stopPropagation();
    setOpen(panel.hidden);
  });
  if (close) close.addEventListener('click', function(e){ e.stopPropagation(); setOpen(false); });
  /* 二维码默认常驻显示：不再因为点击页面其它位置就自动收起。
     需要收起时用面板右上角的 ✕、按钮，或 Esc，都是用户主动操作。 */
  document.addEventListener('keydown', function(e){
    if (e.key === 'Escape' && !panel.hidden) setOpen(false);
  });

  // 窄屏下 .mp-fab 由 CSS 隐藏，正文内联引导接管；这里保留会话内记忆逻辑
  var KEY = 'cl_mp_qr_closed';
  var vw = document.documentElement.clientWidth || window.innerWidth || 0;
  var small = vw > 0 && vw <= 720;
  var closedBefore = false;
  try { closedBefore = !!sessionStorage.getItem(KEY); } catch (e) { closedBefore = false; }
  if (small && !closedBefore) {
    setTimeout(function () {
      panel.hidden = false;
      btn.setAttribute('aria-expanded', 'true');
    }, 500);
  }
  // 用户手动收起后，本次会话不再自动弹
  var rawSetOpen = setOpen;
  setOpen = function (open) {
    rawSetOpen(open);
    if (small) {
      try {
        if (open) sessionStorage.removeItem(KEY);
        else sessionStorage.setItem(KEY, '1');
      } catch (e) { /* 隐私模式忽略 */ }
    }
  };
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initMpFab);
else initMpFab();

/* ---------------- 手机端内联引导 ---------------- */
function initMpInline(){
  var box = document.getElementById('mpInline');
  if (!box) return;
  var KEY = 'cl_mp_hint_off';
  var more = document.getElementById('mpiMore');
  var body = document.getElementById('mpiBody');
  var close = document.getElementById('mpiClose');

  // 只在窄屏出现；关掉过一次就不再打扰
  function narrow(){ return window.matchMedia('(max-width:720px)').matches; }
  function stored(){ try { return localStorage.getItem(KEY) === '1'; } catch (e) { return false; } }

  function sync(){
    box.hidden = !narrow() || stored();
    // 默认收起：二维码一展开就占掉手机首屏的四分之一，把标题和按钮全推到下面。
    // 想装小程序的人点「看码」一下就能看到，不想装的人不被挡路。
    if (narrow() && !stored()) {
      if (body) body.setAttribute('hidden', '');
      if (more) more.textContent = '看码';
    }
  }
  sync();
  window.addEventListener('resize', sync);

  if (more) more.addEventListener('click', function(){
    var open = body.hasAttribute('hidden');
    if (open) body.removeAttribute('hidden'); else body.setAttribute('hidden', '');
    more.textContent = open ? '收起' : '看码';
  });

  if (close) close.addEventListener('click', function(){
    box.hidden = true;
    try { localStorage.setItem(KEY, '1'); } catch (e) { /* 隐私模式忽略 */ }
  });
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initMpInline);
else initMpInline();

/* =========================================================
   藏品广场（plaza）：分享 / 点赞 / 评论 / 关注
   数据来自 /api/shares 等接口，公开可读，写操作需登录。
   ========================================================= */
var PLAZA = { sort: 'new', follow: false, items: [], offset: 0, loading: false };

function loadPlaza(append){
  var box = document.getElementById('plazaBox');
  if (!box) return;
  if (!append) { PLAZA.offset = 0; PLAZA.items = []; box.innerHTML = '<div class="muted" style="padding:30px">正在加载广场…</div>'; }
  if (PLAZA.loading) return;
  PLAZA.loading = true;
  var qs = '?sort=' + encodeURIComponent(PLAZA.sort) + '&limit=20&offset=' + PLAZA.offset +
    (PLAZA.follow ? '&follow=1' : '');
  api('/api/shares' + qs).then(function(r){
    PLAZA.loading = false;
    if (!r || !r.ok) { box.innerHTML = '<div class="muted" style="padding:30px">' + ((r && r.error) || '加载失败') + '</div>'; return; }
    var items = Array.isArray(r.items) ? r.items : [];
    if (append) PLAZA.items = PLAZA.items.concat(items); else PLAZA.items = items;
    PLAZA.offset += items.length;
    renderPlaza();
  }).catch(function(err){
    PLAZA.loading = false;
    box.innerHTML = '<div class="muted" style="padding:30px">加载失败：' + esc(err.message || '') + '</div>';
  });
}

function plazaTagChips(tags){
  if (!Array.isArray(tags) || !tags.length) return '';
  return '<div class="pz-tags">' + tags.slice(0, 6).map(function(t){
    var nm = typeof t === 'string' ? t : t.name;
    var rar = typeof t === 'object' ? (t.rarity || 1) : 1;
    return '<span class="pz-tag rar' + Math.min(5, rar) + '">' + esc(nm) + '</span>';
  }).join('') + '</div>';
}

function renderPlaza(){
  var box = document.getElementById('plazaBox');
  if (!box) return;
  if (!PLAZA.items.length) {
    box.innerHTML = '<div class="pz-empty">广场还空着，来分享第一件藏品吧。</div>';
    return;
  }
  var html = PLAZA.items.map(function(s){
    var imgs = Array.isArray(s.images) ? s.images : [];
    var cover = imgs.length
      ? '<div class="pz-cover"><img src="' + esc(imgs[0]) + '" alt="藏品图片" loading="lazy">' +
        (imgs.length > 1 ? '<span class="pz-cover-more">+' + (imgs.length - 1) + '</span>' : '') +
        (s.form === 'single' ? '<span class="pz-form">单个</span>' : (s.form === 'set' ? '<span class="pz-form">整套</span>' : '')) + '</div>'
      : '<div class="pz-cover ph"><span class="pz-cover-ph-name">' + esc(s.holdingName) + '</span>' +
        (s.form === 'single' ? '<span class="pz-form">单个</span>' : (s.form === 'set' ? '<span class="pz-form">整套</span>' : '')) + '</div>';
    var serials = Array.isArray(s.serials) ? s.serials : [];
    var serialTxt = serials.length ? '号码 ' + serials.slice(0, 4).join(' · ') + (serials.length > 4 ? ' 等' + serials.length + '张' : '') : '';
    var mine = isLoggedIn() && APP.user && s.uid === APP.user.id;
    return '<article class="pz-card" data-share="' + esc(s.id) + '">' +
      cover +
      '<div class="pz-body">' +
        '<div class="pz-title">' + esc(s.holdingName) + '</div>' +
        (serialTxt ? '<div class="pz-serials">' + esc(serialTxt) + '</div>' : '') +
        plazaTagChips(s.tags) +
        (s.caption ? '<div class="pz-caption">' + esc(s.caption) + '</div>' : '') +
      '</div>' +
      '<div class="pz-author-line">' +
        (s.avatar ? '<img class="pz-avatar" src="' + esc(s.avatar) + '" alt="">' : '<span class="pz-avatar ph">' + esc((s.author || '藏')[0]) + '</span>') +
        '<span class="pz-author">' + esc(s.author || '藏友') + '</span>' +
        '<span class="pz-time">' + esc(plazaTime(s.createdAt)) + '</span>' +
      '</div>' +
      '<div class="pz-actions">' +
        '<button class="pz-like' + (s.liked ? ' on' : '') + '" data-pz-act="like" data-id="' + esc(s.id) + '">♥ ' + (Number(s.likes) || 0) + '</button>' +
        '<button class="pz-comment" data-pz-act="comments" data-id="' + esc(s.id) + '">评论 ' + (Number(s.comments) || 0) + '</button>' +
        '<button class="pz-follow" data-pz-act="follow" data-uid="' + esc(s.uid) + '" data-name="' + esc(s.author || '藏友') + '">+ 关注</button>' +
        (mine ? '<button class="pz-del" data-pz-act="del" data-id="' + esc(s.id) + '">删除</button>' : '') +
      '</div>' +
      '<div class="pz-comments" id="cmts-' + esc(s.id) + '" hidden></div>' +
    '</article>';
  }).join('');
  if (PLAZA.items.length >= 20) html += '<button class="pz-more" id="plazaMore">加载更多</button>';
  box.innerHTML = html;
}

function plazaTime(iso){
  if (!iso) return '';
  var t = new Date(iso);
  if (isNaN(t.getTime())) return '';
  var diff = Date.now() - t.getTime();
  if (diff < 60000) return '刚刚';
  if (diff < 3600000) return Math.floor(diff / 60000) + ' 分钟前';
  if (diff < 86400000) return Math.floor(diff / 3600000) + ' 小时前';
  if (diff < 604800000) return Math.floor(diff / 86400000) + ' 天前';
  return (t.getMonth() + 1) + '月' + t.getDate() + '日';
}

/* 广场交互（事件委托） */
(function initPlazaEvents(){
  var tabs = document.getElementById('plazaTabs');
  if (tabs) tabs.addEventListener('click', function(e){
    var b = e.target.closest('button'); if (!b) return;
    Array.prototype.forEach.call(tabs.querySelectorAll('button'), function(x){ x.className = ''; });
    b.className = 'on';
    if (b.getAttribute('data-follow')) {
      if (!isLoggedIn()) { toast('登录后才能看关注动态'); return; }
      PLAZA.follow = true; PLAZA.sort = 'new';
    } else {
      PLAZA.follow = false; PLAZA.sort = b.getAttribute('data-sort') || 'new';
    }
    loadPlaza();
  });
  var nb = document.getElementById('plazaNew');
  if (nb) nb.addEventListener('click', function(){
    if (!isLoggedIn()) { toast('请先登录再分享'); return; }
    openShareDialog();
  });

  var box = document.getElementById('plazaBox');
  if (!box) return;
  box.addEventListener('click', function(e){
    if (e.target.id === 'plazaMore') { loadPlaza(true); return; }
    // 删除自己的评论：按钮在评论区内部，没有 data-pz-act，必须先于下面的 return 处理
    var cd = e.target.closest('button[data-pz-cd]');
    if (cd) {
      var cid = cd.getAttribute('data-pz-cd');
      var sid = cd.getAttribute('data-id');
      if (!confirm('确定删除这条评论？')) return;
      api('/api/shares/' + encodeURIComponent(sid) + '/comments/' + encodeURIComponent(cid), { method: 'DELETE' }).then(function(r){
        if (!r || !r.ok) { toast((r && r.error) || '删除失败'); return; }
        var it = PLAZA.items.filter(function(x){ return x.id === sid; })[0];
        if (it) it.comments = Math.max(0, (Number(it.comments) || 0) - 1);
        // 局部更新：评论区保持展开、按钮数字同步，不重建整页（重建会冲掉评论区——这是评论消失 bug 的根因）
        var cntBtn = box.querySelector('button[data-pz-act="comments"][data-id="' + sid + '"]');
        if (cntBtn) cntBtn.textContent = '评论 ' + (Number(it && it.comments) || 0);
        var cmtBox = document.getElementById('cmts-' + sid);
        if (cmtBox && !cmtBox.hidden) loadComments(sid, cmtBox);
        toast('已删除');
      });
      return;
    }
    var b = e.target.closest('button[data-pz-act]'); if (!b) return;
    var act = b.getAttribute('data-pz-act');
    var id = b.getAttribute('data-id');
    if (act === 'like') {
      if (!isLoggedIn()) { toast('请先登录再点赞'); return; }
      api('/api/shares/' + encodeURIComponent(id) + '/like', { method: 'POST', body: {} }).then(function(r){
        if (!r || !r.ok) { toast((r && r.error) || '操作失败'); return; }
        var it = PLAZA.items.filter(function(x){ return x.id === id; })[0];
        if (it) { it.liked = r.liked; it.likes = Math.max(0, (Number(it.likes) || 0) + (r.liked ? 1 : -1)); renderPlaza(); }
      });
    } else if (act === 'comments') {
      var cbox = document.getElementById('cmts-' + id);
      if (!cbox) return;
      if (!cbox.hidden) { cbox.hidden = true; return; }
      cbox.hidden = false; cbox.innerHTML = '正在加载评论…';
      loadComments(id, cbox);
    } else if (act === 'follow') {
      if (!isLoggedIn()) { toast('请先登录再关注'); return; }
      var uid = b.getAttribute('data-uid');
      api('/api/follow/' + encodeURIComponent(uid), { method: 'POST', body: {} }).then(function(r){
        if (!r || !r.ok) { toast((r && r.error) || '操作失败'); return; }
        b.textContent = r.following ? '已关注' : '+ 关注';
        b.className = 'pz-follow' + (r.following ? ' on' : '');
      });
    } else if (act === 'del') {
      if (!confirm('确定删除这条分享？')) return;
      api('/api/shares/' + encodeURIComponent(id), { method: 'DELETE' }).then(function(r){
        if (!r || !r.ok) { toast((r && r.error) || '删除失败'); return; }
        PLAZA.items = PLAZA.items.filter(function(x){ return x.id !== id; });
        renderPlaza();
      });
    }
  });
  box.addEventListener('submit', function(e){
    var f = e.target;
    if (!f.classList.contains('pz-cmt-form')) return;
    e.preventDefault();
    var id = f.getAttribute('data-id');
    var inp = f.querySelector('input');
    var text = (inp.value || '').trim();
    if (!text) return;
    if (!isLoggedIn()) { toast('请先登录再评论'); return; }
    api('/api/shares/' + encodeURIComponent(id) + '/comments', { method: 'POST', body: { text: text } }).then(function(r){
      if (!r || !r.ok) { toast((r && r.error) || '评论失败'); return; }
      inp.value = '';
      var it = PLAZA.items.filter(function(x){ return x.id === id; })[0];
      if (it) it.comments = (Number(it.comments) || 0) + 1;
      // 不调用 renderPlaza()：它会重建整页 DOM，把刚展开的评论区连同输入框一起冲掉（评论 bug 根因）
      var cntBtn = box.querySelector('button[data-pz-act="comments"][data-id="' + id + '"]');
      if (cntBtn) cntBtn.textContent = '评论 ' + (Number(it && it.comments) || 0);
      var cbox = document.getElementById('cmts-' + id);
      if (cbox) loadComments(id, cbox);
    });
  });
})();

function loadComments(id, cbox){
  api('/api/shares/' + encodeURIComponent(id) + '/comments').then(function(r){
    if (!r || !r.ok) { cbox.innerHTML = '<div class="muted">评论加载失败</div>'; return; }
    var items = Array.isArray(r.items) ? r.items : [];
    var me = APP.user && APP.user.id;
    var html = items.length ? items.map(function(c){
      var mine = c.mine === true || (me && c.uid === me);
      return '<div class="pz-cmt"><b>' + esc(c.author || '藏友') + '</b> ' + esc(c.text) +
        '<span class="pz-time">' + esc(plazaTime(c.createdAt)) + '</span>' +
        (mine ? '<button type="button" class="pz-cmt-del" data-pz-cd="' + esc(c.id) + '" data-id="' + esc(id) + '">删除</button>' : '') +
        '</div>';
    }).join('') : '<div class="muted" style="font-size:12px">还没有评论</div>';
    html += '<form class="pz-cmt-form" data-id="' + esc(id) + '"><input placeholder="说点什么…" maxlength="280" autocomplete="off"><button type="submit">发送</button></form>';
    cbox.innerHTML = html;
  });
}

/* 分享对话框：从我的藏品多选（最多 20 件），每件成为一张卡片，写文案后一次发布 */
function openShareDialog(presetName){
  if (!isLoggedIn()) { toast('请先登录再分享'); return; }
  if (!coll.length) { toast('还没有藏品，先去清单里挑几枚'); return; }
  var rows = coll.map(function(c, i){
    var checked = presetName && c.name === presetName ? ' checked' : '';
    var pics = Array.isArray(c.images) && c.images.length
      ? '<img src="' + esc(c.images[0]) + '" alt="" loading="lazy">' : '';
    var serials = Array.isArray(c.serials) ? c.serials : [];
    var note = serials.length ? (serials.length + ' 个号码') : (c.form === 'set' ? '整套' : (c.form === 'single' ? '单个' : '藏品'));
    return '<label class="pz-pick"><input type="checkbox" class="pz-pick-cb" data-i="' + i + '"' + checked + '>' +
      pics + '<span class="pz-pick-name">' + esc(c.name) + '</span><span class="pz-pick-note">' + esc(note) + '</span></label>';
  }).join('');
  var overlay = document.createElement('div');
  overlay.className = 'pz-modal-mask';
  overlay.innerHTML = '<div class="pz-modal pz-modal-multi">' +
    '<div class="pz-modal-h"><b>分享藏品到广场（可多选）</b><button type="button" class="pz-modal-x">×</button></div>' +
    '<div class="pz-pick-bar"><button type="button" class="pz-pick-all" id="pzPickAll">全选</button>' +
      '<span class="pz-pick-count" id="pzPickCount">已选 0 件</span></div>' +
    '<div class="pz-pick-list">' + rows + '</div>' +
    '<label>分享文案（可选，应用于所选藏品）<textarea id="pzCaption" rows="2" maxlength="280" placeholder="晒晒你的靓号和收藏心得…"></textarea></label>' +
    '<div class="pz-modal-f"><button type="button" class="btn" id="pzCancel">取消</button>' +
    '<button type="button" class="btn primary" id="pzSubmit">发布分享</button></div>' +
    '</div>';
  document.body.appendChild(overlay);
  function close(){ overlay.remove(); }
  function refreshCount(){
    var n = overlay.querySelectorAll('.pz-pick-cb:checked').length;
    overlay.querySelector('#pzPickCount').textContent = '已选 ' + n + ' 件';
  }
  overlay.querySelector('.pz-modal-x').onclick = close;
  document.getElementById('pzCancel').onclick = close;
  overlay.querySelector('#pzPickAll').onclick = function(){
    var cbs = overlay.querySelectorAll('.pz-pick-cb');
    var allChecked = Array.prototype.every.call(cbs, function(x){ return x.checked; });
    Array.prototype.forEach.call(cbs, function(x){ x.checked = !allChecked; });
    refreshCount();
  };
  Array.prototype.forEach.call(overlay.querySelectorAll('.pz-pick-cb'), function(cb){
    cb.addEventListener('change', function(){
      if (overlay.querySelectorAll('.pz-pick-cb:checked').length > 20) {
        cb.checked = false; toast('一次最多分享 20 件');
      }
      refreshCount();
    });
  });
  refreshCount();
  document.getElementById('pzSubmit').onclick = function(){
    var cbs = overlay.querySelectorAll('.pz-pick-cb:checked');
    if (!cbs.length) { toast('请勾选至少一件藏品'); return; }
    var caption = overlay.querySelector('#pzCaption').value.trim();
    var items = Array.prototype.map.call(cbs, function(cb){
      var c = coll[Number(cb.getAttribute('data-i'))];
      return {
        holdingName: c.name,
        serials: Array.isArray(c.serials) ? c.serials : [],
        images: Array.isArray(c.images) ? c.images : [],
        form: c.form || ''
      };
    });
    var btn = this; btn.disabled = true; btn.textContent = '发布中…';
    api('/api/shares/batch', { method: 'POST', body: { items: items, caption: caption } }).then(function(r){
      if (!r || !r.ok) { toast((r && r.error) || '发布失败'); btn.disabled = false; btn.textContent = '发布分享'; return; }
      close(); toast('已分享 ' + (r.count || items.length) + ' 件到广场');
      if (currentTab() === 'plaza') loadPlaza();
    });
  };
}
