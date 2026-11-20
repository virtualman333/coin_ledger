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
 * 设计约束：
 *   - 缓存 10 分钟，并发请求合并为一次，避免打爆公开接口；
 *   - 拉取失败降级到「上次成功值」，再失败用内置兜底价（标注 fallback）；
 *   - 任何情况下都不抛错到路由层，前端拿不到价就自行隐藏克重价。
 */
const TROY_OZ_G = 31.1035;
const CACHE_MS = 10 * 60 * 1000;
const FETCH_TIMEOUT_MS = 8000;

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

/** 带超时的 fetch JSON */
async function fetchJson(url) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), FETCH_TIMEOUT_MS);
  try {
    const r = await fetch(url, { signal: ctl.signal, headers: { 'user-agent': 'coin-ledger/1.0 (+metal-price)' } });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return await r.json();
  } finally {
    clearTimeout(timer);
  }
}

function create() {
  let cache = null;       // { quotes, fetchedAt, stale }
  let inflight = null;    // Promise，合并并发

  async function load() {
    const usdOz = {};
    const errors = [];
    // 四种金属并行拉取，个别失败不影响其它
    await Promise.all(Object.keys(NAMES).map(async (sym) => {
      try {
        const j = await fetchJson('https://api.gold-api.com/price/' + sym);
        const p = Number(j && j.price);
        if (p > 0) usdOz[sym] = p; else errors.push(sym + ':bad');
      } catch (e) { errors.push(sym + ':' + (e && e.message)); }
    }));

    // 汇率：frankfurter(ECB) 主，er-api 兜底
    let fx = 0;
    try {
      const j = await fetchJson('https://api.frankfurter.dev/v1/latest?base=USD&symbols=CNY');
      fx = Number(j && j.rates && j.rates.CNY);
    } catch (e) { errors.push('fx:' + (e && e.message)); }
    if (!(fx > 0)) {
      try {
        const j = await fetchJson('https://open.er-api.com/v6/latest/USD');
        fx = Number(j && j.rates && j.rates.CNY);
      } catch (e) { errors.push('fx2:' + (e && e.message)); }
    }

    const partial = Object.keys(usdOz).length < Object.keys(NAMES).length || !(fx > 0);
    // 与上次成功值合并补齐缺失项
    const prev = cache && cache.quotes;
    const out = {};
    Object.keys(NAMES).forEach((sym) => {
      const oz = usdOz[sym] != null ? usdOz[sym]
        : (prev && prev[sym] ? prev[sym].usdOz : FALLBACK_USD_OZ[sym]);
      const rate = fx > 0 ? fx : (cache && cache.fx > 0 ? cache.fx : FALLBACK_FX);
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
      quotes: out,
      fx: fx > 0 ? fx : (cache && cache.fx > 0 ? cache.fx : FALLBACK_FX),
      fetchedAt: new Date().toISOString(),
      stale: partial,
      errors: errors
    };
  }

  async function getQuotes(force) {
    const now = Date.now();
    if (!force && cache && now - cache.at < CACHE_MS) return cache;
    if (!inflight) {
      inflight = load().then((r) => {
        cache = Object.assign({ at: Date.now() }, r);
        return cache;
      }).catch(() => {
        // load 内部已逐项兜底，理论上不会到这；真到了就返回最小可用快照
        if (cache) return cache;
        const out = {};
        Object.keys(NAMES).forEach((sym) => {
          out[sym] = {
            symbol: sym, name: NAMES[sym], usdOz: FALLBACK_USD_OZ[sym], fx: FALLBACK_FX,
            cnyPerGram: Math.round((FALLBACK_USD_OZ[sym] / TROY_OZ_G * FALLBACK_FX) * 100) / 100,
            fallback: true
          };
        });
        cache = { at: now, quotes: out, fx: FALLBACK_FX, fetchedAt: new Date(now).toISOString(), stale: true, errors: ['all'] };
        return cache;
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
    const q = cache && cache.quotes && cache.quotes[sym];
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
