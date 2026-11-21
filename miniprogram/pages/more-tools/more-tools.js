const store = require('../../utils/store');
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
    isAdmin: false,
    loggedIn: false,
    plazaOn: feature.plaza,
    appVersion: '',
  },

  onLoad() {
    const state = store.getState ? store.getState() : {};
    this.setData({
      isAdmin: !!state.isAdmin,
      loggedIn: !!(state && state.user),
      appVersion: appVersion(),
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
          fail: () => wx.showModal({
            title: '读取失败',
            content: '这个文件不是 UTF-8 文本，换个文件试试。',
            showCancel: false,
          }),
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
});
