'use strict';
/**
 * 贵金属套内规格明细仓储（MySQL 实现）。
 *
 * 一「套」在 cl_coins 里一行（is_set=1），套内每一枚在这里一行。
 * replaceAll 是「整份替换」语义：管理端一次性提交 N 行，事务里先删后插，
 * 避免逐行 diff 时出现「改了两行、漏删一行」的中间态。
 *
 * 单位红线（A3）：max_mintage 的单位由 mintage_unit 显式标注，
 * 贵金属公告是「枚」（piece），存量普通币是「万枚」（wan_piece）。
 * 该列有默认值，因此老调用方不传也不会把单位搞错方向。
 */
const COLUMNS = 'coin_no AS coinNo, seq AS seq, name AS name, metal AS metal, weight_g AS weightG, '
  + 'purity AS purity, face AS face, max_mintage AS maxMintage, mintage_unit AS mintageUnit, '
  + 'shape AS shape, size_text AS sizeText, quality AS quality, reverse_text AS reverseText';

function create(pool) {
  if (!pool) throw new Error('pm-piece.repo(mysql) 需要连接池');

  return {
    mode: 'db',

    /**
     * 某套的全部规格。
     *
     * @param {number} no 套的 no
     * @returns {Promise<object[]>} 行列表（按 seq）
     */
    async listByCoin(no) {
      const [rows] = await pool.query(
        'SELECT ' + COLUMNS + ' FROM cl_pm_pieces WHERE coin_no = ? ORDER BY seq',
        [Number(no)]
      );
      return rows;
    },

    /**
     * 全部规格（导出与统计用）。
     *
     * @returns {Promise<object[]>} 行列表
     */
    async listAll() {
      const [rows] = await pool.query('SELECT ' + COLUMNS + ' FROM cl_pm_pieces ORDER BY coin_no, seq');
      return rows;
    },

    /**
     * 整份替换某套的规格（事务内先删后插）。
     *
     * @param {object} conn 事务连接
     * @param {number} no 套的 no
     * @param {Array<object>} pieces 规格数组
     * @returns {Promise<number>} 写入行数
     */
    async replaceAll(conn, no, pieces) {
      const runner = conn || pool;
      const list = Array.isArray(pieces) ? pieces : [];
      await runner.query('DELETE FROM cl_pm_pieces WHERE coin_no = ?', [Number(no)]);
      let n = 0;
      for (let i = 0; i < list.length; i += 1) {
        const p = list[i] || {};
        const seq = Number(p.seq) || i + 1;
        const weightG = Number(p.weightG !== undefined ? p.weightG : p.weight_g);
        const purity = Number(p.purity);
        const face = Number(p.face);
        const maxMintage = Number(p.maxMintage !== undefined ? p.maxMintage : p.max_mintage);
        if (!p.name || !p.metal || !Number.isFinite(weightG) || !Number.isFinite(purity)
          || !Number.isFinite(face) || !Number.isFinite(maxMintage)) {
          // 明细是「只读参考」，缺字段直接跳过比写入脏数据更安全；
          // 但 service 层已用 schemas/pm.js 卡过一遍，正常不会走到这里
          continue;
        }
        await runner.query(
          `INSERT INTO cl_pm_pieces (coin_no, seq, name, metal, weight_g, purity, face, max_mintage,
             mintage_unit, shape, size_text, quality, reverse_text)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [Number(no), seq, String(p.name).slice(0, 64), String(p.metal), weightG, purity, face, maxMintage,
            p.mintageUnit === 'wan_piece' ? 'wan_piece' : 'piece',
            p.shape || 'round',
            p.sizeText === undefined || p.sizeText === null ? null : String(p.sizeText).slice(0, 32),
            p.quality || null,
            p.reverseText === undefined || p.reverseText === null ? null : String(p.reverseText).slice(0, 255)]
        );
        n += 1;
      }
      return n;
    },

    /**
     * 删除某套的全部规格。
     *
     * @param {object} conn 事务连接
     * @param {number} no 套的 no
     * @returns {Promise<number>} 影响行数
     */
    async removeByCoin(conn, no) {
      const runner = conn || pool;
      const [r] = await runner.query('DELETE FROM cl_pm_pieces WHERE coin_no = ?', [Number(no)]);
      return Number(r.affectedRows || 0);
    }
  };
}

module.exports = { create: create, COLUMNS: COLUMNS };
