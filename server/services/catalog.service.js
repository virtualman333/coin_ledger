'use strict';
/**
 * 目录服务：排序、过滤、投影的**唯一出口**。
 *
 * 三条不可妥协的约定（arch 6.1 / 6.2）：
 *   1. 排序只有一处：CATALOG_ORDER_SQL（MySQL）+ compareCatalogOrder（内存），
 *      两者口径一致，实现在 schemas/common.js；
 *   2. 投影只有一处：projectLegacyCoin（老形态）+ projectCatalogCoin（新形态）。
 *      任何 route 都不许自己拼对象 —— 否则三端迟早分叉；
 *   3. `/api/bootstrap.coins` 必须保持 `no ASC`（现状顺序）。这是唯一例外：
 *      老前端不改一行是硬要求，首屏顺序变化属可感知变化，所以新排序只由
 *      `/api/catalog` 承载。
 *
 * 关于「键序」：存量 coins.json 的 137 条里有 17 种不同的键顺序
 * （size 有时在 seriesKeys 前、limit 有时在 set 前…）。JSON 对象的键序无语义，
 * 因此这里按 arch 3.2 的表格给出一个固定顺序，`tools/diff-catalog.js` 用
 * 「深比较」判定零漂移，另外提供 `--strict-key-order` 只做提示、不判失败。
 */
const common = require('../schemas/common');

/* 排序口径从 common 再导出，保持「catalog.service 是唯一入口」的可读性 */
const CATALOG_ORDER_SQL = common.CATALOG_ORDER_SQL;
const CATEGORY_RANK = common.CATEGORY_RANK;
const CATEGORY_OF_KIND = common.CATEGORY_OF_KIND;

/** 分类筛选别名 → 库内枚举值 */
const CATEGORY_ALIAS = {
  coin: 'commemorative_coin',
  note: 'commemorative_note',
  pm: 'precious_metal',
  all: 'all',
  commemorative_coin: 'commemorative_coin',
  commemorative_note: 'commemorative_note',
  precious_metal: 'precious_metal'
};

/**
 * 是否有值（用于「可选键缺省不输出」）。
 *
 * @param {unknown} v 值
 * @returns {boolean} 判定
 */
function present(v) {
  return v !== null && v !== undefined && v !== '';
}

/**
 * 老形态投影：/api/bootstrap.coins、/api/admin/coins、export:json 共用。
 *
 * 逐字复刻 3.2 的映射表：
 *   i = no - 1（number）；dia 双列；est 对贵金属不输出；可选键缺省不输出 null。
 *
 * @param {object} row camelCase 行（repo 返回）
 * @param {{withPrice?: number|null, withExtras?: boolean}} [opts]
 *   withPrice  行情覆盖值（全局行情优先）
 *   withExtras 是否追加 no/category/status（默认 false：导出与 bootstrap 必须与基线逐字同构）
 * @returns {object} 老形态品种对象
 */
