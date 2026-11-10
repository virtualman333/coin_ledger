const cat = require('../../utils/catalog');
const api = require('../../utils/api');
const store = require('../../utils/store');

Page({
  data: {
    items: [],
    total: 0,
    count: 0,
  },

  onShow() {
    this.build();
  },

  build() {
    const owned = {};
    (store.getState().holdings || []).forEach((h) => { owned[h.name] = 1; });

    const items = cat.seriesList.map((s) => {
      const members = cat.inSeries(s.code);
      const own = members.filter((c) => owned[c.name]).length;
      return {
        code: s.code,
        name: s.name,
        count: members.length,
        own: own,
        pct: members.length ? Math.round((own / members.length) * 100) : 0,
        // 卡图可能为空：老系列没配图时用占位色块
        imgUrl: s.img ? api.BASE + '/' + s.img : '',
      };
    });

    this.setData({ items, total: cat.total, count: items.length });
  },

  goSeries(e) {
    const code = e.currentTarget.dataset.code;
    wx.setStorageSync('cl_pending_series', code);
    wx.switchTab({ url: '/pages/list/list' });
  },

  goAll() {
    wx.removeStorageSync('cl_pending_series');
    wx.switchTab({ url: '/pages/list/list' });
  },
});
