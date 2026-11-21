const cat = require('../../utils/catalog');
const api = require('../../utils/api');
const store = require('../../utils/store');
const share = require('../../utils/share');

Page({
  data: {
    items: [],
    total: 0,
    count: 0,
    // 三大品类分组（按 tab 一次只展示一类）
    activeCat: 'coin',
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
      const pm = res.items.map((it) => {
        const mats = Array.isArray(it.materials) ? it.materials.filter(Boolean) : [];
        const yf = String(it.yearFrom || ''), yt = String(it.yearTo || '');
        return {
          code: it.code,
          name: it.name,
          count: it.count,
          yearText: yf && yt ? (yf === yt ? (yf + ' 年') : (yf + '—' + yt)) : '',
          matText: mats.slice(0, 4).join(' · '),
          thumb: it.thumb ? (String(it.thumb).indexOf('http') === 0 ? it.thumb : api.BASE + it.thumb) : '',
        };
      });
      this.setData({ pmLoaded: true, pmGroup: pm });
    }).catch(() => this.setData({ pmLoaded: true, pmGroup: [] }));
  },

  switchCat(e) {
    const catCode = e.currentTarget.dataset.cat || 'coin';
    if (catCode === this.data.activeCat) return;
    this.setData({ activeCat: catCode });
  },

  goSeries(e) {
    const ds = e.currentTarget.dataset;
    const code = ds.code || '';
    const category = ds.cat || 'coin';
    // 打开独立系列详情页：只展示这一系列的品种，保留返回栈（不再 switchTab 跳回清单）
    let name = '';
    const pool = category === 'pm' ? this.data.pmGroup
      : (category === 'note' ? this.data.noteGroup : this.data.coinGroup);
    if (Array.isArray(pool)) {
      const hit = pool.filter((s) => s.code === code)[0];
      if (hit) name = hit.name || '';
    }
    wx.navigateTo({
      url: '/pages/series-detail/series-detail?category=' + category
        + '&code=' + encodeURIComponent(code)
        + '&name=' + encodeURIComponent(name),
    });
  },

  goAll() {
    wx.removeStorageSync('cl_pending_series');
    getApp().goTab(2);
  },

  onShareAppMessage() {
    return share.appMessage('series');
  },

  onShareTimeline() {
    return share.timeline('series');
  },
});