function projectLegacyCoin(row, opts) {
  const options = opts || {};
  const isPm = row.category === 'precious_metal';
  const no = Number(row.no);
  const out = {};

  out.i = no - 1;
  out.year = Number(row.year);
  out.name = String(row.name);
  out.series = row.series === null || row.series === undefined ? '' : String(row.series);
  out.face = Number(row.face);
  if (present(row.mintage)) out.mintage = Number(row.mintage);
  out.material = row.material === null || row.material === undefined ? '' : String(row.material);
  // dia 双列规则：数值走 dia，"—" 这类文本走 dia_text，都没有时按老口径给 "—"
  if (present(row.dia)) out.dia = Number(row.dia);
  else out.dia = present(row.diaText) ? String(row.diaText) : '—';
  out.kind = row.kind === 'note' ? 'note' : 'coin';

  // est：贵金属恒无参考估值（Q1），连键都不出，避免前端渲染「约 0 元」
  if (!isPm) {
    const override = options.withPrice;
    const est = typeof override === 'number' ? override : Number(row.est);
    out.est = Number.isFinite(est) ? est : 0;
  }

  out.set = row.setCode === null || row.setCode === undefined ? 'single' : String(row.setCode);
  out.pieces = row.pieces === null || row.pieces === undefined ? 1 : Number(row.pieces);

  if (present(row.thickness)) out.thickness = String(row.thickness);
  if (present(row.weight)) out.weight = String(row.weight);
  if (present(row.caster)) out.caster = String(row.caster);
  if (present(row.edge)) out.edge = String(row.edge);
  if (present(row.obverse)) out.obverse = String(row.obverse);
  if (present(row.reverse)) out.reverse = String(row.reverse);

  const keys = Array.isArray(row.seriesKeys) && row.seriesKeys.length
    ? row.seriesKeys.map(String)
    : (out.series ? [out.series] : []);
  out.seriesKeys = keys;

  if (present(row.size)) out.size = String(row.size);
  if (present(row.limitQty)) out.limit = Number(row.limitQty);
  if (present(row.reserveLimit)) out.reserveLimit = Number(row.reserveLimit);
  if (present(row.setSize)) out.setSize = Number(row.setSize);
  if (present(row.specFrom)) out.specFrom = String(row.specFrom);

  /* ↓ 允许新增的字段（默认不输出）：导出物要能当回滚资产，多一个键就不是「同构」了；
     T03 的新接口走 projectCatalogCoin，不需要靠这几个键 */
  if (options.withExtras) {
    out.no = no;
    out.category = row.category;
    out.status = row.status;
  }

  return out;
}

/**
 * 新形态投影：/api/catalog、/api/coin/:no、小程序包共用。
 *
 * 与老形态的差别：字段名统一、带 hasPrice、贵金属带结构化 pm 子对象。
 *
 * @param {object} row camelCase 行
 * @param {{pieces?: object[]}} [opts] pieces：贵金属套内明细
 * @returns {object} 新形态品种对象
 */
function projectCatalogCoin(row, opts) {
  const options = opts || {};
  const isPm = row.category === 'precious_metal';
  const no = Number(row.no);
  const out = {
    no: no,
    i: no - 1,
    category: row.category,
    categoryRank: Number(row.categoryRank || 0),
    kind: row.kind === 'note' ? 'note' : 'coin',
    year: Number(row.year),
    name: String(row.name),
    series: row.series || '',
    seriesKeys: Array.isArray(row.seriesKeys) && row.seriesKeys.length
      ? row.seriesKeys.map(String)
      : (row.series ? [String(row.series)] : []),
    face: Number(row.face),
    material: row.material || '',
    dia: present(row.dia) ? Number(row.dia) : (present(row.diaText) ? String(row.diaText) : '—'),
    set: row.setCode || 'single',
    pieces: Number(row.pieces || 1),
    status: row.status
  };

  if (present(row.mintage)) {
    out.mintage = Number(row.mintage);
    out.mintageUnit = row.mintageUnit || 'wan_piece';
  }
  if (present(row.size)) out.size = String(row.size);
  if (present(row.thickness)) out.thickness = String(row.thickness);
  if (present(row.weight)) out.weight = String(row.weight);
  if (present(row.caster)) out.caster = String(row.caster);
  if (present(row.edge)) out.edge = String(row.edge);
  if (present(row.obverse)) out.obverse = String(row.obverse);
  if (present(row.reverse)) out.reverse = String(row.reverse);
  if (present(row.specFrom)) out.specFrom = String(row.specFrom);

  if (isPm) {
    // Q1：贵金属不给估值，也不出 est 键
    out.hasPrice = false;
    out.pm = {
      metal: row.metal || null,
      purity: present(row.purity) ? Number(row.purity) : null,
      weightG: present(row.weightG) ? Number(row.weightG) : null,
      weightText: present(row.weight) ? String(row.weight) : null,
      spec: row.spec || null,
      shape: row.shape || null,
      quality: row.quality || null,
      issueMethod: row.issueMethod || null,
      issueDate: row.issueDate ? String(row.issueDate).slice(0, 10) : null,
      isSet: !!row.isSet,
      setPieces: present(row.setPieces) ? Number(row.setPieces) : null,
      setWeightG: present(row.setWeightG) ? Number(row.setWeightG) : null,
      setFaceTotal: present(row.setFaceTotal) ? Number(row.setFaceTotal) : null,
      salesChannel: row.salesChannel || null,
      dealer: row.dealer || null,
      certificate: row.certificate || null,
      packaging: row.packaging || null,
      mintageNote: row.mintageNote || null,
      pieces: Array.isArray(options.pieces) ? options.pieces.map(projectPmPiece) : []
    };
  } else {
    out.hasPrice = true;
    out.est = present(row.est) ? Number(row.est) : 0;
  }

  return out;
}

