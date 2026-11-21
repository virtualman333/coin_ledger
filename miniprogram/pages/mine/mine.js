const cat = require('../../utils/catalog');
const store = require('../../utils/store');
const share = require('../../utils/share');
const feature = require('../../utils/feature');
const tabbar = require('../../utils/tabbar');

/** 收藏进度切成 20 段刻度：比一根细线更像「集章册」，也更看得清进度 */
function buildSegs(pct) {
  const N = 20;
  const filled = Math.round((Math.max(0, Math.min(100, pct)) / 100) * N);
  const out = [];
  for (let i = 0; i < N; i += 1) out.push(i < filled);
  return out;
}

/** 版本号来自 app.globalData；测试环境没有 getApp 时退回空串 */
function appVersion() {
  try {
    const app = typeof getApp === 'function' ? getApp() : null;
    return (app && app.globalData && app.globalData.version) || '';
  } catch (e) {
    return '';
  }
}

Page({
  data: {
    plazaOn: feature.plaza,        // 广场入口开关（utils/feature.js）
    loggedIn: false,
    isAdmin: false,
    userName: '',
    userAvatar: '',
    displayName: '',
    appVersion: '',
    totalCoins: 0,
    progPct: 0,
    syncTip: '',
    stats: {
      faceText: '0',
      costText: '0',
      marketText: '0',
      pnlText: '¥0',
      pnlPct: 0,
      up: true,
      kinds: 0,
      rolls: 0,
    },
  },

  onShow() {
    tabbar.syncSelected(this, 3);
    this.render();
    store.refresh().then(() => this.render()).catch((err) => {
      this.setData({ syncTip: err.message || '同步失败' });
    });
  },

  onPullDownRefresh() {
    store.refresh().then(() => {
      this.render();
      wx.stopPullDownRefresh();
    }).catch(() => wx.stopPullDownRefresh());
  },

  /** 最近 3 枚有图的藏品，放在「我的藏品」行左侧当视觉锚点 */
  buildThumbs(list) {
    const api = require('../../utils/api');
    const out = [];
    (list || []).forEach((h) => {
      if (out.length >= 3) return;
      let url = '';
      if (h.category === 'pm') {
        url = h.thumb ? (String(h.thumb).indexOf('http') === 0 ? h.thumb : api.BASE + h.thumb) : '';
      } else {
        const c = cat.byName[h.name];
        url = c ? (c.smallUrl || c.thumbUrl || c.imgUrl || '') : '';
      }
      if (url) out.push(url);
    });
    return out;
  },

  render() {
    const state = store.getState();
    const st = store.stats();

    this.setData({
      loggedIn: !!state.user,
      isAdmin: !!(state.isAdmin || (state.user && state.user.role === 'admin')),
      userName: state.user ? state.user.name : '',
      displayName: state.user ? (state.user.nickname || state.user.name) : '',
      userAvatar: state.user && state.user.avatar ? require('../../utils/api').BASE + state.user.avatar : '',
      appVersion: appVersion(),
      totalCoins: cat.total,
      thumbs: this.buildThumbs(state.holdings),
      segs: buildSegs(cat.total ? (st.kinds / cat.total) * 100 : 0),
      progPct: cat.total ? Math.round((st.kinds / cat.total) * 100) : 0,
      stats: {
        faceText: cat.money(st.face),
        costText: cat.money(st.cost),
        marketText: cat.money(st.market),
        pnlText: (st.profit >= 0 ? '+' : '-') + '¥' + cat.money(Math.abs(st.profit)),
        pnlPct: st.cost ? cat.round2((st.profit / st.cost) * 100) : 0,
        up: st.profit >= 0,
        kinds: st.kinds,
        rolls: st.rolls,
      },
      syncTip: state.synced ? '' : (state.error || ''),
    });
  },

  goHoldings() {
    wx.navigateTo({ url: '/pages/holdings/holdings' });
  },

  goProfile() {
    wx.navigateTo({ url: '/pages/profile/profile' });
  },

  goMoreTools() {
    wx.navigateTo({ url: '/pages/more-tools/more-tools' });
  },

  goAccount() {
    wx.navigateTo({ url: '/pages/account/account' });
  },

  goList() {
    wx.switchTab({ url: '/pages/list/list' });
  },

  onShareAppMessage() {
    return share.appMessage('mine');
  },

  onShareTimeline() {
    return share.timeline('mine');
  },
});
