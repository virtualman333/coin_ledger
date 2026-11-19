'use strict';
/**
 * DB → JSON 导出（回滚资产 + 小程序打包源）
 *
 *   node tools/export-json.js                    # 写 public/data/*.json（原子替换）+ data/exports/<ISO>/
 *   node tools/export-json.js --out /tmp/x       # 只写指定目录（迁移验收 / 小程序打包）
 *   node tools/export-json.js --from-json        # 数据源用 JSON 仓储（离线自检：JSON→JSON 应零漂移）
 *   node tools/export-json.js --no-verify        # 跳过导出后的自动 diff
 *
 * 产物必须是「与现有 6 个 JSON 完全同构」的结构（键名/嵌套/类型一致），
 * 唯一有意差异：coins.json 的 meta.count 写真实条数（前端不读它）。
 *
 * 为什么需要这个工具（arch 5.2 / H6）：
 *   1. 回滚资产：库里出问题时，切 DATA_SOURCE=json 就能照旧跑；
 *   2. 三端同源：小程序包由 export 产物打包，不再各自查库；
 *   3. 验收：`diff-catalog` 拿它和基线比对，逐字段证明零漂移。
 */
const fs = require('node:fs');
const path = require('node:path');

const config = require('../server/config');
const { createDataSource } = require('../server/services/data-source');
const catalog = require('../server/services/catalog.service');
const diffCatalog = require('./diff-catalog');

const FILES = ['coins.json', 'descriptions.json', 'series.json', 'images.json', 'plan.json', 'gallery.json'];

/**
 * 读目标目录里的现有文件（用于保留 updated / note 这类文档级戳）。
 *
 * 回退链：先看调用方给的输出目录（可能已经有上一轮产物），再看仓库里的
 * public/data —— `--out` 指向**全新空目录**时，series.json 的 note 与
 * updated/note 这类「文档级戳」并不在数据库里，必须能从基线取到。
 * 否则 diff:catalog 会把 note 判成实质差异（QA Step2 实测过这个坑）。
 *
 * @param {string} dir 目录
 * @param {string} file 文件名
 * @returns {object} 解析结果或空对象
 */
function readExisting(dir, file) {
  const candidates = [path.join(dir, file), path.join(config.PUBLIC_DIR, 'data', file)];
  for (const candidate of candidates) {
    try {
      return JSON.parse(fs.readFileSync(candidate, 'utf8'));
    } catch (e) { /* 继续找下一个 */ }
  }
  return {};
}

/**
 * 组装 6 个产物文档。
 *
 * @param {import('../server/services/data-source').DataSource} ds 数据源
 * @param {string} baseDir 用于保留文档级戳的目录（通常是输出目录）
 * @returns {Promise<Object<string, object>>} 文件名 → 文档
 */
async function buildDocs(ds, baseDir) {
  const now = new Date();
  const repos = ds.repos;

  const [coinRows, descRows, seriesRows, setRows, imageRows, plan, defaults] = await Promise.all([
    repos.coins.listPublished(),
    repos.descriptions.listAll(),
    repos.series.listAll(),
    repos.sets.listAll(),
    repos.images.listAll(),
    repos.plan.get(),
    repos.defaultHoldings.listAll()
  ]);

  /* ---- coins.json：coins 按 no 升序（与现状一致），series/sets/defaults 平铺 ---- */
  const sortedCoins = coinRows.slice().sort((a, b) => Number(a.no) - Number(b.no));
  const coinsDoc = {
    meta: {
      count: sortedCoins.length,
      generated: now.toISOString()
    },
    series: catalog.projectLegacySeriesMap(seriesRows, sortedCoins),
    coins: sortedCoins.map((r) => catalog.projectLegacyCoin(r, { withExtras: false })),
    defaults: defaults.map((d) => {
      const item = {
        name: d.name,
        rolls: Number(d.rolls || 0),
        cost: Number(d.cost || 0),
        market: Number(d.market || 0),
        group: d.grp || '独立藏品'
      };
      if (d.sep) item.sep = true;
      return item;
    }),
    sets: catalog.projectLegacySets(setRows)
  };

  /* ---- descriptions.json：key = no 字符串，按 no 升序，缺的 9 条照缺 ---- */
  const descDoc = {};
  descRows.slice().sort((a, b) => Number(a.coinNo) - Number(b.coinNo)).forEach((r) => {
    descDoc[String(r.coinNo)] = catalog.projectLegacyDesc(r);
  });

  /* ---- series.json：items 键序 key,name,desc,img,sort,imgFrom ---- */
  const oldSeries = readExisting(baseDir, 'series.json');
  const seriesDoc = {
    updated: oldSeries.updated || now.toISOString().slice(0, 10),
    note: oldSeries.note || '',
    items: seriesRows.slice().sort((a, b) => (Number(a.sort || 0) - Number(b.sort || 0))
      || String(a.seriesKey).localeCompare(String(b.seriesKey)))
      .map((s) => {
        const item = {
          key: s.seriesKey,
          name: s.name,
          desc: s.descr === undefined || s.descr === null ? '' : String(s.descr),
          img: s.img === undefined || s.img === null ? '' : String(s.img),
          sort: Number(s.sort || 0)
        };
        if (s.imgFrom !== undefined && s.imgFrom !== null) item.imgFrom = String(s.imgFrom);
        return item;
      })
  };

  /* ---- images.json：real = 有实拍主图的 no；mock = 占位图 no ---- */
  const oldImages = readExisting(baseDir, 'images.json');
  const mockSet = {};
  imageRows.forEach((r) => { if (r.isMock) mockSet[Number(r.coinNo)] = true; });
  const imagesDoc = {
    real: imageRows.filter((r) => r.kind === 'main' && !r.isMock).map((r) => Number(r.coinNo))
      .filter((v, i, arr) => arr.indexOf(v) === i).sort((a, b) => a - b),
    mock: Object.keys(mockSet).map(Number).sort((a, b) => a - b),
    updated: oldImages.updated || now.toISOString().slice(0, 10)
  };

  /* ---- gallery.json：{ updated, coins: { no: [{f,k}] } } ---- */
  const oldGallery = readExisting(baseDir, 'gallery.json');
  const galleryDoc = {
    updated: oldGallery.updated || now.toISOString().slice(0, 10),
    coins: catalog.projectLegacyGallery(imageRows)
  };

  /* ---- plan.json：updated/note 用库里的（plan.repo 已保留），years 逐字还原 ---- */
  const planDoc = catalog.projectLegacyPlan(plan);

  return {
    'coins.json': coinsDoc,
    'descriptions.json': descDoc,
    'series.json': seriesDoc,
    'images.json': imagesDoc,
    'plan.json': planDoc,
    'gallery.json': galleryDoc
  };
}