/**
 * 贵金属套内单枚投影。
 *
 * @param {object} p 明细行
 * @returns {object} 明细对象（对外 camelCase，单位显式带出）
 */
function projectPmPiece(p) {
  return {
    seq: Number(p.seq),
    name: String(p.name || ''),
    metal: String(p.metal || ''),
    weightG: Number(p.weightG || 0),
    purity: Number(p.purity || 0),
    face: Number(p.face || 0),
    maxMintage: Number(p.maxMintage || 0),
    mintageUnit: p.mintageUnit === 'wan_piece' ? 'wan_piece' : 'piece',
    shape: p.shape || 'round',
    sizeText: p.sizeText || null,
    quality: p.quality || null,
    reverseText: p.reverseText || null
  };
}

/**
 * 老形态 desc 投影（原 descriptions.json 的一条）。
 *
 * @param {object} row 描述行
 * @returns {object} { title, url, text, date, source, textMd }
 */
function projectLegacyDesc(row) {
  const out = {};
  out.title = row.title === null || row.title === undefined ? '' : String(row.title);
  if (present(row.url)) out.url = String(row.url);
  else if (row.url === '') out.url = '';
  out.text = row.body === null || row.body === undefined ? '' : String(row.body);
  // date 原文优先（存量是「1984年」这类非日期字符串，个别条目甚至是空串 ""）
  if (row.dateText !== null && row.dateText !== undefined) out.date = String(row.dateText);
  else if (present(row.publishedOn)) out.date = String(row.publishedOn).slice(0, 10);
  if (present(row.source)) out.source = String(row.source);
  if (present(row.bodyMd)) out.textMd = String(row.bodyMd);
  return out;
}

/**
 * 老形态 gallery 投影：{ '1': [{f,k}] }。
 *
 * @param {object[]} imageRows 图片行
 * @returns {object} gallery.coins
 */
function projectLegacyGallery(imageRows) {
  const out = {};
  (imageRows || []).forEach((r) => {
    const key = String(r.coinNo);
    if (!out[key]) out[key] = [];
    out[key].push({ f: r.filename, k: r.kind });
  });
  return out;
}

/**
 * 老形态 sets 投影：{ code: {name,unit,total,members,size,kind} }。
 *
 * @param {object[]} setRows 套系行
 * @returns {object} sets 对象
 */
function projectLegacySets(setRows) {
  const out = {};
  (setRows || []).forEach((r) => {
    const item = {};
    item.name = String(r.name || '');
    item.unit = r.unit || '枚';
    item.total = Number(r.total || 0);
    item.members = Number(r.members || 0);
    if (present(r.size)) item.size = Number(r.size);
    if (present(r.kind)) item.kind = String(r.kind);
    out[r.setCode] = item;
  });
  return out;
}

/**
 * 老形态 series 投影：{ key: name }（bootstrap 用的就是这个名字映射）。
 *
 * @param {object[]} seriesRows 系列行
 * @returns {object} series 对象
 */
function projectLegacySeriesMap(seriesRows, coinRows) {
  const out = {};
  const primary = {};
  (coinRows || []).forEach((c) => { if (c.series) primary[String(c.series)] = true; });
  (seriesRows || []).forEach((r) => {
    // coins.json 的 series 映射只有 19 个 key，正好等于「被某个品种当作主系列」的集合；
    // SXC（生肖纪念钞）只出现在 seriesKeys 里，因此不进映射 —— 这一条是逐字复刻现状，
    // 不是取舍。seriesMeta（20 条）才承担「所有系列」的职责。
    if (Object.keys(primary).length && !primary[r.seriesKey]) return;
    out[r.seriesKey] = r.name;
  });
  return out;
}

