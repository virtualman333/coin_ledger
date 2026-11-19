'use strict';
/**
 * 系列服务（T03）。
 *
 * 分层原则：routes 只解析参数，SQL 只在 repository，本文件负责规则与事务语义。
 *
 * 两个必须逐字复刻的旧语义：
 *   1. `listWithCount` 的「主系列回填」：
 *      计数按 seriesKeys（为空时回落 [series]）；把某个 key 从成员里移出时，
 *      如果它正好是 coin.series，就把 coin.series 改成 next[0] 或 ''；
 *      加进来时若 coin.series 为空则回填该 key。否则 seriesSvc.listWithCount
 *      会在 seriesKeys 为空时回退到 series，把已经移出的系列又算回去。
 *   2. create/update/remove/saveImage 的报错文案与截断长度（见 schemas/series.js）。
 *
 * 写入的灰度语义（arch 5.3）：
 *   - `DATA_SOURCE=json`（S0 现状）：仍走旧文件写（server/series.js + SEED_FILE），
 *     保证「保存后 bootstrap 立即生效」，管理端四页流程不回退；
 *   - `DATA_SOURCE=db`（S2/S3）：走 repositories 的事务写。
 *   repository 自身的 ReadonlyError 语义不变（直接调 repo 写仍会 503）。
 */
const fs = require('fs');
const path = require('path');

const config = require('../config');
const audit = require('../audit');
const legacySeries = require('../series');
const legacy = require('../legacy/api-handler');
const seriesSchema = require('../schemas/series');
const common = require('../schemas/common');

/**
 * 创建系列服务。
 *
 * @param {{dataSource: object, catalog: object, withTx: Function}} ctx 依赖
 * @returns {object} 服务实例
 */
