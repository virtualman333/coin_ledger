const cat = require('../../utils/catalog');
const store = require('../../utils/store');
const share = require('../../utils/share');

Page({
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
    seriesTop: [],
    syncTip: '',
    progress: { owned: 0, total: 0, pct: 0, label: '' },
    heroImg: '',
  },

  onShow() {
    this.render();
    store.refresh().then(() => this.render()).catch((err) => {
      this.setData({ syncTip: err.message || '同步失败' });
    });
  },

  onPullDownRefresh() {
    store.refresh().then(() => {
      this.render();
      wx.stopPullDownRefresh();
    }).catch(() => {
      wx.stopPullDownRefresh();
    });
  },

  render() {
    const st = store.stats();
    const owned = store.ownedNames();
    const ownedCount = Object.keys(owned).length;
    const coins = cat.coins.slice().sort((a, b) => (b.year - a.year) || (b.id - a.id));
    // hero 右侧展示一枚真实藏品，比纯装饰更有归属感
    const firstOwned = cat.coins.filter((c) => owned[c.name] && c.imgUrl)[0];
    const heroImg = firstOwned ? (firstOwned.thumbUrl || firstOwned.imgUrl) : '';
    const latest = coins.slice(0, 3).map((c) => ({
      id: c.id,
      name: c.name,
      year: c.year,
      imgUrl: c.smallUrl || c.thumbUrl || c.imgUrl,
      faceText: c.faceText,                       // 单件面额，如「20 元/张」
      priceText: '一套约 ¥' + cat.money(store.setPriceOf(c)),
    }));
    const seriesTop = cat.seriesList
      .map((x) => {
        const list = cat.coins.filter((c) => c.series === x.code);
        const own = list.filter((c) => owned[c.name]).length;
        return {
          code: x.code,
          name: x.name,
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

  goHoldings() {
    wx.navigateTo({ url: '/pages/holdings/holdings' });
  },

  /** 最新发行的「全部」→ 发行计划（tab 页，用 switchTab） */
  goPlanTab() {
    wx.switchTab({ url: '/pages/plan/plan' });
  },

  /** 系列总览：卡片页，而不是直接跳清单 */
  goSeriesPage() {
    wx.navigateTo({ url: '/pages/series/series' });
  },

  goList() {
    wx.switchTab({ url: '/pages/list/list' });
  },


  goAccount() {
    wx.navigateTo({ url: '/pages/account/account' });
  },

  goDetail(e) {
    wx.navigateTo({ url: '/pages/detail/detail?id=' + e.currentTarget.dataset.id });
  },

  copyContact() {
    wx.setClipboardData({
      data: 'virtualman2001',
      success: () => wx.showToast({ title: '微信号已复制', icon: 'success' }),
    });
  },

  onShareAppMessage() {
    return share.appMessage('home');
  },

  onShareTimeline() {
    return share.timeline('home');
  },

  goSeries(e) {
    // switchTab 的 success 回调里目标页可能还没就绪，用一次性标记传递，由清单页 onShow 取走
    wx.setStorageSync('cl_pending_series', e.currentTarget.dataset.code);
    wx.switchTab({ url: '/pages/list/list' });
  },
});
