const store = require('./utils/store');
const visit = require('./utils/visit');

// 全局页面曝光埋点：包装 Page，onShow 时按页面路由上报。
// 新页面自动生效，不用逐个加；任何异常都吞掉，绝不影响页面注册与渲染。
try {
  const rawPage = Page;
  if (typeof rawPage === 'function') {
    Page = function (options) {
      const onShow = options && options.onShow;
      options.onShow = function () {
        try { visit.track(this && this.route); } catch (e) {}
        if (typeof onShow === 'function') return onShow.apply(this, arguments);
      };
      return rawPage(options);
    };
  }
} catch (e) { /* 基础库不允许重写时静默跳过 */ }

App({
  globalData: {
    appName: '藏币录',
    version: '2.9.63',
  },

  onLaunch() {
    store.hydrate();
    store.refresh().catch(() => {});

    // 允许右上角菜单里的「转发给朋友」和「分享到朋友圈」
    if (wx.showShareMenu) {
      wx.showShareMenu({
        withShareTicket: true,
        menus: ['shareAppMessage', 'shareTimeline'],
      });
    }
  },

  /**
   * 统一跳到某个 tab。
   *
   * 现在四个 tab 都住在常驻宿主页 pages/shell 里，具体是哪一格通过 globalData
   * 带过去（switchTab 不支持带参数）。其它页面不要再直接 switchTab 到
   * pages/index|plan|list|mine —— 那些路径已经退化成兼容壳，会多绕一次重定向。
   */
  goTab(index) {
    this.globalData.pendingTab = index;
    wx.switchTab({
      url: '/pages/shell/shell',
      // 已经站在宿主页时 switchTab 会失败，那就直接切视图
      fail: () => {
        try {
          const pages = getCurrentPages();
          const cur = pages[pages.length - 1];
          if (cur && cur.route === 'pages/shell/shell' && typeof cur.apply === 'function') {
            this.globalData.pendingTab = null;
            cur.apply(index);
          }
        } catch (e) { /* 忽略 */ }
      },
    });
  },
});