/**
 * 原子写一个 JSON 文件（tmp + rename，避免半截文件被站点读到）。
 *
 * @param {string} dir 目录
 * @param {string} file 文件名
 * @param {object} doc 文档
 * @returns {number} 字节数
 */
function writeJson(dir, file, doc) {
  fs.mkdirSync(dir, { recursive: true });
  const target = path.join(dir, file);
  const tmp = target + '.tmp';
  const text = JSON.stringify(doc) + '\n';
  fs.writeFileSync(tmp, text, 'utf8');
  fs.renameSync(tmp, target);
  return Buffer.byteLength(text);
}

/**
 * 写整套产物。
 *
 * @param {string} dir 目录
 * @param {Object<string, object>} docs 文档
 * @returns {Object<string, number>} 文件名 → 字节数
 */
function writeDocs(dir, docs) {
  const sizes = {};
  FILES.forEach((f) => { sizes[f] = writeJson(dir, f, docs[f]); });
  return sizes;
}

/**
 * 主流程。
 *
 * @param {string[]} argv 命令行参数
 * @returns {Promise<void>} 完成
 */
async function main(argv) {
  const args = argv.slice(2);
  const get = (flag, def) => {
    const i = args.indexOf(flag);
    return i >= 0 ? args[i + 1] : def;
  };
  const fromJson = args.indexOf('--from-json') >= 0;
  const outDir = path.resolve(get('--out', path.join(config.PUBLIC_DIR, 'data')));
  const noVerify = args.indexOf('--no-verify') >= 0;
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');

  let pool = null;
  let ds = null;
  try {
    if (fromJson) {
      ds = createDataSource({ mode: 'json' });
      console.log('[export] 源 = JSON 仓储（离线自检模式）');
    } else {
      const mysql = require('mysql2/promise');
      pool = mysql.createPool(config.mysqlOptions());
      await pool.query('SELECT 1');
      ds = createDataSource({ mode: 'db', pool: pool });
      console.log('[export] 源 = MySQL ' + config.DB.host + ':' + config.DB.port + '/' + config.DB.database);
    }

    const docs = await buildDocs(ds, outDir);
    const sizes = writeDocs(outDir, docs);
    console.log('[export] 已写入 ' + outDir);
    Object.keys(sizes).forEach((f) => console.log('  · ' + f + '  ' + Math.round(sizes[f] / 1024) + 'KB'));

    // 时间戳快照（回滚资产）+ latest 指针目录（小程序打包源）
    if (args.indexOf('--snapshot') >= 0 || outDir === path.join(config.PUBLIC_DIR, 'data')) {
      const snapDir = path.join(config.EXPORT_DIR, stamp);
      writeDocs(snapDir, docs);
      const latest = path.join(config.EXPORT_DIR, 'latest');
      try { fs.rmSync(latest, { recursive: true, force: true }); } catch (e) { /* 首次没有 */ }
      fs.cpSync(snapDir, latest, { recursive: true });
      console.log('[export] 快照 ' + snapDir + '（并更新 latest）');
    }

    if (!noVerify) {
      const baseline = path.join(config.PUBLIC_DIR, 'data');
      if (outDir === baseline) {
        console.log('[export] 目标就是 public/data，跳过自比对（会自己和自己比）');
      } else {
        const result = diffCatalog.diffDirs(outDir, baseline, { strictKeyOrder: false });
        if (result.ok) {
          console.log('[export] 与 public/data 比对：结构一致，实质差异 0 处（允许差异 ' + result.allowed.length + ' 项）');
        } else {
          console.error('[export] 与 public/data 比对发现 ' + result.diffs.length + ' 处实质差异：');
          result.diffs.slice(0, 20).forEach((d) => {
            console.error('  × ' + d.file + (d.pointer || '/') + '：' + JSON.stringify(d.a) + ' ≠ ' + JSON.stringify(d.b));
          });
          process.exitCode = 1;
        }
      }
    }
  } finally {
    if (pool) { try { await pool.end(); } catch (e) { /* ignore */ } }
  }
}

module.exports = { buildDocs: buildDocs, writeDocs: writeDocs, writeJson: writeJson, FILES: FILES };

if (require.main === module) {
  main(process.argv).catch((e) => {
    console.error('[export] 失败：', e.message || e);
    process.exit(1);
  });
}
