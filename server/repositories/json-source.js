'use strict';
/**
 * JSON 数据源（DATA_SOURCE=json 的只读实现共用）。
 *
 * 与改造前的 loadSeed() 完全同源：读的是同一批文件（SEED_FILE / descriptions.json /
 * series.json / gallery.json / images.json / plan.json），只是按 mtime 缓存，
 * 这样管理端（仍在写文件的老路径）改完文件后，下一次读能自动看到新内容。
 *
 * 为什么单独一个文件：7 个 json repository 都要读文件，
 * 各自写一遍 fs.readFileSync + JSON.parse + try/catch 只会制造 7 份不一致的兜底值。
 */
const fs = require('fs');
const path = require('path');

const config = require('../config');

/** file → { mtimeMs, data } */
const cache = new Map();

/**
 * 读 JSON 文件，按 mtime 缓存；文件不存在或解析失败时返回 fallback 深拷贝。
 *
 * @param {string} file 绝对路径
 * @param {object} fallback 兜底值
 * @returns {object} 解析结果
 */
function readJson(file, fallback) {
  let st = null;
  try {
    st = fs.statSync(file);
  } catch (e) {
    return fallback;
  }
  const hit = cache.get(file);
  if (hit && hit.mtimeMs === st.mtimeMs) return hit.data;
  let data = fallback;
  try {
    data = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    data = fallback;
  }
  cache.set(file, { mtimeMs: st.mtimeMs, data: data });
  return data;
}

/** 清缓存（迁移/导出工具在同一进程里连跑多次时用） */
function clearCache() {
  cache.clear();
}

/** coins.json（品种 + series + sets + defaults） */
function coinsDoc() {
  return readJson(config.SEED_FILE, { meta: {}, series: {}, coins: [], defaults: [], sets: {} });
}

/** descriptions.json（key = 序号字符串 1..137） */
function descriptionsDoc() {
  return readJson(config.DESCRIPTIONS_FILE, {});
}

/** series.json（{ updated, note, items:[{key,name,desc,img,sort,imgFrom}] }） */
function seriesDoc() {
  return readJson(config.SERIES_FILE, { updated: '', note: '', items: [] });
}

/** gallery.json（{ updated, coins: { '1': [{f,k}] } }） */
function galleryDoc() {
  return readJson(config.GALLERY_FILE, { updated: '', coins: {} });
}

/** images.json（{ real:[no...], mock:[no...], updated }） */
function imagesDoc() {
  return readJson(config.IMAGES_FILE, { real: [], mock: [], updated: '' });
}

/** plan.json（{ updated, note, years:[...] }） */
function planDoc() {
  return readJson(config.PLAN_FILE, { updated: '', note: '', years: [] });
}

/** 目录绝对路径（文件名固定，只有 SEED/PLAN 可被环境变量改） */
const FILES = {
  seed: config.SEED_FILE,
  descriptions: config.DESCRIPTIONS_FILE,
  series: config.SERIES_FILE,
  gallery: config.GALLERY_FILE,
  images: config.IMAGES_FILE,
  plan: config.PLAN_FILE,
  dataDir: path.dirname(config.GALLERY_FILE)
};

module.exports = {
  readJson: readJson,
  clearCache: clearCache,
  coinsDoc: coinsDoc,
  descriptionsDoc: descriptionsDoc,
  seriesDoc: seriesDoc,
  galleryDoc: galleryDoc,
  imagesDoc: imagesDoc,
  planDoc: planDoc,
  FILES: FILES
};
