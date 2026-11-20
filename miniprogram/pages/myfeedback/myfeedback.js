const api = require('../../utils/api');

Page({
  data: { items: [], loading: true, err: '' },

  onShow() { this.load(); },

  onPullDownRefresh() {
    this.load(() => wx.stopPullDownRefresh());
  },

  load(done) {
    this.setData({ loading: true, err: '' });
    api.get('/api/feedback/mine').then((res) => {
      const items = (res.items || []).map((it) => Object.assign({}, it, {
        dateText: String(it.createdAt || '').slice(0, 16).replace('T', ' '),
        done: it.status === 'done',
        imgs: (it.images || []).map((f) => (String(f).indexOf('http') === 0 ? f : api.BASE + '/feedback/' + f)),
      }));
      this.setData({ items, loading: false, err: '' });
      if (done) done();
    }).catch(() => {
      // 加载失败不能说成「还没有提交过反馈」，会让用户以为自己的反馈丢了
      this.setData({ loading: false, err: '加载失败，点此重试' });
      if (done) done();
    });
  },

  preview(e) {
    const src = e.currentTarget.dataset.src;
    const urls = e.currentTarget.dataset.urls || [];
    if (urls.length) wx.previewImage({ urls, current: src });
  },
});
