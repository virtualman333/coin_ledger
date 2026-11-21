'use strict';
/**
 * 我的藏品：只读分享快照（Web 与小程序共用）。
 *
 *   POST /api/colshare          登录，把当前藏品脱敏成快照，返回分享码
 *   GET  /api/colshare/:code    公开，读取快照（转发 / 朋友圈落地）
 *
 * 快照独立于 store 的整份文档模型，直接走 app.db（cl_colshare，migration 009）。
 */
const crypto = require('node:crypto');
const legacy = require('../legacy/api-handler');
const colshare = require('../services/colshare.service');

function newCode() {
  return crypto.randomBytes(6).toString('hex').slice(0, 12);
}

function parseItems(v) {
  if (!v) return [];
  try {
    const j = JSON.parse(v);
    return Array.isArray(j) ? j : [];
  } catch (e) {
    return [];
  }
}

module.exports = async function colshareRoutes(app) {
  /* ---------------- 生成快照 ---------------- */
  app.post('/api/colshare', { preHandler: app.requireLogin }, async function (request, reply) {
    const me = request.user;
    const body = await legacy.readBody(request.raw, 512 * 1024);
    const options = colshare.normalizeOptions(body && body.options);
    const items = colshare.sanitizeItems(body && body.items, options);
    if (!items.length) {
      return reply.code(400).send({ ok: false, error: '先添加藏品再分享' });
    }
    const code = newCode();
    // 统计永远按完整清单算：即使用户选择不公开清单，头部「N 个品种 · X 枚」也该是对的
    const stats = colshare.statsOf(items);
    // 不勾「品种清单」就只存汇总，别把明细留在库里
    const storedItems = options.list ? items : [];
    const [users] = await app.db.query(
      'SELECT nickname, name FROM cl_users WHERE id = ? LIMIT 1', [me.id]);
    const u = users[0] || {};
    const nickname = String(u.nickname || u.name || '藏友').slice(0, 64);
    await app.db.query(
      'INSERT INTO cl_colshare (code, uid, nickname, items, kinds, total, created_at) '
      + 'VALUES (?, ?, ?, ?, ?, ?, NOW(3))',
      [code, String(me.id), nickname, JSON.stringify(storedItems), stats.kinds, stats.total]);
    reply.send({ ok: true, code, kinds: stats.kinds, total: stats.total });
  });

  /* ---------------- 读取快照（公开） ---------------- */
  app.get('/api/colshare/:code', async function (request, reply) {
    const code = String((request.params && request.params.code) || '').slice(0, 32);
    if (!code) return reply.code(400).send({ ok: false, error: '缺少分享码' });
    const [rows] = await app.db.query(
      'SELECT code, nickname, items, kinds, total, created_at FROM cl_colshare WHERE code = ? LIMIT 1',
      [code]);
    const r = rows[0];
    if (!r) return reply.code(404).send({ ok: false, error: '分享不存在或已失效' });
    const items = parseItems(r.items);
    const stats = colshare.statsOf(items);
    reply.send({
      ok: true,
      code: r.code,
      owner: r.nickname || '藏友',
      items: items,
      kinds: Number(r.kinds) || 0,
      total: Number(r.total) || 0,
      // 有品种但没明细 = 分享者选择不公开清单
      listHidden: (Number(r.kinds) || 0) > 0 && items.length === 0,
      faceTotal: stats.faceTotal,
      aiTotal: stats.aiTotal,
      createdAt: r.created_at ? new Date(r.created_at).toISOString() : '',
    });
  });
};
