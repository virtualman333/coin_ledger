const { dayText } = require('../../utils/datetime');
const api = require('../../utils/api');
const { ensureAdmin } = require('../../utils/admin-guard');

const PAGE_SIZE = 20;

Page({
  data: {
    users: [],
    total: 0,
    page: 1,
    hasMore: false,
    loading: false,
    q: '',
    status: 'all',
    stats: { total: 0, admins: 0, tests: 0, disabled: 0 },
    statusTabs: [
      { v: 'all', t: '全部' },
      { v: 'active', t: '正常' },
      { v: 'test', t: '测试' },
      { v: 'disabled', t: '已禁用' },
    ],
  },

  onLoad() {
    if (!ensureAdmin()) return;
    this.loadUsers(true);
  },

  onPullDownRefresh() {
    Promise.resolve(this.loadUsers(true))
      .then(() => wx.stopPullDownRefresh(), () => wx.stopPullDownRefresh());
  },

  /** 滚到底自动续拉，也可以点底部「加载更多」 */
  onReachBottom() {
    this.loadMore();
  },

  loadMore() {
    if (!this.data.hasMore || this.data.loading) return;
    this.loadUsers(false);
  },

  /**
   * reset=true 从第一页重拉（搜索、筛选、下拉刷新）；
   * 否则按当前页往后追加。
   */
  loadUsers(reset) {
    if (this.data.loading) return Promise.resolve();
    const page = reset ? 1 : this.data.page + 1;
    this.setData({ loading: true });
    const url = '/api/admin/users?page=' + page + '&size=' + PAGE_SIZE
      + '&q=' + encodeURIComponent(this.data.q)
      + '&status=' + this.data.status;
    return api.get(url).then((r) => {
      if (!r || !r.ok) {
        this.setData({ loading: false });
        return;
      }
      const rows = (r.users || []).map((u) => Object.assign({}, u, {
        createdAtText: dayText(u.createdAt),
        displayName: u.nickname || u.name,
        initial: String(u.nickname || u.name || '?').slice(0, 1),
      }));
      const users = reset ? rows : this.data.users.concat(rows);
      this.setData({
        users,
        total: r.total || 0,
        page,
        hasMore: users.length < (r.total || 0),
        stats: r.stats || this.data.stats,
        loading: false,
      });
    }).catch((e) => {
      this.setData({ loading: false });
      wx.showToast({ title: (e && e.message) || '加载失败', icon: 'none' });
    });
  },

  onSearchInput(e) {
    this.setData({ q: e.detail.value });
    if (this._timer) clearTimeout(this._timer);
    this._timer = setTimeout(() => this.loadUsers(true), 400);
  },

  clearSearch() {
    if (this._timer) clearTimeout(this._timer);
    this.setData({ q: '' });
    this.loadUsers(true);
  },

  setStatus(e) {
    const status = e.currentTarget.dataset.v;
    if (!status || status === this.data.status) return;
    this.setData({ status });
    this.loadUsers(true);
  },

  userActions(e) {
    const id = e.currentTarget.dataset.id;
    const u = this.data.users.filter((x) => x.id === id)[0];
    if (!u) return;

    const items = ['查看藏品（' + u.holdings + ' 条）'];
    const actions = [() => this.viewHoldings(u)];
    if (u.role !== 'admin') {
      items.push(u.isTest ? '取消测试标记' : '标记为测试账号');
      actions.push(() => this.toggleTest(u));
    }
    if (u.isTest && u.role !== 'admin') {
      items.push('删除账号');
      actions.push(() => this.deleteUser(u));
    }

    wx.showActionSheet({
      itemList: items,
      success: (r) => {
        const fn = actions[r.tapIndex];
        if (fn) fn();
      },
    });
  },
  toggleTest(u) {
    const next = !u.isTest;
    const tip = next
      ? '标记后该账号可以被删除，确定？'
      : '取消测试标记后，这个账号将无法再被删除，确定？';
    wx.showModal({
      title: next ? '标记为测试账号' : '取消测试标记',
      content: '「' + u.name + '」' + tip,
      success: (r) => {
        if (!r.confirm) return;
        api.patch('/api/admin/users/' + encodeURIComponent(u.id), { isTest: next }).then(() => {
          wx.showToast({ title: next ? '已标记' : '已取消', icon: 'success' });
          this.loadUsers(true);
        }).catch((e) => wx.showToast({ title: e.message || '操作失败', icon: 'none' }));
      },
    });
  },
  viewHoldings(u) {
    wx.navigateTo({
      url: '/pages/admin-user/admin-user?id=' + encodeURIComponent(u.id) + '&name=' + encodeURIComponent(u.name),
    });
  },
  deleteUser(u) {
    if (u.role === 'admin') {
      wx.showToast({ title: '管理员账号不能在这里删除', icon: 'none' });
      return;
    }
    if (!u.isTest) {
      wx.showToast({ title: '只有测试账号可以删除', icon: 'none' });
      return;
    }
    wx.showModal({
      title: '删除账号',
      content: '确定删除「' + u.name + '」？该账号的 ' + u.holdings + ' 条藏品会一起删除，无法恢复。',
      confirmText: '删除',
      confirmColor: '#c0392b',
      success: (r) => {
        if (!r.confirm) return;
        api.del('/api/admin/users/' + encodeURIComponent(u.id)).then(() => {
          wx.showToast({ title: '已删除', icon: 'success' });
          this.loadUsers(true);
        }).catch((err) => wx.showToast({ title: err.message || '删除失败', icon: 'none' }));
      },
    });
  },
});
