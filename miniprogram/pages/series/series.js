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
    // 模糊搜索：三类系列一起筛（名称 / 编号），全量在本地，边输边筛不请求接口
    kw: '',
    coinAll: [],
    noteAll: [],
    pmAll: [],
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
      coinAll: all.filter((s) => s.cat === 'coin'),
      noteAll: all.filter((s) => s.cat === 'note'),
      total: cat.total,
      count: all.length,
    }, () => this.applyFilter());
  },

  /** 搜索：按名称 / 编号模糊匹配，三类系列一起筛 */
  onKw(e) {
    this.setData({ kw: String((e.detail && e.detail.value) || '') }, () => this.applyFilter());
  },

  clearKw() {
    this.setData({ kw: '' }, () => this.applyFilter());
  },

  /** 把 kw 应用到三类系列上；空关键字原样返回，避免每次都新建数组 */
  applyFilter() {
    const q = String(this.data.kw || '').trim().toLowerCase();
    const hit = (x) => !q
      || String(x.name || '').toLowerCase().indexOf(q) >= 0
      || String(x.code || '').toLowerCase().indexOf(q) >= 0;
    this.setData({
      coinGroup: this.data.coinAll.filter(hit),
      noteGroup: this.data.noteAll.filter(hit),
      pmGroup: this.data.pmAll.filter(hit),
    });
  },

  /** 贵金属「系列」= 发行项目，走公开接口，和 list 页同一来源 */
  loadPmSeries() {
    api.get('/api/series?category=pm').then((res) => {
      if (!res || !res.ok || !Array.isArray(res.items)) {
        this.setData({ pmLoaded: true, pmAll: [], pmGroup: [] });
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
      this.setData({ pmLoaded: true, pmAll: pm }, () => this.applyFilter());
    }).catch(() => this.setData({ pmLoaded: true, pmAll: [], pmGroup: [] }));
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
    const pool = category === 'pm' ? (this.data.pmAll.length ? this.data.pmAll : this.data.pmGroup)
      : (category === 'note' ? this.data.noteAll : this.data.coinAll);
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
