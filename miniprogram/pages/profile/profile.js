const api = require('../../utils/api');
const store = require('../../utils/store');

Page({
  data: {
    nick: '',
    showAvatar: '',      // 当前展示的头像（已存的绝对地址，或本次新选的临时路径）
    avatarTemp: '',      // 本次新选的头像；为空表示没换
    name: '',            // 用户名（登录名）
    origName: '',        // 进来时的用户名，用来判断有没有改
    nameLocked: false,   // 已经用过改名机会：只读
    hasPassword: false,
    loginName: '',
    joinedText: '',
    isTest: false,
    saving: false,
    dirty: false,
    // 改密码面板
    pwdOpen: false,
    oldPwd: '',
    newPwd: '',
    newPwd2: '',
    pwdBusy: false,
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
      name: u.name || '',
      origName: u.name || '',
      nameLocked: !!u.nameChanged,   // 服务端标记：改过一次就锁死
      hasPassword: !!u.hasPassword,
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

  onName(e) {
    const name = String(e.detail.value || '').trim();
    this.setData({ name, dirty: name !== this.data.origName || this.data.dirty });
  },

  /* ---------------- 密码 ---------------- */
  openPwd() {
    this.setData({ pwdOpen: true, oldPwd: '', newPwd: '', newPwd2: '' });
  },

  closePwd() {
    if (this.data.pwdBusy) return;
    this.setData({ pwdOpen: false });
  },

  onOldPwd(e) { this.setData({ oldPwd: e.detail.value }); },
  onNewPwd(e) { this.setData({ newPwd: e.detail.value }); },
  onNewPwd2(e) { this.setData({ newPwd2: e.detail.value }); },
  noop() {},

  submitPwd() {
    if (this.data.pwdBusy) return;
    const { hasPassword, oldPwd, newPwd, newPwd2 } = this.data;

    if (hasPassword && !oldPwd) {
      wx.showToast({ title: '请输入原密码', icon: 'none' });
      return;
    }
    if (String(newPwd).length < 8) {
      wx.showToast({ title: '新密码至少 8 位', icon: 'none' });
      return;
    }
    if (/^\d+$/.test(String(newPwd))) {
      wx.showToast({ title: '新密码不能是纯数字', icon: 'none' });
      return;
    }
    if (newPwd !== newPwd2) {
      wx.showToast({ title: '两次输入不一致', icon: 'none' });
      return;
    }

    this.setData({ pwdBusy: true });
    api.post('/api/auth/password', { oldPassword: oldPwd, newPassword: newPwd })
      .then(() => {
        this.setData({ pwdBusy: false, pwdOpen: false, oldPwd: '', newPwd: '', newPwd2: '', hasPassword: true });
        wx.showToast({ title: '密码已保存', icon: 'success' });
      })
      .catch((err) => {
        this.setData({ pwdBusy: false });
        wx.showToast({ title: err.message || '修改失败', icon: 'none' });
      });
  },

  save() {
    if (this.data.saving) return;
    const nick = String(this.data.nick || '').trim();
    if (nick && nick.length < 2) {
      wx.showToast({ title: '昵称至少 2 个字', icon: 'none' });
      return;
    }
    if (!this.data.dirty) return;

    // 用户名要先落库：它是登录名，改失败就别把昵称头像存一半。
    // 成功后递归回 save()，此时 nameLocked 已为 true，不会再进这个分支。
    const name = String(this.data.name || '').trim();
    if (!this.data.nameLocked && name && name !== this.data.origName) {
      this.setData({ saving: true });
      api.post('/api/user/name', { name })
        .then((res) => {
          const fresh = (res && res.user) || {};
          this.setData({
            nameLocked: true,
            origName: fresh.name || name,
            name: fresh.name || name,
            saving: false,
          });
          return store.refresh({ force: true });
        })
        .then(() => this.save())
        .catch((err) => {
          this.setData({ saving: false });
          wx.showToast({ title: err.message || '用户名修改失败', icon: 'none' });
        });
      return;
    }

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
