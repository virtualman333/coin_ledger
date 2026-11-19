'use strict';
/**
 * 目录 JSON → MySQL 迁移（幂等、零漂移、不做 DELETE）
 *
 *   node tools/migrate-catalog-to-db.js                 # 默认 --dry-run：只校验 + 打印计划
 *   node tools/migrate-catalog-to-db.js --apply         # 事务写入
 *   node tools/migrate-catalog-to-db.js --apply --verify  # 写后导出并与 public/data 逐字段 diff
 *   node tools/migrate-catalog-to-db.js --force         # 库内已有 seed_rev 时允许重跑（仍是 upsert）
 *   node tools/migrate-catalog-to-db.js --allow-drift   # 跳过条数断言（仅限明确知道原因时）
 *
 * 三条硬要求（arch 5.1）：
 *   1. **前置断言**：任一失败即中止，一行都不写；
 *   2. **幂等**：全部 upsert（冲突键 = no），跑两次结果一致；
 *   3. **不做 DELETE**：没有任何 `DELETE FROM cl_coins`；no = i + 1 原样写入，
 *      不依赖任何排序，绝不重新编号。
 *
 * 关于「同 no 的 name 必须一致」：如果库里已经有人工核验过的品种名，
 * 而 JSON 里还是旧名，直接用旧 JSON 覆盖等于丢掉人工修订 —— 所以这里报错停下，
 * 让人先决定「以库为准」还是「以文件为准」，而不是悄悄覆盖。
 */
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const config = require('../server/config');
const runner = require('../server/migrations/runner');
const schemaCoin = require('../server/schemas/coin');
const common = require('../server/schemas/common');
const { createDataSource } = require('../server/services/data-source');
const exportJson = require('./export-json');
const diffCatalog = require('./diff-catalog');

/** 期望的描述缺失集合（9 个品种历史上就没有公告原文，属正常） */
const EXPECTED_MISSING_DESC = [19, 26, 38, 59, 86, 87, 101, 130, 136];

/** 期望条数（与 arch 5.1 第 4 步一致） */
const EXPECTED_COUNTS = {
  coins: 137,
  defaults: 12,
  series: 20,
  sets: 21,
  descriptions: 128,
  images: 250,
  planYears: 2
};

/**
 * 读一个文件并算 sha256（用于把「本次迁移用的是哪份源文件」记进 cl_meta）。
 *
 * @param {string} file 路径
 * @returns {{text:string,sha256:string}} 内容与摘要
 */
function readWithHash(file) {
  const text = fs.readFileSync(file, 'utf8');
  return { text: text, sha256: crypto.createHash('sha256').update(text).digest('hex') };
}

/**
 * 载入全部源文件。
 *
 * @returns {object} 源数据与时序信息
 */
function loadSources() {
  const files = {
    coins: config.SEED_FILE,
    descriptions: config.DESCRIPTIONS_FILE,
    series: config.SERIES_FILE,
    images: config.IMAGES_FILE,
    plan: config.PLAN_FILE,
    gallery: config.GALLERY_FILE
  };
  const out = { files: files, sha256: {} };
  Object.keys(files).forEach((k) => {
    const r = readWithHash(files[k]);
    out.sha256[k] = r.sha256;
    out[k] = JSON.parse(r.text);
  });
  return out;
}

/**
 * 前置断言（不通过就不许写库）。
 *
 * @param {object} src loadSources() 的结果
 * @param {{allowDrift?: boolean}} [opts] 选项
 * @returns {{ok:boolean, errors:string[], stats:object}} 断言结果
 */
