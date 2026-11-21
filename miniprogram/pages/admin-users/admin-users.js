const { dayText } = require('../../utils/datetime');
const api = require('../../utils/api');
const { ensureAdmin } = require('../../utils/admin-guard');

Page({
  data: {
    users: [],
  },

  onLoad() {
    if (!ensureAdmin()) return;
    this.loadUsers();
  },

  onPullDownRefresh() {
    Promise.resolve(this.loadUsers())
      .then(() => wx.stopPullDownRefresh(), () => wx.stopPullDownRefresh());
  },

  loadUsers() {
    return api.get('/api/admin/users').then((res) => {
      const users = (res.users || []).map((u) => Object.assign({}, u, {
        createdAtText: dayText(u.createdAt),
      }));
      const total = (res.stats && res.stats.total) || users.length;
      this.setData({ users, userCount: total });
    }).catch((e) => wx.showToast({ title: e.message || '加载失败', icon: 'none' }));
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
          this.loadUsers();
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
          this.loadUsers();
        }).catch((err) => wx.showToast({ title: err.message || '删除失败', icon: 'none' }));
      },
    });
  },
});
