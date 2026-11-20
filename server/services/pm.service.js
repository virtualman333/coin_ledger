'use strict';
/**
 * 贵金属目录服务（T04）。
 *
 * 三条口径直接调用 schemas/pm.js（不重写规则）：
 *   A1 一「套」一行（no=138/139/140），套内规格在 pieces[]/cl_pm_pieces；
 *   A2 套级 weight_g 恒 NULL，用 set_weight_g（明细求和）；
 *   A3 套级 mintage 恒 NULL，逐枚发行量以「枚」存 pieces[].max_mintage。
 *
 * 写路径灰度：
 *   - json：写「种子文件」config.PM_SEED_FILE（可被环境变量指到临时副本，
 *     所以 admin 全流程可离线验证，不污染 public/data/*.json）；
 *   - db：cl_coins + cl_pm_pieces 同一事务（整份替换语义）。
 *
 * 发布闸门：只走 pmSchema.validateSet(row, {forPublish:true}) —— 未 verified
 * 或没有 source_url 一律 400，文案由 schema 给出 field 级错误。
 */
const fs = require('fs');
const path = require('path');

const config = require('../config');
const common = require('../schemas/common');
const pmSchema = require('../schemas/pm');
const coinSchema = require('../schemas/coin');
const source = require('../repositories/json-source');
// 只保留数据库模式：rowFromLegacy 原本来自已删除的 coin.repo.json.js，
// 这里内联一份等价实现（该函数仅由旧种子读取路径使用，db 模式不会走到）。
const coinRepoJson = {
  rowFromLegacy: function (c) {
    return Object.assign({}, c, {
      category: 'precious_metal', kind: 'coin',
      id: Number(c.i) + 1, no: Number(c.i) + 1,
      status: c.status || 'published',
    });
  }
};

/**
 * 读种子文档（按 mtime 缓存，写完自动失效）。
 *
 * @returns {{sets: object[]}} 种子文档
 */
function readSeed() {
  const doc = source.readJson(config.PM_SEED_FILE, { sets: [] });
  return doc && Array.isArray(doc.sets) ? doc : { sets: [] };
}

/**
 * 原子写种子文件。
 *
 * @param {object} doc 文档
 * @returns {void}
 */
function writeSeed(doc) {
  fs.mkdirSync(path.dirname(config.PM_SEED_FILE), { recursive: true });
  const tmp = config.PM_SEED_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(doc, null, 2) + '\n', 'utf8');
  fs.renameSync(tmp, config.PM_SEED_FILE);
  source.clearCache();
}

/**
 * 种子明细 → 对外 camelCase 明细（单位 piece 固定）。
 *
 * @param {object} p 种子明细
 * @returns {object} 明细
 */
function pieceFromSeed(p) {
  return {
    seq: Number(p.seq),
    name: String(p.name || ''),
    metal: String(p.metal || ''),
    weightG: Number(p.weight_g || 0),
    purity: Number(p.purity || 0),
    face: Number(p.face || 0),
    maxMintage: Number(p.max_mintage || 0),
    mintageUnit: 'piece',
    shape: p.shape || 'round',
    sizeText: p.size_text === undefined ? null : String(p.size_text),
    quality: p.quality || null,
    reverseText: p.reverse_text === undefined ? null : String(p.reverse_text)
  };
}

/**
 * 种子里的一套 → 与 coin.repo 同形状的 camelCase 行。
 *
 * @param {object} s 种子套
 * @returns {object} 行
 */
function rowFromSeed(s) {
  const row = coinRepoJson.rowFromLegacy({
    i: Number(s.no) - 1,
    year: s.year,
    name: s.name,
    series: s.series || 'PM',
    seriesKeys: Array.isArray(s.series_keys) ? s.series_keys : ['PM'],
    face: s.face,
    mintage: null,
    material: s.material || '',
    dia: null,
    kind: 'coin',
    est: null,
    set: 'single',
    pieces: s.set_pieces || 0,
    obverse: s.obverse,
    reverse: s.reverse,
    caster: s.caster
  });
  row.no = Number(s.no);
  row.id = Number(s.no);
  row.category = 'precious_metal';
  row.categoryRank = common.CATEGORY_RANK.precious_metal;
  row.mintageUnit = null;
  row.mintageNote = s.mintage_note || null;
  row.specFrom = null;
  row.setSize = s.set_pieces || 0;
  row.metal = s.metal || null;
  row.purity = s.purity === undefined || s.purity === null ? null : Number(s.purity);
  row.weightG = null;                         // A2：套级恒 NULL
  row.spec = s.spec || null;
  row.shape = s.shape || null;
  row.quality = s.quality || null;
  row.issueMethod = s.issue_method || 'unknown';
  row.issueDate = common.toDateOnly(s.issue_date);
  row.isSet = 1;
  row.setPieces = s.set_pieces || 0;
  row.setWeightG = s.set_weight_g === undefined || s.set_weight_g === null ? null : Number(s.set_weight_g);
  row.setFaceTotal = s.set_face_total === undefined || s.set_face_total === null ? null : Number(s.set_face_total);
  row.salesChannel = s.sales_channel || null;
  row.dealer = s.dealer || null;
  row.certificate = s.certificate || null;
  row.packaging = s.packaging || null;
  row.sourceUrl = s.source_url || '';
  row.sourceText = s.source_text || null;
  row.sourceDate = common.toDateOnly(s.source_date);
  row.verified = s.verified ? 1 : 0;
  row.status = s.status === 'published' ? 'published' : 'draft';
  row.pieces = Array.isArray(s.pieces) ? s.pieces.map(pieceFromSeed) : [];
  return row;
}

