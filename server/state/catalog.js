'use strict';
/**
 * 目录域运行时状态（state 层）。
 *
 * 这里只放「启动时从 public/data 读进内存、之后由管理端原地修改」的只读/半只读数据：
 *
 *   SEED      发行清单（coins.json）—— 管理端改参数会原地改这批对象再落盘
 *   DESC      品种官方介绍（descriptions.json）
 *   PLAN      年度发行计划（plan.json）
 *   GALLERY   多图索引（gallery.json）+ GALLERY_VER 破缓存版本号
 *   IMG_SET   有主图的品种编号；IMG_REAL 有实拍图的编号
 *   PM_*      贵金属可收藏名称白名单（启动时从数据库装载）
 *
 * 为什么单独成层：这些对象以前长在 legacy/api-handler.js 里，于是 coin/series/plan/image
 * 四个 service 为了取一份 SEED 都得 require 那个 1500 行的处理器，形成反向依赖。
 * 现在依赖方向是 routes/services → state，state 不认识任何上层。
 *
 * 写入口只有三个：loadSeed()（启动一次）、setPlan()、touchGallery()。
 * 需要原地改 coin 对象的写服务请走 state().seed，**不要**在这里塞业务规则。
 */
const fs = require('fs');
const path = require('path');

const config = require('../config');

const PUBLIC_DIR = config.PUBLIC_DIR;
const PLAN_FILE = config.PLAN_FILE;
const GALLERY_FILE = config.GALLERY_FILE;

/** @type {{coins: object[], series: object, sets?: object, defaults?: object[]}} */
let SEED = { coins: [], series: {}, defaults: [] };
/** 名称 → 品种对象 */
let COIN_BY_NAME = new Map();
/** 贵金属可收藏名称白名单：名称 → 行 */
let PM_BY_NAME = new Map();
/** 有主图（NNN.jpg）的品种编号，升序 */
let IMG_SET = [];
/** 有官方实拍图的品种编号 */
let IMG_REAL = [];
/** 品种编号 → [{f,k}] 多图 */
let GALLERY = {};
/** gallery.json 的 mtime，用来给图片 URL 加 ?v= 破缓存 */
let GALLERY_VER = '';
/** 品种名 → 官方介绍 */
let DESC = {};
/** 年度发行计划 */
let PLAN = { years: [] };

/**
 * 从 public/data 载入全部目录数据（进程启动时调一次）。
 *
 * 任何一份数据缺失都不致命：对应的空值兜底，服务继续跑（历史行为一致）。
 *
 * @returns {void}
 */
function loadSeed() {
  const raw = fs.readFileSync(config.SEED_FILE, 'utf8');
  SEED = JSON.parse(raw);
  COIN_BY_NAME = new Map(SEED.coins.map((c) => [c.name, c]));

  const imgDir = path.join(PUBLIC_DIR, 'img');
  try {
    IMG_SET = fs.readdirSync(imgDir)
      .filter((f) => /^\d{3}\.jpg$/i.test(f))
      .map((f) => parseInt(f.slice(0, 3), 10))
      .sort((a, b) => a - b);
  } catch {
    IMG_SET = [];
  }

  // 实拍 / 示意图 归属（tools/fill_images.py 生成）
  try {
    const m = JSON.parse(fs.readFileSync(path.join(PUBLIC_DIR, 'data', 'images.json'), 'utf8'));
    IMG_REAL = Array.isArray(m.real) ? m.real : [];
  } catch {
    IMG_REAL = [];
  }
  try {
    DESC = JSON.parse(fs.readFileSync(path.join(PUBLIC_DIR, 'data', 'descriptions.json'), 'utf8'));
  } catch {
    DESC = {};
  }
  try {
    PLAN = JSON.parse(fs.readFileSync(PLAN_FILE, 'utf8'));
    const planN = (PLAN.years || []).reduce((a, y) => a + (y.items || []).length, 0);
    console.log(`[boot] 发行计划 ${(PLAN.years || []).length} 个年度 / ${planN} 个项目`);
  } catch {
    PLAN = { years: [] };
  }
  try {
    const gpath = path.join(PUBLIC_DIR, 'data', 'gallery.json');
    const g = JSON.parse(fs.readFileSync(gpath, 'utf8'));
    GALLERY = g && g.coins ? g.coins : {};
    // 图片地址带 ?v=<gallery mtime>：换图后 URL 变化，绕开 /img/ 的 7 天强缓存
    GALLERY_VER = String(Math.round(fs.statSync(gpath).mtimeMs)).slice(-8);
  } catch {
    GALLERY = {};
    GALLERY_VER = '';
  }

  const galCount = Object.keys(GALLERY).reduce((a, k) => a + (GALLERY[k] || []).length, 0);
  console.log(`[boot] 发行清单 ${SEED.coins.length} 个品种，图片 ${IMG_SET.length} 张（实拍 ${IMG_REAL.length}），多图 ${galCount} 张，官方介绍 ${Object.keys(DESC).length} 条`);

  // SEO 渲染与这里共用同一份 SEED/DESC 对象（渲染代码逐字保留，不做改写）
  require('../services/seo').setData({ seed: SEED, desc: DESC });
}

