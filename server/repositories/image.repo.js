'use strict';
/**
 * 品种多图仓储（MySQL 实现）。
 *
 * 两张老 JSON 在这里合并成一张表：
 *   · gallery.json  { coins: { '1': [{f:'001.jpg', k:'main'}, …] } }  → (coin_no, kind, filename)
 *   · images.json   { real:[no…], mock:[34,56] }                      → is_mock 派生
 * 这样「某品种用哪张图」只有一处事实源，不会再出现 gallery 与 images 打架。
 */
const IMAGE_COLUMNS = 'coin_no AS coinNo, kind AS kind, filename AS filename, is_mock AS isMock, ord AS ord';

function create(pool) {
  if (!pool) throw new Error('image.repo(mysql) 需要连接池');

  return {
    mode: 'db',

    /**
     * 全部图片行。
     *
     * @returns {Promise<object[]>} 行列表
     */
    async listAll() {
      const [rows] = await pool.query('SELECT ' + IMAGE_COLUMNS + ' FROM cl_coin_images ORDER BY coin_no, ord, kind');
      return rows;
    },

    /**
     * 单个品种的多图（按 ord 升序）。
     *
     * @param {number} no 品种编号
     * @returns {Promise<object[]>} 行列表
     */
    async listByCoin(no) {
      const [rows] = await pool.query(
        'SELECT ' + IMAGE_COLUMNS + ' FROM cl_coin_images WHERE coin_no = ? ORDER BY ord, kind',
        [Number(no)]
      );
      return rows;
    },

    /**
     * 有官方实拍主图的品种编号（对应 images.json 的 real[]）。
     *
     * @returns {Promise<number[]>} 编号数组（升序）
     */
    async realMainNos() {
      const [rows] = await pool.query(
        "SELECT coin_no AS no FROM cl_coin_images WHERE kind = 'main' AND is_mock = 0 ORDER BY coin_no"
      );
      return rows.map((r) => Number(r.no));
    },

    /**
     * 图库版本号（前端用它给图片 URL 加 ?v= 破 7 天强缓存）。
     * db 模式读 cl_meta['catalog.gallery_ver']（迁移/换图时写入）；没有就返回空串。
     *
     * @returns {Promise<string>} 版本号
     */
    async version() {
      try {
        const [rows] = await pool.query("SELECT v FROM cl_meta WHERE k = 'catalog.gallery_ver' LIMIT 1");
        return rows.length && rows[0].v ? String(rows[0].v) : '';
      } catch (e) {
        // cl_meta 属于用户域，理论上一定在；万一查不到也不该让整页 500
        return '';
      }
    },

    /**
     * 递增图库版本号（前端给图片 URL 加 ?v= 破 7 天强缓存）。
     *
     * db 模式必须在这里写 cl_meta['catalog.gallery_ver'] —— version() 读的就是它。
     * 旧值是迁移时写入的 8 位时间戳数字串，直接 +1 保证「每次改图必变」，
     * 即使两次请求落在同一毫秒也不会撞号（纯 Date.now() 有这个坑）。
     *
     * @param {object} [conn] 事务连接；必须与 replaceForCoin 用同一条
     * @returns {Promise<string>} 新版本号
     */
    async bumpVersion(conn) {
      const runner = conn || pool;
      const [rows] = await runner.query("SELECT v FROM cl_meta WHERE k = 'catalog.gallery_ver' LIMIT 1");
      const prev = rows.length && rows[0].v ? String(rows[0].v) : '';
      const next = /^\d{1,15}$/.test(prev)
        ? String(Number(prev) + 1)
        : String(Date.now()).slice(-8);
      await runner.query(
        "INSERT INTO cl_meta (k, v) VALUES ('catalog.gallery_ver', ?) "
        + 'ON DUPLICATE KEY UPDATE v = VALUES(v)',
        [next]
      );
      return next;
    },

    /**
     * 整套替换某品种的图（order 变化时也安全：先删后插，事务内）。
     *
     * @param {object} conn 事务连接
     * @param {number} no 品种编号
     * @param {Array<{f:string,k:string}>} images 图列表
     * @param {boolean} isMock 是否占位图（images.json 的 mock 集合）
     * @returns {Promise<void>} 完成
     */
    async replaceForCoin(conn, no, images, isMock) {
      const runner = conn || pool;
      await runner.query('DELETE FROM cl_coin_images WHERE coin_no = ?', [Number(no)]);
      const list = Array.isArray(images) ? images : [];
      for (let i = 0; i < list.length; i += 1) {
        const it = list[i] || {};
        if (!it.f || !it.k) continue;
        await runner.query(
          'INSERT INTO cl_coin_images (coin_no, kind, filename, is_mock, ord) VALUES (?, ?, ?, ?, ?)',
          [Number(no), String(it.k), String(it.f), isMock ? 1 : 0, i]
        );
      }
    }
  };
}

module.exports = { create: create, IMAGE_COLUMNS: IMAGE_COLUMNS };
