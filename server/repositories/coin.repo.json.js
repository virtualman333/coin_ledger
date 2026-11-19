'use strict';
/**
 * 品种仓储（JSON 只读实现）。
 *
 * 存在的意义（arch 5.3）：`DATA_SOURCE=json` 是**回滚位**。库里出问题时
 * 5 分钟内切回来，站点必须照常可读 —— 所以读路径必须有等价实现，
 * 而且它与 MySQL 实现返回**同一套 camelCase 行形状**，
 * 这样 catalog.service 的投影函数完全不用分支。
 *
 * 写路径一律抛 ReadonlyError（HTTP 503 + 中文文案），管理端会原样展示，
 * 不静默失败 —— 静默失败是回滚时最容易踩的坑。
 */
const common = require('../schemas/common');
const source = require('./json-source');

/**
 * 把 coins.json 的一条品种映射成「行形状」。
 *
 * 映射规则与迁移脚本共用 3.2 的字段表：
 *   · i        → no = i + 1
 *   · dia      → dia（数字）/ dia_text（"—" 这类文本）
 *   · set      → set_code
 *   · limit / reserveLimit / setSize / specFrom → limit_qty / reserve_limit / set_size / spec_from
 *   · seriesKeys → series_keys（数组）
 *   · 其余缺失键 → null（MySQL 里同样是 NULL）
 *
 * @param {object} c coins.json 的一条
 * @returns {object} camelCase 行
 */
function rowFromLegacy(c) {
  const no = Number(c.i) + 1;
  const kind = c.kind === 'note' ? 'note' : 'coin';
  const category = common.CATEGORY_OF_KIND[kind];
  const diaNum = Number(c.dia);
  const hasDia = c.dia !== undefined && c.dia !== null && String(c.dia).trim() !== '' && Number.isFinite(diaNum);
  const series = c.series === undefined || c.series === null ? '' : String(c.series);

  return {
    id: no,
    no: no,
    category: category,
    categoryRank: common.CATEGORY_RANK[category],
    kind: kind,
    year: Number(c.year),
    name: String(c.name),
    series: series,
    seriesKeys: Array.isArray(c.seriesKeys) && c.seriesKeys.length ? c.seriesKeys.map(String) : (series ? [series] : null),
    face: Number(c.face) || 0,
    mintage: c.mintage === undefined || c.mintage === null ? null : Number(c.mintage),
    mintageUnit: 'wan_piece',
    mintageNote: null,
    material: c.material === undefined || c.material === null ? '' : String(c.material),
    dia: hasDia ? diaNum : null,
    diaText: hasDia ? null : (c.dia === undefined ? null : String(c.dia)),
    size: c.size === undefined ? null : String(c.size),
    thickness: c.thickness === undefined ? null : String(c.thickness),
    weight: c.weight === undefined ? null : String(c.weight),
    caster: c.caster === undefined ? null : String(c.caster),
    edge: c.edge === undefined ? null : String(c.edge),
    obverse: c.obverse === undefined ? null : String(c.obverse),
    reverse: c.reverse === undefined ? null : String(c.reverse),
    specFrom: c.specFrom === undefined ? null : String(c.specFrom),
    est: c.est === undefined || c.est === null ? null : Number(c.est),
    setCode: c.set === undefined ? 'single' : String(c.set),
    pieces: c.pieces === undefined ? 1 : Number(c.pieces),
    setSize: c.setSize === undefined ? null : Number(c.setSize),
    limitQty: c.limit === undefined ? null : Number(c.limit),
    reserveLimit: c.reserveLimit === undefined ? null : Number(c.reserveLimit),
    metal: null,
    purity: null,
    weightG: null,
    spec: null,
    shape: null,
    quality: null,
    issueMethod: null,
    issueDate: null,
    isSet: 0,
    setPieces: null,
    setWeightG: null,
    setFaceTotal: null,
    salesChannel: null,
    dealer: null,
    certificate: null,
    packaging: null,
    sourceUrl: 'legacy:public/data/coins.json',
    sourceText: null,
    sourceDate: null,
    verified: 0,
    status: 'published',
    createdAt: null,
    updatedAt: null
  };
}

/**
 * 读 coins.json 并转成行列表（保持 no 升序，与 CLI 的 i 顺序一致）。
 *
 * @returns {object[]} 行列表
 */
function allRows() {
  const doc = source.coinsDoc();
  const coins = Array.isArray(doc.coins) ? doc.coins : [];
  return coins
    .slice()
    .sort((a, b) => Number(a.i) - Number(b.i))
    .map(rowFromLegacy);
}

function create() {
  return {
    mode: 'json',

    async listAll(filter) {
      const f = filter || {};
      const rows = allRows();
      if (f.status === 'published' || f.status === 'draft') return rows.filter((r) => r.status === f.status);
      return rows;
    },

    async listPublished() {
      return allRows().filter((r) => r.status === 'published');
    },

    async findByNo(no) {
      const n = Number(no);
      return allRows().filter((r) => r.no === n)[0] || null;
    },

    async listByCategory(category, filter) {
      const f = filter || {};
      return allRows().filter((r) => r.category === category
        && (!f.status || r.status === f.status))
        .sort(common.compareCatalogOrder);
    },

    /**
     * 老形态原始品种对象（json 模式专用）。
     * 刻意**不做投影**：coins.json 的 137 条有 17 种键顺序，只有原样交出去
     * 才能保证 /api/admin/coins 与 /api/bootstrap 的 JSON 逐字不变。
     * MySQL 模式没有这个方法，service 会走 projectLegacyCoin。
     *
     * @returns {object[]} coins.json 的 coins 数组（原对象引用）
     */
    async listLegacyRaw() {
      const doc = source.coinsDoc() || {};
      return Array.isArray(doc.coins) ? doc.coins : [];
    },

    async insert() {
      throw new common.ReadonlyError();
    },

    async update() {
      throw new common.ReadonlyError();
    },

    async remove() {
      throw new common.ReadonlyError();
    },

    async nextNo() {
      // 只读模式下不分配新编号；给「新建」表单做只读预览时可以调它，但要显式允许
      const rows = allRows();
      return rows.reduce((m, r) => Math.max(m, r.no), 0) + 1;
    },

    async countByCategory() {
      const out = {};
      common.CATEGORIES.forEach((c) => { out[c] = 0; });
      allRows().forEach((r) => { out[r.category] = (out[r.category] || 0) + 1; });
      return out;
    },

    async count() {
      return allRows().length;
    }
  };
}

module.exports = { create: create, rowFromLegacy: rowFromLegacy, allRows: allRows };