function validateSources(src, opts) {
  const options = opts || {};
  const errors = [];
  const coins = Array.isArray(src.coins.coins) ? src.coins.coins : [];
  const desc = src.descriptions || {};
  const galleryCoins = (src.gallery && src.gallery.coins) ? src.gallery.coins : {};
  const imageCount = Object.keys(galleryCoins).reduce((a, k) => a + (Array.isArray(galleryCoins[k]) ? galleryCoins[k].length : 0), 0);
  const planItems = ((src.plan && src.plan.years) || []).reduce((a, y) => a + ((y && y.items) || []).length, 0);
  const seriesKeys = {};
  coins.forEach((c) => {
    (Array.isArray(c.seriesKeys) && c.seriesKeys.length ? c.seriesKeys : [c.series])
      .filter(Boolean).forEach((k) => { seriesKeys[k] = true; });
  });

  const stats = {
    coins: coins.length,
    descriptions: Object.keys(desc).length,
    seriesDistinct: Object.keys(seriesKeys).length,
    series: ((src.series && src.series.items) || []).length,
    sets: Object.keys((src.coins && src.coins.sets) || {}).length,
    defaults: ((src.coins && src.coins.defaults) || []).length,
    galleryCoinKeys: Object.keys(galleryCoins).length,
    images: imageCount,
    real: ((src.images && src.images.real) || []).length,
    mock: (src.images && src.images.mock) || [],
    planYears: ((src.plan && src.plan.years) || []).length,
    planItems: planItems
  };

  if (!options.allowDrift) {
    if (stats.coins !== EXPECTED_COUNTS.coins) errors.push('品种数应为 ' + EXPECTED_COUNTS.coins + '，实际 ' + stats.coins);
    if (stats.descriptions !== EXPECTED_COUNTS.descriptions) errors.push('描述条数应为 ' + EXPECTED_COUNTS.descriptions + '，实际 ' + stats.descriptions);
    // 注：arch 5.1 写的是「series key 数 === 19」，实测 coins.json 引用 20 个不同 key
    // （与 series.json 的 20 条一一对应）。这里按实测口径断言，并额外校验「无悬空引用」。
    if (stats.seriesDistinct !== EXPECTED_COUNTS.series) errors.push('品种引用的系列数应为 ' + EXPECTED_COUNTS.series + '，实际 ' + stats.seriesDistinct);
    if (stats.series !== EXPECTED_COUNTS.series) errors.push('series.json items 应为 20，实际 ' + stats.series);
    if (stats.sets !== EXPECTED_COUNTS.sets) errors.push('套系应为 21，实际 ' + stats.sets);
    if (stats.defaults !== EXPECTED_COUNTS.defaults) errors.push('初始藏品模板应为 12，实际 ' + stats.defaults);
    if (stats.galleryCoinKeys !== EXPECTED_COUNTS.coins) errors.push('gallery 覆盖品种数应为 137，实际 ' + stats.galleryCoinKeys);
    if (stats.images !== EXPECTED_COUNTS.images) errors.push('图片张数应为 250，实际 ' + stats.images);
    if (stats.real !== 135) errors.push('实拍图品种数应为 135，实际 ' + stats.real);
    if (JSON.stringify(stats.mock) !== '[34,56]') errors.push('占位图品种应为 [34,56]，实际 ' + JSON.stringify(stats.mock));
    if (stats.planYears < 1 || stats.planItems !== 10) errors.push('发行计划应为 ≥1 个年度 / 10 个项目，实际 ' + stats.planYears + ' / ' + stats.planItems);
  }

  // 系列引用必须都能在 series.json 里找到（否则外键式语义断裂，前端会渲染空系列名）
  const knownSeries = new Set((((src.series && src.series.items) || [])).map((s) => String(s.key)));
  const dangling = Object.keys(seriesKeys).filter((k) => !knownSeries.has(k));
  if (dangling.length) errors.push('品种引用了不存在的系列：' + dangling.join(',') + '（series.json 里没有这些 key）');

  // i 必须是 0..n-1 连续（no = i + 1 的前提）
  for (let i = 0; i < coins.length; i += 1) {
    if (Number(coins[i].i) !== i) { errors.push('第 ' + i + ' 条的 i 应为 ' + i + '，实际 ' + coins[i].i + '（no = i+1 的前提被破坏）'); break; }
  }

  // 描述缺项必须 ⊆ 已知的 9 个
  const missing = [];
  for (let n = 1; n <= coins.length; n += 1) {
    if (!desc[String(n)]) missing.push(n);
  }
  const unexpected = missing.filter((n) => EXPECTED_MISSING_DESC.indexOf(n) < 0);
  if (unexpected.length) errors.push('出现了预期外的描述缺项：' + unexpected.join(',') + '（已知缺项只有 ' + EXPECTED_MISSING_DESC.join(',') + '）');
  stats.missingDesc = missing;

  return { ok: errors.length === 0, errors: errors, stats: stats };
}

/**
 * 把一条 coins.json 品种转成 cl_coins 的列值对象。
 *
 * 这里就是 3.2 字段映射表的实现：i → no = i+1、dia 双列、set → set_code、
 * limit/reserveLimit/setSize/specFrom → limit_qty/reserve_limit/set_size/spec_from。
 *
 * @param {object} c coins.json 的一条
 * @returns {object} 列名 → 值
 */
