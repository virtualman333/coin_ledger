const cat = require('../../utils/catalog');
const store = require('../../utils/store');
const share = require('../../utils/share');
const feature = require('../../utils/feature');

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

  goAdmin() {
    wx.navigateTo({ url: '/pages/admin/admin' });
  },

  onShow() {
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

  goPlaza() {
    wx.navigateTo({ url: '/pages/plaza/plaza' });
  },

  /* ---------------- 收藏备份：导出 / 导入 ---------------- */

  onBackup() {
    if (!store.isLogin()) {
      wx.showToast({ title: '登录后才能备份收藏', icon: 'none' });
      return;
    }
    wx.showActionSheet({
      itemList: ['导出收藏', '导入收藏'],
      success: (r) => {
        if (r.tapIndex === 0) this.exportHoldings();
        else this.importHoldings();
      },
      fail: () => {},
    });
  },

  exportHoldings() {
    const data = store.exportHoldings();
    if (!data.count) {
      wx.showToast({ title: '账本还是空的', icon: 'none' });
      return;
    }
    wx.showActionSheet({
      itemList: ['复制到剪贴板', '存成文件发到微信'],
      success: (r) => {
        if (r.tapIndex === 0) this.copyExport(data);
        else this.fileExport(data);
      },
      fail: () => {},
    });
  },

  copyExport(data) {
    wx.setClipboardData({
      data: JSON.stringify(data),
      success: () => wx.showToast({ title: '已复制 ' + data.count + ' 条收藏', icon: 'none' }),
      fail: () => wx.showToast({ title: '复制失败，请重试', icon: 'none' }),
    });
  },

  /** 写进用户目录再用「发送给聊天」导出成 .json；不支持就退回剪贴板 */
  fileExport(data) {
    if (!wx.shareFileMessage || !wx.env || !wx.env.USER_DATA_PATH) {
      this.copyExport(data);
      return;
    }
    const day = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const fileName = '藏币录-收藏-' + day + '.json';
    const filePath = wx.env.USER_DATA_PATH + '/' + fileName;
    try {
      wx.getFileSystemManager().writeFileSync(filePath, JSON.stringify(data), 'utf8');
    } catch (e) {
      this.copyExport(data);
      return;
    }
    wx.shareFileMessage({
      filePath: filePath,
      fileName: fileName,
      fail: (err) => {
        // 用户主动取消不算失败，别再塞一份到剪贴板打扰他
        if (err && /cancel/i.test(err.errMsg || '')) return;
        this.copyExport(data);
      },
    });
  },

  importHoldings() {
    wx.showActionSheet({
      itemList: ['从聊天记录选文件', '从剪贴板粘贴'],
      success: (r) => {
        if (r.tapIndex === 0) this.importFromFile();
        else this.importFromClipboard();
      },
      fail: () => {},
    });
  },

  importFromFile() {
    if (!wx.chooseMessageFile) {
      wx.showToast({ title: '当前微信版本不支持选文件，改用剪贴板', icon: 'none' });
      return;
    }
    wx.chooseMessageFile({
      count: 1,
      type: 'file',
      extension: ['json', 'txt'],
      success: (res) => {
        const f = res.tempFiles && res.tempFiles[0];
        if (!f || !f.path) return;
        wx.getFileSystemManager().readFile({
          filePath: f.path,
          encoding: 'utf8',
          success: (r) => this.applyImport(r.data),
          fail: () => wx.showModal({ title: '读取失败', content: '这个文件不是 UTF-8 文本，换个文件试试。', showCancel: false }),
        });
      },
      fail: () => {},
    });
  },

  importFromClipboard() {
    wx.getClipboardData({
      success: (res) => this.applyImport(res.data),
      fail: () => wx.showToast({ title: '读不到剪贴板内容', icon: 'none' }),
    });
  },

  applyImport(raw) {
    const parsed = store.parseImport(raw);
    if (!parsed.ok) {
      wx.showModal({ title: '导入失败', content: parsed.error, showCancel: false });
      return;
    }
    const tip = parsed.dropped ? '（另有 ' + parsed.dropped + ' 条无法识别，已忽略）' : '';
    wx.showModal({
      title: '导入 ' + parsed.items.length + ' 条收藏',
      content: '与现有收藏重复的会自动跳过，不会覆盖已有的数量与成本。' + tip,
      confirmText: '导入',
      success: (r) => {
        if (!r.confirm) return;
        wx.showLoading({ title: '导入中', mask: true });
        store.importHoldings(parsed.items, 'merge').then((res) => {
          wx.hideLoading();
          wx.showModal({
            title: '导入完成',
            content: '新增 ' + res.added + ' 条'
              + (res.skipped ? '，跳过 ' + res.skipped + ' 条已存在' : '')
              + '，当前共 ' + res.total + ' 条。',
            showCancel: false,
          });
          this.render();
        }).catch((err) => {
          wx.hideLoading();
          wx.showModal({
            title: '导入失败',
            content: (err && err.message) || '请稍后重试',
            showCancel: false,
          });
        });
      },
    });
  },

  goCount() {
    wx.navigateTo({ url: '/pages/count/count' });
  },

  goMyFeedback() {
    wx.navigateTo({ url: '/pages/myfeedback/myfeedback' });
  },

  goAbout() {
    wx.navigateTo({ url: '/pages/about/about' });
  },

  goAccount() {
    wx.navigateTo({ url: '/pages/account/account' });
  },

  goList() {
    wx.switchTab({ url: '/pages/list/list' });
  },

  copyContact() {
    wx.setClipboardData({
      data: 'virtualman2001',
      success: () => wx.showToast({ title: '微信号已复制', icon: 'success' }),
    });
  },

  onShareAppMessage() {
    return share.appMessage('mine');
  },

  onShareTimeline() {
    return share.timeline('mine');
  },
});
