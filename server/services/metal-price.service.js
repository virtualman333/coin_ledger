'use strict';
/**
 * 贵金属实时行情（公开接口，无需 key）。
 *
 * 数据源：
 *   - 金银铂钯现货：https://api.gold-api.com/price/{XAU|XAG|XPT|XPD}  美元 / 金衡盎司
 *   - 美元人民币汇率：https://api.frankfurter.dev/v1/latest?base=USD&symbols=CNY（ECB）
 *     兜底 https://open.er-api.com/v6/latest/USD
 *
 * 换算：1 金衡盎司 = 31.1035 克；元/克 = (美元/盎司 ÷ 31.1035) × 人民币汇率。
 *
 * 设计约束（小时级缓存版）：
 *   - 每小时只更新一次：同一 UTC 小时内的请求直接读缓存，不拉外部接口；
 *     缓存记录写入 data/metal-price-cache.json，进程重启后同小时仍读缓存。
 *   - 同小时并发请求合并为一次外部拉取（in-flight Promise）。
 *   - 拉取失败且有旧缓存时，返回旧缓存并标 stale；完全没有缓存时用内置兜底价
 *     （标注 fallback/stale），再失败也不抛错到路由层。
 */
const fs = require('fs');
const path = require('path');
const config = require('../config');

const TROY_OZ_G = 31.1035;
const FETCH_TIMEOUT_MS = 8000;

/** 默认持久化路径：data/metal-price-cache.json（可被 create({cacheFile}) 覆盖） */
const DEFAULT_CACHE_FILE = path.join(config.DATA_DIR, 'metal-price-cache.json');

// 兜底价（美元/盎司），仅在完全拉不到公开接口时使用；汇率兜底 7.1
const FALLBACK_USD_OZ = { XAU: 3350, XAG: 38, XPT: 1000, XPD: 1000 };
const FALLBACK_FX = 7.1;

/** 详情页 material/weight 可能是数组，统一取首项成标量 */
function first(v) {
  if (Array.isArray(v)) return v[0];
  return v;
}

/** 材质文本 -> 金属符号。双金属取主导（第一个命中），铜等无贵金属行情的返回 null */
function metalOf(material) {
  const s = String(first(material) || '');
  if (s.indexOf('铂') >= 0 || /pt\b/i.test(s)) return 'XPT';
  if (s.indexOf('钯') >= 0 || /pd\b/i.test(s)) return 'XPD';
  if (s.indexOf('金') >= 0 || /au\b/i.test(s)) return 'XAU';
  if (s.indexOf('银') >= 0 || /ag\b/i.test(s)) return 'XAG';
  return null;
}

const NAMES = { XAU: '黄金', XAG: '白银', XPT: '铂金', XPD: '钯金' };

/** UTC 小时桶 key，例如 2026-11-20T09 */
function hourKeyOf(ms) {
  return new Date(ms).toISOString().slice(0, 13);
}

/** 带超时的 fetch JSON。fetchImpl 为空时用全局 fetch（便于测试注入） */
async function fetchJson(url, fetchImpl) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), FETCH_TIMEOUT_MS);
  try {
    const f = fetchImpl || fetch;
    const r = await f(url, { signal: ctl.signal, headers: { 'user-agent': 'coin-ledger/1.0 (+metal-price)' } });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return await r.json();
  } finally {
    clearTimeout(timer);
  }
}

/** 读持久化缓存；文件缺失/损坏一律当作无缓存 */
function readPersisted(file) {
  try {
    if (!fs.existsSync(file)) return null;
    const rec = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!rec || typeof rec !== 'object' || !rec.payload || !rec.payload.quotes) return null;
    return rec;
  } catch (e) {
    return null;
  }
}

/**
 * @param {object} [options]
 * @param {string} [options.cacheFile] 缓存文件路径，默认 data/metal-price-cache.json
 * @param {function} [options.now] 返回毫秒时间戳的时钟，默认 Date.now（测试可注入）
 * @param {function} [options.fetch] fetch 实现，默认全局 fetch
 */
