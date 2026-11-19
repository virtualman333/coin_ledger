'use strict';
/**
 * 图片服务（T03）。
 *
 * 从 legacy/api-handler.js 的 `POST /api/admin/gallery`、`POST /api/admin/image`、
 * `DELETE /api/admin/image` 三个分支原样搬入，逻辑一字未简化：
 *   - kind 白名单 main/obverse/reverse/set，同 kind 去重，文件必须真实存在；
 *   - 主图上传时按内容生成 480 / 160 两张方形缩略图
 *     （img/th/<no>.jpg 与 img/th/s/<no>.jpg）；
 *   - 每次换图调用 legacy.touchGallery()：写 gallery.json + 刷新 galleryVer，
 *     否则 /img/* 的 7 天强缓存会让用户一直看到旧图（踩过的坑）；
 *   - 删除主图同时清 th/ 与 th/s/ 下的两张缩略图。
 *
 * db 模式：图库行写 cl_coin_images（事务）；文件仍落 public/img —— 图片本体
 * 从来不在数据库里，这一点两种模式一致。
 */
const fs = require('fs');
const path = require('path');

const config = require('../config');
const audit = require('../audit');
const legacy = require('../legacy/api-handler');
const catalog = require('../services/catalog.service');
const common = require('../schemas/common');

const PUBLIC_DIR = config.PUBLIC_DIR;
const SUFFIX = { main: '', obverse: '-f', reverse: '-b', set: '-s' };
const KINDS = { main: 1, obverse: 1, reverse: 1, set: 1 };

/**
 * 本机图片清单（legacy 的 IMG_SET：public/img 下的 NNN.jpg）。
 *
 * @returns {number[]} 编号升序
 */
function listImageNos() {
  try {
    return fs.readdirSync(path.join(PUBLIC_DIR, 'img'))
      .filter((f) => /^\d{3}\.jpg$/i.test(f))
      .map((f) => parseInt(f.slice(0, 3), 10))
      .sort((a, b) => a - b);
  } catch (e) {
    return [];
  }
}

/**
 * 创建图片服务。
 *
 * @param {{dataSource: object, withTx: Function}} ctx 依赖
 * @returns {object} 服务实例
 */
