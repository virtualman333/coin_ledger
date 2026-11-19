'use strict';
/**
 * 发行计划仓储（MySQL 实现）。
 *
 * 语义是「整份替换」：PUT /api/admin/plan 交上来的是一整份计划，
 * 年度条目字段异质（extra/banks/design/schedule…），所以 items 原样存 JSON 列，
 * 不拆表 —— 拆列等于宣布「以后不许加字段」，而央行公告年年加字段。
 *
 * 计划里**永不含贵金属**（贵金属不进入发行计划，这条在 T04 的写入侧再断言一次）。
 */
function parseItems(raw) {
  if (Array.isArray(raw)) return raw;
  if (raw === null || raw === undefined) return [];
  if (typeof raw === 'string') {
    try {
      const v = JSON.parse(raw);
      return Array.isArray(v) ? v : [];
    } catch (e) {
      return [];
    }
  }
  return [];
}

function create(pool) {
  if (!pool) throw new Error('plan.repo(mysql) 需要连接池');

  return {
    mode: 'db',

    /**
     * 读整份计划（文档级元信息 + 年度列表）。
     *
     * @returns {Promise<{updated:string, note:string, years:object[]}>} 计划文档
     */
    async get() {
      const [docRows] = await pool.query('SELECT updated AS updated, note AS note FROM cl_plan_doc WHERE id = 1');
      const [yearRows] = await pool.query(
        'SELECT year AS year, published_at AS publishedAt, published_by AS publishedBy, '
        + 'source_url AS sourceUrl, source_text AS sourceText, items AS items, ord AS ord '
        + 'FROM cl_plan_years ORDER BY ord, year'
      );
      const doc = docRows.length ? docRows[0] : { updated: null, note: null };
      return {
        updated: doc.updated ? String(doc.updated).slice(0, 10) : '',
        note: doc.note === null || doc.note === undefined ? '' : String(doc.note),
        years: yearRows.map((y) => ({
          year: Number(y.year),
          publishedAt: y.publishedAt ? String(y.publishedAt).slice(0, 10) : undefined,
          publishedBy: y.publishedBy === null || y.publishedBy === undefined ? undefined : String(y.publishedBy),
          sourceUrl: y.sourceUrl === null || y.sourceUrl === undefined ? undefined : String(y.sourceUrl),
          sourceText: y.sourceText === null || y.sourceText === undefined ? undefined : String(y.sourceText),
          items: parseItems(y.items)
          // ord 是库内排序辅助列（SQL ORDER BY 用），按共享约定不对外投影
        }))
      };
    },

    /**
     * 整份替换（必须在事务里调用：先清年度再按顺序写回）。
     *
     * @param {object} conn 事务连接
     * @param {{updated?:string, note?:string, years?:object[]}} plan 计划文档
     * @returns {Promise<{years:number, items:number}>} 写入统计
     */
    async replace(conn, plan) {
      const runner = conn || pool;
      const p = plan || {};
      const years = Array.isArray(p.years) ? p.years : [];
      let itemCount = 0;

      await runner.query(
        `INSERT INTO cl_plan_doc (id, updated, note) VALUES (1, ?, ?)
         ON DUPLICATE KEY UPDATE updated = VALUES(updated), note = VALUES(note)`,
        [p.updated ? String(p.updated).slice(0, 10) : null, p.note === undefined ? null : String(p.note)]
      );

      await runner.query('DELETE FROM cl_plan_years');
      for (let i = 0; i < years.length; i += 1) {
        const y = years[i] || {};
        const items = Array.isArray(y.items) ? y.items : [];
        itemCount += items.length;
        await runner.query(
          `INSERT INTO cl_plan_years (year, published_at, published_by, source_url, source_text, items, ord)
           VALUES (?, ?, ?, ?, ?, CAST(? AS JSON), ?)`,
          [Number(y.year), y.publishedAt ? String(y.publishedAt).slice(0, 10) : null,
            y.publishedBy === undefined ? null : y.publishedBy,
            y.sourceUrl === undefined ? null : y.sourceUrl,
            y.sourceText === undefined ? null : y.sourceText,
            JSON.stringify(items), i]
        );
      }
      return { years: years.length, items: itemCount };
    }
  };
}

module.exports = { create: create, parseItems: parseItems };