function create(options) {
  options = options || {};
  const cacheFile = options.cacheFile || DEFAULT_CACHE_FILE;
  const nowFn = typeof options.now === 'function' ? options.now : Date.now;
  const fetchImpl = typeof options.fetch === 'function' ? options.fetch : null;

  // { hourKey, fetchedAt, payload:{ hourKey, quotes, fx, fetchedAt, stale, errors } }
  let cache = readPersisted(cacheFile);
  let inflight = null; // Promise，合并同小时并发

  function persist(rec) {
    try {
      fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
      fs.writeFileSync(cacheFile, JSON.stringify(rec), 'utf8');
    } catch (e) {
      // 持久化失败不影响请求：内存缓存仍然有效
    }
  }

  /** 真正拉外部接口并组装快照；prev 用于补齐个别失败项，实现「失败回落旧值」 */
  async function load(key) {
    const usdOz = {};
    const errors = [];
    // 四种金属并行拉取，个别失败不影响其它
    await Promise.all(Object.keys(NAMES).map(async (sym) => {
      try {
        const j = await fetchJson('https://api.gold-api.com/price/' + sym, fetchImpl);
        const p = Number(j && j.price);
        if (p > 0) usdOz[sym] = p; else errors.push(sym + ':bad');
      } catch (e) { errors.push(sym + ':' + (e && e.message)); }
    }));

    // 汇率：frankfurter(ECB) 主，er-api 兜底
    let fx = 0;
    try {
      const j = await fetchJson('https://api.frankfurter.dev/v1/latest?base=USD&symbols=CNY', fetchImpl);
      fx = Number(j && j.rates && j.rates.CNY);
    } catch (e) { errors.push('fx:' + (e && e.message)); }
    if (!(fx > 0)) {
      try {
        const j = await fetchJson('https://open.er-api.com/v6/latest/USD', fetchImpl);
        fx = Number(j && j.rates && j.rates.CNY);
      } catch (e) { errors.push('fx2:' + (e && e.message)); }
    }

    const partial = Object.keys(usdOz).length < Object.keys(NAMES).length || !(fx > 0);
    // 与上次成功值合并补齐缺失项
    const prev = cache && cache.payload && cache.payload.quotes;
    const prevFx = cache && cache.payload && cache.payload.fx;
    const out = {};
    Object.keys(NAMES).forEach((sym) => {
      const oz = usdOz[sym] != null ? usdOz[sym]
        : (prev && prev[sym] ? prev[sym].usdOz : FALLBACK_USD_OZ[sym]);
      const rate = fx > 0 ? fx : (prevFx > 0 ? prevFx : FALLBACK_FX);
      out[sym] = {
        symbol: sym,
        name: NAMES[sym],
        usdOz: oz,
        fx: rate,
        cnyPerGram: Math.round((oz / TROY_OZ_G * rate) * 100) / 100,
        fallback: usdOz[sym] == null
      };
    });
    return {
      hourKey: key,
      quotes: out,
      fx: fx > 0 ? fx : (prevFx > 0 ? prevFx : FALLBACK_FX),
      fetchedAt: new Date(nowFn()).toISOString(),
      stale: partial,
      errors: errors
    };
  }

  /** 构造最小可用快照：完全无缓存且拉取异常时使用（沿用原错误逻辑） */
  function fallbackSnapshot(key, now) {
    const out = {};
    Object.keys(NAMES).forEach((sym) => {
      out[sym] = {
        symbol: sym, name: NAMES[sym], usdOz: FALLBACK_USD_OZ[sym], fx: FALLBACK_FX,
        cnyPerGram: Math.round((FALLBACK_USD_OZ[sym] / TROY_OZ_G * FALLBACK_FX) * 100) / 100,
        fallback: true
      };
    });
    return {
      hourKey: key,
      quotes: out,
      fx: FALLBACK_FX,
      fetchedAt: new Date(now).toISOString(),
      stale: true,
      errors: ['all']
    };
  }

  async function getQuotes(force) {
    const now = nowFn();
    const key = hourKeyOf(now);

    // 同一小时直接返回缓存（哪怕它是 stale 的），绝不拉外部接口
    if (!force && cache && cache.hourKey === key) return cache.payload;

    if (!inflight) {
      inflight = load(key).then((payload) => {
        cache = { hourKey: key, fetchedAt: payload.fetchedAt, payload: payload };
        persist(cache);
        return payload;
      }).catch(() => {
        // load 内部已逐项兜底，理论上不会到这。真到了：有旧缓存就标 stale 返回，
        // 没有缓存就按原错误逻辑给最小可用快照。
        if (cache) {
          const stalePayload = Object.assign({}, cache.payload, { hourKey: key, stale: true });
          cache = { hourKey: key, fetchedAt: stalePayload.fetchedAt, payload: stalePayload };
          persist(cache);
          return stalePayload;
        }
        const payload = fallbackSnapshot(key, now);
        cache = { hourKey: key, fetchedAt: payload.fetchedAt, payload: payload };
        persist(cache);
        return payload;
      }).finally(() => { inflight = null; });
    }
    return inflight;
  }

  /**
   * 单枚贵金属币的克重价。
   * @param {string} material 材质文本（金/银/铂/钯/双金属…）
   * @param {number|string} weightG 克重
   * @param {number|string} fineness 成色，百分数值（如 91.6）——也可能是 0~1 小数
   * @returns {object|null} { symbol, name, grossGram, pureGram, cnyPerGram, value, ... } 或 null
   */
  function valueOf(material, weightG, fineness) {
    const sym = metalOf(material);
    if (!sym) return null;
    const w = Number(first(weightG));
    if (!(w > 0)) return null;
    let f = Number(first(fineness));
    if (!isFinite(f) || f <= 0) f = 100;
    // fineness 可能是 91.6（百分数）或 0.916（小数）
    if (f <= 1) f = f * 100;
    if (f > 100) f = 100;
    const pureGram = Math.round(w * f / 100 * 1000) / 1000;
    const q = cache && cache.payload && cache.payload.quotes && cache.payload.quotes[sym];
    const price = q ? q.cnyPerGram : null;
    return {
      symbol: sym,
      name: NAMES[sym],
      grossGram: w,
      fineness: f,
      pureGram: pureGram,
      cnyPerGram: price,
      value: price == null ? null : Math.round(pureGram * price * 100) / 100
    };
  }

  return { getQuotes, valueOf, metalOf, TROY_OZ_G };
}

module.exports = { create, metalOf, first, NAMES, TROY_OZ_G };