function create(ctx) {
  const ds = ctx.dataSource;
  const repos = ds.repos;

  /**
   * 当前图库（json 用内存镜像，db 用仓储）。
   *
   * @returns {Promise<object>} { '1': [{f,k}] }
   */
  async function galleryMap() {
    if (ds.mode === 'json') return legacy.state().gallery;
    const rows = await repos.images.listAll();
    return catalog.projectLegacyGallery(rows);
  }

  return {
    mode: ds.mode,
    listImageNos: listImageNos,

    /**
     * 整份替换某品种的多图。
     *
     * @param {object} body 请求体
     * @param {string} actor 操作人
     * @param {string} ip 来源 IP
     * @returns {Promise<{status:number,body:object}>} 响应
     */
    async saveGallery(body, actor, ip) {
      const b = common.isPlainObject(body) ? body : {};
      const id = String(Number(b.id));
      const list = Array.isArray(b.images) ? b.images : [];
      const clean = [];
      for (const it of list) {
        if (!it || !KINDS[it.k] || typeof it.f !== 'string') continue;
        if (clean.some((x) => x.k === it.k)) continue;
        if (!fs.existsSync(path.join(PUBLIC_DIR, 'img', it.f))) continue;
        clean.push({ f: it.f, k: it.k });
      }

      if (ds.mode === 'json') {
        const g = legacy.state().gallery;
        if (clean.length) g[id] = clean;
        else delete g[id];
        legacy.touchGallery();      // 写文件 + 刷新 galleryVer（7 天缓存破不掉的老坑）
      } else {
        await ctx.withTx(async (conn) => {
          await repos.images.replaceForCoin(conn, Number(id), clean, false);
          await repos.images.bumpVersion(conn);   // db 模式破 7 天强缓存的关键一步
        });
      }

      audit.log(actor, 'gallery.update', String(id), clean.length + ' 张图', ip);
      const g = await galleryMap();
      return { status: 200, body: { ok: true, images: g[id] || [] } };
    },

    /**
     * 上传图片（含 480 / 160 缩略图）。
     *
     * @param {object} body 请求体（图片 base64）
     * @param {string} actor 操作人
     * @param {string} ip 来源 IP
     * @returns {Promise<{status:number,body:object}>} 响应
     */
    async upload(body, actor, ip) {
      const b = common.isPlainObject(body) ? body : {};
      const id = Number(b.id);
      const kind = String(b.kind || '');
      if (!(kind in SUFFIX)) {
        return { status: 400, body: { ok: false, error: '图片类型不合法' } };
      }

      const coin = ds.mode === 'json'
        ? legacy.state().seed.coins.filter((c) => Number(c.i) + 1 === id)[0]
        : await repos.coins.findByNo(id);
      if (!coin) return { status: 404, body: { ok: false, error: '品种不存在' } };

      const raw = String(b.data || '');
      const m = /^data:image\/(jpeg|jpg|png);base64,([A-Za-z0-9+/=]+)$/.exec(raw);
      if (!m) return { status: 400, body: { ok: false, error: '只支持 JPEG / PNG' } };
      const buf = Buffer.from(m[2], 'base64');
      if (!buf.length) return { status: 400, body: { ok: false, error: '图片内容为空' } };
      if (buf.length > 4 * 1024 * 1024) return { status: 413, body: { ok: false, error: '图片超过 4MB，请先压缩' } };

      const fname = String(id).padStart(3, '0') + SUFFIX[kind] + '.jpg';
      fs.writeFileSync(path.join(PUBLIC_DIR, 'img', fname), buf);

      // 主图上传时，前端会附带两张按内容裁切好的方形缩略图（480 / 160）
      if (kind === 'main') {
        [['thumb480', ''], ['thumb160', 's']].forEach((pair) => {
          const tm = /^data:image\/(?:jpeg|jpg);base64,([A-Za-z0-9+/=]+)$/.exec(String(b[pair[0]] || ''));
          if (!tm) return;
          const thumb = Buffer.from(tm[1], 'base64');
          if (!thumb.length || thumb.length > 2 * 1024 * 1024) return;
          const dir = path.join(PUBLIC_DIR, 'img', 'th', pair[1]);
          fs.mkdirSync(dir, { recursive: true });
          fs.writeFileSync(path.join(dir, fname), thumb);
        });
      }

      const key = String(id);
      const list = ds.mode === 'json'
        ? (legacy.state().gallery[key] || []).filter((it) => it.k !== kind)
        : (await repos.images.listByCoin(id)).filter((it) => it.k !== kind)
          .map((it) => ({ f: it.filename, k: it.kind }));
      list.push({ f: fname, k: kind });

      if (ds.mode === 'json') {
        legacy.state().gallery[key] = list;
        legacy.touchGallery();
      } else {
        await ctx.withTx(async (conn) => {
          await repos.images.replaceForCoin(conn, id, list, false);
          await repos.images.bumpVersion(conn);   // db 模式破 7 天强缓存的关键一步
        });
      }

      console.log('[admin] 上传图片 ' + fname + '（' + Math.round(buf.length / 1024) + 'KB）');
      audit.log(actor, 'image.upload', fname, kind, ip);
      return { status: 200, body: { ok: true, file: fname, images: list } };
    },

    /**
     * 删除图片（主图连带清两张缩略图）。
     *
     * @param {object} query url.parse(req.url,true).query
     * @param {string} actor 操作人
     * @param {string} ip 来源 IP
     * @returns {Promise<{status:number,body:object}>} 响应
     */
    async remove(query, actor, ip) {
      const q = query && typeof query === 'object' ? query : {};
      const id = String(Number(q.id));
      const kind = String(q.kind || '');
      const g = await galleryMap();
      const list = g[id] || [];
      const hit = list.filter((it) => it.k === kind)[0];
      if (!hit) return { status: 404, body: { ok: false, error: '没有这张图' } };

      const rest = list.filter((it) => it.k !== kind);
      if (ds.mode === 'json') {
        if (rest.length) g[id] = rest;
        else delete g[id];
      }

      try { fs.unlinkSync(path.join(PUBLIC_DIR, 'img', hit.f)); } catch (e) { /* 文件可能已不在 */ }
      if (kind === 'main') {
        try { fs.unlinkSync(path.join(PUBLIC_DIR, 'img', 'th', hit.f)); } catch (e) { /* 可能没有 */ }
        try { fs.unlinkSync(path.join(PUBLIC_DIR, 'img', 'th', 's', hit.f)); } catch (e) { /* 可能没有 */ }
      }

      if (ds.mode === 'json') {
        legacy.touchGallery();
      } else {
        await ctx.withTx(async (conn) => {
          await repos.images.replaceForCoin(conn, Number(id),
            rest.map((it) => ({ f: it.f, k: it.k })), false);
          await repos.images.bumpVersion(conn);   // db 模式破 7 天强缓存的关键一步
        });
      }

      audit.log(actor, 'image.delete', id + ':' + kind, hit.f, ip);
      return { status: 200, body: { ok: true, images: rest } };
    }
  };
}

module.exports = { create: create, listImageNos: listImageNos, SUFFIX: SUFFIX };
