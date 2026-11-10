const api = require('../../utils/api');
const store = require('../../utils/store');

Page({
  data: {
    text: '',
    busy: false,
    sentCount: 0,
    leftToday: 3,
    features: [
      { k: 'remind', ico: '⏰', name: '发行预约提醒', desc: '预约当天 09:00 微信通知你，不用自己盯日子', on: true },
      { k: 'series', ico: '🗂', name: '按系列浏览', desc: '一个品种可以属于多个系列，比如生肖钞也在纪念钞里', on: true },
      { k: 'ledger', ico: '📒', name: '收藏账本', desc: '按套记数量与成本，自动算市值和盈亏', on: true },
      { k: 'plan', ico: '📅', name: '发行计划', desc: '央行年度计划 + 预约期、兑换期，按发行日倒序', on: true },
      { k: 'photo', ico: '📷', name: '自己拍的照片', desc: '给每枚币存一张你自己的实物照', on: false },
    ],
  },

  onLoad() {
    const user = store.getState().user;
    // 测试账号不开放这个入口
    if (!user || user.isTest) {
      wx.showToast({ title: '这个入口暂不开放', icon: 'none' });
      setTimeout(() => wx.navigateBack(), 600);
    }
  },

  onInput(e) {
    this.setData({ text: e.detail.value });
  },

  submit() {
    if (this.data.busy) return;
    const text = String(this.data.text || '').trim();
    if (text.length < 4) {
      wx.showToast({ title: '多写几个字', icon: 'none' });
      return;
    }
    this.setData({ busy: true });
    api.post('/api/feature-request', { text }).then(() => {
      this.setData({ busy: false, text: '', sentCount: this.data.sentCount + 1 });
      wx.showModal({
        title: '收到了',
        content: '谢谢，这条会进需求池。如果做出来，会在「关于」里说明。',
        showCancel: false,
        confirmText: '好',
      });
    }).catch((err) => {
      this.setData({ busy: false });
      wx.showToast({ title: err.message || '提交失败', icon: 'none' });
    });
  },
});