/**
 * 系列列表（含 count）：等价于老 server/series.js 的 listWithCount。
 *
 * 语义要点：count 按 seriesKeys 统计；seriesKeys 为空时回落 [series]，
 * 否则「主系列回填」改动后计数会少算（这个坑 T03 必须原样保留）。
 *
 * @param {object[]} seriesRows 系列行（已按 sort 排序）
 * @param {object[]} coinRows 品种行
 * @returns {Array<object>} 系列列表（含 count）
 */
function seriesWithCount(seriesRows, coinRows) {
  const counts = {};
  (coinRows || []).forEach((c) => {
    const keys = Array.isArray(c.seriesKeys) && c.seriesKeys.length
      ? c.seriesKeys
      : (c.series ? [c.series] : []);
    keys.forEach((k) => { counts[k] = (counts[k] || 0) + 1; });
  });
  return (seriesRows || [])
    .map((s) => ({
      key: s.seriesKey,
      name: s.name,
      desc: s.descr === undefined || s.descr === null ? '' : String(s.descr),
      img: s.img === undefined || s.img === null ? '' : String(s.img),
      sort: Number(s.sort || 0),
      imgFrom: s.imgFrom === undefined ? undefined : s.imgFrom,
      count: counts[s.seriesKey] || 0
    }))
    .sort((a, b) => (a.sort || 0) - (b.sort || 0));
}

/**
 * 老形态 plan 投影（原 plan.json 的一条年度）。
 *
 * 年度对象的键序固定为 year,publishedAt,publishedBy,sourceUrl,sourceText,items，
 * 可选字段缺省不输出（存量 2025/2026 两个年度都是这个形状）。
 * `ord` 是库内排序辅助列，对外不出现。
 *
 * @param {{updated?:string,note?:string,years?:object[]}} plan 计划文档
 * @returns {{updated:string,note:string,years:object[]}} 老形态计划
 */
function projectLegacyPlan(plan) {
  const p = plan || {};
  const out = {};
  out.updated = p.updated === undefined || p.updated === null ? '' : String(p.updated);
  out.note = p.note === undefined || p.note === null ? '' : String(p.note);
  out.years = (Array.isArray(p.years) ? p.years : []).map((y) => {
    const item = { year: Number(y.year) };
    if (present(y.publishedAt)) item.publishedAt = String(y.publishedAt).slice(0, 10);
    if (present(y.publishedBy)) item.publishedBy = String(y.publishedBy);
    if (present(y.sourceUrl)) item.sourceUrl = String(y.sourceUrl);
    if (present(y.sourceText)) item.sourceText = String(y.sourceText);
    item.items = Array.isArray(y.items) ? y.items : [];
    return item;
  });
  return out;
}

/**
 * 目录服务。
 *
 * 构造时注入 DataSource（含仓储包），因此同一份代码在 db / json 下行为一致；
 * 写路径由 dataSource.assertWritable() 统一把住（json 模式 503）。
 */
class CatalogService {
  /**
   * @param {import('./data-source').DataSource} dataSource 数据源
   */
  constructor(dataSource) {
    this.dataSource = dataSource;
  }

  get repos() {
    return this.dataSource.repos;
  }

  /**
   * 统一目录查询（/api/catalog、sitemap、export:json、build_mp_data 共用）。
   *
   * @param {{category?: string, year?: number|string, series?: string, status?: string,
   *          page?: number|string, size?: number|string}} [filter] 过滤条件
   * @returns {Promise<{total:number,page:number,size:number,items:object[]}>} 分页结果
   */
  async query(filter) {
    const f = filter || {};
    const status = f.status === 'draft' ? 'draft' : 'published';
    // json 模式需要把贵金属种子并入查询视图（draft 由 status 过滤自然排除）；
    // db 模式迁移后 cl_coins 里本来就有 PM 行，沿用 listAll。
    const loader = typeof this.repos.coins.listAllIncludingPm === 'function'
      ? this.repos.coins.listAllIncludingPm.bind(this.repos.coins)
      : this.repos.coins.listAll.bind(this.repos.coins);
    const rows = await loader({ status: status });

    let list = rows.slice().sort(common.compareCatalogOrder);

    const cat = CATEGORY_ALIAS[String(f.category || 'all')];
    if (cat && cat !== 'all') list = list.filter((r) => r.category === cat);
    if (f.year !== undefined && f.year !== null && String(f.year) !== '') {
      const y = Number(f.year);
      if (Number.isFinite(y)) list = list.filter((r) => Number(r.year) === y);
    }
    if (f.series) {
      const key = String(f.series);
      list = list.filter((r) => {
        const keys = Array.isArray(r.seriesKeys) && r.seriesKeys.length
          ? r.seriesKeys
          : (r.series ? [r.series] : []);
        return keys.indexOf(key) >= 0 || r.series === key;
      });
    }

    const total = list.length;
    const pageInfo = common.normalizePage(f);
    const slice = list.slice(pageInfo.offset, pageInfo.offset + pageInfo.size);

    return {
      total: total,
      page: pageInfo.page,
      size: pageInfo.size,
      items: slice.map((r) => projectCatalogCoin(r))
    };
  }

