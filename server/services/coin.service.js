'use strict';
/**
 * 品种写服务（T03）。
 *
 * 从 legacy/api-handler.js 的 `applyCoinPatch`（批量）与 `PATCH /api/admin/coin`
 * 原样搬入：允许字段、数值规则、series/set/kind 校验、seriesKeys 主系列回填、
 * `{saved,failed}` / `{ok,coin,applied}` 响应结构都保持 legacy 语义。
 *
 * 写路径灰度（arch 5.3）：
 *   - json（S0 现状）：改 loadSeed() 载入的那批对象 + 原子写 SEED_FILE，
 *     bootstrap 立即生效（管理端「参数」页验收项）；
 *   - db：走 coin.repo.update，列名由 schemas/coin.js 白名单收敛，
 *     no/id 永不可写（repo 的 NEVER_UPDATE_COLUMNS + 库级触发器双保险）。
 */
const fs = require('fs');

const config = require('../config');
const audit = require('../audit');
const legacy = require('../legacy/api-handler');
const seriesSvc = require('../series');
const coinSchema = require('../schemas/coin');
const common = require('../schemas/common');

/** 批量保存允许的数值字段（legacy applyCoinPatch 口径：没有 setSize） */
const BATCH_NUM_FIELDS = { year: 1, face: 1, est: 1, mintage: 1, pieces: 1 };
/** 批量保存允许的文本字段 */
const BATCH_TXT_FIELDS = { material: 1, dia: 1, series: 1, set: 1, kind: 1 };
/** 单条编辑额外允许 setSize */
const SINGLE_NUM_FIELDS = { year: 1, face: 1, est: 1, mintage: 1, pieces: 1, setSize: 1 };

/**
 * 创建品种写服务。
 *
 * @param {{dataSource: object, catalog: object}} ctx 依赖
 * @returns {object} 服务实例
 */
