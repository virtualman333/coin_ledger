'use strict';
/**
 * 贵金属发行计划服务。
 *
 * 数据独立于普通发行计划（plan.json），单独存 PLAN_PM_FILE（plan-pm.json）：
 *   { updated, source, note, categories:['pm'], years:[{year, items:[
 *       {key,name,code,pieces,release,announce}
 *   ]}] }
 *
 * 公开接口 /api/plans?category=pm 走 json-source.planPmDoc()（按 mtime 缓存），
 * 所以这里原子写完文件再 clearCache()，网站 /plan 与小程序立即可见，无需重启。
 * 整份替换语义与普通计划一致；校验规则在本文件内（结构比普通计划简单）。
 */
const fs = require('fs');
const path = require('path');

const config = require('../config');
const audit = require('../audit');
const source = require('../repositories/json-source');

/** 单项目允许的字段与默认值 */
const ITEM_KEYS = ['key', 'name', 'code', 'pieces', 'release', 'announce'];

/**
 * 规范化项目：只保留已知字段，类型归位。
 *
 * @param {object} it 原始项目
 * @returns {object} 规范化项目
 */
function normalizeItem(it) {
  const s = it && typeof it === 'object' ? it : {};
  const out = {};
  ITEM_KEYS.forEach((k) => {
    const v = s[k];
    if (k === 'pieces') out[k] = Number(v) > 0 ? Math.floor(Number(v)) : 0;
    else out[k] = v === undefined || v === null ? '' : String(v);
  });
  if (!out.code) out.code = out.key;
  return out;
}

/**
 * 规范化整份计划。
 *
 * @param {object} src 输入（允许 {plan:{...}} 或直接计划对象）
 * @returns {object} 规范化计划
 */
function normalizePlan(src) {
  const raw = src && typeof src === 'object' ? (src.plan ? src.plan : src) : {};
  const years = Array.isArray(raw.years) ? raw.years : [];
  const seen = {};
  const outYears = [];

  for (const y of years) {
    const year = Number(y && y.year);
    if (!Number.isFinite(year)) return { error: '年度不合法' };
    const items = [];
    for (const it of (Array.isArray(y.items) ? y.items : [])) {
      const norm = normalizeItem(it);
      if (!norm.key) return { error: '项目缺少标识 key（' + year + ' 年）' };
      if (!norm.name) return { error: '项目「' + norm.key + '」缺少名称' };
      if (seen[norm.key]) return { error: '项目 key 重复：' + norm.key };
      seen[norm.key] = 1;
      items.push(norm);
    }
    outYears.push({ year: year, items: items });
  }
  outYears.sort((a, b) => b.year - a.year);

  return {
    plan: {
      updated: raw.updated ? String(raw.updated) : new Date().toISOString().slice(0, 10),
      source: raw.source ? String(raw.source) : 'https://www.ecgci.com/coin-list',
      note: raw.note ? String(raw.note) : '贵金属纪念币年度发行计划',
      categories: ['pm'],
      years: outYears,
    },
  };
}

/**
 * 创建贵金属计划服务。
 *
 * @param {object} ctx 依赖（保留签名对称，当前仅用审计）
 * @returns {object} 服务实例
 */
function create(ctx) {
  return {
    /** @returns {object} 当前整份计划 */
    get() {
      return source.planPmDoc();
    },

    /**
     * 整份替换（原子写）。
     *
     * @param {object} body 请求体
     * @param {string} actor 操作人
     * @param {string} ip 来源 IP
     * @returns {{ok:boolean,error?:string,years?:number,items?:number}}
     */
    replace(body, actor, ip) {
      const norm = normalizePlan(body);
      if (norm.error) return { ok: false, error: norm.error };
      const next = norm.plan;
      const years = next.years.length;
      const items = next.years.reduce((a, y) => a + y.items.length, 0);

      const file = config.PLAN_PM_FILE;
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const tmp = file + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(next, null, 1) + '\n', 'utf8');
      fs.renameSync(tmp, file);
      source.clearCache();

      audit.log(actor, 'plan-pm.update', '', years + ' 个年度 / ' + items + ' 个项目', ip);
      console.log('[admin] 更新贵金属发行计划：' + years + ' 个年度 / ' + items + ' 个项目');
      return { ok: true, years: years, items: items };
    },
  };
}

module.exports = { create: create, normalizePlan: normalizePlan, normalizeItem: normalizeItem, ITEM_KEYS: ITEM_KEYS };
