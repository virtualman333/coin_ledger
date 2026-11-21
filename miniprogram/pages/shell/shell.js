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
    refreshing: false,
  },

  onLoad(query) {
    this._loaded = [false, false, false, false];

    const t = Number(query && query.tab);
    if (t > 0 && t <= 3) {
      this.setData({ tab: t });
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
      // 已经在这一格：只回顶，不要再跑一遍 onShow（那会让列表又闪一次）
      this.scrollTop();
      return;
    }

    const prev = this.data.tab;
    this.run(prev, 'onHide');

    // 不再需要 pageScrollTo：每个 tab 在自己的 scroll-view 里，
    // 切走再切回还停在原来的位置，也就不会有"回到顶部"的那一下跳。
    this.setData({ tab: next }, () => {
      wx.setNavigationBarTitle({ title: TITLES[next] });
      wx.nextTick(() => {
        this.boot(next);
        visit.track(ROUTES[next]);
      });
    });
  },

  onTabChange(e) {
    this.apply(e.detail.index);
  },

  /** 视图内部的"去清单/去计划"等跳转，走同一套切视图逻辑，不重新加载页面 */
  onViewSwitch(e) {
    this.apply(e.detail.index);
  },

  /** scroll-view 下拉刷新：转给当前视图，完成后由视图的 refreshed 事件收回 */
  onRefresh() {
    if (this.data.refreshing) return;
    this.setData({ refreshing: true });

    // 兜底：视图异常没回调也要把转圈收掉，否则一直挂着
    if (this._refreshTimer) clearTimeout(this._refreshTimer);
    this._refreshTimer = setTimeout(() => this.finishRefresh(), 5000);

    const v = this.view();
    if (v && typeof v.onPullDownRefresh === 'function') v.onPullDownRefresh();
    else this.finishRefresh();
  },

  onRefreshed() {
    this.finishRefresh();
  },

  finishRefresh() {
    if (this._refreshTimer) {
      clearTimeout(this._refreshTimer);
      this._refreshTimer = null;
    }
    if (this.data.refreshing) this.setData({ refreshing: false });
  },

  /** scroll-view 触底：转给当前视图做加载更多 */
  onLower() {
    const v = this.view();
    if (v && typeof v.onReachBottom === 'function') v.onReachBottom();
  },

  /** 再点当前 tab：回到顶部（页面自己不再滚动，得让 scroll-view 滚） */
  onRetap() {
    this.scrollTop();
  },

  /**
   * 当前 tab 回顶。
   * scroll-view 是原生组件，selectComponent 拿不到，只能用 selectorQuery 取节点上下文
   * （基础库 2.14+ 的 ScrollViewContext）；取不到就静默跳过，不影响其它交互。
   */
  scrollTop() {
    const id = '#scroll-' + this.data.tab;
    try {
      wx.createSelectorQuery().in(this).select(id).node().exec((res) => {
        const ctx = res && res[0] && res[0].node;
        if (ctx && typeof ctx.scrollTo === 'function') {
          ctx.scrollTo({ top: 0, animated: true });
        }
      });
    } catch (e) { /* 忽略 */ }
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
