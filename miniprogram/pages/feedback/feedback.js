const api = require('../../utils/api');
const cat = require('../../utils/catalog');
const privacy = require('../../utils/privacy');

Page({
  data: {
    coinId: 0,
    coinName: '',
    text: '',
    images: [],          // dataURL 列表
    busy: false,
    maxLen: 500,
  },

  onLoad(query) {
    const id = Number(query && query.id) || 0;
    const coin = cat.byId[id];
    this.setData({
      coinId: id,
      coinName: coin ? coin.name : (query && query.name) || '',
    });
  },

  onInput(e) {
    this.setData({ text: e.detail.value });
  },

  /** 选图：微信自带压缩，再读成 base64，最多 3 张 */
  addImage() {
    const left = 3 - this.data.images.length;
    if (left <= 0) {
      wx.showToast({ title: '最多 3 张', icon: 'none' });
      return;
    }
    privacy.ensure().then((ok) => {
      if (!ok) {
        wx.showToast({ title: '需要同意隐私保护指引才能选图', icon: 'none' });
        return;
      }
      this.pickImages(left);
    });
  },

  pickImages(left) {
    wx.chooseMedia({
      count: left,
      mediaType: ['image'],
      sizeType: ['compressed'],
      success: (res) => {
        const files = (res.tempFiles || []).map((f) => f.tempFilePath);
        files.forEach((p) => this.readAsDataUrl(p));
      },
    });
  },

  readAsDataUrl(filePath) {
    const fs = wx.getFileSystemManager();
    try {
      const base64 = fs.readFileSync(filePath, 'base64');
      if (base64.length > 2.6 * 1024 * 1024) {
        wx.showToast({ title: '图片太大，换一张', icon: 'none' });
        return;
      }
      const ext = /\.png$/i.test(filePath) ? 'png' : 'jpeg';
      this.setData({ images: this.data.images.concat(['data:image/' + ext + ';base64,' + base64]) });
    } catch (e) {
      wx.showToast({ title: '读图失败', icon: 'none' });
    }
  },

  removeImage(e) {
    const i = Number(e.currentTarget.dataset.i);
    const list = this.data.images.slice();
    list.splice(i, 1);
    this.setData({ images: list });
  },

  previewImage(e) {
    const i = Number(e.currentTarget.dataset.i);
    wx.previewImage({ current: this.data.images[i], urls: this.data.images });
  },

  submit() {
    const text = String(this.data.text || '').trim();
    if (text.length < 4) {
      wx.showToast({ title: '写清楚一点（至少 4 字）', icon: 'none' });
      return;
    }
    if (this.data.busy) return;
    this.setData({ busy: true });
    api.post('/api/feedback', {
      coinId: this.data.coinId,
      text: text,
      images: this.data.images,
    }).then(() => {
      this.setData({ busy: false, text: '', images: [] });
      wx.showToast({ title: '已提交，感谢', icon: 'success' });
      setTimeout(() => wx.navigateBack(), 700);
    }).catch((err) => {
      this.setData({ busy: false });
      wx.showModal({ title: '提交失败', content: err.message || '请稍后重试', showCancel: false });
    });
  },
});
