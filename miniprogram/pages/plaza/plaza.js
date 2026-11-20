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
    loadError: '',
  },

  onShow() {
    const was = this.data.loggedIn;
    const now = store.isLogin();
    this.setData({ loggedIn: now });
    // 从图片预览/详情页返回时不要无条件重拉第一页，否则用户已上拉加载的内容被丢弃、列表跳回顶部
    if (was !== now || !this.data.items.length) this.load();
  },

  onPullDownRefresh() {
    this.load(() => wx.stopPullDownRefresh());
  },

  onReachBottom() {
    this.loadMore();
  },

  /** 统一的登录引导：toast 一闪而过不解决问题，给出可点的下一步 */
  goLogin() {
    wx.showModal({
      title: '还没登录', content: '登录后才能参与广场互动',
      confirmText: '去登录',
      success: (r) => { if (r.confirm) wx.navigateTo({ url: '/pages/account/account' }); },
    });
  },

  switchTab(e) {
    const ds = e.currentTarget.dataset;
    if (ds.follow) {
      if (!store.isLogin()) { this.goLogin(); return; }
      this.setData({ follow: true, sort: 'new' });
    } else {
      this.setData({ follow: false, sort: ds.sort || 'new' });
    }
    this.load();
  },

  load(done) {
    // 作废旧请求，让切 tab / 下拉刷新立刻生效，而不是被 in-flight 的 loading 吞掉
    this._seq = (this._seq || 0) + 1;
    this.setData({ offset: 0, noMore: false, loading: false, loadError: '' });
    this.fetch(done);
  },

  loadMore() {
    if (this.data.loading || this.data.noMore) return;
    this.fetch();
  },

  retry() {
    this.load();
  },

  fetch(done) {
    const seq = this._seq = (this._seq || 0) + 1;
    const startOffset = this.data.offset;
    this.setData({ loading: true });
    const q = '?sort=' + encodeURIComponent(this.data.sort) + '&limit=20&offset=' + startOffset +
      (this.data.follow ? '&follow=1' : '');
    api.get('/api/shares' + q).then((r) => {
      if (seq !== this._seq) { if (done) done(); return; }   // 过期响应直接丢弃
      this.setData({ loading: false });
      const items = (r && r.ok && Array.isArray(r.items)) ? r.items : [];
      const me = store.state.user;
      items.forEach((s) => {
        s.mine = !!(me && s.uid === me.id);
        s.authorInitial = String(s.author || '藏').charAt(0);   // WXML 不支持 (expr)[0]，预算好
        s.pics = (s.images || []).slice(0, 3).map((p) => p.indexOf('http') === 0 ? p : BASE + p);
        s.picsMore = s.pics.length > 1 ? ('+' + (s.pics.length - 1)) : '';
        s.avatarUrl = s.avatar ? (s.avatar.indexOf('http') === 0 ? s.avatar : BASE + s.avatar) : '';
        s.timeText = timeText(s.createdAt);
      });
      const merged = startOffset === 0 ? items : this.data.items.concat(items);
      this.setData({ items: merged, offset: startOffset + items.length, noMore: items.length < 20 });
      this.setData({ loadError: '' });
      if (done) done();
    }).catch(() => {
      if (seq !== this._seq) { if (done) done(); return; }
      this.setData({ loading: false });
      // 网络失败不能显示「广场还空着」，必须有明确的错误态和重试
      if (startOffset === 0 && !this.data.items.length) this.setData({ loadError: '加载失败，点此重试' });
      else wx.showToast({ title: '加载失败，请重试', icon: 'none' });
      if (done) done();
    });
  },

  /** 写操作统一失败提示，避免断网时点了没反应 */
  fail(e) {
    wx.showToast({ title: (e && e.message) || '网络异常，请重试', icon: 'none' });
  },

  toggleLike(e) {
    if (!store.isLogin()) { this.goLogin(); return; }
    const id = e.currentTarget.dataset.id;
    if (this._liking && this._liking[id]) return;           // 防连点导致点赞/取消来回跳
    this._liking = this._liking || {};
    this._liking[id] = true;
    api.post('/api/shares/' + encodeURIComponent(id) + '/like', {}).then((r) => {
      this._liking[id] = false;
      if (!r || !r.ok) { wx.showToast({ title: (r && r.error) || '操作失败', icon: 'none' }); return; }
      const items = this.data.items.map((s) => {
        if (s.id !== id) return s;
        return Object.assign({}, s, { liked: r.liked, likes: Math.max(0, (Number(s.likes) || 0) + (r.liked ? 1 : -1)) });
      });
      this.setData({ items });
    }).catch((err) => { this._liking[id] = false; this.fail(err); });
  },

  toggleFollow(e) {
    if (!store.isLogin()) { this.goLogin(); return; }
    const uid = e.currentTarget.dataset.uid;
    api.post('/api/follow/' + encodeURIComponent(uid), {}).then((r) => {
      if (!r || !r.ok) { wx.showToast({ title: (r && r.error) || '操作失败', icon: 'none' }); return; }
      // 回写状态：以前按钮恒为「+ 关注」，再点一次会误取消关注
      const items = this.data.items.map((s) => {
        if (s.uid !== uid) return s;
        return Object.assign({}, s, { following: !!r.following });
      });
      this.setData({ items });
      wx.showToast({ title: r.following ? '已关注' : '已取消', icon: 'none' });
    }).catch((err) => this.fail(err));
  },

  toggleComments(e) {
    const id = e.currentTarget.dataset.id;
    const cmts = Object.assign({}, this.data.cmts);
    // 修复：无论首次还是再次点击，都必须把状态写回 cmts[id]，否则首次展开后状态丢失
    const cur = Object.assign({ open: false, list: [] }, cmts[id] || {});
    cur.open = !cur.open;
    cmts[id] = cur;
    this.setData({ cmts });
    if (cur.open && !(cur.list || []).length) this.loadComments(id);
  },

  loadComments(id) {
    const me = store.state.user;
    return api.get('/api/shares/' + encodeURIComponent(id) + '/comments').then((r) => {
      const cmts = Object.assign({}, this.data.cmts);
      // 保留用户当前的展开状态：发完评论立刻收起时，回包不该强制重新展开
      const cur = Object.assign({ open: false, list: [] }, cmts[id] || {});
      cur.list = (r && r.ok && Array.isArray(r.items)) ? r.items : [];
      cur.list.forEach((c) => {
        c.timeText = timeText(c.createdAt);
        // 后端已返回 mine；前端再按 uid 兜底，避免接口未带该字段时删不掉自己的评论
        c.mine = c.mine === true || !!(me && c.uid === me.id);
      });
      cmts[id] = cur;
      this.setData({ cmts });
    }).catch(() => {
      const cmts = Object.assign({}, this.data.cmts);
      const cur = Object.assign({ open: false, list: [] }, cmts[id] || {});
      cur.list = [];
      cmts[id] = cur;
      this.setData({ cmts });
      wx.showToast({ title: '评论加载失败', icon: 'none' });
    });
  },

  /** 删除自己的评论（后端按 uid 校验，前端只显示自己的删除入口） */
  delComment(e) {
    const ds = e.currentTarget.dataset;
    const id = ds.id;
    const cid = ds.cid;
    if (!id || !cid) return;
    wx.showModal({
      title: '删除评论', content: '确定删除这条评论？',
      success: (res) => {
        if (!res.confirm) return;
        api.del('/api/shares/' + encodeURIComponent(id) + '/comments/' + encodeURIComponent(cid)).then((r) => {
          if (!r || !r.ok) { wx.showToast({ title: (r && r.error) || '删除失败', icon: 'none' }); return; }
          const cmts = Object.assign({}, this.data.cmts);
          const cur = Object.assign({ open: true, list: [] }, cmts[id] || {});
          cur.list = (cur.list || []).filter((c) => c.id !== cid);
          cmts[id] = cur;
          const items = this.data.items.map((s) => {
            if (s.id !== id) return s;
            return Object.assign({}, s, { comments: Math.max(0, (Number(s.comments) || 0) - 1) });
          });
          this.setData({ cmts, items });
          wx.showToast({ title: '已删除', icon: 'success' });
        }).catch((err) => wx.showToast({ title: (err && err.message) || '删除失败', icon: 'none' }));
      },
    });
  },

  onCommentInput(e) {
    const id = e.currentTarget.dataset.id;
    const text = Object.assign({}, this.data.commentText);
    text[id] = e.detail.value;
    this.setData({ commentText: text });
  },

  sendComment(e) {
    if (!store.isLogin()) { this.goLogin(); return; }
    const id = e.currentTarget.dataset.id;
    const text = (this.data.commentText[id] || '').trim();
    if (!text) return;
    // 键盘 bindconfirm 与点「发送」可能同时触发，且连点会发多条
    this._sending = this._sending || {};
    if (this._sending[id]) return;
    this._sending[id] = true;
    api.post('/api/shares/' + encodeURIComponent(id) + '/comments', { text }).then((r) => {
      this._sending[id] = false;
      if (!r || !r.ok) { wx.showToast({ title: (r && r.error) || '评论失败', icon: 'none' }); return; }
      const textMap = Object.assign({}, this.data.commentText); textMap[id] = '';
      this.setData({ commentText: textMap });
      const items = this.data.items.map((s) => {
        if (s.id !== id) return s;
        return Object.assign({}, s, { comments: (Number(s.comments) || 0) + 1 });
      });
      this.setData({ items });
      this.loadComments(id);
    }).catch((err) => { this._sending[id] = false; this.fail(err); });
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
        }).catch((err) => this.fail(err));
      },
    });
  },

  goShare() {
    if (!store.isLogin()) { this.goLogin(); return; }
    // 到我的藏品页：点「多选分享」进入勾选模式，可一次分享多件
    wx.navigateTo({ url: '/pages/holdings/holdings' });
    setTimeout(() => wx.showToast({ title: '点「多选分享」勾选藏品', icon: 'none', duration: 2500 }), 500);
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
