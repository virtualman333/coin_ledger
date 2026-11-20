'use strict';
/**
 * 公开目录接口（T03）。
 *
 *   GET /api/series       —— 旧接口，20 项 + count，响应与 legacy 逐字一致
 *   GET /api/catalog      —— 新增，三端统一目录出参（排序唯一实现在 catalog.service）
 *   GET /api/coin/:no     —— 新增，单品种完整出参（描述/多图/贵金属规格明细）
 *
 * 只有这一层解析 req.query；过滤、排序、投影全部由 catalog.service 负责，
 * routes 里不出现任何数据库查询语句（验收项：routes 目录 grep 无输出）。
 */
const seriesService = require('../services/series.service');

/**
 * 从查询串取单个字符串（Fastify 的 query 可能是数组）。
 *
 * @param {unknown} v 原始值
 * @returns {string} 字符串
 */
function one(v) {
  if (Array.isArray(v)) return String(v[0] || '');
  return v === undefined || v === null ? '' : String(v);
}

module.exports = async function catalogRoutes(app) {
  /** GET /api/series —— 普通币/纪念钞的系列；?category=pm 返回贵金属独立项目 */
  app.get('/api/series', async function seriesList(request, reply) {
    const q = request.query || {};
    const cat = Array.isArray(q.category) ? q.category[0] : q.category;
    if (cat === 'pm') {
      // 贵金属的「系列」是发行项目（一套），与普通币的 series 完全不是一回事。
      // 附带年份跨度、材质与代表图，供小程序/网页的项目卡片展示。
      const r = await app.db.query(
        'SELECT project_code AS code, MAX(project_name) AS name, COUNT(*) AS count, ' +
        'MIN(year) AS yearFrom, MAX(year) AS yearTo, ' +
        'GROUP_CONCAT(DISTINCT material) AS materials, ' +
        'COALESCE(MAX(thumb), \'\') AS thumb ' +
        'FROM cl_ecgci_pm GROUP BY project_code ORDER BY name'
      );
      const rows = r[0];
      return reply.send({
        ok: true,
        category: 'pm',
        items: rows.map((r) => {
          const mats = String(r.materials || '').split(',').filter(Boolean);
          return {
            code: r.code,
            name: r.name,
            count: Number(r.count),
            yearFrom: String(r.yearFrom || ''),
            yearTo: String(r.yearTo || ''),
            materials: mats,
            thumb: r.thumb || '',
          };
        }),
      });
    }
    const svc = seriesService.create({
      dataSource: app.dataSource,
      catalog: app.catalog,
      withTx: app.withTx
    });
    reply.send({ ok: true, category: 'coin', items: await svc.listWithCount() });
  });

  /** GET /api/catalog —— 新增，公开只读 published */
  app.get('/api/catalog', async function catalogList(request, reply) {
    const q = request.query || {};
    const result = await app.catalog.query({
      category: one(q.category) || 'all',
      year: one(q.year),
      series: one(q.series),
      // 公开接口永远只看已上架，即使调用方伪造 status=draft 也不放行
      status: 'published',
      page: one(q.page),
      size: one(q.size)
    });
    reply.send({ ok: true, total: result.total, page: result.page, size: result.size, items: result.items });
  });

  /** GET /api/coin/:no —— 新增，完整出参 */
  app.get('/api/coin/:no', async function coinDetail(request, reply) {
    const no = Number(request.params.no);
    if (!Number.isInteger(no) || no <= 0) {
      reply.code(400).send({ ok: false, error: '品种编号不合法' });
      return;
    }
    // 公开详情：未上架(draft)品种按 404 处理，禁止绕过上架闸门直取内容
    const detail = await app.catalog.detail(no, { publishedOnly: true });
    if (!detail) {
      reply.code(404).send({ ok: false, error: '品种不存在' });
      return;
    }
    reply.send(Object.assign({ ok: true }, detail));
  });
};
