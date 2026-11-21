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
   *   ?page=1&pageSize=30&year=2026&face=10&material=金&quality=精制
   *   &project=G202701&q=熊猫&sort=year_desc|year_asc|code&facets=1
   * sort 默认 year_desc（缺年份沉底）；facets=1 时额外返回年份/面额/材质的去重取值，供前端拼筛选项。
   * 只返回展示所需列，不含 raw 公告全文（那条走详情接口）。
   */
  /** GET /api/catalog/pm/:code —— 单枚完整详情（点开才拉，不进列表传输） */
  app.get('/api/catalog/pm/:code', async function pmDetail(request, reply) {
    const code = String(request.params.code || '').toUpperCase();
    const CDN = 'https://chngc-prod-c2c-cdn.ecgci.com';
    let raw = null;
    // project_code 一起取：前端要靠它拉「同系列」的其他币
    const rows = await app.db.query(
      'SELECT raw, thumb, thumb_back, weight_g, project_code FROM cl_ecgci_pm WHERE code = ? LIMIT 1', [code]);
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
        projectCode: (rows[0] && rows[0][0] && rows[0][0].project_code) || raw.projectCode || '',
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
    const face = String(one(q.face) || '');
    const material = String(one(q.material) || '');
    const quality = String(one(q.quality) || '');
    const kw = String(one(q.q) || '').trim();
    const offset = (page - 1) * pageSize;
    const cols = 'code, project_code AS projectCode, project_name AS projectName, year, name, ' +
      'material, weight_g AS weightG, face, fineness, max_mintage AS maxMintage, quality, ' +
      'front_picture AS frontPicture, back_picture AS backPicture, thumb, thumb_back AS thumbBack';

    // 年份是 VARCHAR，直接排序会把空串和 NULL 混进来；统一转数字再排，缺年份永远沉底
    const ynum = "CAST(NULLIF(year, '') AS UNSIGNED)";
    const SORTS = {
      year_desc: ' ORDER BY ' + ynum + ' IS NULL, ' + ynum + ' DESC, code DESC',
      year_asc: ' ORDER BY ' + ynum + ' IS NULL, ' + ynum + ' ASC, code ASC',
      code: ' ORDER BY code ASC',
    };
    const sort = String(one(q.sort) || 'year_desc');
    const orderBy = SORTS[sort] || SORTS.year_desc;

    let total, items;
    {
      const where = [], params = [];
      if (year) { where.push('year = ?'); params.push(year); }
      if (project) { where.push('project_code = ?'); params.push(project); }
      if (face) { where.push('face = ?'); params.push(face); }
      if (material) { where.push('material = ?'); params.push(material); }
      if (quality) { where.push('quality = ?'); params.push(quality); }
      if (kw) {
        // 搜索框写的是「搜品种 / 年份」，那年份和项目名也要能搜到
        where.push('(name LIKE ? OR code LIKE ? OR project_name LIKE ? OR year LIKE ?)');
        const like = '%' + kw + '%';
        params.push(like, like, like, like);
      }
      const wsql = where.length ? (' WHERE ' + where.join(' AND ')) : '';
      const cnt = await app.db.query('SELECT COUNT(*) AS c FROM cl_ecgci_pm' + wsql, params);
      total = Number(cnt[0][0].c);
      const rows = await app.db.query(
        'SELECT ' + cols + ' FROM cl_ecgci_pm' + wsql + orderBy + ' LIMIT ? OFFSET ?',
        params.concat([pageSize, offset])
      );
      items = rows[0];
    }

    // ?facets=1：给前端拼筛选项用（年份 / 面额 / 材质），只有首屏才需要算
    let facets = null;
    if (String(one(q.facets) || '') === '1') {
      const [ys, fs, ms] = await Promise.all([
        app.db.query("SELECT DISTINCT year FROM cl_ecgci_pm WHERE year IS NOT NULL AND year <> '' ORDER BY year DESC"),
        app.db.query('SELECT DISTINCT face FROM cl_ecgci_pm WHERE face IS NOT NULL ORDER BY face ASC'),
        app.db.query("SELECT DISTINCT material FROM cl_ecgci_pm WHERE material IS NOT NULL AND material <> '' ORDER BY material ASC"),
      ]);
      facets = {
        years: ys[0].map((r) => String(r.year)),
        faces: fs[0].map((r) => r.face),
        materials: ms[0].map((r) => String(r.material)),
      };
    }

    reply.send({ ok: true, total, page, pageSize, pages: Math.ceil(total / pageSize), items, facets });
  });
};
