'use strict';
/**
 * 品类化的发行计划接口（Web 与小程序共用同一份数据源）。
 *
 *   GET /api/plans              —— 品类注册表 + 普通计划 + 贵金属计划
 *   GET /api/plans?category=pm  —— 只取贵金属（小程序可少传数据）
 *
 * 数据是只读 JSON，走 json-source 的 mtime 缓存，与 bootstrap 同源。
 */
const fs = require('fs');
const path = require('path');
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
      'front_picture AS frontPicture, back_picture AS backPicture';

    let total, items;
    if (config.isDbDataSource && app.db) {
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
    } else {
      // JSON 模式（本地/未导库）：同一份种子文件，字段对齐
      const doc = JSON.parse(fs.readFileSync(path.join(config.ROOT, 'data', 'seeds', 'pm-ecgci-all.json'), 'utf8'));
      let list = (doc.items || []).filter((it) => {
        if (year && String(it.projectYear || it.year || '') !== year) return false;
        if (project && it.projectCode !== project) return false;
        if (kw && (it.name || '').indexOf(kw) < 0 && (it.code || '').indexOf(kw) < 0) return false;
        return true;
      });
      total = list.length;
      items = list.slice(offset, offset + pageSize).map((it) => ({
        code: it.code, projectCode: it.projectCode, projectName: it.projectName,
        year: it.projectYear || it.year, name: it.name,
        material: Array.isArray(it.material) ? it.material.join('/') : it.material,
        weightG: Array.isArray(it.weight) ? it.weight.join('/') : it.weight,
        face: it.denomination, fineness: it.fineness, maxMintage: it.circulation,
        quality: it.quality, frontPicture: it.frontPicture, backPicture: it.backPicture
      }));
    }
    reply.send({ ok: true, total, page, pageSize, pages: Math.ceil(total / pageSize), items });
  });
};
