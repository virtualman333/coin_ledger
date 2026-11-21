const api = require('../../utils/api');
const { ensureAdmin } = require('../../utils/admin-guard');

Page({
  data: {
    cats: [],
  },

  onLoad() {
    if (!ensureAdmin()) return;
    this.loadCats();
  },

  onPullDownRefresh() {
    Promise.resolve(this.loadCats())
      .then(() => wx.stopPullDownRefresh(), () => wx.stopPullDownRefresh());
  },

  loadCats() {
    return api.get('/api/admin/categories').then((res) => {
      if (!res || !res.ok) return;
      const items = Array.isArray(res.items) ? res.items : [];
      // 进度条要按真实规模画：之前 wxml 里写死「pm 100% 其余 20%」，
      // 看着像有数据，其实和 count 完全无关
      const total = items.reduce((a, it) => a + (Number(it.count) || 0), 0);
      const max = items.reduce((a, it) => Math.max(a, Number(it.count) || 0), 0);
      this.setData({
        cats: items.map((it) => {
          const n = Number(it.count) || 0;
          return Object.assign({}, it, {
            pct: max ? Math.max(2, Math.round((n / max) * 100)) : 0,
            shareText: total ? Math.round((n / total) * 100) + '%' : '',
          });
        }),
      });
    }).catch(() => {});
  },
});