/**
 * 全部运行时数据的只读视图。
 *
 * @returns {{seed: object, desc: object, plan: object, gallery: object, galleryVer: string, imgSet: number[], imgReal: number[]}} 快照引用
 */
function state() {
  return {
    seed: SEED,
    desc: DESC,
    plan: PLAN,
    gallery: GALLERY,
    galleryVer: GALLERY_VER,
    imgSet: IMG_SET,
    imgReal: IMG_REAL
  };
}

/**
 * 发行计划整份替换后刷新内存（管理端保存成功后调用，bootstrap 立即生效）。
 *
 * @param {object} next 新计划对象
 * @returns {void}
 */
function setPlan(next) {
  PLAN = next;
}

/**
 * 把内存里的图库写回文件（后台改图后调用），并刷新破缓存版本号。
 *
 * @returns {void}
 */
function writeGallery() {
  const doc = { updated: new Date().toISOString().slice(0, 10), coins: GALLERY };
  fs.writeFileSync(GALLERY_FILE, JSON.stringify(doc) + '\n', 'utf8');
  // 关键：galleryVer 原本只在服务启动时算一次，管理端换图后它不变，
  // 前台 /img/ 的 7 天缓存就会一直显示旧图（比如换了正面仍显示背面）。
  // 每次写 gallery 同步刷新内存版本号，图片 URL 的 ?v= 立即失效。
  GALLERY_VER = String(Date.now()).slice(-8);
}

/** 图片服务的别名：语义上“图片变了”，实现就是重写 gallery.json */
function touchGallery() {
  writeGallery();
}

/**
 * 启动时从数据库装载贵金属名称白名单（唯一可收藏的 pm 品种）。
 *
 * @param {import('mysql2/promise').Pool} pool 连接池
 * @returns {Promise<number>} 白名单条数
 */
async function loadPmNames(pool) {
  try {
    const [rows] = await pool.query('SELECT code, name FROM cl_ecgci_pm');
    PM_BY_NAME = new Map(rows.map((r) => [r.name, r]));
    return PM_BY_NAME.size;
  } catch (e) {
    PM_BY_NAME = new Map();
    return 0;
  }
}

/**
 * 从发行计划里按 key 找项目（预约提醒用）。
 *
 * @param {string} key 项目 key
 * @returns {object|null} 带 year/publishedAt 的项目
 */
function findPlanItem(key) {
  const plan = (PLAN && PLAN.years) ? PLAN : null;
  if (!plan) return null;
  for (const y of plan.years) {
    const hit = (y.items || []).filter((it) => it.key === key)[0];
    if (hit) return Object.assign({ year: y.year, publishedAt: y.publishedAt }, hit);
  }
  return null;
}

/**
 * 判断某个名称是不是合法品种（普通纪念币 或 可收藏贵金属）。
 *
 * @param {string} name 品种名
 * @returns {boolean} 是否存在
 */
function hasCoin(name) {
  return COIN_BY_NAME.has(name) || PM_BY_NAME.has(name);
}

module.exports = {
  PUBLIC_DIR: PUBLIC_DIR,
  PLAN_FILE: PLAN_FILE,
  GALLERY_FILE: GALLERY_FILE,

  loadSeed: loadSeed,
  loadPmNames: loadPmNames,
  state: state,
  setPlan: setPlan,
  touchGallery: touchGallery,
  writeGallery: writeGallery,
  findPlanItem: findPlanItem,
  hasCoin: hasCoin
};
