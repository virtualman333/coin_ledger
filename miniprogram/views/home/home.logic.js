const cat = require('../../utils/catalog');
const store = require('../../utils/store');
const share = require('../../utils/share');
const api = require('../../utils/api');
const appconfig = require('../../utils/appconfig');

module.exports = {
  data: {
    totalCoins: 0,
    seriesCount: 0,
    descCount: 0,
    loggedIn: false,
    userName: '',
    stats: {
      faceText: '0',
      costText: '0',
      marketText: '0',
      profitText: '0',
      up: true,
      rolls: 0,
      kinds: 0,
    },
    latest: [],
    maintenance: false,      // 维护状态：隐藏账本相关入口
    seriesTop: [],
    syncTip: '',
    progress: { owned: 0, total: 0, pct: 0, label: '' },
    heroImg: '',
    // 内容板块：实时行情（失败时整块隐藏）
    metal: null,
  },

  onShow() {
    this.render();
    this.loadMetal();
    // 管理端刚切过开关时，回到首页也能立刻生效
    appconfig.refresh().then(() => this.render()).catch(() => {});
    store.refresh().then(() => this.render()).catch((err) => {
      this.setData({ syncTip: err.message || '同步失败' });
    });
  },

  onPullDownRefresh() {
    this.loadMetal();
    store.refresh().then(() => {
      this.render();
      this.triggerEvent('refreshed');
    }).catch(() => {
      this.triggerEvent('refreshed');
    });
  },

  render() {
    const st = store.stats();
    const owned = store.ownedNames();
    const ownedCount = Object.keys(owned).length;
    const coins = cat.coins.slice().sort((a, b) => (b.year - a.year) || (b.id - a.id));
    // hero 右侧展示一枚真实收藏，比纯装饰更有归属感
    const firstOwned = cat.coins.filter((c) => owned[c.name] && c.imgUrl)[0];
    const heroImg = firstOwned ? (firstOwned.thumbUrl || firstOwned.imgUrl) : '';
    const latest = coins.slice(0, 3).map((c) => ({
      id: c.id,
      name: c.name,
      year: c.year,
      imgUrl: c.smallUrl || c.thumbUrl || c.imgUrl,
      faceText: c.faceText,                       // 单件面额，如「20 元/张」
      priceText: '推理价 ¥' + cat.money(cat.aiPriceOf(c) * c.setSize),
    }));
    const seriesTop = cat.seriesList
      .map((x) => {
        const list = cat.coins.filter((c) => (c.seriesKeys || [c.series]).indexOf(x.code) >= 0);
        const own = list.filter((c) => owned[c.name]).length;
        const noteN = list.filter((c) => c.kind === 'note').length;
        return {
          code: x.code,
          name: x.name,
          // 成员以纪念钞为主归 note，与系列页/清单页口径一致
          cat: noteN > list.length / 2 ? 'note' : 'coin',
          count: x.count,
          own,
          pct: x.count ? Math.round((own / x.count) * 100) : 0,
          label: own ? own + ' / ' + x.count : x.count + ' 个品种',
        };
      })
      .sort((a, b) => (b.own / b.count) - (a.own / a.count) || b.count - a.count)
      .slice(0, 6);
    const state = store.getState();

    this.setData({
      totalCoins: cat.total,
      descCount: cat.descCount,
      maintenance: appconfig.ready() ? appconfig.isMaintenance() : true,
      loggedIn: !!state.user,
      userName: state.user ? state.user.name : '',
      stats: {
        faceText: cat.money(st.face),
        costText: cat.money(st.cost),
        marketText: cat.money(st.market),
        profitText: cat.signed(st.profit),
        up: st.profit >= 0,
        rolls: st.rolls,
        kinds: st.kinds,
      },
      latest,
      seriesTop,
      heroImg: heroImg,
      seriesCount: cat.seriesList.length,
      progress: {
        owned: ownedCount,
        total: cat.total,
        pct: Math.round((ownedCount / cat.total) * 1000) / 10,
        label: ownedCount + ' / ' + cat.total,
      },
      syncTip: state.synced ? '' : (state.error || ''),
    });
  },

  /** 首页内容板块：实时金银价（公开接口，失败即隐藏整块） */
  loadMetal() {
    return api.get('/api/metal-price').then((r) => {
      if (!r || !r.ok || !r.quotes) { this.setData({ metal: null }); return; }
      const au = r.quotes.XAU;
      const ag = r.quotes.XAG;
      if (!au || !ag || au.cnyPerGram == null || ag.cnyPerGram == null) {
        this.setData({ metal: null });
        return;
      }
      this.setData({
        metal: {
          gold: fmtPrice(au.cnyPerGram),
          silver: fmtPrice(ag.cnyPerGram),
          timeText: hhmm(r.fetchedAt) + ' 更新',
          stale: !!r.stale,
        },
      });
    }).catch(() => this.setData({ metal: null }));
  },

  /** 行情卡：进贵金属目录 */
  goMetal() {
    wx.setStorageSync('cl_pending_series', { code: '', category: 'pm' });
    this.triggerEvent('switchtab', { index: 2 });
  },

  goHoldings() {
    wx.navigateTo({ url: '/pages/holdings/holdings' });
  },

  /** 最新发行的「全部」→ 发行计划（tab 页，用 switchTab） */
  goPlanTab() {
    this.triggerEvent('switchtab', { index: 1 });
  },

  /** 系列总览：卡片页，而不是直接跳清单 */
  goSeriesPage() {
    wx.navigateTo({ url: '/pages/series/series' });
  },

  goList() {
    this.triggerEvent('switchtab', { index: 2 });
  },


  goDetail(e) {
    wx.navigateTo({ url: '/pages/detail/detail?id=' + e.currentTarget.dataset.id });
  },

  onShareAppMessage() {
    return share.appMessage('home');
  },

  onShareTimeline() {
    return share.timeline('home');
  },

  goSeries(e) {
    // 首页系列卡片：打开独立系列详情页（修复老格式 storage 不带 category 导致筛选错位的 bug）
    const ds = e.currentTarget.dataset;
    const code = ds.code || '';
    const category = ds.cat || 'coin';
    wx.navigateTo({
      url: '/pages/series-detail/series-detail?category=' + category
        + '&code=' + encodeURIComponent(code)
        + '&name=' + encodeURIComponent(ds.name || ''),
    });
  },
};
;

/** 金额保留两位，非数字回退 -- */
function fmtPrice(n) {
  const v = Number(n);
  return isFinite(v) ? v.toFixed(2) : '--';
}

/** ISO 时间 → 本地 HH:MM（用户此前要求全站用本地时区） */
function hhmm(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2);
}