function coinColumns(c) {
  const no = Number(c.i) + 1;
  const kind = c.kind === 'note' ? 'note' : 'coin';
  const category = common.CATEGORY_OF_KIND[kind];
  const dia = schemaCoin.splitDia(c.dia);
  const series = c.series === undefined || c.series === null ? '' : String(c.series);
  const seriesKeys = Array.isArray(c.seriesKeys) && c.seriesKeys.length ? c.seriesKeys.map(String) : (series ? [series] : null);

  return {
    no: no,
    category: category,
    category_rank: common.CATEGORY_RANK[category],
    kind: kind,
    year: Number(c.year),
    name: String(c.name),
    series: series,
    series_keys: seriesKeys,
    face: Number(c.face) || 0,
    mintage: c.mintage === undefined || c.mintage === null ? null : Number(c.mintage),
    mintage_unit: 'wan_piece',
    material: c.material === undefined || c.material === null ? '' : String(c.material),
    dia: dia.dia,
    dia_text: dia.diaText,
    size: c.size === undefined ? null : String(c.size),
    thickness: c.thickness === undefined ? null : String(c.thickness),
    weight: c.weight === undefined ? null : String(c.weight),
    caster: c.caster === undefined ? null : String(c.caster),
    edge: c.edge === undefined ? null : String(c.edge),
    obverse: c.obverse === undefined ? null : String(c.obverse),
    reverse: c.reverse === undefined ? null : String(c.reverse),
    spec_from: c.specFrom === undefined ? null : String(c.specFrom),
    est: c.est === undefined || c.est === null ? null : Number(c.est),
    set_code: c.set === undefined ? 'single' : String(c.set),
    pieces: c.pieces === undefined ? 1 : Math.round(Number(c.pieces) || 1),
    set_size: c.setSize === undefined ? null : Number(c.setSize),
    limit_qty: c.limit === undefined ? null : Number(c.limit),
    reserve_limit: c.reserveLimit === undefined ? null : Number(c.reserveLimit),
    source_url: 'legacy:public/data/coins.json',
    verified: 0,
    status: 'published'
  };
}

/**
 * 把 descriptions.json 的一条转成列值对象。
 *
 * @param {number} no 品种编号
 * @param {object} d 描述对象
 * @returns {object} 列值
 */
function descriptionColumns(no, d) {
  const dateText = d.date === undefined || d.date === null ? null : String(d.date);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateText || '').trim());
  return {
    coin_no: no,
    title: d.title === undefined ? '' : String(d.title),
    url: d.url === undefined ? null : String(d.url),
    body: d.text === undefined ? '' : String(d.text),
    body_md: d.textMd === undefined ? null : String(d.textMd),
    published_on: m ? dateText : null,
    date_text: dateText,
    source: d.source === undefined ? null : String(d.source)
  };
}

/**
 * 生成写入计划（dry-run 打印用；不连库）。
 *
 * @param {object} src 源数据
 * @returns {object} 计划
 */
function buildPlan(src) {
  const coins = src.coins.coins || [];
  const desc = src.descriptions || {};
  const galleryCoins = (src.gallery && src.gallery.coins) || {};
  const imageRows = [];
  Object.keys(galleryCoins).map(Number).filter((n) => Number.isInteger(n)).sort((a, b) => a - b).forEach((no) => {
    (galleryCoins[String(no)] || []).forEach((it, i) => {
      if (!it || !it.f || !it.k) return;
      imageRows.push({ coin_no: no, kind: String(it.k), filename: String(it.f), ord: i, is_mock: 0 });
    });
  });
  return {
    coins: coins.map(coinColumns),
    descriptions: coins.map((c) => Number(c.i) + 1).filter((no) => desc[String(no)]).map((no) => descriptionColumns(no, desc[String(no)])),
    images: imageRows,
    defaults: ((src.coins && src.coins.defaults) || []).map((x, i) => ({
      ord: i, name: String(x.name), rolls: Math.round(Number(x.rolls) || 0),
      cost: Number(x.cost) || 0, market: Number(x.market) || 0,
      grp: x.group === undefined ? '独立藏品' : String(x.group), sep: x.sep ? 1 : 0
    })),
    series: ((src.series && src.series.items) || []).map((s) => ({
      series_key: String(s.key), name: String(s.name),
      descr: s.desc === undefined ? '' : String(s.desc),
      img: s.img === undefined ? '' : String(s.img),
      img_from: s.imgFrom === undefined ? null : String(s.imgFrom),
      sort: Number(s.sort) || 0
    })),
    sets: Object.keys((src.coins && src.coins.sets) || {}).map((code) => {
      const s = src.coins.sets[code] || {};
      return {
        set_code: code, name: String(s.name), unit: s.unit || '枚',
        total: Number(s.total) || 0, members: Number(s.members) || 0,
        size: s.size === undefined ? null : Number(s.size), kind: s.kind || null
      };
    })
  };
}

