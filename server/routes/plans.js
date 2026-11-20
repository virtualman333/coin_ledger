'use strict';
/**
 * 品类化的发行计划接口（Web 与小程序共用同一份数据源）。
 *
 *   GET /api/plans              —— 品类注册表 + 普通计划 + 贵金属计划
 *   GET /api/plans?category=pm  —— 只取贵金属（小程序可少传数据）
 *
 * 数据是只读 JSON，走 json-source 的 mtime 缓存，与 bootstrap 同源。
 */
const config = require('../config');
const source = require('../repositories/json-source');

module.exports = async function planRoutes(app) {
  app.get('/api/plans', async function plansHandler(request, reply) {
    const q = request.query || {};
    const cat = Array.isArray(q.category) ? q.category[0] : q.category;
    const out = {
      ok: true,
      updatedAt: new Date().toISOString(),
      categories: source.categoriesDoc()
    };
    if (!cat || cat === 'coin' || cat === 'note' || cat === 'all') out.plan = source.planDoc();
    if (!cat || cat === 'pm' || cat === 'all') out.planPm = source.planPmDoc();
    reply.send(out);
  });

  /**
   * GET /api/catalog/pm —— 贵金属目录分页查询（2823 条不一次性传输）
   *   ?page=1&pageSize=30&year=2026&q=熊猫&project=G202701
   * 只返回展示所需列，不含 raw 公告全文（那条走详情接口）。
   */
  /** GET /api/catalog/pm/:code —— 单枚完整详情（点开才拉，不进列表传输） */
  app.get('/api/catalog/pm/:code', async function pmDetail(request, reply) {
    const code = String(request.params.code || '').toUpperCase();
    const CDN = 'https://chngc-prod-c2c-cdn.ecgci.com';
    let raw = null;
    const rows = await app.db.query('SELECT raw, thumb, thumb_back, weight_g FROM cl_ecgci_pm WHERE code = ? LIMIT 1', [code]);
    if (rows[0] && rows[0][0]) {
      if (rows[0][0].raw) raw = rows[0][0].raw;
      var thumb = rows[0][0].thumb || '';
    }
    if (!raw) return reply.send({ ok: false, error: '未找到该贵金属币' });
    if (typeof raw === 'string') { try { raw = JSON.parse(raw); } catch (e) { raw = {}; } }
    // 克重价：按实时金银价 × 克重 × 成色算材料价值（失败时不影响详情主体）
    let metalValue = null;
    try {
      await app.metalPrice.getQuotes();
      const w = (rows[0] && rows[0][0] && rows[0][0].weight_g) || raw.weight || '';
      metalValue = app.metalPrice.valueOf(raw.material, w, raw.fineness);
    } catch (e) { metalValue = null; }
    // 原图动辄 2MB+，CDN 支持阿里云 OSS 图片处理，统一压到 600px 宽再给前端
    const img = (p) => {
      if (!p) return '';
      let u = String(p).indexOf('http') === 0 ? String(p) : CDN + (String(p).charAt(0) === '/' ? p : '/' + p);
      if (u.indexOf('x-oss-process') < 0) u += (u.indexOf('?') > 0 ? '&' : '?') + 'x-oss-process=image/resize,w_600';
      return u;
    };
    reply.send({
      ok: true,
      item: {
        code: raw.code, name: raw.name, projectName: raw.projectName,
        year: raw.projectYear || raw.year,
        frontUrl: img(raw.frontPicture), backUrl: img(raw.backPicture),
        thumbUrl: typeof thumb !== 'undefined' ? thumb : '',
        thumbBackUrl: rows[0] && rows[0][0] && rows[0][0].thumb_back ? rows[0][0].thumb_back : '',
        frontDesc: raw.frontPictureDesc || '', backDesc: raw.backPictureDesc || '',
        announce: raw.projectAnnounceName || raw.description || '',
        material: raw.material, weight: raw.weight, spec: raw.spec,
        face: raw.denomination, fineness: raw.fineness, circulation: raw.circulation,
        quality: raw.quality, craft: raw.craft, castingUnit: raw.castingUnit,
        designer: raw.designedPersonName, sculptor: raw.sculptor,
        categories: raw.projectCategoryName, theme: raw.projectTheme, series: raw.projectSeries,
        metalValue: metalValue
      }
    });
  });

  app.get('/api/catalog/pm', async function pmPage(request, reply) {
    const q = request.query || {};
    const one = (v) => Array.isArray(v) ? v[0] : v;
    const page = Math.max(1, Math.min(10000, Number(one(q.page)) || 1));
    const pageSize = Math.max(1, Math.min(100, Number(one(q.pageSize)) || 30));
    const year = String(one(q.year) || '');
    const project = String(one(q.project) || '');
    const kw = String(one(q.q) || '').trim();
    const offset = (page - 1) * pageSize;
    const cols = 'code, project_code AS projectCode, project_name AS projectName, year, name, ' +
      'material, weight_g AS weightG, face, fineness, max_mintage AS maxMintage, quality, ' +
      'front_picture AS frontPicture, back_picture AS backPicture, thumb, thumb_back AS thumbBack';

    let total, items;
    {
      const where = [], params = [];
      if (year) { where.push('year = ?'); params.push(year); }
      if (project) { where.push('project_code = ?'); params.push(project); }
      if (kw) { where.push('(name LIKE ? OR code LIKE ?)'); params.push('%' + kw + '%', '%' + kw + '%'); }
      const wsql = where.length ? (' WHERE ' + where.join(' AND ')) : '';
      const cnt = await app.db.query('SELECT COUNT(*) AS c FROM cl_ecgci_pm' + wsql, params);
      total = Number(cnt[0][0].c);
      const rows = await app.db.query(
        'SELECT ' + cols + ' FROM cl_ecgci_pm' + wsql + ' ORDER BY code LIMIT ? OFFSET ?',
        params.concat([pageSize, offset])
      );
      items = rows[0];
    }
    reply.send({ ok: true, total, page, pageSize, pages: Math.ceil(total / pageSize), items });
  });
};
