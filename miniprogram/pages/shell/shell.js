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
      wx.pageScrollTo({ scrollTop: 0, duration: 220, fail() {} });
      return;
    }

    const prev = this.data.tab;
    this.run(prev, 'onHide');

    // 全部视图常驻，这里只切显示。
    // 不再用 wx:if 按需创建：新视图插入会让内容高度突变，看起来就是"第二次动画"。
    this.setData({ tab: next }, () => {
      wx.setNavigationBarTitle({ title: TITLES[next] });
      // 同一帧同步回顶；延迟执行会先露出旧位置再跳上去，又是一次视觉跳动
      wx.pageScrollTo({ scrollTop: 0, duration: 0, fail() {} });

      // 让"切显示"这一帧先画完，再灌数据。
      // 同一帧里既切视图又 setData 大量列表，会两次重排，药丸动画就被拖出卡顿感。
      setTimeout(() => {
        this.boot(next);
        visit.track(ROUTES[next]);
      }, 16);
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