function create(ctx) {
  const ds = ctx.dataSource;
  const catalog = ctx.catalog;
  const repos = ds.repos;

  return {
    mode: ds.mode,

    /**
     * 系列列表（含 count），与旧 seriesSvc.listWithCount 同口径。
     *
     * @returns {Promise<object[]>} 列表
     */
    async listWithCount() {
      const [seriesRows, coinRows] = await Promise.all([
        repos.series.listAll(),
        repos.coins.listPublished()
      ]);
      return catalog.seriesWithCount(seriesRows, coinRows);
    },

    /**
     * 新建系列。
     *
     * @param {object} body 表单
     * @returns {Promise<{ok:boolean,error?:string,item?:object,items?:object[]}>} 结果
     */
    async create(body) {
      if (ds.mode === 'json') {
        const r = legacySeries.create(body || {});
        return r.ok ? Object.assign({}, r, { items: await this.listWithCount() }) : r;
      }
      const rows = await repos.series.listAll();
      const built = seriesSchema.buildNew(body, rows.length);
      if (!built.ok) return { ok: false, error: built.error };
      if (rows.some((s) => s.seriesKey === built.item.key)) return { ok: false, error: '这个 key 已经存在' };
      await repos.series.upsert({
        seriesKey: built.item.key,
        name: built.item.name,
        descr: built.item.desc,
        img: built.item.img,
        imgFrom: null,
        sort: built.item.sort
      });
      return { ok: true, item: built.item, items: await this.listWithCount() };
    },

    /**
     * 编辑系列。
     *
     * @param {string} key 系列 key
     * @param {object} body 表单
     * @returns {Promise<{ok:boolean,error?:string,item?:object,items?:object[]}>} 结果
     */
    async update(key, body) {
      if (ds.mode === 'json') {
        const r = legacySeries.update(String(key), body || {});
        return r.ok ? Object.assign({}, r, { items: await this.listWithCount() }) : r;
      }
      const row = await repos.series.findByKey(String(key));
      if (!row) return { ok: false, error: '系列不存在' };
      const item = {
        seriesKey: row.seriesKey,
        name: row.name,
        desc: row.descr === undefined || row.descr === null ? '' : String(row.descr),
        img: row.img || '',
        sort: Number(row.sort || 0),
        imgFrom: row.imgFrom
      };
      seriesSchema.applyUpdate(item, body);
      await repos.series.upsert({
        seriesKey: item.seriesKey,
        name: item.name,
        descr: item.desc,
        img: item.img,
        imgFrom: item.imgFrom,
        sort: item.sort
      });
      return { ok: true, item: item, items: await this.listWithCount() };
    },

    /**
     * 删除系列，并清理所有品种的 seriesKeys（与旧 remove + SEED_FILE 写回一致）。
     *
     * @param {string} key 系列 key
     * @param {string} actor 操作人
     * @param {string} ip 来源 IP
     * @returns {Promise<{ok:boolean,error?:string,touched?:number,items?:object[]}>} 结果
     */
    async remove(key, actor, ip) {
      const rows = await repos.series.listAll();
      if (!rows.some((s) => s.seriesKey === String(key))) return { ok: false, error: '系列不存在' };

      if (ds.mode === 'json') {
        const r = legacySeries.remove(String(key), legacy.state().seed.coins);
        if (!r.ok) return r;
        fs.writeFileSync(config.SEED_FILE, JSON.stringify(legacy.state().seed) + '\n', 'utf8');
        const result = { ok: true, touched: r.touched, items: await this.listWithCount() };
        audit.log(actor, 'series.delete', String(key), '清理 ' + r.touched + ' 个品种', ip);
        return result;
      }

      const coins = await repos.coins.listAll();
      let touched = 0;
      await ctx.withTx(async (conn) => {
        await repos.series.remove(String(key), conn);
        for (const c of coins) {
          const keys = Array.isArray(c.seriesKeys) ? c.seriesKeys : (c.series ? [c.series] : []);
          if (keys.indexOf(String(key)) < 0) continue;
          const next = keys.filter((k) => k !== String(key));
          const patch = {
            series: c.series === String(key) ? (next[0] || '') : c.series,
            series_keys: next
          };
          await repos.coins.update(c.no, patch, conn);
          touched += 1;
        }
      });
      audit.log(actor, 'series.delete', String(key), '清理 ' + touched + ' 个品种', ip);
      return { ok: true, touched: touched, items: await this.listWithCount() };
    },

    /**
     * 保存系列卡图（base64 → public/img/series/<key>-<ts>.jpg）。
     *
     * @param {string} key 系列 key
     * @param {unknown} dataUrl data URL
     * @returns {Promise<{ok:boolean,error?:string,img?:string,size?:number}>} 结果
     */
    async saveImage(key, dataUrl) {
      // 两种模式都落文件：卡图本来就在 public/img/series/，库里只存路径
      return legacySeries.saveImage(String(key), dataUrl);
    },

    /**
     * 整份设置系列成员（一次请求完成增减，避免逐条 PATCH 被限流打断）。
     *
     * @param {string} key 系列 key
     * @param {unknown} ids 成员编号数组
     * @param {string} actor 操作人
     * @param {string} ip 来源 IP
     * @returns {Promise<object>} {ok,key,count,changed,series}
     */
    async setMembers(key, ids, actor, ip) {
      const k = String(key === undefined || key === null ? '' : key).trim();
      const items = await this.listWithCount();
      if (!items.some((s) => s.key === k)) return { ok: false, error: '系列不存在' };
      if (!Array.isArray(ids)) return { ok: false, error: '缺少 ids 数组' };

      const want = new Set(ids.map(Number));
      let changed = 0;

      if (ds.mode === 'json') {
        // 直接改 loadSeed() 载入的那批对象 —— 改完 bootstrap 立即生效
        const seed = legacy.state().seed;
        seed.coins.forEach((c) => {
          const id = Number(c.i) + 1;
          const cur = Array.isArray(c.seriesKeys) ? c.seriesKeys.slice() : (c.series ? [c.series] : []);
          const has = cur.indexOf(k) >= 0;
          const should = want.has(id);
          if (has === should) return;
          const next = has ? cur.filter((x) => x !== k) : cur.concat([k]);
          // ↓ 主系列回填语义，原样保留（不可简化）
          if (c.series === k && !should) c.series = next[0] || '';
          if (!c.series && should) c.series = k;
          c.seriesKeys = next;
          changed += 1;
        });
        if (changed) fs.writeFileSync(config.SEED_FILE, JSON.stringify(seed) + '\n', 'utf8');
      } else {
        const coins = await repos.coins.listAll();
        await ctx.withTx(async (conn) => {
          for (const c of coins) {
            const id = Number(c.no);
            const cur = Array.isArray(c.seriesKeys) ? c.seriesKeys.slice() : (c.series ? [c.series] : []);
            const has = cur.indexOf(k) >= 0;
            const should = want.has(id);
            if (has === should) continue;
            const next = has ? cur.filter((x) => x !== k) : cur.concat([k]);
            const nextSeries = (c.series === k && !should) ? (next[0] || '')
              : ((!c.series && should) ? k : c.series);
            await repos.coins.update(id, { series: nextSeries, series_keys: next }, conn);
            changed += 1;
          }
        });
      }

      if (changed) {
        audit.log(actor, 'series.members', k, '变更 ' + changed + ' 个品种 / 现有 ' + want.size + ' 个成员', ip);
      }
      return { ok: true, key: k, count: want.size, changed: changed, series: await this.listWithCount() };
    }
  };
}

module.exports = { create: create };
