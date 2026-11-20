const cat = require('../../utils/catalog');
const api = require('../../utils/api');
const store = require('../../utils/store');
const share = require('../../utils/share');

Page({
  data: {
    items: [],
    total: 0,
    count: 0,
    // 三大品类分组
    coinGroup: [],
    noteGroup: [],
    pmGroup: [],
    pmLoaded: false,
  },

  onShow() {
    this.build();
    this.loadPmSeries();
  },

  build() {
    const owned = {};
    (store.getState().holdings || []).forEach((h) => { owned[h.name] = 1; });

    const all = cat.seriesList.map((s) => {
      const members = cat.inSeries(s.code);
      const own = members.filter((c) => owned[c.name]).length;
      const noteN = members.filter((c) => c.kind === 'note').length;
      return {
        code: s.code,
        name: s.name,
        count: members.length,
        own: own,
        pct: members.length ? Math.round((own / members.length) * 100) : 0,
        imgUrl: s.img ? api.BASE + '/' + s.img : '',
        // 成员以纪念钞为主归 note，否则 coin（与 Web 端口径一致）
        cat: noteN > members.length / 2 ? 'note' : 'coin',
      };
    });

    this.setData({
      items: all,
      coinGroup: all.filter((s) => s.cat === 'coin'),
      noteGroup: all.filter((s) => s.cat === 'note'),
      total: cat.total,
      count: all.length,
    });
  },

  /** 贵金属「系列」= 发行项目，走公开接口，和 list 页同一来源 */
  loadPmSeries() {
    api.get('/api/series?category=pm').then((res) => {
      if (!res || !res.ok || !Array.isArray(res.items)) {
        this.setData({ pmLoaded: true, pmGroup: [] });
        return;
      }
      const pm = res.items.map((it) => ({
        code: it.code,
        name: it.name,
        count: it.count,
      }));
      this.setData({ pmLoaded: true, pmGroup: pm });
    }).catch(() => this.setData({ pmLoaded: true, pmGroup: [] }));
  },

  goSeries(e) {
    const code = e.currentTarget.dataset.code;
    const category = e.currentTarget.dataset.cat || 'coin';
    // 同时传品类 + 系列，list 页会切到对应品类再定位系列
    wx.setStorageSync('cl_pending_series', { code, category });
    wx.switchTab({ url: '/pages/list/list' });
  },

  goAll() {
    wx.removeStorageSync('cl_pending_series');
    wx.switchTab({ url: '/pages/list/list' });
  },

  onShareAppMessage() {
    return share.appMessage('series');
  },

  onShareTimeline() {
    return share.timeline('series');
  },
});
