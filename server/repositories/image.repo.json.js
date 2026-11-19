'use strict';
/**
 * 品种多图仓储（JSON 只读实现）。
 * 同时读 gallery.json（哪张图）与 images.json（实拍/占位），与 MySQL 实现同形状。
 */
const common = require('../schemas/common');
const source = require('./json-source');

/**
 * 合并 gallery.json + images.json → 图片行列表。
 *
 * @returns {object[]} 行列表
 */
function allRows() {
  const gal = source.galleryDoc() || {};
  const img = source.imagesDoc() || {};
  const mockSet = new Set((Array.isArray(img.mock) ? img.mock : []).map(Number));
  const coins = gal.coins && typeof gal.coins === 'object' ? gal.coins : {};

  const rows = [];
  Object.keys(coins).map(Number).filter((n) => Number.isInteger(n) && n > 0).sort((a, b) => a - b).forEach((no) => {
    const list = Array.isArray(coins[String(no)]) ? coins[String(no)] : [];
    list.forEach((it, i) => {
      if (!it || !it.f || !it.k) return;
      rows.push({
        coinNo: no,
        kind: String(it.k),
        filename: String(it.f),
        isMock: mockSet.has(no) ? 1 : 0,
        ord: i
      });
    });
  });
  return rows;
}

function create() {
  return {
    mode: 'json',

    async listAll() {
      return allRows();
    },

    async listByCoin(no) {
      const n = Number(no);
      return allRows().filter((r) => r.coinNo === n);
    },

    async realMainNos() {
      const img = source.imagesDoc() || {};
      const mock = new Set((Array.isArray(img.mock) ? img.mock : []).map(Number));
      const gal = source.galleryDoc() || {};
      const coins = gal.coins && typeof gal.coins === 'object' ? gal.coins : {};
      return Object.keys(coins)
        .map(Number)
        .filter((no) => {
          if (mock.has(no)) return false;
          const list = Array.isArray(coins[String(no)]) ? coins[String(no)] : [];
          return list.some((it) => it && it.k === 'main');
        })
        .sort((a, b) => a - b);
    },

    async replaceForCoin() {
      throw new common.ReadonlyError();
    },

    /**
     * json 模式不需要 DB 版本号：legacy.touchGallery() 已经刷新内存与文件。
     * 保留同签名，避免调用方分支判断。
     *
     * @returns {Promise<string>} 空串
     */
    async bumpVersion() {
      return '';
    },

    /**
     * 图库版本号：沿用老实现的口径 —— gallery.json 的 mtime 后 8 位。
     *
     * @returns {Promise<string>} 版本号
     */
    async version() {
      try {
        const st = require('fs').statSync(source.FILES.gallery);
        return String(Math.round(st.mtimeMs)).slice(-8);
      } catch (e) {
        return '';
      }
    }
  };
}

module.exports = { create: create, allRows: allRows };