/** 事务内通用 upsert（列名来自本工具内部，不接受外部输入拼接） */
async function upsertRows(conn, table, rows, conflictUpdate) {
  if (!rows.length) return 0;
  const cols = Object.keys(rows[0]);
  const colSql = cols.map((c) => '`' + c + '`').join(', ');
  const mark = '(' + cols.map(() => '?').join(', ') + ')';
  const updates = conflictUpdate || cols.filter((c) => c !== 'no' && c !== 'coin_no' && c !== 'ord' && c !== 'series_key' && c !== 'set_code')
    .map((c) => '`' + c + '` = VALUES(`' + c + '`)').join(', ');
  const sql = 'INSERT INTO ' + table + ' (' + colSql + ') VALUES ' + mark
    + (updates ? ' ON DUPLICATE KEY UPDATE ' + updates : '');
  for (const row of rows) {
    const params = cols.map((c) => {
      const v = row[c];
      return Array.isArray(v) ? JSON.stringify(v) : v;
    });
    await conn.query(sql, params);
  }
  return rows.length;
}

/**
 * 写入前的同名断言：库里已有同 no 的品种时，name 必须一致。
 *
 * @param {object} conn 事务连接
 * @param {object[]} coinRows 待写行
 * @returns {Promise<void>} 完成
 * @throws {Error} 名称不一致时
 */
async function assertSameNames(conn, coinRows) {
  const nos = coinRows.map((r) => r.no);
  if (!nos.length) return;
  const [rows] = await conn.query('SELECT `no`, `name` FROM cl_coins WHERE `no` IN (' + nos.map(() => '?').join(',') + ')', nos);
  const byNo = new Map(rows.map((r) => [Number(r.no), String(r.name)]));
  const conflicts = [];
  coinRows.forEach((r) => {
    const existing = byNo.get(Number(r.no));
    if (existing !== undefined && existing !== String(r.name)) {
      conflicts.push('no=' + r.no + '：库内「' + existing + '」 vs 文件「' + r.name + '」');
    }
  });
  if (conflicts.length) {
    throw new Error('同 no 的品种名不一致，拒绝覆盖（请先确认以库还是以文件为准）：\n  ' + conflicts.join('\n  '));
  }
}

/**
 * 事务写入。
 *
 * @param {import('mysql2/promise').Pool} pool 连接池
 * @param {object} src 源数据
 * @returns {Promise<object>} 写入统计
 */
