const api = require('../../utils/api');
const store = require('../../utils/store');
const appconfig = require('../../utils/appconfig');

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
    isAdmin: false,
    loggedIn: false,
    maintenance: false,
    appVersion: '',
  },

  onLoad() {
    const state = store.getState ? store.getState() : {};
    appconfig.refresh().then((c) => this.setData({ maintenance: !!c.maintenance })).catch(() => {});
    this.setData({
      isAdmin: !!state.isAdmin,
      loggedIn: !!(state && state.user),
      appVersion: appVersion(),
    });
  },

  /** 退出登录：和账户页同一套动作，退完留在这里并清空登录态 */
  onLogout() {
    wx.showModal({
      title: '退出登录',
      content: '退出后需要重新登录才能查看收藏。',
      confirmText: '退出',
      success: (res) => {
        if (!res.confirm) return;
        api.post('/api/auth/logout', {}).catch(() => {}).then(() => {
          api.setToken('');
          store.clearUser();
          this.setData({ loggedIn: false, isAdmin: false });
          wx.showToast({ title: '已退出', icon: 'success' });
        });
      },
    });
  },

  /* ---------------- 跳转 ---------------- */

  goCount() {
    wx.navigateTo({ url: '/pages/count/count' });
  },

  goMyFeedback() {
    wx.navigateTo({ url: '/pages/myfeedback/myfeedback' });
  },

  goAbout() {
    wx.navigateTo({ url: '/pages/about/about' });
  },

  goAdmin() {
    wx.navigateTo({ url: '/pages/admin/admin' });
  },

  /* ---------------- 收藏备份：在独立页面里做，那里有完整说明 ---------------- */

  onBackup() {
    if (appconfig.isMaintenance()) { wx.showToast({ title: '账本功能调整中', icon: 'none' }); return; }
    if (!store.isLogin()) {
      wx.showToast({ title: '登录后才能备份收藏', icon: 'none' });
      return;
    }
    wx.navigateTo({ url: '/pages/backup/backup' });
  }
});
