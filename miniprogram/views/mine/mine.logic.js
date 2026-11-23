const api = require('../../utils/api');
const cat = require('../../utils/catalog');
const store = require('../../utils/store');
const share = require('../../utils/share');
const appconfig = require('../../utils/appconfig');

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

module.exports = {
  data: {
    maintenance: false,
    loggedIn: false,
    isAdmin: false,
    userName: '',
    userAvatar: '',
    displayName: '',
    appVersion: '',
    totalCoins: 0,
    progPct: 0,
    dist: [
      { key: 'coin', name: '普通纪念币', n: 0 },
      { key: 'note', name: '纪念钞', n: 0 },
      { key: 'pm', name: '贵金属纪念币', n: 0 }
    ],
    quick: [],
    recent: [],
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
    this.render();
    appconfig.refresh().then(() => this.render()).catch(() => {});
    store.refresh().then(() => this.render()).catch((err) => {
      this.setData({ syncTip: err.message || '同步失败' });
    });
  },

  onPullDownRefresh() {
    store.refresh().then(() => {
      this.render();
      this.triggerEvent('refreshed');
    }).catch(() => this.triggerEvent('refreshed'));
  },

  /** 最近 3 枚有图的收藏，放在「我的收藏」行左侧当视觉锚点 */
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

  /** 收藏构成：三个品类各多少，点了直接跳对应分类 */
  buildDist(hs) {
    const out = [
      { key: 'coin', name: '普通纪念币', n: 0 },
      { key: 'note', name: '纪念钞', n: 0 },
      { key: 'pm', name: '贵金属纪念币', n: 0 }
    ];
    (hs || []).forEach((h) => {
      const c = cat.byName[h.name];
      const key = h.category === 'pm' ? 'pm' : ((c && c.kind === 'note') ? 'note' : 'coin');
      const hit = out.filter((x) => x.key === key)[0];
      if (hit) hit.n += 1;
    });
    return out;
  },

  /** 快捷入口：只放「我的收藏」之外的高频动作，避免和下面那行重复 */
  buildQuick() {
    const list = [];
    // 维护状态下不暴露备份入口：备份本身属于账本功能
    if (!appconfig.isMaintenance()) list.push({ key: 'backup', name: '收藏备份', icon: '⇅' });
    list.push(
      { key: 'count', name: '拍照数币', icon: '◎' },
      { key: 'feedback', name: '意见反馈', icon: '✎' }
    );
    return list;
  },

  /** 最近添加：数组尾部就是最后加入的，取 6 枚足够看出「最近在收什么」 */
  buildRecent(hs) {
    return (hs || []).slice(-6).reverse().map((h) => {
      const c = cat.byName[h.name];
      let img = '';
      if (h.category === 'pm' && h.thumb) {
        img = String(h.thumb).indexOf('http') === 0 ? h.thumb : api.BASE + h.thumb;
      } else if (c) {
        img = c.smallUrl || c.thumbUrl || c.imgUrl || '';
      }
      const size = c ? (c.setSizeBase || c.setSize) : 20;
      const rolls = Number(h.rolls) || 0;
      const qty = h.unit === 'piece' ? rolls : rolls * size;
      return {
        id: c ? c.id : 0,
        pmCode: h.category === 'pm' ? h.id : '',
        isPm: h.category === 'pm',
        name: h.name,
        initial: String(h.name || '藏').charAt(0),
        img,
        qtyText: qty + ' ' + ((c && c.kind === 'note') ? '张' : '枚')
      };
    });
  },

  /* ---------------- 跳转 ---------------- */

  /** 点品类格：带着分类进「我的收藏」 */
  goCat(e) {
    const key = e.currentTarget.dataset.cat || 'all';
    wx.navigateTo({ url: '/pages/holdings/holdings?cat=' + encodeURIComponent(key) });
  },

  /** 点最近添加的某一枚：直接进它的详情 */
  goRecent(e) {
    const idx = Number(e.currentTarget.dataset.idx);
    const it = (this.data.recent || [])[idx];
    if (!it) return;
    if (it.isPm) {
      if (it.pmCode) wx.navigateTo({ url: '/pages/pmdetail/pmdetail?code=' + encodeURIComponent(it.pmCode) });
      else wx.showToast({ title: '这枚暂无详情页', icon: 'none' });
      return;
    }
    if (!it.id) { wx.showToast({ title: '该品种暂无详情页', icon: 'none' }); return; }
    wx.navigateTo({ url: '/pages/detail/detail?id=' + it.id });
  },

  /** 快捷入口分发（收藏备份在更多功能页里，那里有导入导出的完整逻辑） */
  onQuick(e) {
    const key = e.currentTarget.dataset.key;
    if (key === 'backup') { wx.navigateTo({ url: '/pages/backup/backup' }); return; }
    if (key === 'count') { wx.navigateTo({ url: '/pages/count/count' }); return; }
    if (key === 'feedback') { wx.navigateTo({ url: '/pages/feedback/feedback' }); return; }
  },

  render() {
    const state = store.getState();
    const st = store.stats();

    this.setData({
      maintenance: appconfig.ready() ? appconfig.isMaintenance() : true,
      loggedIn: !!state.user,
      isAdmin: !!(state.isAdmin || (state.user && state.user.role === 'admin')),
      userName: state.user ? state.user.name : '',
      displayName: state.user ? (state.user.nickname || state.user.name) : '',
      userAvatar: state.user && state.user.avatar ? require('../../utils/api').BASE + state.user.avatar : '',
      appVersion: appVersion(),
      totalCoins: cat.total,
      dist: this.buildDist(state.holdings),
      quick: this.buildQuick(state.holdings),
      recent: this.buildRecent(state.holdings),
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
    if (appconfig.isMaintenance()) { wx.showToast({ title: '账本功能调整中', icon: 'none' }); return; }
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
    this.triggerEvent('switchtab', { index: 2 });
  },

  onShareAppMessage() {
    return share.appMessage('mine');
  },

  onShareTimeline() {
    return share.timeline('mine');
  },
};
;