function create(ctx) {
  const ds = ctx.dataSource;
  const catalog = ctx.catalog;
  const repos = ds.repos;
  const seed = legacy.state().seed;

  /**
   * 当前 seed（对象引用稳定，原地改即可）。
   *
   * @returns {object} SEED
   */
  function currentSeed() {
    return legacy.state().seed;
  }

  /**
   * 落盘 SEED_FILE（json 模式）。
   *
   * @returns {void}
   */
  function saveSeedFile() {
    fs.writeFileSync(config.SEED_FILE, JSON.stringify(currentSeed()) + '\n', 'utf8');
  }

  /**
   * 校验并应用一条批量 patch（原样复刻 applyCoinPatch）。
   *
   * @param {object} coin 品种对象（原地改）
   * @param {object} patch 待应用字段
   * @returns {object} 实际生效的字段
   */
  function applyBatchPatch(coin, patch) {
    const applied = {};
    Object.keys(patch || {}).forEach((k) => {
      const v = patch[k];
      if (BATCH_NUM_FIELDS[k]) {
        const n = Number(v);
        if (!isFinite(n) || n < 0) return;
        coin[k] = (k === 'year' || k === 'pieces') ? Math.round(n) : n;
        applied[k] = coin[k];
      } else if (BATCH_TXT_FIELDS[k]) {
        const str = String(v == null ? '' : v).trim();
        if (k === 'series' && !currentSeed().series[str]) return;
        if (k === 'set' && str !== 'single' && !(currentSeed().sets || {})[str]) return;
        if (k === 'kind' && str !== 'coin' && str !== 'note') return;
        if (k === 'dia' && str.length > 8) return;
        if (k === 'material' && str.length > 24) return;
        coin[k] = str;
        applied[k] = str;
      }
    });
    return applied;
  }

  return {
    mode: ds.mode,

    /**
     * GET /api/admin/coins：老形态全量（逐字保键序）。
     *
     * @returns {Promise<object>} {ok,coins,series,sets,gallery}
     */
    async adminList() {
      const [coins, series, sets, galleryRows] = await Promise.all([
        catalog.legacyCoins(),
        catalog.legacySeriesMap(await repos.series.listAll(), await repos.coins.listPublished()),
        catalog.legacySetsMap(await repos.sets.listAll()),
        ds.mode === 'json' ? Promise.resolve(null) : repos.images.listAll()
      ]);
      const gallery = ds.mode === 'json'
        ? legacy.state().gallery
        : catalog.projectLegacyGallery(galleryRows);
      return { ok: true, coins: coins, series: series, sets: sets, gallery: gallery };
    },

    /**
     * PATCH /api/admin/coins：批量修改（最多 300 条）。
     *
     * @param {object} body 请求体 {items:[{id,patch}]}
     * @param {string} actor 操作人
     * @param {string} ip 来源 IP
     * @returns {Promise<{status:number,body:object}>} 响应
     */
    async batchPatch(body, actor, ip) {
      const b = common.isPlainObject(body) ? body : {};
      const items = Array.isArray(b.items) ? b.items : [];
      if (!items.length) return { status: 400, body: { ok: false, error: '没有要保存的内容' } };
      if (items.length > 300) return { status: 400, body: { ok: false, error: '一次最多保存 300 条' } };

      const done = [];
      const failed = [];

      if (ds.mode === 'json') {
        const coins = currentSeed().coins;
        items.forEach((it) => {
          const id = Number(it && it.id);
          const coin = coins.filter((c) => Number(c.i) + 1 === id)[0];
          if (!coin) { failed.push({ id: id, error: '品种不存在' }); return; }
          const applied = applyBatchPatch(coin, (it && it.patch) || {});
          if (!Object.keys(applied).length) { failed.push({ id: id, error: '没有可保存的字段' }); return; }
          done.push({ id: id, applied: applied });
        });
        if (done.length) saveSeedFile();
      } else {
        for (const it of items) {
          const id = Number(it && it.id);
          const row = await repos.coins.findByNo(id);
          if (!row) { failed.push({ id: id, error: '品种不存在' }); continue; }
          const coerced = coinSchema.coercePatch((it && it.patch) || {}, ['year', 'face', 'est', 'mintage', 'pieces', 'material', 'dia', 'series', 'setCode', 'kind']);
          if (!Object.keys(coerced.applied).length) { failed.push({ id: id, error: '没有可保存的字段' }); continue; }
          await repos.coins.update(id, coerced.values);
          done.push({ id: id, applied: coerced.applied });
        }
      }

      if (done.length) {
        console.log('[admin] 批量修改 ' + done.length + ' 个品种');
        audit.log(actor, 'coins.batchUpdate', '', '修改 ' + done.length + ' 个品种', ip);
      }
      return { status: 200, body: { ok: failed.length === 0, saved: done.length, failed: failed } };
    },

    /**
     * PATCH /api/admin/coin：单条修改（含 seriesKeys 整份替换）。
     *
     * @param {object} body 请求体 {id,patch}
     * @param {string} actor 操作人
     * @param {string} ip 来源 IP
     * @returns {Promise<{status:number,body:object}>} 响应
     */
    async patchOne(body, actor, ip) {
      const b = common.isPlainObject(body) ? body : {};
      const id = Number(b.id);
      const patch = common.isPlainObject(b.patch) ? b.patch : {};

      const row = ds.mode === 'json' ? null : await repos.coins.findByNo(id);
      const coin = ds.mode === 'json'
        ? currentSeed().coins.filter((c) => Number(c.i) + 1 === id)[0]
        : row;
      if (!coin) return { status: 404, body: { ok: false, error: '品种不存在' } };

      const applied = {};
      const target = coin;
      const seed = currentSeed();

      Object.keys(patch).forEach((k) => {
        const v = patch[k];
        if (SINGLE_NUM_FIELDS[k]) {
          const n = Number(v);
          if (!isFinite(n) || n < 0) return;
          target[k] = (k === 'year' || k === 'pieces' || k === 'setSize') ? Math.round(n) : n;
          applied[k] = target[k];
        } else if (BATCH_TXT_FIELDS[k]) {
          const str = String(v == null ? '' : v).trim();
          if (k === 'series' && !seed.series[str]) return;
          if (k === 'set' && str !== 'single' && !(seed.sets || {})[str]) return;
          if (k === 'kind' && str !== 'coin' && str !== 'note') return;
          if (k === 'dia' && str.length > 8) return;
          if (k === 'material' && str.length > 24) return;
          if (k === 'series' && str !== target.series) {
            const extras = (target.seriesKeys || []).filter((x) => x !== target.series && x !== str);
            target.seriesKeys = [str].concat(extras);
          }
          target[k] = str;
          applied[k] = str;
        }
      });

      /* seriesKeys 整份替换 */
      if (Array.isArray(patch.seriesKeys)) {
        let validKeys;
        if (ds.mode === 'json') {
          validKeys = patch.seriesKeys
            .map((k) => String(k).trim())
            .filter((k) => seriesSvc.load().items.some((s) => s.key === k));
        } else {
          const items = await repos.series.listAll();
          validKeys = patch.seriesKeys
            .map((k) => String(k).trim())
            .filter((k) => items.some((s) => s.seriesKey === k));
        }
        target.seriesKeys = Array.from(new Set(validKeys));
        if (!target.seriesKeys.length && target.series) target.seriesKeys = [target.series];
        applied.seriesKeys = target.seriesKeys;
      }

      if (!Object.keys(applied).length) {
        return { status: 400, body: { ok: false, error: '没有可保存的字段' } };
      }

      if (ds.mode === 'json') {
        saveSeedFile();
      } else {
        // 列名映射只在 schemas/coin.js 里做；set → set_code，dia 双列规则除外（这里只改文本位）
        const values = {};
        Object.keys(applied).forEach((k) => {
          if (k === 'seriesKeys') values.series_keys = applied[k];
          else if (k === 'set') values.set_code = applied[k];
          else if (coinSchema.FIELDS[k]) values[coinSchema.FIELDS[k].col] = applied[k];
        });
        await repos.coins.update(id, values);
      }

      console.log('[admin] 修改品种 ' + id + ' ' + target.name + '：' + JSON.stringify(applied));
      audit.log(actor, 'coin.update', String(id), JSON.stringify(applied), ip);
      return { status: 200, body: { ok: true, coin: target, applied: applied } };
    }
  };
}

module.exports = { create: create, BATCH_NUM_FIELDS: BATCH_NUM_FIELDS, BATCH_TXT_FIELDS: BATCH_TXT_FIELDS };
