const api = require('../../utils/api');
const store = require('../../utils/store');
const share = require('../../utils/share');

const BASE = api.BASE;

Page({
  data: {
    sort: 'new',
    follow: false,
    items: [],
    offset: 0,
    loading: false,
    noMore: false,
    loggedIn: false,
    cmts: {},        // shareId -> {open, list}
    commentText: {},
  },

  onShow() {
    this.setData({ loggedIn: store.isLogin() });
    this.load();
  },

  onPullDownRefresh() {
    this.load(() => wx.stopPullDownRefresh());
  },

  onReachBottom() {
    this.loadMore();
  },

  switchTab(e) {
    const ds = e.currentTarget.dataset;
    if (ds.follow) {
      if (!store.isLogin()) { wx.showToast({ title: '登录后才能看关注', icon: 'none' }); return; }
      this.setData({ follow: true, sort: 'new' });
    } else {
      this.setData({ follow: false, sort: ds.sort || 'new' });
    }
    this.load();
  },

  load(done) {
    this.setData({ offset: 0, noMore: false });
    this.fetch(done);
  },

  loadMore() {
    if (this.data.loading || this.data.noMore) return;
    this.fetch();
  },

  fetch(done) {
    if (this.data.loading) { if (done) done(); return; }
    this.setData({ loading: true });
    const q = '?sort=' + encodeURIComponent(this.data.sort) + '&limit=20&offset=' + this.data.offset +
      (this.data.follow ? '&follow=1' : '');
    api.get('/api/shares' + q).then((r) => {
      this.setData({ loading: false });
      const items = (r && r.ok && Array.isArray(r.items)) ? r.items : [];
      // 归一图片为完整 URL
      const me = store.state.user;
      items.forEach((s) => {
        s.mine = !!(me && s.uid === me.id);
        s.pics = (s.images || []).slice(0, 3).map((p) => p.indexOf('http') === 0 ? p : BASE + p);
        s.avatarUrl = s.avatar ? (s.avatar.indexOf('http') === 0 ? s.avatar : BASE + s.avatar) : '';
        s.timeText = timeText(s.createdAt);
      });
      const merged = this.data.offset === 0 ? items : this.data.items.concat(items);
      this.setData({ items: merged, offset: this.data.offset + items.length, noMore: items.length < 20 });
      if (done) done();
    }).catch(() => {
      this.setData({ loading: false });
      if (done) done();
    });
  },

  toggleLike(e) {
    if (!store.isLogin()) { wx.showToast({ title: '请先登录', icon: 'none' }); return; }
    const id = e.currentTarget.dataset.id;
    api.post('/api/shares/' + encodeURIComponent(id) + '/like', {}).then((r) => {
      if (!r || !r.ok) { wx.showToast({ title: (r && r.error) || '操作失败', icon: 'none' }); return; }
      const items = this.data.items.map((s) => {
        if (s.id !== id) return s;
        return Object.assign({}, s, { liked: r.liked, likes: Math.max(0, (Number(s.likes) || 0) + (r.liked ? 1 : -1)) });
      });
      this.setData({ items });
    });
  },

  toggleFollow(e) {
    if (!store.isLogin()) { wx.showToast({ title: '请先登录', icon: 'none' }); return; }
    const uid = e.currentTarget.dataset.uid;
    api.post('/api/follow/' + encodeURIComponent(uid), {}).then((r) => {
      if (!r || !r.ok) { wx.showToast({ title: (r && r.error) || '操作失败', icon: 'none' }); return; }
      wx.showToast({ title: r.following ? '已关注' : '已取消', icon: 'none' });
    });
  },

  toggleComments(e) {
    const id = e.currentTarget.dataset.id;
    const cmts = Object.assign({}, this.data.cmts);
    const cur = cmts[id] || { open: false, list: [] };
    if (cur.open) {
      cur.open = false;
      this.setData({ cmts });
    } else {
      cur.open = true;
      this.setData({ cmts });
      this.loadComments(id);
    }
  },

  loadComments(id) {
    api.get('/api/shares/' + encodeURIComponent(id) + '/comments').then((r) => {
      const cmts = Object.assign({}, this.data.cmts);
      cmts[id] = { open: true, list: (r && r.ok && Array.isArray(r.items)) ? r.items : [] };
      (cmts[id].list || []).forEach((c) => { c.timeText = timeText(c.createdAt); });
      this.setData({ cmts });
    });
  },

  onCommentInput(e) {
    const id = e.currentTarget.dataset.id;
    const text = Object.assign({}, this.data.commentText);
    text[id] = e.detail.value;
    this.setData({ commentText: text });
  },

  sendComment(e) {
    if (!store.isLogin()) { wx.showToast({ title: '请先登录', icon: 'none' }); return; }
    const id = e.currentTarget.dataset.id;
    const text = (this.data.commentText[id] || '').trim();
    if (!text) return;
    api.post('/api/shares/' + encodeURIComponent(id) + '/comments', { text }).then((r) => {
      if (!r || !r.ok) { wx.showToast({ title: (r && r.error) || '评论失败', icon: 'none' }); return; }
      const textMap = Object.assign({}, this.data.commentText); textMap[id] = '';
      this.setData({ commentText: textMap });
      const items = this.data.items.map((s) => {
        if (s.id !== id) return s;
        return Object.assign({}, s, { comments: (Number(s.comments) || 0) + 1 });
      });
      this.setData({ items });
      this.loadComments(id);
    });
  },

  delShare(e) {
    const id = e.currentTarget.dataset.id;
    wx.showModal({
      title: '删除分享', content: '确定删除这条分享？',
      success: (res) => {
        if (!res.confirm) return;
        api.del('/api/shares/' + encodeURIComponent(id)).then((r) => {
          if (!r || !r.ok) { wx.showToast({ title: (r && r.error) || '删除失败', icon: 'none' }); return; }
          this.setData({ items: this.data.items.filter((s) => s.id !== id) });
        });
      },
    });
  },

  goShare() {
    if (!store.isLogin()) { wx.showToast({ title: '请先登录', icon: 'none' }); return; }
    // 到我的藏品长按卡片，在编辑面板里点「分享广场」
    wx.navigateTo({ url: '/pages/holdings/holdings' });
    setTimeout(() => wx.showToast({ title: '长按藏品 → 分享广场', icon: 'none', duration: 2500 }), 500);
  },

  previewImage(e) {
    const urls = e.currentTarget.dataset.urls || [];
    const cur = e.currentTarget.dataset.cur || '';
    wx.previewImage({ urls, current: cur });
  },

  onShareAppMessage() {
    return share.appMessage('plaza');
  },

  onShareTimeline() {
    return share.timeline('plaza');
  },
});

function timeText(iso) {
  if (!iso) return '';
  const t = new Date(iso);
  if (isNaN(t.getTime())) return '';
  const diff = Date.now() - t.getTime();
  if (diff < 60000) return '刚刚';
  if (diff < 3600000) return Math.floor(diff / 60000) + ' 分钟前';
  if (diff < 86400000) return Math.floor(diff / 3600000) + ' 小时前';
  if (diff < 604800000) return Math.floor(diff / 86400000) + ' 天前';
  return (t.getMonth() + 1) + '月' + t.getDate() + '日';
}