/**
 * normalized → 种子文件字段（snake_case，与种子结构一一对应）。
 *
 * @param {object} n normalized
 * @param {object} [base] 原套（保留未覆盖字段）
 * @returns {object} 种子套
 */
/**
 * 对外明细（camelCase）→ 种子文件明细（snake_case），两种形态都兼容。
 *
 * @param {object} p 明细
 * @returns {object} 种子明细
 */
function seedPieceFromCamel(p) {
  return {
    seq: Number(p.seq), name: String(p.name || ''), metal: String(p.metal || ''),
    weight_g: Number(p.weightG !== undefined ? p.weightG : p.weight_g),
    purity: Number(p.purity), face: Number(p.face),
    max_mintage: Number(p.maxMintage !== undefined ? p.maxMintage : p.max_mintage),
    shape: p.shape || 'round',
    size_text: p.sizeText !== undefined ? p.sizeText : p.size_text,
    quality: p.quality || null,
    reverse_text: p.reverseText !== undefined ? p.reverseText : p.reverse_text
  };
}

function toSeedSet(n, base) {
  return Object.assign({}, base || {}, {
    no: Number(n.no), category: n.category, year: n.year, name: n.name,
    series: n.series, series_keys: n.seriesKeys, kind: n.kind, face: n.face,
    mintage: null, mintage_note: n.mintageNote, material: n.material, metal: n.metal,
    purity: n.purity, weight_g: null, set_weight_g: n.setWeightG,
    set_face_total: n.setFaceTotal, is_set: n.isSet, set_pieces: n.setPieces,
    shape: n.shape, quality: n.quality, issue_method: n.issueMethod,
    issue_date: n.issueDate, sales_channel: n.salesChannel, dealer: n.dealer,
    certificate: n.certificate, packaging: n.packaging, obverse: n.obverse,
    reverse: n.reverse, caster: n.caster, source_url: n.sourceUrl,
    source_text: n.sourceText, source_date: n.sourceDate, verified: n.verified,
    status: (base && base.status) || n.status,
    pieces: (n.pieces || []).map(seedPieceFromCamel)
  });
}

/**
 * 创建贵金属服务。
 *
 * @param {{dataSource: object, withTx: Function}} ctx 依赖
 * @returns {object} 服务实例
 */
