'use strict';
/**
 * 藏品增强 + 藏品广场接口（Web 与小程序共用）。
 *
 *   POST /api/serial/analyze      号码分析（无需登录）
 *   POST /api/serial/analyze-batch 批量分析 + 连号识别
 *   POST /api/holding/image       藏品图片上传（登录，base64 落盘，≤3 张由 holdings 白名单约束）
 *   GET  /api/shares              广场帖子流（?sort=new|hot&follow=1&limit&offset）
 *   POST /api/shares              发帖（登录，内容安全审核）
 *   DELETE /api/shares/:id        删帖（作者或管理员）
 *   POST /api/shares/:id/like     点赞/取消（toggle）
 *   GET  /api/shares/:id/comments 评论列表
 *   POST /api/shares/:id/comments 发评论（登录，内容安全审核）
 *   DELETE /api/shares/:id/comments/:cid  删评论（作者或管理员）
 *   GET  /api/following           我关注的人 + 各用户帖子数
 *   POST /api/follow/:uid         关注/取消（toggle，不能关注自己）
 *
 * 广场数据独立于 store 的整份文档模型，直接走 app.db（cl_share 等四表，migration 008）。
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const config = require('../config');
const wxsec = require('../wxsec');
const serial = require('../serial');
const { readBody } = require('../core/http');

const PUBLIC_DIR = config.PUBLIC_DIR;
const COLLECTION_DIR = path.join(PUBLIC_DIR, 'collection');

function newId() {
  return Date.now().toString(36) + crypto.randomBytes(4).toString('hex');
}
function parseArr(v) {
  if (!v) return [];
  try { const j = JSON.parse(v); return Array.isArray(j) ? j : []; } catch (e) { return []; }
}
function toISO(v) {
  if (!v) return '';
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? '' : d.toISOString();
}

module.exports = async function plazaRoutes(app) {
  /* ---------------- 号码分析 ---------------- */
  app.post('/api/serial/analyze', async function (request, reply) {
    const body = await readBody(request.raw, 16 * 1024);
    const no = String(body.no == null ? '' : body.no).slice(0, 32);
    reply.send(Object.assign({ ok: true }, serial.analyze(no)));
  });

  app.post('/api/serial/analyze-batch', async function (request, reply) {
    const body = await readBody(request.raw, 64 * 1024);
    const list = Array.isArray(body.nos) ? body.nos.slice(0, 200) : [];
    const r = serial.analyzeBatch(list);
    reply.send({ ok: true, items: r.items, runs: r.runs });
  });

  /* ---------------- 藏品图片上传 ---------------- */
  app.post('/api/holding/image', { preHandler: app.requireLogin }, async function (request, reply) {
    const me = request.user;
    const body = await readBody(request.raw, 3 * 1024 * 1024);
    const data = String(body.image || '');
    const m = /^data:image\/(jpeg|jpg|png|webp);base64,([A-Za-z0-9+/=]+)$/.exec(data);
    if (!m) return reply.code(400).send({ ok: false, error: '只支持 JPEG / PNG / WebP' });
    const buf = Buffer.from(m[2], 'base64');
    if (!buf.length || buf.length > 2 * 1024 * 1024) {
      return reply.code(400).send({ ok: false, error: '图片不能超过 2MB' });
    }
    // 内容安全审核（失败时按配置放行，见 wxsec）
    const chk = await wxsec.checkImage(buf, me.wxOpenid || '');
    if (chk && chk.ok === false) {
      return reply.code(400).send({ ok: false, error: '图片内容不合适，换一张吧' });
    }
    const ext = m[1] === 'png' ? 'png' : (m[1] === 'webp' ? 'webp' : 'jpg');
    fs.mkdirSync(COLLECTION_DIR, { recursive: true });
    const name = me.id + '-' + Date.now().toString(36) + '-' + crypto.randomBytes(3).toString('hex') + '.' + ext;
    fs.writeFileSync(path.join(COLLECTION_DIR, name), buf);
    reply.send({ ok: true, path: '/collection/' + name });
  });

  /* ---------------- 广场帖子流 ---------------- */
  app.get('/api/shares', async function (request, reply) {
    const q = request.query || {};
    const sort = q.sort === 'hot' ? 'hot' : 'new';
    const limit = Math.min(50, Math.max(1, Number(q.limit) || 20));
    const offset = Math.max(0, Number(q.offset) || 0);
    const me = app.currentUser(request.raw);
    let rows;
    if (q.follow === '1' && me) {
      [rows] = await app.db.query(
        'SELECT s.*, u.nickname, u.avatar, u.name AS uname FROM cl_share s ' +
        'JOIN cl_follow f ON f.target_uid = s.uid AND f.uid = ? ' +
        'JOIN cl_users u ON u.id = s.uid ' +
        'ORDER BY ' + (sort === 'hot' ? 's.likes DESC, s.created_at DESC' : 's.created_at DESC') +
        ' LIMIT ? OFFSET ?', [me.id, limit, offset]);
    } else {
      [rows] = await app.db.query(
        'SELECT s.*, u.nickname, u.avatar, u.name AS uname FROM cl_share s ' +
        'JOIN cl_users u ON u.id = s.uid ' +
        'ORDER BY ' + (sort === 'hot' ? 's.likes DESC, s.created_at DESC' : 's.created_at DESC') +
        ' LIMIT ? OFFSET ?', [limit, offset]);
    }
    const items = rows.map((r) => ({
      id: r.id, uid: r.uid,
      author: r.nickname || r.uname,
      avatar: r.avatar ? '/avatar/' + r.avatar : '',
      holdingName: r.holding_name,
      serials: parseArr(r.serials),
      images: parseArr(r.images),
      form: r.form || '',
      caption: r.caption || '',
      tags: parseArr(r.tags),
      likes: Number(r.likes) || 0,
      comments: Number(r.comments) || 0,
      createdAt: toISO(r.created_at),
      liked: false
    }));
    // 登录用户标注已点赞
    if (me && items.length) {
      const ids = items.map((x) => x.id);
      const [liked] = await app.db.query(
        'SELECT share_id FROM cl_share_like WHERE uid = ? AND share_id IN (' + ids.map(() => '?').join(',') + ')',
        [me.id].concat(ids));
      const set = new Set(liked.map((x) => x.share_id));
      items.forEach((x) => { x.liked = set.has(x.id); });
    }
    reply.send({ ok: true, items, sort });
  });

  /* ---------------- 发帖 ---------------- */
  // 单件与批量共用同一套字段清洗 / 审核 / 标签重算，避免两处口径漂移。
  function cleanShareItem(b, me) {
    const holdingName = String(b.holdingName || '').trim().slice(0, 64);
    if (!holdingName) return { error: '请选择要分享的藏品' };
    const caption = String(b.caption || '').trim().slice(0, 280);
    const serials = (Array.isArray(b.serials) ? b.serials : []).slice(0, 200).map((s) => String(s || '').trim().slice(0, 24)).filter(Boolean);
    const images = (Array.isArray(b.images) ? b.images : []).slice(0, 3)
      .map((s) => String(s || '').trim())
      .filter((p) => /^\/collection\/[A-Za-z0-9._-]+\.(jpg|jpeg|png|webp)$/i.test(p));
    const form = b.form === 'single' || b.form === 'set' ? b.form : '';
    // 号码花样标签：服务端重算，不信任前端传值
    const tags = [];
    serials.forEach((no) => {
      serial.analyze(no).tags.forEach((t) => {
        if (!tags.some((x) => x.name === t.name)) tags.push({ name: t.name, rarity: t.rarity });
      });
    });
    return { holdingName, caption, serials, images, form, tags };
  }
  async function checkCaption(caption, me) {
    if (!caption) return null;
    const chk = await wxsec.checkText(caption, me.wxOpenid || '');
    return (chk && chk.ok === false) ? '文案内容不合适，改一改吧' : null;
  }
  async function insertShare(clean, me) {
    const id = newId();
    await app.db.query(
      'INSERT INTO cl_share (id, uid, holding_name, serials, images, form, caption, tags, likes, comments, created_at) VALUES (?,?,?,?,?,?,?,?,0,0,NOW(3))',
      [id, me.id, clean.holdingName, JSON.stringify(clean.serials), JSON.stringify(clean.images), clean.form, clean.caption, JSON.stringify(clean.tags)]
    );
    return id;
  }

  app.post('/api/shares', { preHandler: app.requireLogin }, async function (request, reply) {
    const me = request.user;
    const b = await readBody(request.raw, 512 * 1024);
    const clean = cleanShareItem(b, me);
    if (clean.error) return reply.code(400).send({ ok: false, error: clean.error });
    const bad = await checkCaption(clean.caption, me);
    if (bad) return reply.code(400).send({ ok: false, error: bad });
    const id = await insertShare(clean, me);
    reply.send({ ok: true, id });
  });

  /**
   * POST /api/shares/batch —— 多选藏品一次性分享（每件生成一条独立帖子，广场里就是一张张卡片）。
   * body: { items: [{holdingName, serials, images, form, caption}, ...], caption? }
   * 单帖 caption 优先，未填时回退到公共 caption；最多 20 件，逐件审核，全部校验通过后才落库。
   */
  app.post('/api/shares/batch', { preHandler: app.requireLogin }, async function (request, reply) {
    const me = request.user;
    const b = await readBody(request.raw, 1024 * 1024);
    const rawItems = Array.isArray(b.items) ? b.items.slice(0, 20) : [];
    if (!rawItems.length) return reply.code(400).send({ ok: false, error: '请先选择要分享的藏品' });
    const globalCaption = String(b.caption || '').trim().slice(0, 280);
    const cleans = [];
    for (const raw of rawItems) {
      const clean = cleanShareItem(raw, me);
      if (clean.error) return reply.code(400).send({ ok: false, error: clean.error });
      if (!clean.caption && globalCaption) clean.caption = globalCaption;
      cleans.push(clean);
    }
    // 审核放在所有字段校验之后，避免垃圾请求消耗内容安全额度
    for (const clean of cleans) {
      const bad = await checkCaption(clean.caption, me);
      if (bad) return reply.code(400).send({ ok: false, error: bad });
    }
    const ids = [];
    for (const clean of cleans) ids.push(await insertShare(clean, me));
    reply.send({ ok: true, ids, count: ids.length });
  });

  app.delete('/api/shares/:id', { preHandler: app.requireLogin }, async function (request, reply) {
    const me = request.user;
    const id = String(request.params.id || '').slice(0, 24);
    const [rows] = await app.db.query('SELECT uid FROM cl_share WHERE id = ?', [id]);
    if (!rows.length) return reply.code(404).send({ ok: false, error: '帖子不存在' });
    if (rows[0].uid !== me.id && me.role !== 'admin') {
      return reply.code(403).send({ ok: false, error: '只能删除自己的分享' });
    }
    await app.db.query('DELETE FROM cl_share_comment WHERE share_id = ?', [id]);
    await app.db.query('DELETE FROM cl_share_like WHERE share_id = ?', [id]);
    await app.db.query('DELETE FROM cl_share WHERE id = ?', [id]);
    reply.send({ ok: true });
  });

  /* ---------------- 点赞 ---------------- */
  app.post('/api/shares/:id/like', { preHandler: app.requireLogin }, async function (request, reply) {
    const me = request.user;
    const id = String(request.params.id || '').slice(0, 24);
    const [exists] = await app.db.query('SELECT id FROM cl_share WHERE id = ?', [id]);
    if (!exists.length) return reply.code(404).send({ ok: false, error: '帖子不存在' });
    const [had] = await app.db.query('SELECT uid FROM cl_share_like WHERE share_id = ? AND uid = ?', [id, me.id]);
    if (had.length) {
      await app.db.query('DELETE FROM cl_share_like WHERE share_id = ? AND uid = ?', [id, me.id]);
      await app.db.query('UPDATE cl_share SET likes = GREATEST(0, likes - 1) WHERE id = ?', [id]);
      reply.send({ ok: true, liked: false });
    } else {
      await app.db.query('INSERT INTO cl_share_like (share_id, uid, created_at) VALUES (?,?,NOW(3))', [id, me.id]);
      await app.db.query('UPDATE cl_share SET likes = likes + 1 WHERE id = ?', [id]);
      reply.send({ ok: true, liked: true });
    }
  });

  /* ---------------- 评论 ---------------- */
  app.get('/api/shares/:id/comments', async function (request, reply) {
    const id = String(request.params.id || '').slice(0, 24);
    const me = app.currentUser(request.raw);
    const [rows] = await app.db.query(
      'SELECT c.*, u.nickname, u.avatar, u.name AS uname FROM cl_share_comment c ' +
      'JOIN cl_users u ON u.id = c.uid WHERE c.share_id = ? ORDER BY c.created_at LIMIT 200', [id]);
    reply.send({
      ok: true,
      items: rows.map((r) => ({
        id: r.id, uid: r.uid, author: r.nickname || r.uname,
        avatar: r.avatar ? '/avatar/' + r.avatar : '',
        text: r.text, createdAt: toISO(r.created_at),
        mine: !!(me && r.uid === me.id)
      }))
    });
  });

  app.post('/api/shares/:id/comments', { preHandler: app.requireLogin }, async function (request, reply) {
    const me = request.user;
    const id = String(request.params.id || '').slice(0, 24);
    const cb = await readBody(request.raw, 16 * 1024);
    const text = String(cb.text || '').trim().slice(0, 280);
    if (!text) return reply.code(400).send({ ok: false, error: '评论不能为空' });
    const chk = await wxsec.checkText(text, me.wxOpenid || '');
    if (chk && chk.ok === false) return reply.code(400).send({ ok: false, error: '评论内容不合适，改一改吧' });
    const [exists] = await app.db.query('SELECT id FROM cl_share WHERE id = ?', [id]);
    if (!exists.length) return reply.code(404).send({ ok: false, error: '帖子不存在' });
    const cid = newId();
    await app.db.query(
      'INSERT INTO cl_share_comment (id, share_id, uid, text, created_at) VALUES (?,?,?,?,NOW(3))',
      [cid, id, me.id, text]
    );
    await app.db.query('UPDATE cl_share SET comments = comments + 1 WHERE id = ?', [id]);
    reply.send({
      ok: true,
      comment: { id: cid, uid: me.id, author: me.nickname || me.name, text, createdAt: new Date().toISOString() }
    });
  });

  app.delete('/api/shares/:id/comments/:cid', { preHandler: app.requireLogin }, async function (request, reply) {
    const me = request.user;
    const id = String(request.params.id || '').slice(0, 24);
    const cid = String(request.params.cid || '').slice(0, 24);
    const [rows] = await app.db.query('SELECT uid FROM cl_share_comment WHERE id = ? AND share_id = ?', [cid, id]);
    if (!rows.length) return reply.code(404).send({ ok: false, error: '评论不存在' });
    if (rows[0].uid !== me.id && me.role !== 'admin') {
      return reply.code(403).send({ ok: false, error: '只能删除自己的评论' });
    }
    await app.db.query('DELETE FROM cl_share_comment WHERE id = ?', [cid]);
    await app.db.query('UPDATE cl_share SET comments = GREATEST(0, comments - 1) WHERE id = ?', [id]);
    reply.send({ ok: true });
  });

  /* ---------------- 关注 ---------------- */
  app.get('/api/following', async function (request, reply) {
    const me = app.currentUser(request.raw);
    if (!me) return reply.send({ ok: true, items: [] });
    const [rows] = await app.db.query(
      'SELECT f.target_uid, u.nickname, u.avatar, u.name AS uname FROM cl_follow f ' +
      'JOIN cl_users u ON u.id = f.target_uid WHERE f.uid = ? ORDER BY f.created_at DESC', [me.id]);
    reply.send({
      ok: true,
      items: rows.map((r) => ({
        uid: r.target_uid, name: r.nickname || r.uname,
        avatar: r.avatar ? '/avatar/' + r.avatar : ''
      }))
    });
  });

  app.post('/api/follow/:uid', { preHandler: app.requireLogin }, async function (request, reply) {
    const me = request.user;
    const target = String(request.params.uid || '').slice(0, 16);
    if (target === me.id) return reply.code(400).send({ ok: false, error: '不能关注自己' });
    const [u] = await app.db.query('SELECT id FROM cl_users WHERE id = ?', [target]);
    if (!u.length) return reply.code(404).send({ ok: false, error: '用户不存在' });
    const [had] = await app.db.query('SELECT uid FROM cl_follow WHERE uid = ? AND target_uid = ?', [me.id, target]);
    if (had.length) {
      await app.db.query('DELETE FROM cl_follow WHERE uid = ? AND target_uid = ?', [me.id, target]);
      reply.send({ ok: true, following: false });
    } else {
      await app.db.query('INSERT INTO cl_follow (uid, target_uid, created_at) VALUES (?,?,NOW(3))', [me.id, target]);
      reply.send({ ok: true, following: true });
    }
  });
};
