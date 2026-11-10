const cat = require('../../utils/catalog');
const privacy = require('../../utils/privacy');
const store = require('../../utils/store');

Page({
  data: {
    version: '',
    totalCoins: 0,
    seriesCount: 0,
    isTest: false,
  },

  onLoad() {
    const user = store.getState().user;
    this.setData({ isTest: !!(user && user.isTest) });
    let ver = '';
    try {
      const app = typeof getApp === 'function' ? getApp() : null;
      ver = (app && app.globalData && app.globalData.version) || '';
    } catch (e) { ver = ''; }
    this.setData({
      version: ver || '1.0.0',
      totalCoins: cat.total,
      seriesCount: cat.seriesList.length,
    });
  },

  copyContact() {
    privacy.ensure().then((ok) => {
      if (!ok) return;
      wx.setClipboardData({
      data: 'virtualman2001',
        success: () => wx.showToast({ title: '微信号已复制', icon: 'success' }),
      });
    });
  },

  goMore() {
    wx.navigateTo({ url: '/pages/more/more' });
  },

  goPrivacy() {
    wx.navigateTo({ url: '/pages/privacy/privacy' });
  },
});
