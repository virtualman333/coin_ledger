const api = require('../../utils/api');
const store = require('../../utils/store');

Page({
  data: {
    nick: '',
    showAvatar: '',      // 当前展示的头像（已存的绝对地址，或本次新选的临时路径）
    avatarTemp: '',      // 本次新选的头像；为空表示没换
    loginName: '',
    joinedText: '',
    isTest: false,
    saving: false,
    dirty: false,
  },

  onLoad() {
    const state = store.getState ? store.getState() : {};
    const u = state && state.user;
    if (!u) {
      wx.showToast({ title: '请先登录', icon: 'none' });
      setTimeout(() => wx.navigateBack(), 600);
      return;
    }
    const avatar = u.avatar
      ? (String(u.avatar).indexOf('http') === 0 ? u.avatar : api.BASE + u.avatar)
      : '';
    this.setData({
      nick: u.nickname || '',
      showAvatar: avatar,
      loginName: u.name || '',
      joinedText: u.createdAt ? String(u.createdAt).slice(0, 10).replace(/-/g, '/') : '',
      isTest: !!u.isTest,
    });
  },

  goAccount() {
    wx.navigateTo({ url: '/pages/account/account' });
  },

  onChooseAvatar(e) {
    const url = e.detail && e.detail.avatarUrl;
    if (!url) return;
    this.setData({ avatarTemp: url, showAvatar: url, dirty: true });
  },

  onNick(e) {
    const v = (e.detail && e.detail.value) || '';
    this.setData({ nick: v, dirty: true });
  },

  save() {
    if (this.data.saving) return;
    const nick = String(this.data.nick || '').trim();
    if (nick && nick.length < 2) {
      wx.showToast({ title: '昵称至少 2 个字', icon: 'none' });
      return;
    }
    if (!this.data.dirty) return;

    const send = (avatarData) => {
      const payload = { nickname: nick };
      // 注意：接口里 avatar === '' 表示「清除头像」，没换头像时绝对不能带这个字段
      if (avatarData) payload.avatar = avatarData;
      this.setData({ saving: true });
      api.post('/api/me/profile', payload)
        .then(() => store.refresh({ force: true }))
        .then(() => {
          this.setData({ saving: false, dirty: false, avatarTemp: '' });
          wx.showToast({ title: '已保存', icon: 'success' });
          setTimeout(() => wx.navigateBack(), 600);
        })
        .catch((err) => {
          this.setData({ saving: false });
          wx.showToast({ title: err.message || '保存失败', icon: 'none' });
        });
    };

    const temp = this.data.avatarTemp;
    if (temp && temp.indexOf('data:') !== 0) {
      wx.getFileSystemManager().readFile({
        filePath: temp,
        encoding: 'base64',
        success: (fr) => send('data:image/jpeg;base64,' + fr.data),
        fail: () => send(''),
      });
    } else {
      send(temp || '');
    }
  },
});
