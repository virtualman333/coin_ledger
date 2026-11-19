const api = require('../../utils/api');

Page({
  data: { items: [], loading: true },

  onShow() { this.load(); },

  load() {
    api.get('/api/feedback/mine').then((res) => {
      const items = (res.items || []).map((it) => Object.assign({}, it, {
        dateText: String(it.createdAt || '').slice(0, 16).replace('T', ' '),
        done: it.status === 'done',
        imgs: (it.images || []).map((f) => (String(f).indexOf('http') === 0 ? f : api.BASE + '/feedback/' + f)),
      }));
      this.setData({ items, loading: false });
    }).catch(() => this.setData({ loading: false }));
  },

  preview(e) {
    const src = e.currentTarget.dataset.src;
    const urls = e.currentTarget.dataset.urls || [];
    if (urls.length) wx.previewImage({ urls, current: src });
  },
});
