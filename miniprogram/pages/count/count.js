const api = require('../../utils/api');
const store = require('../../utils/store');
const privacy = require('../../utils/privacy');

Page({
  data: {
    image: '',        // 本地预览路径
    marked: '',       // 标注图（服务器返回）
    count: 0,
    edited: false,    // 用户是否手动改过数量
    busy: false,
    err: '',
    ms: 0,
    logged: false
  },

  onShow() {
    this.setData({ logged: store.isLogin && store.isLogin() });
  },

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
