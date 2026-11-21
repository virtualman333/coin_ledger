const visit = require('../../utils/visit');

/**
 * 宿主页：承载 4 个 tab 视图 + 一条常驻 TabBar。
 *
 * 为什么不继续用微信的 custom tabBar：
 * 那套机制是「每个 tab 页各挂一个实例」，切页必然重建组件，
 * 药丸动画只能靠延时 switchTab 硬凑，跨页那一帧永远接不上。
 * 现在 tabBar 属于这个页面，切视图只是 setData，组件不动。
 *
 * 页面级能力（下拉刷新 / 触底 / 分享 / 标题 / 曝光埋点）统一在这里转发给当前视图，
 * 视图本身不需要知道自己是不是页面。
 */

const TITLES = ['藏币录', '发行计划', '全套清单', '我的'];
const ROUTES = ['pages/index/index', 'pages/plan/plan', 'pages/list/list', 'pages/mine/mine'];
const IDS = ['#view-home', '#view-plan', '#view-list', '#view-mine'];

Page({
  data: {
    tab: 0,
    // 首次只渲染首页，其余按需创建：list 有 2800+ 条数据，一次性全渲染会卡
    visited: [true, false, false, false],
  },

  onLoad(query) {
    this._loaded = [false, false, false, false];

    const t = Number(query && query.tab);
    if (t > 0 && t <= 3) {
      const visited = this.data.visited.slice();
      visited[t] = true;
      this.setData({ tab: t, visited });
      wx.setNavigationBarTitle({ title: TITLES[t] });
    }
  },

  onShow() {
    // 从别的页面 switchTab 过来：目标 tab 放在 globalData 里带过来
    const app = getApp();
    const pending = app && app.globalData && app.globalData.pendingTab;
    if (typeof pending === 'number') {
      app.globalData.pendingTab = null;
      this.apply(pending);
      return;
    }

    this.boot(this.data.tab);
    visit.track(ROUTES[this.data.tab]);
  },

  onHide() {
    this.run(this.data.tab, 'onHide');
  },

  onUnload() {
    this.run(this.data.tab, 'onHide');
  },

  /** 取某个 tab 对应的视图组件实例，不传则取当前 tab */
  view(tab) {
    const t = typeof tab === 'number' ? tab : this.data.tab;
    return this.selectComponent(IDS[t]);
  },

  /** 调视图方法；组件刚 setData 出来时可能还没挂好，短重试几次 */
  run(tab, name, arg, attempt) {
    const tries = attempt || 0;
    const v = this.view(tab);
    if (v && typeof v[name] === 'function') {
      v[name](arg);
      return true;
    }
    if (v) return true;
    if (tries >= 3) return false;
    setTimeout(() => this.run(tab, name, arg, tries + 1), 40);
    return false;
  },

  /** 视图首次可见时补一次 onLoad（原来由框架调，现在没人调了） */
  boot(tab, attempt) {
    const tries = attempt || 0;
    const v = this.view(tab);
    if (v) {
      if (!this._loaded[tab]) {
        this._loaded[tab] = true;
        if (typeof v.onLoad === 'function') v.onLoad({});
      }
      if (typeof v.onShow === 'function') v.onShow();
      return;
    }
    if (tries >= 3) return;
    setTimeout(() => this.boot(tab, tries + 1), 40);
  },

  apply(next) {
    if (typeof next !== 'number' || next < 0 || next > 3) return;

    if (next === this.data.tab) {
      this.boot(next);
      visit.track(ROUTES[next]);
      return;
    }

    const prev = this.data.tab;
    this.run(prev, 'onHide');

    const visited = this.data.visited.slice();
    visited[next] = true;

    // 只切显示：组件不销毁，药丸同一帧开始滑动，视觉上是连续的
    this.setData({ tab: next, visited }, () => {
      wx.setNavigationBarTitle({ title: TITLES[next] });
      this.boot(next);
      visit.track(ROUTES[next]);
      // 各 tab 各自从顶部开始，避免上一个 tab 的滚动位置串过来
      setTimeout(() => {
        wx.pageScrollTo({ scrollTop: 0, duration: 0, fail() {} });
      }, 30);
    });
  },

  onTabChange(e) {
    this.apply(e.detail.index);
  },

  /** 视图内部的"去清单/去计划"等跳转，走同一套切视图逻辑，不重新加载页面 */
  onViewSwitch(e) {
    this.apply(e.detail.index);
  },

  /** 再点当前 tab：回到顶部 */
  onRetap() {
    wx.pageScrollTo({ scrollTop: 0, duration: 220, fail() {} });
  },

  onPullDownRefresh() {
    const v = this.view();
    if (v && typeof v.onPullDownRefresh === 'function') v.onPullDownRefresh();
    else wx.stopPullDownRefresh();
  },

  onReachBottom() {
    const v = this.view();
    if (v && typeof v.onReachBottom === 'function') v.onReachBottom();
  },

  onShareAppMessage(res) {
    const v = this.view();
    if (v && typeof v.onShareAppMessage === 'function') {
      const out = v.onShareAppMessage(res);
      if (out) return out;
    }
    return {
      title: '藏币录 · 中国纪念币图鉴',
      path: '/pages/shell/shell?tab=' + this.data.tab,
    };
  },

  onShareTimeline() {
    const v = this.view();
    if (v && typeof v.onShareTimeline === 'function') {
      const out = v.onShareTimeline();
      if (out) return out;
    }
    return { title: '藏币录 · 中国纪念币图鉴' };
  },
});