async function applyAll(pool, src) {
  const plan = buildPlan(src);
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    await assertSameNames(conn, plan.coins);
    const coinsWritten = await upsertRows(conn, 'cl_coins', plan.coins);
    const defaultsWritten = await upsertRows(conn, 'cl_default_holdings', plan.defaults);
    const seriesWritten = await upsertRows(conn, 'cl_series', plan.series);
    const setsWritten = await upsertRows(conn, 'cl_sets', plan.sets);
    const descWritten = await upsertRows(conn, 'cl_coin_descriptions', plan.descriptions);
    const imagesWritten = await upsertRows(conn, 'cl_coin_images', plan.images);

    // 发行计划：整份替换（cl_plan_doc 一行 + cl_plan_years 按 ord）
    const planDoc = src.plan || { years: [] };
    await conn.query(
      'INSERT INTO cl_plan_doc (id, updated, note) VALUES (1, ?, ?) ON DUPLICATE KEY UPDATE updated = VALUES(updated), note = VALUES(note)',
      [planDoc.updated ? String(planDoc.updated).slice(0, 10) : null, planDoc.note === undefined ? null : String(planDoc.note)]
    );
    // 这里只删计划年度（整份替换语义），不碰 cl_coins
    await conn.query('DELETE FROM cl_plan_years');
    const years = Array.isArray(planDoc.years) ? planDoc.years : [];
    for (let i = 0; i < years.length; i += 1) {
      const y = years[i] || {};
      await conn.query(
        `INSERT INTO cl_plan_years (year, published_at, published_by, source_url, source_text, items, ord)
         VALUES (?, ?, ?, ?, ?, CAST(? AS JSON), ?)`,
        [Number(y.year), y.publishedAt ? String(y.publishedAt).slice(0, 10) : null,
          y.publishedBy === undefined ? null : y.publishedBy,
          y.sourceUrl === undefined ? null : y.sourceUrl,
          y.sourceText === undefined ? null : y.sourceText,
          JSON.stringify(Array.isArray(y.items) ? y.items : []), i]
      );
    }

    // 图片的 is_mock 由 images.json 的 mock 决定（34/56 是占位图）
    const mock = new Set(((src.images && src.images.mock) || []).map(Number));
    if (mock.size) {
      await conn.query(
        'UPDATE cl_coin_images SET is_mock = 1 WHERE coin_no IN (' + Array.from(mock).map(() => '?').join(',') + ')',
        Array.from(mock)
      );
      await conn.query(
        'UPDATE cl_coin_images SET is_mock = 0 WHERE coin_no NOT IN (' + Array.from(mock).map(() => '?').join(',') + ')',
        Array.from(mock)
      );
    }

    // 元信息：seed_rev 让 --force 能判断「这是第几次迁移」，gallery_ver 给图片 URL 破缓存
    const seedRev = String(Date.now());
    const metaPairs = {
      'catalog.seed_rev': seedRev,
      'catalog.gallery_ver': String(Date.now()).slice(-8),
      'catalog.source_sha256': src.sha256.coins
    };
    for (const k of Object.keys(metaPairs)) {
      await conn.query('INSERT INTO cl_meta (k, v) VALUES (?, ?) ON DUPLICATE KEY UPDATE v = VALUES(v)', [k, metaPairs[k]]);
    }

    await conn.commit();
    return {
      coins: coinsWritten,
      defaults: defaultsWritten,
      series: seriesWritten,
      sets: setsWritten,
      descriptions: descWritten,
      images: imagesWritten,
      planYears: years.length,
      planItems: years.reduce((a, y) => a + ((y && y.items) || []).length, 0),
      seedRev: seedRev
    };
  } catch (e) {
    try { await conn.rollback(); } catch (rollbackErr) { /* ignore */ }
    throw e;
  } finally {
    conn.release();
  }
}

/**
 * 逐表行数断言（写后自检）。
 *
 * @param {import('mysql2/promise').Pool} pool 连接池
 * @returns {Promise<object>} 实际行数
 */
async function countAll(pool) {
  const q = async (sql) => {
    const [rows] = await pool.query(sql);
    return Number(rows[0].n);
  };
  return {
    coins: await q('SELECT COUNT(*) AS n FROM cl_coins'),
    defaults: await q('SELECT COUNT(*) AS n FROM cl_default_holdings'),
    series: await q('SELECT COUNT(*) AS n FROM cl_series'),
    sets: await q('SELECT COUNT(*) AS n FROM cl_sets'),
    descriptions: await q('SELECT COUNT(*) AS n FROM cl_coin_descriptions'),
    images: await q('SELECT COUNT(*) AS n FROM cl_coin_images'),
    planYears: await q('SELECT COUNT(*) AS n FROM cl_plan_years')
  };
}

/**
 * 主流程。
 *
 * @param {string[]} argv 命令行参数
 * @returns {Promise<void>} 完成
 */