function create(ctx) {
  const ds = ctx.dataSource;
  const repos = ds.repos;

  /**
   * 全部套（含 draft）。
   *
   * @returns {Promise<object[]>} 行列表（按 no）
   */
  async function allRows() {
    if (ds.mode === 'json') {
      return readSeed().sets.slice().sort((a, b) => Number(a.no) - Number(b.no)).map(rowFromSeed);
    }
    const rows = await repos.coins.listByCategory('precious_metal');
    const out = [];
    for (const r of rows) {
      out.push(Object.assign({}, r, { pieces: await repos.pmPieces.listByCoin(r.no) }));
    }
    return out;
  }

  return {
    mode: ds.mode,

    /** @returns {Promise<object[]>} 全部套（含 pieces） */
    listAll: allRows,

    /**
     * 按状态过滤（admin 用；公开接口不要调它）。
     *
     * @param {string} [status] draft|published
     * @returns {Promise<object[]>} 行列表
     */
    async listByStatus(status) {
      const rows = await allRows();
      if (status === 'draft' || status === 'published') return rows.filter((r) => r.status === status);
      return rows;
    },

    /**
     * 已上架的套（公开接口唯一入口）。
     *
     * @returns {Promise<object[]>} 行列表
     */
    async listPublished() {
      return (await allRows()).filter((r) => r.status === 'published');
    },

    /**
     * 按 no 取一套（不按 status 过滤，供 admin 与 SSR 判断）。
     *
     * @param {number} no 编号
     * @returns {Promise<object|null>} 行或 null
     */
    async findByNo(no) {
      const rows = await allRows();
      return rows.filter((r) => Number(r.no) === Number(no))[0] || null;
    },

    /**
     * 下一个可用编号（至少 138，且大于当前 max）。
     *
     * @returns {Promise<number>} 新编号
     */
    async nextNo() {
      const rows = await allRows();
      return Math.max(common.LEGACY_NO_MAX + 1, rows.reduce((m, r) => Math.max(m, Number(r.no)), 0) + 1);
    },

    /**
     * 新建一套（默认 draft）。
     *
     * @param {object} payload 表单（含 pieces）
     * @returns {Promise<{ok:boolean,error?:string,field?:string,row?:object}>} 结果
     */
    async create(payload) {
      const p = payload && typeof payload === 'object' ? payload : {};
      const check = pmSchema.validateSet(p, { exists: false });
      if (!check.ok) return { ok: false, error: check.errors[0].error, field: check.errors[0].field };

      if (ds.mode === 'json') {
        const next = Object.assign({}, check.normalized, { no: await this.nextNo(), status: 'draft', sourceText: check.normalized.sourceText || '' });
        const doc = readSeed();
        doc.sets.push(toSeedSet(next));
        writeSeed(doc);
        return { ok: true, row: await this.findByNo(next.no) };
      }

      // db：算号与写入必须同一个事务连接 —— FOR UPDATE 锁住 MAX(no) 区间直到 commit，
      // 否则两个并发 create 会拿到同一个 no，第二个撞 uk_no 报 500。
      let assignedNo = 0;
      await ctx.withTx(async (conn) => {
        const maxNo = await repos.coins.nextNo(conn);
        assignedNo = Math.max(common.LEGACY_NO_MAX + 1, maxNo);
        const next = Object.assign({}, check.normalized, {
          no: assignedNo, status: 'draft', sourceText: check.normalized.sourceText || ''
        });
        await repos.coins.insert(toDbColumns(next), conn);
        await repos.pmPieces.replaceAll(conn, assignedNo, next.pieces);
      });
      return { ok: true, row: await this.findByNo(assignedNo) };
    },

    /**
     * 编辑一套（不的状态字段由 setStatus 单独改）。
     *
     * @param {number} no 编号
     * @param {object} payload 表单
     * @returns {Promise<{ok:boolean,error?:string,field?:string,row?:object}>} 结果
     */
    async update(no, payload) {
      const current = await this.findByNo(no);
      if (!current) return { ok: false, error: '贵金属品种不存在', field: 'no' };
      const merged = Object.assign({}, current, payload || {}, { no: Number(no) });
      const check = pmSchema.validateSet(merged, { exists: true });
      if (!check.ok) return { ok: false, error: check.errors[0].error, field: check.errors[0].field };

      if (ds.mode === 'json') {
        const doc = readSeed();
        doc.sets = doc.sets.map((s) => Number(s.no) === Number(no)
          ? toSeedSet(check.normalized, Object.assign({}, s, { no: Number(no), status: current.status })) : s);
        writeSeed(doc);
      } else {
        await ctx.withTx(async (conn) => {
          // 上架状态只能由 setStatus() 改：它跑 forPublish 闸门（verified + source_url）。
          // update() 只做 exists 校验，若让 payload.status 落到库里就能绕过闸门，
          // 所以这里强制沿用 current.status（与上面 json 分支口径一致）。
          const cols = toDbColumns(Object.assign({}, check.normalized, { status: current.status }));
          await repos.coins.update(no, cols, conn);
          await repos.pmPieces.replaceAll(conn, no, check.normalized.pieces);
        });
      }
      return { ok: true, row: await this.findByNo(no) };
    },

    /**
     * 整份替换套内规格（事务：DELETE + INSERT）。
     *
     * @param {number} no 套编号
     * @param {object[]} pieces 明细
     * @returns {Promise<{ok:boolean,error?:string,field?:string,count?:number}>} 结果
     */
    async replacePieces(no, pieces) {
      const current = await this.findByNo(no);
      if (!current) return { ok: false, error: '贵金属品种不存在', field: 'no' };
      const check = pmSchema.validateSet(Object.assign({}, current, { pieces: pieces }), { exists: true });
      if (!check.ok) return { ok: false, error: check.errors[0].error, field: check.errors[0].field };

      if (ds.mode === 'json') {
        const doc = readSeed();
        doc.sets = doc.sets.map((s) => Number(s.no) === Number(no)
          ? Object.assign({}, s, { pieces: check.normalized.pieces, set_pieces: check.normalized.setPieces }) : s);
        writeSeed(doc);
      } else {
        await ctx.withTx(async (conn) => {
          await repos.pmPieces.replaceAll(conn, no, check.normalized.pieces);
          await repos.coins.update(no, { set_pieces: check.normalized.setPieces }, conn);
        });
      }
      return { ok: true, count: check.normalized.pieces.length };
    },

    /**
     * 上下架。上架前必须 forPublish 校验通过（verified + source_url）。
     *
     * @param {number} no 编号
     * @param {string} status draft|published
     * @returns {Promise<{ok:boolean,error?:string,field?:string,row?:object}>} 结果
     */
    async setStatus(no, status) {
      const next = status === 'published' ? 'published' : 'draft';
      const current = await this.findByNo(no);
      if (!current) return { ok: false, error: '贵金属品种不存在', field: 'no' };
      if (next === 'published') {
        const check = pmSchema.validateSet(current, { exists: true, forPublish: true });
        if (!check.ok) return { ok: false, error: check.errors[0].error, field: check.errors[0].field };
      }
      if (ds.mode === 'json') {
        const doc = readSeed();
        doc.sets = doc.sets.map((s) => Number(s.no) === Number(no) ? Object.assign({}, s, { status: next }) : s);
        writeSeed(doc);
      } else {
        // 单条 UPDATE 也放进事务：保证「校验通过 → 状态落库」是原子的，
        // 且写调用拿到的是事务连接（与 create/update/remove 口径一致）
        await ctx.withTx(async (conn) => {
          await repos.coins.update(no, { status: next }, conn);
        });
      }
      return { ok: true, row: await this.findByNo(no) };
    },

    /**
     * 删除草稿（红线：no>=138 且 status=draft）。
     *
     * @param {number} no 编号
     * @returns {Promise<{ok:boolean,error?:string}>} 结果
     */
    async remove(no) {
      const current = await this.findByNo(no);
      if (!current) return { ok: false, error: '贵金属品种不存在' };
      if (Number(no) <= common.LEGACY_NO_MAX) return { ok: false, error: common.ERROR_TEXT.noImmutable };
      if (current.status !== 'draft') return { ok: false, error: common.ERROR_TEXT.notDraft };
      if (ds.mode === 'json') {
        const doc = readSeed();
        doc.sets = doc.sets.filter((s) => Number(s.no) !== Number(no));
        writeSeed(doc);
      } else {
        await ctx.withTx(async (conn) => {
          await repos.pmPieces.removeByCoin(conn, no);
          await repos.coins.remove(no, conn);
        });
      }
      return { ok: true };
    },

    /**
     * G3 占比断言用。
     *
     * @returns {Promise<{pm:number,total:number,ratio:number,ok:boolean}>} 统计
     */
    async ratio() {
      const counts = await repos.coins.countByCategory();
      const pm = Number(counts.precious_metal || 0) + (ds.mode === 'json' ? (await allRows()).length : 0);
      const total = Number(counts.commemorative_coin || 0) + Number(counts.commemorative_note || 0) + pm;
      return Object.assign({ pm: pm, total: total }, pmSchema.checkRatio(pm, total));
    }
  };
}

