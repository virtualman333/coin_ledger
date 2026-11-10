const api = require('../../utils/api');
const store = require('../../utils/store');
const cat = require('../../utils/catalog');
const policy = require('../../utils/policy');

Page({
  data: {
    loggedIn: false,
    user: null,
    avatarText: '',
    isAdmin: false,
    mode: 'login',
    name: '',
    password: '',
    busy: false,
    wxBusy: false,
    agree: false,                 // 是否已勾选同意隐私政策
    profileSheet: false,          // 微信登录后的「完善资料」面板
    profileNick: '',
    profileAvatar: '',
    profileSaving: false,
    pwdVisible: false,
    pwd2Visible: false,
    password2: '',
    avatarUrl: '',
    displayName: '',
    showPolicy: false,
    policy,
    holdingsCount: 0,
    userCount: 0,
    totalCoins: 0,
    seriesCount: 0,
  },

  onLoad() {
    // 记住上次的同意状态，避免每次登录都重新勾选
    try {
      if (wx.getStorageSync('cl_privacy_agreed')) this.setData({ agree: true });
    } catch (e) { /* 读不到就当未同意 */ }
  },

  onShow() {
    this.render();
    store.refresh().then(() => this.render()).catch(() => {});
  },

  render() {
    const state = store.getState();
    this.setData({
      loggedIn: !!state.user,
      user: state.user,
      avatarText: state.user ? String(state.user.nickname || state.user.name).slice(0, 1) : '',
      displayName: state.user ? (state.user.nickname || state.user.name) : '',
      avatarUrl: state.user && state.user.avatar ? api.BASE + state.user.avatar : '',
      isAdmin: !!state.isAdmin,
      holdingsCount: state.holdings.length,
      userCount: state.userCount,
      totalCoins: cat.total,
      seriesCount: cat.seriesList.length,
    });
  },

  switchMode(e) {
    this.setData({
      mode: e.currentTarget.dataset.mode,
      password: '',
      password2: '',
      pwdVisible: false,
      pwd2Visible: false,
    });
  },

  onName(e) {
    this.setData({ name: e.detail.value });
  },

  onPassword(e) {
    this.setData({ password: e.detail.value });
  },

  onPassword2(e) {
    this.setData({ password2: e.detail.value });
  },

  togglePwd() {
    this.setData({ pwdVisible: !this.data.pwdVisible });
  },

  togglePwd2() {
    this.setData({ pwd2Visible: !this.data.pwd2Visible });
  },

  submit() {
    if (!this.requireAgree()) return;
    if (this.data.busy) return;
    const name = String(this.data.name || '').trim();
    const password = String(this.data.password || '');
    if (!name) {
      wx.showToast({ title: '请填用户名', icon: 'none' });
      return;
    }
    if (!password) {
      wx.showToast({ title: '请填密码', icon: 'none' });
      return;
    }
    if (this.data.mode === 'register' && password !== String(this.data.password2 || '')) {
      wx.showToast({ title: '两次输入的密码不一致', icon: 'none' });
      return;
    }
    const path = this.data.mode === 'login' ? '/api/auth/login' : '/api/auth/register';
    this.setData({ busy: true });
    wx.showLoading({ title: this.data.mode === 'login' ? '登录中' : '注册中', mask: true });
    api.post(path, { name, password }).then((res) => {
      api.setToken(res.token || '');
      this.setData({ password: '', password2: '' });
      return store.refresh();
    }).then(() => {
      wx.hideLoading();
      this.setData({ busy: false });
      this.render();
      wx.showToast({ title: this.data.mode === 'login' ? '登录成功' : '注册成功', icon: 'success' });
      setTimeout(() => this.leave(), 600);
    }).catch((err) => {
      wx.hideLoading();
      this.setData({ busy: false });
      wx.showModal({
        title: this.data.mode === 'login' ? '登录失败' : '注册失败',
        content: err.message || '请稍后重试',
        showCancel: false,
      });
    });
  },

  toggleAgree() {
    const next = !this.data.agree;
    this.setData({ agree: next });
    try { wx.setStorageSync('cl_privacy_agreed', next); } catch (e) { /* ignore */ }
  },

  goPrivacy() {
    wx.navigateTo({ url: '/pages/privacy/privacy' });
  },

  /** 未同意隐私政策时拦一下：不收集任何信息，直到用户主动点同意 */
  requireAgree() {
    if (this.data.agree) return true;
    this.setData({ showPolicy: true });     // 直接把协议摊开给用户看
    return false;
  },

  closePolicy() {
    this.setData({ showPolicy: false });
  },

  /** 弹出层里点「同意并继续」：勾上同意，关掉弹层，用户再点登录即可 */
  agreeFromPolicy() {
    this.setData({ agree: true, showPolicy: false });
    try { wx.setStorageSync('cl_privacy_agreed', true); } catch (e) { /* ignore */ }
    wx.showToast({ title: '已同意，可以登录了', icon: 'none' });
  },

  noop() {},

  /** 微信一键登录：拿 code 换 openid，服务端自动建号或找回已有账号 */
  /** 拿一个全新的微信登录 code（code 只能用一次、5 分钟过期） */
  loginCode() {
    return new Promise((resolve, reject) => {
      wx.login({
        success: (r) => (r && r.code ? resolve(r.code) : reject(new Error('没拿到微信授权'))),
        fail: () => reject(new Error('微信未授权')),
      });
    });
  },

  /**
   * 用 code 换登录态；code 失效（40029 过期 / 40163 已用过）时自动换新 code 重试一次。
   * 这两种错误在真机上最常见：用户停在这一页久了、或点了两次。
   */
  requestWxLogin(code) {
    return api.post('/api/auth/wx/login', { code }).catch((err) => {
      const wxCode = err && err.body && err.body.wxCode;
      if (wxCode === 40029 || wxCode === 40163) {
        return this.loginCode().then((fresh) => api.post('/api/auth/wx/login', { code: fresh }));
      }
      throw err;
    });
  },

  wxLogin() {
    if (!this.requireAgree()) return;
    if (this.data.wxBusy) return;
    this.setData({ wxBusy: true });
    this.loginCode()
      .then((code) => this.requestWxLogin(code))
      .then((res) => {
        api.setToken(res.token || '');
        return store.refresh().then(() => res);
      })
      .then((res) => {
        this.setData({ wxBusy: false });
        this.render();
        wx.showToast({ title: res.isNew ? '已为你建好账号' : '登录成功', icon: 'success' });
        const user = store.getState().user || {};
        // 还没有昵称头像的新账号：先让他设一下，可以跳过
        if (!user.nickname) {
          this.setData({
            profileSheet: true,
            profileNick: user.nickname || '',
            profileAvatar: '',
          });
          return;
        }
        setTimeout(() => this.leave(), 600);
      })
      .catch((err) => {
        this.setData({ wxBusy: false });
        this.showError('微信登录失败', err, () => this.wxLogin());
      });
  },

  /* ---------------- 完善资料（可跳过） ---------------- */
  onChooseAvatar(e) {
    const url = e.detail && e.detail.avatarUrl;
    if (url) this.setData({ profileAvatar: url });
  },

  onProfileNick(e) {
    this.setData({ profileNick: e.detail.value });
  },

  skipProfile() {
    this.setData({ profileSheet: false });
    setTimeout(() => this.leave(), 300);
  },

  saveProfile() {
    if (this.data.profileSaving) return;
    const nick = String(this.data.profileNick || '').trim();
    if (nick && nick.length < 2) {
      wx.showToast({ title: '昵称至少 2 个字', icon: 'none' });
      return;
    }
    const avatar = this.data.profileAvatar;
    if (!nick && !avatar) {
      this.skipProfile();
      return;
    }

    const send = (avatarData) => {
      this.setData({ profileSaving: true });
      api.post('/api/me/profile', { nickname: nick, avatar: avatarData || '' })
        .then(() => store.refresh({ force: true }))
        .then(() => {
          this.setData({ profileSaving: false, profileSheet: false });
          this.render();
          wx.showToast({ title: '已保存', icon: 'success' });
          setTimeout(() => this.leave(), 600);
        })
        .catch((err) => {
          this.setData({ profileSaving: false });
          wx.showToast({ title: err.message || '保存失败', icon: 'none' });
        });
    };

    // 头像是临时文件，读成 base64 再传
    if (avatar && avatar.indexOf('data:') !== 0) {
      wx.getFileSystemManager().readFile({
        filePath: avatar,
        encoding: 'base64',
        success: (fr) => send('data:image/jpeg;base64,' + fr.data),
        fail: () => send(''),
      });
    } else {
      send(avatar);
    }
  },

  /** 已登录状态下把当前账号和微信绑定 */
  bindWx() {
    if (this.data.wxBusy) return;
    this.setData({ wxBusy: true });
    const post = (code) => api.post('/api/auth/wx/bind', { code: code }).catch((err) => {
      const wxCode = err && err.body && err.body.wxCode;
      if (wxCode === 40029 || wxCode === 40163) {
        return this.loginCode().then((fresh) => api.post('/api/auth/wx/bind', { code: fresh }));
      }
      throw err;
    });
    this.loginCode()
      .then(post)
      .then(() => store.refresh())
      .then(() => {
        this.setData({ wxBusy: false });
        this.render();
        wx.showToast({ title: '已绑定微信', icon: 'success' });
      })
      .catch((err) => {
        this.setData({ wxBusy: false });
        this.showError('绑定失败', err, () => this.bindWx());
      });
  },

  /** 微信注册的账号没有密码，这里补一个，方便在网页版登录 */
  setPassword() {
    const pw = String(this.data.password || '');
    if (pw.length < 8) { wx.showToast({ title: '密码至少 8 位', icon: 'none' }); return; }
    if (/^\d+$/.test(pw)) { wx.showToast({ title: '密码不能是纯数字', icon: 'none' }); return; }
    if (this.data.busy) return;
    this.setData({ busy: true });
    api.post('/api/auth/password', { newPassword: pw })
      .then(() => store.refresh())
      .then(() => {
        this.setData({ busy: false, password: '' });
        this.render();
        wx.showToast({ title: '密码已设置', icon: 'success' });
      })
      .catch((err) => {
        this.setData({ busy: false });
        wx.showToast({ title: err.message || '设置失败', icon: 'none' });
      });
  },

  showError(title, err, retry) {
    const notReady = err && err.status === 503;
    if (!retry) {
      wx.showModal({
        title,
        content: notReady
          ? '微信登录还没配置好。请站点管理员在服务器环境变量里加上 WX_APPSECRET 后重启服务。'
          : (err && err.message) || '请稍后重试',
        showCancel: false,
        confirmText: '知道了',
      });
      return;
    }
    wx.showModal({
      title,
      content: (err && err.message) || '请稍后重试',
      confirmText: '重试',
      cancelText: '取消',
      success: (r) => { if (r.confirm) retry(); },
    });
  },

  /** 登录成功后回到上一页；没有上一页就回我的藏品 */
  leave() {
    const pages = getCurrentPages();
    if (pages.length > 1) {
      wx.navigateBack();
    } else {
      wx.switchTab({ url: '/pages/mine/mine' });
    }
  },

  logout() {
    wx.showModal({
      title: '退出登录',
      content: '退出后需要重新登录才能查看藏品。',
      confirmText: '退出',
      success: (res) => {
        if (!res.confirm) return;
        api.post('/api/auth/logout', {}).catch(() => {}).then(() => {
          api.setToken('');
          store.clearUser();
          this.render();
          wx.showToast({ title: '已退出', icon: 'success' });
        });
      },
    });
  },

  /** 复制微信号，方便加好友 */
  copyContact() {
    wx.setClipboardData({
      data: 'virtualman2001',
      success: () => wx.showToast({ title: '微信号已复制', icon: 'success' }),
    });
  },

});
