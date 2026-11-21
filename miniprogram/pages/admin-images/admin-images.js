const cat = require('../../utils/catalog');
const api = require('../../utils/api');
const { ensureAdmin } = require('../../utils/admin-guard');

Page({
  data: {
    coins: [],
  },

  onLoad(q) {
    if (!ensureAdmin()) return;
    // 从「资料库」点进来时带着品种名，直接定位到这一枚
    const kw = String((q && q.kw) || '').trim();
    if (kw) this.setData({ keyword: kw });
    this.loadCoins();
  },

  onPullDownRefresh() {
    Promise.resolve(this.loadCoins())
      .then(() => wx.stopPullDownRefresh(), () => wx.stopPullDownRefresh());
  },

  loadCoins() {
    return api.get('/api/admin/coins').then((res) => {
      const byId = {};
      cat.coins.forEach((c) => { byId[c.id] = c; });
      const coins = (res.coins || []).map((c) => {
        const id = Number(c.i) + 1;
        const local = byId[id] || {};
        return Object.assign({}, local, c, {
          id: id,
          i: id,
          smallUrl: local.smallUrl || '',
          thumbUrl: local.thumbUrl || '',
          imgUrl: local.imgUrl || '',
        });
      });
      this.setData({ coins, coinCount: coins.length });
      this.applyFilter();
    }).catch((e) => wx.showToast({ title: e.message || '加载失败', icon: 'none' }));
  },
  applyFilter() {
    const kw = String(this.data.keyword || '').trim();
    const all = this.data.allCoins || this.data.coins;
    this.data.allCoins = all;
    const list = !kw ? all : all.filter((c) => String(c.name).indexOf(kw) >= 0 || String(c.year).indexOf(kw) >= 0);
    this.setData({ coins: list });
  },

  previewImage(e) {
    const url = e.currentTarget.dataset.url;
    if (!url) { wx.showToast({ title: '这枚还没有图', icon: 'none' }); return; }
    wx.previewImage({ urls: [url], current: url });
  },
  replaceImage(e) {
    const id = Number(e.currentTarget.dataset.i);
    const coin = this.data.coins.filter((x) => x.id === id)[0];
    if (!coin) return;
    wx.showActionSheet({
      itemList: ['上传主图', '上传正面图', '上传背面图', '上传整套图'],
      success: (r) => {
        const kinds = ['main', 'obverse', 'reverse', 'set'];
        this.pickAndUpload(id, kinds[r.tapIndex]);
      },
    });
  },
  pickAndUpload(id, kind) {
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sizeType: ['compressed'],
      success: (r) => {
        const file = (r.tempFiles || [])[0];
        if (!file) return;
        wx.getFileSystemManager().readFile({
          filePath: file.tempFilePath,
          encoding: 'base64',
          success: (fr) => {
            const ext = /\.png$/i.test(file.tempFilePath) ? 'png' : 'jpeg';
            wx.showLoading({ title: '上传中', mask: true });
            api.post('/api/admin/image', { id: id, kind: kind, data: 'data:image/' + ext + ';base64,' + fr.data })
              .then(() => {
                wx.hideLoading();
                wx.showToast({ title: '已上传', icon: 'success' });
                this.setData({ allCoins: null });
                this.loadCoins();
              })
              .catch((e) => { wx.hideLoading(); wx.showToast({ title: e.message || '上传失败', icon: 'none' }); });
          },
          fail: () => wx.showToast({ title: '读取图片失败', icon: 'none' }),
        });
      },
    });
  },
});