  /**
   * 单品种完整出参（含描述、多图、规格明细）。贵金属额外带 pieces。
   *
   * @param {number} no 品种编号
   * @returns {Promise<object|null>} 详情或 null
   */
  async detail(no) {
    const row = await this.repos.coins.findByNo(no);
    if (!row) return null;
    const descRow = await this.repos.descriptions.findByNo(no);
    const imageRows = await this.repos.images.listByCoin(no);
    const pieces = row.category === 'precious_metal' ? await this.repos.pmPieces.listByCoin(no) : [];
    return {
      coin: projectCatalogCoin(row, { pieces: pieces }),
      desc: descRow ? projectLegacyDesc(descRow) : null,
      images: imageRows.map((r) => ({ filename: r.filename, kind: r.kind, isMock: !!r.isMock })),
      pieces: pieces.map(projectPmPiece)
    };
  }

  /**
   * 老形态品种对象（逐字保键序）。
   *
   * json 模式直接拿 coins.json 的原对象 —— 存量 137 条有 17 种键顺序，
   * 任何固定投影顺序都会让 /api/bootstrap 与 /api/admin/coins 的 JSON
   * 字符串发生变化（快照按 JSON.stringify 取摘要，会判失败）。
   * db 模式没有原始对象，用投影生成规范键序（此时没有基线可比）。
   *
   * @param {object[]} [rows] 已读出的行（db 模式复用，避免二次查询）
   * @returns {Promise<object[]>} 老形态品种对象
   */
  async legacyCoins(rows) {
    if (typeof this.repos.coins.listLegacyRaw === 'function') {
      return this.repos.coins.listLegacyRaw();
    }
    const list = Array.isArray(rows) ? rows : await this.repos.coins.listPublished();
    return list.slice().sort((a, b) => Number(a.no) - Number(b.no)).map((r) => projectLegacyCoin(r));
  }

  /**
   * bootstrap 用的 series 映射：json 模式取原对象，db 模式由行推导。
   *
   * @param {object[]} seriesRows 系列行
   * @param {object[]} coinRows 品种行
   * @returns {Promise<object>} key → name
   */
  async legacySeriesMap(seriesRows, coinRows) {
    if (typeof this.repos.series.legacyMapRaw === 'function') return this.repos.series.legacyMapRaw();
    return projectLegacySeriesMap(seriesRows, coinRows);
  }

  /**
   * bootstrap 用的 sets 映射：json 模式取原对象，db 模式由行推导。
   *
   * @param {object[]} setRows 套系行
   * @returns {Promise<object>} code → set
   */
  async legacySetsMap(setRows) {
    if (typeof this.repos.sets.legacyMapRaw === 'function') return this.repos.sets.legacyMapRaw();
    return projectLegacySets(setRows);
  }

