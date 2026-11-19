'use strict';
/**
 * 贵金属套内规格明细仓储（JSON 只读实现）。
 *
 * 数据来自 data/seeds/precious-metal-2026.json（T04 的 3 套真实数据）。
 * 文件不存在时返回空数组 —— 这样 DATA_SOURCE=json 的老库（还没导贵金属）
 * 不会被这条读路径打断，前端只是看不到贵金属，其余照旧。
 */
const common = require('../schemas/common');
const source = require('./json-source');
const config = require('../config');

/**
 * 读种子文件里的 sets（带 pieces[]）。
 *
 * @returns {object[]} 套数组
 */
function seedSets() {
  const doc = source.readJson(config.PM_SEED_FILE, { sets: [] });
  return doc && Array.isArray(doc.sets) ? doc.sets : [];
}

/**
 * 取某套的明细并映射成行形状。
 *
 * @param {number} no 套的 no
 * @returns {object[]} 行列表
 */
function listByCoin(no) {
  const n = Number(no);
  const set = seedSets().filter((s) => Number(s.no) === n)[0];
  if (!set || !Array.isArray(set.pieces)) return [];
  return set.pieces.map((p, i) => ({
    coinNo: n,
    seq: Number(p.seq) || i + 1,
    name: String(p.name || ''),
    metal: String(p.metal || ''),
    weightG: Number(p.weight_g !== undefined ? p.weight_g : p.weightG) || 0,
    purity: Number(p.purity) || 0,
    face: Number(p.face) || 0,
    maxMintage: Number(p.max_mintage !== undefined ? p.max_mintage : p.maxMintage) || 0,
    mintageUnit: p.mintage_unit === 'wan_piece' ? 'wan_piece' : 'piece',
    shape: p.shape || 'round',
    sizeText: p.size_text === undefined ? null : String(p.size_text),
    quality: p.quality || null,
    reverseText: p.reverse_text === undefined ? null : String(p.reverse_text)
  })).sort((a, b) => a.seq - b.seq);
}

function create() {
  return {
    mode: 'json',

    async listByCoin(no) {
      return listByCoin(no);
    },

    async listAll() {
      const out = [];
      seedSets().forEach((s) => {
        listByCoin(s.no).forEach((r) => out.push(r));
      });
      return out;
    },

    async replaceAll() {
      throw new common.ReadonlyError();
    },

    async removeByCoin() {
      throw new common.ReadonlyError();
    }
  };
}

module.exports = { create: create, listByCoin: listByCoin, seedSets: seedSets };
