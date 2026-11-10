const store = require('./utils/store');

App({
  globalData: {
    appName: '藏币录',
    version: '2.8.3',
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