  /**
   * 组装 /api/bootstrap 的目录部分（用户域字段由调用方拼）。
   *
   * 顺序红线：coins 必须是 `no ASC`（不是 category_rank,year DESC,no）——
   * 老前端不改一行的前提是首屏顺序不变。新排序由 query() 承载。
   *
   * @param {{prices?: object, imgSet?: number[], version?: string}} [ctx] 行情覆盖与图片清单
   * @returns {Promise<object>} 目录相关字段
   */
  async buildBootstrap(ctx) {
    const c = ctx || {};
    const prices = c.prices && typeof c.prices === 'object' ? c.prices : {};

    const rows = await this.repos.coins.listPublished();
    const legacyCoins = await this.legacyCoins(rows);
    const coins = legacyCoins.map((c, i) => {
      const idx = c.i === undefined ? i : Number(c.i);
      const override = prices[String(idx)];
      // 与 legacy buildBootstrap 同款：无覆盖时原样返回同一个对象引用，
      // 有覆盖时 Object.assign 只在原位置改 est，键序不变
      return typeof override === 'number' ? Object.assign({}, c, { est: override }) : c;
    });

    const [seriesRows, setRows, descRows, imageRows, plan, defaults, galleryVer] = await Promise.all([
      this.repos.series.listAll(),
      this.repos.sets.listAll(),
      this.repos.descriptions.listAll(),
      this.repos.images.listAll(),
      this.repos.plan.get(),
      this.repos.defaultHoldings.listAll(),
      this.repos.images.version()
    ]);

    const desc = {};
    descRows.forEach((r) => { desc[String(r.coinNo)] = projectLegacyDesc(r); });

    const imgReal = await this.repos.images.realMainNos();

    const [seriesMap, setsMap] = await Promise.all([
      this.legacySeriesMap(seriesRows, rows),
      this.legacySetsMap(setRows)
    ]);

    return {
      coins: coins,
      series: seriesMap,
      sets: setsMap,
      defaults: defaults.map((d) => {
        const item = {
          name: d.name,
          rolls: Number(d.rolls || 0),
          cost: Number(d.cost || 0),
          market: Number(d.market || 0),
          group: d.grp || '独立藏品'
        };
        // 存量 12 条里只有 1 条带 sep；「有才输出」才能逐字还原
        if (d.sep) item.sep = true;
        return item;
      }),
      imgSet: Array.isArray(c.imgSet) ? c.imgSet : imgReal,
      imgReal: imgReal,
      gallery: projectLegacyGallery(imageRows),
      galleryVer: galleryVer || '',
      plan: plan,
      seriesMeta: seriesWithCount(seriesRows, rows),
      desc: desc
    };
  }

  /**
   * 系列列表（含 count）：把模块级函数挂到实例上，供 series.service 调用。
   *
   * @param {object[]} seriesRows 系列行
   * @param {object[]} coinRows 品种行
   * @returns {object[]} 系列列表
   */
  seriesWithCount(seriesRows, coinRows) {
    return seriesWithCount(seriesRows, coinRows);
  }

  /**
   * 断言一组行确实按统一口径排序（迁移/导出后自检用）。
   *
   * @param {object[]} rows 行列表
   * @returns {{ok:boolean, index:number}} 结果（index = 第一处违例）
   */
  assertOrder(rows) {
    const list = Array.isArray(rows) ? rows : [];
    for (let i = 1; i < list.length; i += 1) {
      if (common.compareCatalogOrder(list[i - 1], list[i]) > 0) return { ok: false, index: i };
    }
    return { ok: true, index: -1 };
  }

  /**
   * 分类计数（/api/health、G3 占比断言用）。
   *
   * @returns {Promise<Object<string, number>>} category → count
   */
  async countByCategory() {
    return this.repos.coins.countByCategory();
  }
}

module.exports = {
  CatalogService: CatalogService,
  create: function create(dataSource) { return new CatalogService(dataSource); },
  CATALOG_ORDER_SQL: CATALOG_ORDER_SQL,
  CATEGORY_RANK: CATEGORY_RANK,
  CATEGORY_OF_KIND: CATEGORY_OF_KIND,
  CATEGORY_ALIAS: CATEGORY_ALIAS,
  projectLegacyCoin: projectLegacyCoin,
  projectCatalogCoin: projectCatalogCoin,
  projectPmPiece: projectPmPiece,
  projectLegacyDesc: projectLegacyDesc,
  projectLegacyGallery: projectLegacyGallery,
  projectLegacySets: projectLegacySets,
  projectLegacySeriesMap: projectLegacySeriesMap,
  projectLegacyPlan: projectLegacyPlan,
  seriesWithCount: seriesWithCount
};
