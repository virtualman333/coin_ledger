const api = require('../../utils/api');
const store = require('../../utils/store');
const share = require('../../utils/share');

Page({
  data: { code: '', item: null, loading: true, err: '', owned: false, busy: false, retryable: false },

  onLoad(q) {
    const code = String((q && q.code) || '').toUpperCase();
    this.setData({ code, owned: this.isOwned(code) });
    if (!code) { this.setData({ loading: false, err: '缺少藏品编号', retryable: false }); return; }
    this.load();
  },

  /** 抽成独立方法，失败态可重试而不是把用户困在死页面 */
  load() {
    const code = this.data.code;
    this.setData({ loading: true, err: '', retryable: false });
    api.get('/api/catalog/pm/' + encodeURIComponent(code)).then((res) => {
      if (!res || !res.ok) { this.setData({ loading: false, err: '未找到该品种' }); return; }
      const d = res.item || {};
      // 数据库存的是本地相对地址，小程序补上站点域名
      if (d.thumbUrl && String(d.thumbUrl).indexOf('http') !== 0) d.thumbUrl = api.BASE + d.thumbUrl;
      const join = (v) => Array.isArray(v) ? v.join('、') : (v || '');
      const facts = [
        ['编号', d.code], ['项目', d.projectName], ['年份', d.year],
        ['材质', join(d.material)], ['克重', join(d.weight)], ['规格', d.spec],
        ['面额', d.face != null ? d.face + ' 元' : ''], ['成色', d.fineness ? d.fineness + '%' : ''],
        ['最大发行量', d.circulation ? d.circulation + ' 枚' : ''], ['质量', d.quality],
        ['工艺', join(d.craft)], ['铸造单位', d.castingUnit],
        ['设计', d.designer], ['雕刻', d.sculptor],
        ['题材', join(d.theme)], ['系列', join(d.series)]
      ].filter((x) => x[1]);
      // 克重价（后端按实时金银价 × 成色净重算好）
      let mv = null;
      if (d.metalValue && d.metalValue.value != null) {
        mv = Object.assign({}, d.metalValue, {
          valueText: '≈ ¥' + d.metalValue.value,
          tip: '按今日' + d.metalValue.name + ' ¥' + d.metalValue.cnyPerGram + '/克 × 净重 '
            + d.metalValue.pureGram + ' 克（' + d.metalValue.grossGram + ' 克 × 成色 '
            + d.metalValue.fineness + '%）。仅材料价值，不含铸造成本与纪念溢价，随行情浮动，仅供参考。'
        });
      }
      this.setData({
        item: Object.assign({}, d, { facts, announceText: String(d.announce || '').trim(), metalValue: mv }),
        loading: false,
      });
    }).catch(() => this.setData({ loading: false, err: '详情加载失败，检查网络后重试', retryable: true }));
  },

  /** 从「我的藏品」移出后再返回本页，按钮状态要跟着更新 */
  onShow() {
    if (this.data.code) this.setData({ owned: this.isOwned(this.data.code) });
  },

  retry() {
    if (!this.data.code) return;
    this.load();
  },

  goHome() {
    wx.switchTab({ url: '/pages/index/index' });
  },

  isOwned(code) {
    return (store.state.holdings || []).some((h) => h.category === 'pm' && h.id === code);
  },

  /** 已收藏时点按钮 = 取消收藏（二次确认），否则加入；与普通币详情页 removeCoin 同口径 */
  toggleFav() {
    if (this.data.owned) this.removeFav();
    else this.addFav();
  },

  removeFav() {
    const it = this.data.item;
    if (!it || !this.data.owned || this.data.busy) return;
    const code = this.data.code || it.code;
    wx.showModal({
      title: '移出藏品',
      content: '把「' + (it.name || code) + '」从我的藏品里移出？',
      confirmText: '移出',
      confirmColor: '#c0392b',
      success: (res) => {
        if (!res.confirm) return;
        this.setData({ busy: true });
        wx.showLoading({ title: '处理中', mask: true });
        let task;
        try { task = store.removeHolding(code); }
        catch (e) { wx.hideLoading(); this.setData({ busy: false }); wx.showToast({ title: e.message || '操作失败', icon: 'none' }); return; }
        task.then(() => store.refresh({ force: true })).then(() => {
          wx.hideLoading();
          this.setData({ owned: false, busy: false });
          wx.showToast({ title: '已移出', icon: 'success' });
        }).catch((err) => {
          wx.hideLoading();
          // 以服务端为准重新判定，避免本地显示「已移出」但账本里还在
          this.setData({ owned: this.isOwned(code), busy: false });
          wx.showToast({ title: (err && err.message) || '操作失败', icon: 'none' });
        });
      },
    });
  },

  addFav() {
    const it = this.data.item;
    if (!it || this.data.owned) return;
    // 与普通币详情页 detail.js 的 addCoin 保持同一登录引导口径
    if (!store.isLogin()) {
      wx.showModal({
        title: '还没登录', content: '登录后才能把藏品记进自己的账本',
        confirmText: '去登录',
        success: (r) => { if (r.confirm) wx.navigateTo({ url: '/pages/account/account' }); },
      });
      return;
    }
    if (this.data.busy) return;
    this.setData({ busy: true });
    wx.showLoading({ title: '保存中' });
    let task;
    try { task = store.addPm({ code: it.code, name: it.name, thumb: it.thumbUrl, face: it.face }); }
    catch (e) { wx.hideLoading(); this.setData({ busy: false }); wx.showToast({ title: e.message || '加入失败', icon: 'none' }); return; }
    task.then(() => store.refresh({ force: true })).then(() => {
      wx.hideLoading();
      this.setData({ owned: this.isOwned(it.code), busy: false });
      wx.showToast({ title: '已加入藏品', icon: 'success' });
    }).catch((e) => {
      wx.hideLoading(); this.setData({ busy: false });
      wx.showToast({ title: (e && e.message) || '保存失败', icon: 'none' });
    });
  },

  preview(e) {
    const src = e.currentTarget.dataset.src;
    if (src) wx.previewImage({ urls: [src], current: src });
  },

  onShareAppMessage() {
    return share.pmMessage(this.data.item || { code: this.data.code });
  },

  onShareTimeline() {
    return share.pmTimeline(this.data.item || { code: this.data.code });
  },
});
