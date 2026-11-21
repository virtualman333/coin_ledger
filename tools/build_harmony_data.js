'use strict';
/**
 * 把网站/小程序同一份品种目录打包成鸿蒙端内置数据（rawfile）。
 *
 * 数据源与小程序完全一致：优先 miniprogram/data/catalog.js（已由 build_mp_data.js
 * 从 export:json / public/data 加工过），没有再回落 public/data。
 *
 *   node tools/build_harmony_data.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const MP_DATA = path.join(ROOT, 'miniprogram', 'data', 'catalog.js');
const OUT = process.env.HARMONY_OUT
  || path.join(ROOT, 'harmony', 'entry', 'src', 'main', 'resources', 'rawfile', 'catalog.json');

function load() {
  try {
    const raw = require(MP_DATA);
    if (raw && Array.isArray(raw.coins) && raw.coins.length) {
      return { data: raw, from: 'miniprogram/data/catalog.js' };
    }
  } catch (e) {
    // 下面回落
  }
  const srcDir = fs.existsSync(path.join(ROOT, 'data', 'exports', 'latest', 'coins.json'))
    ? path.join(ROOT, 'data', 'exports', 'latest')
    : path.join(ROOT, 'public', 'data');
  const read = (name, fallback) => {
    try { return JSON.parse(fs.readFileSync(path.join(srcDir, name), 'utf8')); }
    catch (e) { return fallback; }
  };
  const coinsDoc = read('coins.json', { coins: [], series: {}, sets: {} });
  const seriesDoc = read('series.json', { items: [] });
  const plan = read('plan.json', { years: [] });
  return {
    from: srcDir,
    data: {
      meta: coinsDoc.meta || {},
      series: coinsDoc.series || {},
      seriesMeta: seriesDoc.items || [],
      sets: coinsDoc.sets || {},
      coins: coinsDoc.coins || [],
      plan,
    },
  };
}

const loaded = load();
// 鸿蒙端只需要展示字段，去掉图片二进制无关信息，保持与小程序一致的字段名
const payload = {
  generatedAt: new Date().toISOString(),
  meta: loaded.data.meta || {},
  series: loaded.data.series || {},
  seriesMeta: loaded.data.seriesMeta || [],
  sets: loaded.data.sets || {},
  coins: loaded.data.coins || [],
  plan: loaded.data.plan || { years: [] },
};

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(payload), 'utf8');
const kb = (fs.statSync(OUT).size / 1024).toFixed(0);
console.log('  · 数据源：' + loaded.from);
console.log('  · ' + payload.coins.length + ' 个品种 · ' + payload.seriesMeta.length + ' 个系列 · '
  + (payload.plan.years || []).length + ' 年发行计划');
console.log('  · 已写入 ' + path.relative(ROOT, OUT) + '（' + kb + ' KB）');
