const store = require('../../utils/store');

/**
 * 收藏备份：独立的说明 + 操作页。
 *
 * 以前是「我的 → 收藏备份 → 弹 ActionSheet → 再选导出还是导入」，
 * 用户既不知道该选哪个，也不知道备份出来的文件长什么样、能干什么。
 * 现在把说明、导出、导入、注意事项集中在一页，动作也是一次点击直达。
 */
Page({
  data: {
    loggedIn: false,
    count: 0,
    kinds: 0,
    lastBackup: '',
  },

  onShow() {
    const st = (store.getState && store.getState()) || {};
    const hs = st.holdings || [];
    let last = '';
    try { last = wx.getStorageSync('cl_last_backup') || ''; } catch (e) { last = ''; }
    this.setData({
      loggedIn: !!st.user,
      count: hs.length,
      kinds: (store.stats && store.stats().kinds) || hs.length,
      lastBackup: last ? String(last).slice(0, 10) : '',
    });
  },

  /** 所有动作都要登录：未登录时提示并带去登录 */
  needLogin() {
    if (this.data.loggedIn) return false;
    wx.showToast({ title: '登录后才能备份收藏', icon: 'none' });
    setTimeout(() => {
      wx.navigateTo({ url: '/pages/account/account' });
    }, 600);
    return true;
  },

  markBackedUp() {
    const day = new Date().toISOString().slice(0, 10);
    try { wx.setStorageSync('cl_last_backup', day); } catch (e) { /* 存不下不影响导出 */ }
    this.setData({ lastBackup: day });
  },

  /* ---------------- 导出 ---------------- */

  exportData() {
    const data = store.exportCsv();
    if (!data.count) {
      wx.showToast({ title: '账本还是空的', icon: 'none' });
      return null;
    }
    return data;
  },

  /** 存成 .csv 发给微信（文件传输助手 / 任意聊天），电脑上能直接用 Excel 打开 */
  fileExport() {
    if (this.needLogin()) return;
    const data = this.exportData();
    if (!data) return;

    if (!wx.shareFileMessage || !wx.env || !wx.env.USER_DATA_PATH) {
      this.copyExport();
      return;
    }
    const day = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const fileName = '藏币录-收藏-' + day + '.csv';
    const filePath = wx.env.USER_DATA_PATH + '/' + fileName;
    try {
      // BOM 不能省：Excel 双击打开 CSV 时不认 BOM 会把中文按 GBK 解成乱码
      wx.getFileSystemManager().writeFileSync(filePath, '\uFEFF' + data.csv, 'utf8');
    } catch (e) {
      this.copyExport();
      return;
    }
    wx.shareFileMessage({
      filePath: filePath,
      fileName: fileName,
      success: () => this.markBackedUp(),
      fail: (err) => {
        // 用户主动取消不算失败，别再塞一份到剪贴板打扰他
        if (err && /cancel/i.test(err.errMsg || '')) return;
        this.copyExport();
      },
    });
  },

  copyExport() {
    if (this.needLogin()) return;
    const data = this.exportData();
    if (!data) return;
    wx.setClipboardData({
      data: data.csv,
      success: () => {
        this.markBackedUp();
        wx.showToast({ title: '已复制 ' + data.count + ' 条收藏', icon: 'none' });
      },
      fail: () => wx.showToast({ title: '复制失败，请重试', icon: 'none' }),
    });
  },

  /* ---------------- 导入 ---------------- */

  importFromFile() {
    if (this.needLogin()) return;
    if (!wx.chooseMessageFile) {
      wx.showToast({ title: '当前微信版本不支持选文件，改用「粘贴导入」', icon: 'none' });
      return;
    }
    wx.chooseMessageFile({
      count: 1,
      type: 'file',
      extension: ['csv', 'txt', 'json'],
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
    if (this.needLogin()) return;
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
      title: '识别到 ' + parsed.items.length + ' 条收藏',
      content: '与现有收藏重复的会自动跳过，不会覆盖已有的数量与成本。' + tip,
      confirmText: '开始导入',
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
          this.onShow();
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
