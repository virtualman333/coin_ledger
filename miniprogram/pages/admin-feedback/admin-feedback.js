const { dayText } = require('../../utils/datetime');
const api = require('../../utils/api');
const { ensureAdmin } = require('../../utils/admin-guard');

Page({
  data: {
    feedbacks: [], fbStatus: 'open', fbReply: '', fbDetail: null, saving: false,
  },

  onLoad() {
    if (!ensureAdmin()) return;
    this.loadFeedback();
  },

  onPullDownRefresh() {
    Promise.resolve(this.loadFeedback())
      .then(() => wx.stopPullDownRefresh(), () => wx.stopPullDownRefresh());
  },

  setFbStatus(e) {
    this.setData({ fbStatus: e.currentTarget.dataset.s });
    this.loadFeedback();
  },
  loadFeedback() {
    return api.get('/api/admin/feedback?status=' + this.data.fbStatus).then((res) => {
      const feedbacks = (res.items || []).map((it) => Object.assign({}, it, {
        createdAtText: dayText(it.createdAt),
      }));
      this.setData({ feedbacks, openCount: res.open || 0 });
    }).catch((e) => wx.showToast({ title: e.message || '加载失败', icon: 'none' }));
  },
  fbActions(e) {
    const id = e.currentTarget.dataset.id;
    const it = this.data.feedbacks.filter((x) => x.id === id)[0];
    if (!it) return;
    const images = (it.images || []).map((f) => (String(f).indexOf('http') === 0 ? f : api.BASE + '/feedback/' + f));
    this.setData({ fbDetail: Object.assign({}, it, { images: images }), fbReply: it.reply || '' });
  },
  closeFb() {
    this.setData({ fbDetail: null });
  },
  previewFbImage(e) {
    const src = e.currentTarget.dataset.src;
    wx.previewImage({ urls: this.data.fbDetail.images, current: src });
  },
  onFbReplyInput(e) {
    this.setData({ fbReply: e.detail.value });
  },
  saveFbReply() {
    const it = this.data.fbDetail;
    if (!it) return;
    const reply = String(this.data.fbReply || '').trim();
    if (!reply) { wx.showToast({ title: '先写点回复内容', icon: 'none' }); return; }
    wx.showLoading({ title: '保存中' });
    api.patch('/api/admin/feedback/' + it.id, { reply, status: 'done' }).then(() => {
      wx.hideLoading();
      wx.showToast({ title: '已回复', icon: 'success' });
      this.setData({ fbDetail: null, fbReply: '' });
      this.loadFeedback();
    }).catch((e) => {
      wx.hideLoading();
      wx.showToast({ title: e.message || '保存失败', icon: 'none' });
    });
  },
  toggleFb() {
    const it = this.data.fbDetail;
    if (!it) return;
    const next = it.status === 'open' ? 'done' : 'open';
    api.patch('/api/admin/feedback/' + it.id, { status: next }).then(() => {
      wx.showToast({ title: '已更新', icon: 'success' });
      this.setData({ fbDetail: null });
      this.loadFeedback();
    }).catch((e) => wx.showToast({ title: e.message || '操作失败', icon: 'none' }));
  },
  deleteFb() {
    const it = this.data.fbDetail;
    if (!it) return;
    wx.showModal({
      title: '删除反馈',
      content: '删除后无法恢复，确定？',
      confirmText: '删除',
      confirmColor: '#c0392b',
      success: (r) => {
        if (!r.confirm) return;
        api.del('/api/admin/feedback/' + it.id).then(() => {
          wx.showToast({ title: '已删除', icon: 'success' });
          this.setData({ fbDetail: null });
          this.loadFeedback();
        }).catch((e) => wx.showToast({ title: e.message || '删除失败', icon: 'none' }));
      },
    });
  },
  noop() {},
});