async function main(argv) {
  const args = argv.slice(2);
  const doApply = args.indexOf('--apply') >= 0;
  const doVerify = args.indexOf('--verify') >= 0;
  const force = args.indexOf('--force') >= 0;
  const allowDrift = args.indexOf('--allow-drift') >= 0;

  console.log('[migrate] 源文件：' + config.SEED_FILE);
  const src = loadSources();
  const check = validateSources(src, { allowDrift: allowDrift });

  console.log('[migrate] 源数据统计：' + JSON.stringify(check.stats));
  if (!check.ok) {
    console.error('[migrate] 前置断言失败，未写入任何数据：');
    check.errors.forEach((e) => console.error('  × ' + e));
    process.exit(1);
  }

  const plan = buildPlan(src);
  console.log('[migrate] 写入计划：');
  console.log('   cl_coins             ' + plan.coins.length + ' 行');
  console.log('   cl_default_holdings  ' + plan.defaults.length + ' 行');
  console.log('   cl_series            ' + plan.series.length + ' 行');
  console.log('   cl_sets              ' + plan.sets.length + ' 行');
  console.log('   cl_coin_descriptions ' + plan.descriptions.length + ' 行（缺 ' + (plan.coins.length - plan.descriptions.length) + ' 条属正常）');
  console.log('   cl_coin_images       ' + plan.images.length + ' 行');
  console.log('   cl_plan_years        ' + (((src.plan && src.plan.years) || []).length) + ' 行（items 原样 JSON）');
  console.log('   保号：no = i + 1，1..' + plan.coins.length + '，无 DELETE');

  const migrations = runner.listMigrations();
  console.log('[migrate] 迁移脚本：' + migrations.map((m) => m.version + '(' + m.blocks.length + '块)').join(', '));

  if (!doApply) {
    const dry = await runner.apply(null, { dryRun: true });
    console.log('[migrate] dry-run：共 ' + dry.blocks + ' 个语句块待执行；加 --apply 才会写库');
    return;
  }

  const mysql = require('mysql2/promise');
  const pool = mysql.createPool(config.mysqlOptions());
  try {
    const probe = await runner.probe(pool);
    console.log('[migrate] 已连接 MySQL ' + probe.version + '（JSON 列：' + (probe.json ? '支持' : '不支持') + '）');
    if (!probe.json) throw new Error('当前 MySQL 不支持 JSON 列（需要 5.7+），无法继续');

    // --force：库内已有 seed_rev 时允许重跑（仍然走幂等 upsert，不做任何 DELETE）
    if (!force) {
      const [rows] = await pool.query("SELECT v FROM cl_meta WHERE k = 'catalog.seed_rev' LIMIT 1").catch(() => [[]]);
      if (rows && rows.length && rows[0].v) {
        throw new Error('库内已有 catalog.seed_rev=' + rows[0].v + '（说明迁移跑过）。'
          + '本次是幂等 upsert，确认无误请加 --force 重跑。');
      }
    }

    const mig = await runner.apply(pool, {});
    console.log('[migrate] 建表：已应用 [' + mig.applied.join(', ') + ']  跳过 [' + mig.skipped.join(', ') + ']');

    const written = await applyAll(pool, src);
    console.log('[migrate] 写入完成：' + JSON.stringify(written));

    const counts = await countAll(pool);
    console.log('[migrate] 行数自检：' + JSON.stringify(counts));
    const problems = Object.keys(EXPECTED_COUNTS).filter((k) => counts[k] !== EXPECTED_COUNTS[k]);
    if (problems.length) {
      throw new Error('行数与预期不符：' + problems.map((k) => k + ' 期望 ' + EXPECTED_COUNTS[k] + ' 实际 ' + counts[k]).join('；'));
    }

    if (doVerify) {
      const ds = createDataSource({ mode: 'db', pool: pool });
      const tmp = path.join(require('node:os').tmpdir(), 'cl-migrate-verify-' + Date.now());
      const docs = await exportJson.buildDocs(ds, config.PUBLIC_DIR ? path.join(config.PUBLIC_DIR, 'data') : tmp);
      exportJson.writeDocs(tmp, docs);
      const result = diffCatalog.diffDirs(tmp, path.join(config.PUBLIC_DIR, 'data'), { strictKeyOrder: false });
      if (result.ok) {
        console.log('[migrate] --verify：导出与 public/data 结构一致，实质差异 0 处（允许差异 ' + result.allowed.length + ' 项）');
      } else {
        console.error('[migrate] --verify：发现 ' + result.diffs.length + ' 处实质差异');
        result.diffs.slice(0, 20).forEach((d) => {
          console.error('  × ' + d.file + (d.pointer || '/') + '：' + JSON.stringify(d.a) + ' ≠ ' + JSON.stringify(d.b));
        });
        process.exitCode = 1;
      }
      try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) { /* ignore */ }
    }
  } finally {
    try { await pool.end(); } catch (e) { /* ignore */ }
  }
}

module.exports = {
  EXPECTED_COUNTS: EXPECTED_COUNTS,
  EXPECTED_MISSING_DESC: EXPECTED_MISSING_DESC,
  loadSources: loadSources,
  validateSources: validateSources,
  buildPlan: buildPlan,
  coinColumns: coinColumns,
  descriptionColumns: descriptionColumns,
  applyAll: applyAll,
  countAll: countAll
};

if (require.main === module) {
  main(process.argv).catch((e) => {
    console.error('[migrate] 失败：' + (e && e.message ? e.message : e));
    if (process.env.DEBUG) console.error(e);
    process.exit(1);
  });
}