/**
 * normalized → cl_coins 列名（列名仍由 schemas/coin.js 定义）。
 *
 * @param {object} n normalized
 * @returns {Object<string, unknown>} 列名 → 值
 */
function toDbColumns(n) {
  const pick = {
    no: n.no, category: 'precious_metal', category_rank: common.CATEGORY_RANK.precious_metal,
    kind: 'coin', year: n.year, name: n.name, series: n.series, series_keys: n.seriesKeys,
    face: n.face, mintage: null, mintage_unit: 'piece', mintage_note: n.mintageNote,
    material: n.material, metal: n.metal, purity: n.purity, weight_g: null,
    spec: n.spec, shape: n.shape, quality: n.quality, issue_method: n.issueMethod,
    issue_date: n.issueDate, is_set: n.isSet ? 1 : 0, set_pieces: n.setPieces,
    set_weight_g: n.setWeightG, set_face_total: n.setFaceTotal,
    sales_channel: n.salesChannel, dealer: n.dealer, certificate: n.certificate,
    packaging: n.packaging, obverse: n.obverse, reverse: n.reverse, caster: n.caster,
    source_url: n.sourceUrl, source_text: n.sourceText, source_date: n.sourceDate,
    verified: n.verified, status: n.status, est: null
  };
  const out = {};
  Object.keys(pick).forEach((k) => { if (pick[k] !== undefined) out[k] = pick[k]; });
  return out;
}

module.exports = {
  create: create,
  readSeed: readSeed,
  writeSeed: writeSeed,
  rowFromSeed: rowFromSeed,
  toDbColumns: toDbColumns,
  toSeedSet: toSeedSet,
  pieceFromSeed: pieceFromSeed
};
