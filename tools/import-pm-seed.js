'use strict';
/**
 * 贵金属种子导入（T04）
 *
 *   node tools/import-pm-seed.js                 # 默认 dry-run：只校验、不写
 *   node tools/import-pm-seed.js --apply         # db：事务 upsert cl_coins + cl_pm_pieces
 *                                                # json：种子即数据源，仅提示（无需导入）
 *   node tools/import-pm-seed.js --apply --verify # 导入后逐套比对规格行数与求和
 *   node tools/import-pm-seed.js --apply --publish # 显式上架（默认不自动 publish）
 *
 * 幂等：按 no upsert；同 no 名称不一致直接报错，不覆盖人工核验过的数据。
 * 不做任何 DELETE；套内规格用「整份替换」（先删该套，再按 seq 插入）。
 * 所有口径与校验都来自 schemas/pm.js —— 这里不重写规则。
 */
const fs = require('fs');

const config = require('../server/config');
const pmSchema = require('../server/schemas/pm');
const common = require('../server/schemas/common');
const pmService = require('../server/services/pm.service');
const { createDataSource } = require('../server/services/data-source');
const runner = require('../server/migrations/runner');

/**
 * 校验整份种子（任一失败即中止，不写一行）。
 *
 * @param {object} doc 种子文档
 * @returns {{ok:boolean,errors:string[],stats:object}} 结果
 */
function validateSeed(doc) {
  const errors = [];
  const sets = doc && Array.isArray(doc.sets) ? doc.sets : [];
  const stats = { sets: sets.length, pieces: 0, units: (doc && doc.units) || null };

  if (!sets.length) errors.push('种子里没有 sets');

  sets.forEach((s, i) => {
    const expectNo = common.LEGACY_NO_MAX + 1 + i;
    if (Number(s.no) !== expectNo) errors.push('第 ' + i + ' 套的 no 应为 ' + expectNo + '，实际 ' + s.no);
    if (s.category !== 'precious_metal') errors.push('no=' + s.no + ' 的 category 必须是 precious_metal');
    if (!Number(s.is_set)) errors.push('no=' + s.no + ' 必须 is_set=1（A1 一「套」一行）');
    if (s.mintage !== null && s.mintage !== undefined) errors.push('no=' + s.no + ' 的套级 mintage 必须为 NULL（A3）');
    if (s.weight_g !== null && s.weight_g !== undefined) errors.push('no=' + s.no + ' 的套级 weight_g 必须为 NULL（A2）');

    const check = pmSchema.validateSet(Object.assign({}, s, { no: s.no }), { exists: true });
    if (!check.ok) {
      check.errors.forEach((e) => errors.push('no=' + s.no + ' ' + e.field + '：' + e.error));
    }

    const sum = pmSchema.summarizePieces(s.pieces || []);
    stats.pieces += sum.count;
    if (sum.setWeightG !== Number(s.set_weight_g)) {
      errors.push('no=' + s.no + ' set_weight_g=' + s.set_weight_g + ' 与明细求和 ' + sum.setWeightG + ' 不一致（不猜、不补估）');
    }
    if (sum.setFaceTotal !== Number(s.set_face_total)) {
      errors.push('no=' + s.no + ' set_face_total=' + s.set_face_total + ' 与明细求和 ' + sum.setFaceTotal + ' 不一致');
    }
    if (sum.count !== Number(s.set_pieces)) {
      errors.push('no=' + s.no + ' set_pieces=' + s.set_pieces + ' 与明细行数 ' + sum.count + ' 不一致');
    }
    // 逐枚发行量的单位必须是「枚」，不能混进存量普通币的「万枚」
    (s.pieces || []).forEach((p) => {
      const unit = p.mintage_unit || (doc.units && doc.units.max_mintage) || 'piece';
      if (unit !== 'piece') errors.push('no=' + s.no + ' 明细 seq=' + p.seq + ' 的发行量单位必须是 piece（枚），实际 ' + unit);
    });
  });

  return { ok: errors.length === 0, errors: errors, stats: stats };
}

/**
 * 打印导入计划。
 *
 * @param {object} doc 种子文档
 * @param {object} check 校验结果
 * @returns {void}
 */
