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
    version: '2.9.7',
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
});
