const api = require('../../utils/api');
const store = require('../../utils/store');
const privacy = require('../../utils/privacy');

const SHARE_COVER = '/images/share-cover.png';
const POSTER_W = 1080;          // 海报逻辑尺寸（4:5，微信单图竖版最舒服）
const POSTER_H = 1350;

/** 画圆角矩形路径（canvas 2d 的 roundRect 新基础库才有，自己拼，兼容老机型） */
function roundRect(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.lineTo(x + w - rr, y);
  ctx.arcTo(x + w, y, x + w, y + rr, rr);
  ctx.lineTo(x + w, y + h - rr);
  ctx.arcTo(x + w, y + h, x + w - rr, y + h, rr);
  ctx.lineTo(x + rr, y + h);
  ctx.arcTo(x, y + h, x, y + h - rr, rr);
  ctx.lineTo(x, y + rr);
  ctx.arcTo(x, y, x + rr, y, rr);
  ctx.closePath();
}

Page({
  data: {
    image: '',        // 本地预览路径
    marked: '',       // 标注图（服务器返回）
    count: 0,
    edited: false,    // 用户是否手动改过数量
    busy: false,
    err: '',
    ms: 0,
    logged: false,
    invited: 0,       // 从好友分享进来时带的数量（>0 才显示邀请条）
    posterBusy: false
  },

  onLoad(q) {
    const from = q && q.from;
    const c = Number((q && q.c) || 0);
    if (from === 'share' && c > 0) {
      this.setData({ invited: Math.min(999, Math.floor(c)) });
    }
  },

  onShow() {
    this.setData({ logged: store.isLogin && store.isLogin() });
  },

  /* ---------------- 页面分享（右上角 ··· 转发 / 朋友圈） ---------------- */

  /** 标题带数量更有说服力；没结果时就是一句功能描述 */
  shareTitle() {
    const n = Number(this.data.count) || 0;
    if (n > 0) return '我用拍照数币数出 ' + n + ' 枚硬币，你也试试';
    return '拍照数币：一桌硬币拍一张，自动数清多少枚';
  },

  onShareAppMessage() {
    const n = Number(this.data.count) || 0;
    return {
      title: this.shareTitle(),
      path: n > 0 ? '/pages/count/count?from=share&c=' + n : '/pages/count/count',
      imageUrl: this.data.marked || SHARE_COVER
    };
  },

  onShareTimeline() {
    const n = Number(this.data.count) || 0;
    return {
      title: this.shareTitle(),
      query: n > 0 ? 'from=share&c=' + n : '',
      imageUrl: this.data.marked || SHARE_COVER
    };
  },

  /* ---------------- 分享结果图（canvas 海报） ---------------- */

  /** 用 canvas 2d 画一张结果海报，再交给微信「分享图片」面板 */
  shareResult() {
    if (this.data.posterBusy) return;
    if (!this.data.marked) {
      wx.showToast({ title: '先拍一张识别结果吧', icon: 'none' });
      return;
    }
    this.setData({ posterBusy: true });
    wx.showLoading({ title: '生成中…', mask: true });

    this.posterFile().then((file) => {
      wx.hideLoading();
      this.setData({ posterBusy: false });
      if (!file) {
        wx.showToast({ title: '生成失败，请重试', icon: 'none' });
        return;
      }
      if (wx.showShareImageMenu) {
        wx.showShareImageMenu({ path: file, fail: () => this.savePoster(file) });
      } else {
        this.savePoster(file);
      }
    }).catch(() => {
      wx.hideLoading();
      this.setData({ posterBusy: false });
      wx.showToast({ title: '生成失败，请重试', icon: 'none' });
    });
  },

  /** 没有「分享图片」面板（低版本）时的兜底：存相册 */
  savePoster(file) {
    wx.saveImageToPhotosAlbum({
      filePath: file,
      success: () => wx.showToast({ title: '已存到相册', icon: 'success' }),
      fail: () => wx.previewImage({ urls: [file] })
    });
  },

  /** 生成海报临时文件路径 */
  posterFile() {
    return new Promise((resolve) => {
      wx.createSelectorQuery()
        .select('#poster')
        .fields({ node: true, size: true })
        .exec((res) => {
          const canvas = res && res[0] && res[0].node;
          if (!canvas) {
            resolve('');
            return;
          }
          canvas.width = POSTER_W;
          canvas.height = POSTER_H;
          const ctx = canvas.getContext('2d');

          Promise.all([
            this.posterPhoto(),
            this.loadPath('/images/logo-seal.png')
          ]).then((paths) => Promise.all([
            this.loadImage(canvas, paths[0]),
            this.loadImage(canvas, paths[1])
          ])).then((imgs) => {
            this.drawPoster(ctx, imgs[0], imgs[1]);
            wx.canvasToTempFilePath({
              canvas,
              x: 0,
              y: 0,
              width: POSTER_W,
              height: POSTER_H,
              destWidth: POSTER_W,
              destHeight: POSTER_H,
              fileType: 'jpg',
              quality: 0.92,
              success: (r) => resolve(r.tempFilePath),
              fail: () => resolve('')
            });
          });
        });
    });
  },

  /**
   * 标注图的本地路径。优先走服务端缩略图接口（写成本地文件，不依赖
   * downloadFile 合法域名），拿不到再退回直接读网络图。
   */
  posterPhoto() {
    if (this.localPreview && this.localPreviewMarked === this.data.marked) {
      return Promise.resolve(this.localPreview);
    }
    return this.fetchPreview().then((path) => {
      if (path) {
        this.localPreview = path;
        this.localPreviewMarked = this.data.marked;
        return path;
      }
      return this.loadPath(this.data.marked);
    });
  },

  fetchPreview() {
    const name = String(this.data.marked || '').split('/').pop();
    if (!name) return Promise.resolve('');
    return api.get('/api/coin-count/preview?f=' + encodeURIComponent(name))
      .then((r) => {
        const b64 = r && r.ok && r.dataUrl ? String(r.dataUrl).split(',')[1] : '';
        if (!b64) return '';
        const filePath = wx.env.USER_DATA_PATH + '/count-poster-' + name.replace(/\.png$/, '') + '.jpg';
        return new Promise((resolve) => {
          wx.getFileSystemManager().writeFile({
            filePath,
            data: b64,
            encoding: 'base64',
            success: () => resolve(filePath),
            fail: () => resolve('')
          });
        });
      })
      .catch(() => '');
  },

  /** 网络图 / 包内图统一取成本地临时路径；失败给空串，海报降级成无图版 */
  loadPath(src) {
    return new Promise((resolve) => {
      if (!src) {
        resolve('');
        return;
      }
      wx.getImageInfo({
        src,
        success: (r) => resolve(r.path || ''),
        fail: () => resolve('')
      });
    });
  },

  loadImage(canvas, path) {
    return new Promise((resolve) => {
      if (!path) {
        resolve(null);
        return;
      }
      const img = canvas.createImage();
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = path;
    });
  },

  drawPoster(ctx, photo, logo) {
    const n = Number(this.data.count) || 0;
    const CREAM = '#fbf8f1';
    const INK = '#2a2620';
    const GOLD = '#9a6b1f';
    const MUTED = '#6b6559';
    const FAINT = '#a39b8c';

    ctx.fillStyle = CREAM;
    ctx.fillRect(0, 0, POSTER_W, POSTER_H);

    // 顶部：印章 + 品牌名
    if (logo) {
      ctx.save();
      roundRect(ctx, 72, 64, 84, 84, 20);
      ctx.clip();
      ctx.drawImage(logo, 72, 64, 84, 84);
      ctx.restore();
    }
    ctx.fillStyle = MUTED;
    ctx.font = '32px sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText('藏币录 · 拍照数币', 180, 108);

    // 数量主视觉
    ctx.fillStyle = MUTED;
    ctx.font = '38px sans-serif';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText('这桌一共数出', 72, 268);

    ctx.fillStyle = GOLD;
    ctx.font = 'bold 190px sans-serif';
    const numText = String(n);
    ctx.fillText(numText, 68, 470);
    const numW = ctx.measureText(numText).width;
    ctx.fillStyle = MUTED;
    ctx.font = '48px sans-serif';
    ctx.fillText('枚', 68 + numW + 16, 470);

    ctx.fillStyle = FAINT;
    ctx.font = '32px sans-serif';
    ctx.fillText('手机拍一张平铺的硬币，自动数清数量', 72, 540);

    // 标注图：卡片尺寸跟着图片比例走再居中。
    // 固定 936×562 的白卡装竖图，会左右各空出一大片白，看着像没排好版；
    // 按图比例收卡 + 淡投影，读起来像一张装裱好的照片。
    const bandY = 600, bandH = 562, bandW = POSTER_W - 144;
    const pad = 14;
    if (photo) {
      // 卡片含内边距也不能超出文字栏（72px 起、936 宽），否则横图会顶到页边
      const scale = Math.min((bandW - pad * 2) / photo.width, (bandH - pad * 2) / photo.height);
      const dw = Math.round(photo.width * scale);
      const dh = Math.round(photo.height * scale);
      const cardW = dw + pad * 2;
      const cardH = dh + pad * 2;
      const cardX = Math.round((POSTER_W - cardW) / 2);
      const cardY = Math.round(bandY + (bandH - cardH) / 2);

      ctx.save();
      ctx.shadowColor = 'rgba(74,58,26,0.12)';
      ctx.shadowBlur = 26;
      ctx.shadowOffsetY = 8;
      ctx.fillStyle = '#ffffff';
      roundRect(ctx, cardX, cardY, cardW, cardH, 24);
      ctx.fill();
      ctx.restore();

      ctx.save();
      roundRect(ctx, cardX + pad, cardY + pad, dw, dh, 16);
      ctx.clip();
      ctx.drawImage(photo, cardX + pad, cardY + pad, dw, dh);
      ctx.restore();
    }
    // photo 为空时什么都不画：宁可留白，也不要在分享出去的海报上写「图片加载失败」

    // 底部
    ctx.strokeStyle = '#e8dcc2';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(72, 1218);
    ctx.lineTo(POSTER_W - 72, 1218);
    ctx.stroke();

    ctx.fillStyle = INK;
    ctx.font = 'bold 34px sans-serif';
    ctx.fillText('微信搜索「藏币录」小程序', 72, 1276);
    ctx.fillStyle = FAINT;
    ctx.font = '27px sans-serif';
    ctx.fillText('只数数量、不识别币种 · 结果可手动修正', 72, 1322);

    if (this.data.edited) {
      ctx.fillStyle = GOLD;
      ctx.font = '26px sans-serif';
      ctx.textAlign = 'right';
      ctx.fillText('已手动修正', POSTER_W - 72, 1276);
      ctx.textAlign = 'left';
    }
  },

  /* ---------------- 拍照 / 计数 ---------------- */

  /** 拍照 / 相册选图：登录与隐私授权都前置，避免白操作一次选图 */
  chooseImage() {
    if (this.data.busy) return;
    if (!(store.isLogin && store.isLogin())) {
      wx.showModal({
        title: '需要先登录', content: '拍照数币需要登录后使用。', confirmText: '去登录',
        success: (r) => { if (r.confirm) wx.navigateTo({ url: '/pages/account/account' }); }
      });
      return;
    }
    privacy.ensure().then((ok) => {
      if (!ok) { wx.showToast({ title: '需要授权后才能使用相机/相册', icon: 'none' }); return; }
      wx.chooseMedia({
        count: 1, mediaType: ['image'], sizeType: ['compressed'], sourceType: ['album', 'camera'],
        success: (res) => {
          const file = res.tempFiles && res.tempFiles[0];
          if (!file) return;
          if (file.size > 9 * 1024 * 1024) {
            wx.showToast({ title: '图片不能超过 9MB', icon: 'none' }); return;
          }
          this.setData({ image: file.tempFilePath, marked: '', count: 0, edited: false, err: '', ms: 0 });
          this.run(file.tempFilePath);
        }
      });
    });
  },

  /** 读取为 base64 上传计数 */
  run(filePath) {
    if (!(store.isLogin && store.isLogin())) {
      wx.showModal({
        title: '需要先登录', content: '拍照数币需要登录后使用。', confirmText: '去登录',
        success: (r) => { if (r.confirm) wx.navigateTo({ url: '/pages/account/account' }); }
      });
      return;
    }
    this.setData({ busy: true, err: '' });
    wx.showLoading({ title: '识别中…', mask: true });
    wx.getFileSystemManager().readFile({
      filePath, encoding: 'base64',
      success: (fr) => {
        const mime = /\.png$/i.test(filePath) ? 'image/png' : 'image/jpeg';
        api.post('/api/coin-count', { image: 'data:' + mime + ';base64,' + fr.data })
          .then((r) => {
            wx.hideLoading();
            if (!r || !r.ok) throw new Error((r && r.error) || '识别失败');
            let marked = r.marked || '';
            if (marked && marked.charAt(0) === '/') marked = api.BASE + marked;
            this.setData({
              busy: false, count: Number(r.count) || 0, marked,
              ms: r.ms || 0, edited: false
            });
            if (!r.count) wx.showToast({ title: '没识别到硬币，换个角度试试', icon: 'none' });
          })
          .catch((err) => {
            wx.hideLoading();
            this.setData({ busy: false, err: err.message || '识别失败，请重试' });
          });
      },
      fail: () => {
        wx.hideLoading();
        this.setData({ busy: false, err: '读取图片失败' });
      }
    });
  },

  retry() {
    if (this.data.busy) return;
    if (this.data.image) this.run(this.data.image);
  },

  /** 手动微调数量（算法非 100%，允许人工纠正） */
  adjust(e) {
    const d = Number(e.currentTarget.dataset.d) || 0;
    const next = Math.max(0, (this.data.count || 0) + d);
    this.setData({ count: next, edited: true });
  },

  previewMarked() {
    if (!this.data.marked) return;
    wx.previewImage({ urls: [this.data.marked], current: this.data.marked });
  }
});