function printPlan(doc, check) {
  console.log('[pm-seed] 源文件：' + config.PM_SEED_FILE);
  console.log('[pm-seed] 统计：' + JSON.stringify(check.stats));
  (doc.sets || []).forEach((s) => {
    const sum = pmSchema.summarizePieces(s.pieces || []);
    console.log('  no=' + s.no + '  ' + s.name);
    console.log('    ' + sum.count + ' 枚 / ' + sum.setWeightG + ' g / ' + sum.setFaceTotal + ' 元'
      + ' / 最小发行量 ' + sum.minMintage + ' 枚 / 状态 ' + s.status + ' / verified=' + s.verified);
  });
}

/**
 * 主流程。
 *
 * @param {string[]} argv 参数
 * @returns {Promise<void>} 完成
 */
async function main(argv) {
  const args = argv.slice(2);
  const doApply = args.indexOf('--apply') >= 0;
  const doVerify = args.indexOf('--verify') >= 0;
  const doPublish = args.indexOf('--publish') >= 0;

  const doc = JSON.parse(fs.readFileSync(config.PM_SEED_FILE, 'utf8'));
  const check = validateSeed(doc);
  printPlan(doc, check);
  if (!check.ok) {
    console.error('[pm-seed] 种子校验失败，未写入任何数据：');
    check.errors.forEach((e) => console.error('  × ' + e));
    process.exit(1);
  }
  if (!doApply) {
    console.log('[pm-seed] dry-run 完成；加 --apply 才写入' + (config.DATA_SOURCE === 'db' ? '数据库' : '（json 模式种子即数据源）'));
    return;
  }

  if (config.DATA_SOURCE !== 'db') {
    console.log('[pm-seed] DATA_SOURCE=json：种子文件本身就是目录数据源，无需导入。');
    console.log('[pm-seed] ' + doc.sets.length + ' 套 / ' + check.stats.pieces + ' 枚规格（status=draft）已对管理端可见。');
    return;
  }

  const mysql = require('mysql2/promise');
  const pool = mysql.createPool(config.mysqlOptions());
  try {
    const migrations = runner.listMigrations();
    console.log('[pm-seed] 迁移文件：' + migrations.map((m) => m.version).join(', '));
    const ds = createDataSource({ mode: 'db', pool: pool });
    const svc = pmService.create({ dataSource: ds, withTx: async (fn) => {
      const conn = await pool.getConnection();
      try {
        await conn.beginTransaction();
        const r = await fn(conn);
        await conn.commit();
        return r;
      } catch (e) {
        try { await conn.rollback(); } catch (_) { /* ignore */ }
        throw e;
      } finally {
        conn.release();
      }
    } });

    // 同名断言：库里已有同 no 的品种必须同名，避免覆盖人工核验过的数据
    for (const s of doc.sets) {
      const existing = await ds.repos.coins.findByNo(s.no);
      if (existing && String(existing.name) !== String(s.name)) {
        throw new Error('no=' + s.no + ' 库内名称「' + existing.name + '」与种子「' + s.name + '」不一致，拒绝覆盖');
      }
    }

    for (const s of doc.sets) {
      const existing = await svc.findByNo(s.no);
      if (!existing) await svc.create(s);
      else await svc.update(s.no, s);
      console.log('[pm-seed] 已 upsert no=' + s.no + '（' + s.name + '）');
    }

    if (doPublish) {
      for (const s of doc.sets) {
        const r = await svc.setStatus(s.no, 'published');
        if (!r.ok) throw new Error('no=' + s.no + ' 上架失败：' + r.error);
      }
      console.log('[pm-seed] 已上架 ' + doc.sets.length + ' 套');
    }

    if (doVerify) {
      for (const s of doc.sets) {
        const row = await svc.findByNo(s.no);
        const sum = pmSchema.summarizePieces(row.pieces || []);
        if (!row || sum.count !== Number(s.set_pieces) || sum.setWeightG !== Number(s.set_weight_g)) {
          throw new Error('no=' + s.no + ' 导入后自检失败');
        }
      }
      const counts = await ds.repos.coins.countByCategory();
      console.log('[pm-seed] 行数自检：' + JSON.stringify(counts));
    }
  } finally {
    try { await pool.end(); } catch (e) { /* ignore */ }
  }
}

module.exports = { validateSeed: validateSeed, printPlan: printPlan };

if (require.main === module) {
  main(process.argv).catch((e) => {
    console.error('[pm-seed] 失败：' + (e && e.message ? e.message : e));
    process.exit(1);
  });
}
