const api = require('../../utils/api');
const cat = require('../../utils/catalog');
const store = require('../../utils/store');

/** 时间戳 → 2026/11/09 */
function dayText(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  return d.getFullYear() + '/' + (d.getMonth() + 1) + '/' + d.getDate();
}

Page({
  data: {
    // 管理首页改成功能入口卡片，比一上来横排五个 tab 清楚
    modules: [
      { group: '内容', cls: 'g-content', items: [
        { k: 'params', t: '参数', d: '品种基础数据', i: '⚙' },
        { k: 'images', t: '图片', d: '实物图与图集', i: '▣' },
        { k: 'series', t: '系列', d: '归类与卡图', i: '❖' },
      ] },
      { group: '运营', cls: 'g-ops', items: [
        { k: 'users', t: '用户', d: '账号与权限', i: '♙' },
        { k: 'feedback', t: '反馈', d: '纠错与建议', i: '✎' },
      ] },
      { group: '数据', cls: 'g-data', items: [
        { k: 'visitors', t: '访客', d: '访问与留存', i: '◷' },
      ] },
    ],
    viewMode: 'home',
    tab: '',   // 首页为空，只有进模块才指向具体功能
    vsShowVisitors: false,
    vsClient: 'all',
    vsView: 'ip',
    vsClients: [
      { v: 'all', t: '全部' },
      { v: 'web', t: '网页' },
      { v: 'mp', t: '小程序' },
    ],
    vsRange: 'all',
    vsRanges: [
      { v: 'today', t: '今日' },
      { v: 'week', t: '近 7 天' },
      { v: 'month', t: '近 30 天' },
      { v: 'all', t: '全部' },
    ],
    vsViews: [
      { v: 'ip', t: '按 IP' },
      { v: 'sid', t: '按会话' },
    ],
    visitors: null,
    visRows: [],
    vsDetail: null,
    vsLoading: false,
    vsError: '',
    userCount: 0,
    coinCount: 0,
    openCount: 0,
    users: [],
    coins: [],
    keyword: '',
    feedbacks: [],
    fbStatus: 'open',
    editing: false,
    editName: '',
    editId: 0,
    editFields: [],
    saving: false,
    fbDetail: null,
    series: [],
    editingSeries: false,
    seriesForm: {},
    seriesFields: [],
  },

  onLoad() {
    const state = store.getState();
    if (!state.isAdmin) {
      wx.showModal({
        title: '没有权限',
        content: '只有管理员能进入管理端。',
        showCancel: false,
        success: () => wx.navigateBack(),
      });
      return;
    }
    this.setData({ coinCount: cat.total });
    this.loadFeedback();      // 首页只取角标数，进模块再加载明细
    this.loadUserCount();
  },

  onPullDownRefresh() {
    const task = this.data.viewMode === 'module'
      ? this.loadTab(this.data.tab)
      : Promise.all([this.loadFeedback(), this.loadUserCount()]);
    Promise.resolve(task).then(() => wx.stopPullDownRefresh()).catch(() => wx.stopPullDownRefresh());
  },

  /** 首页「用户」只取总数，不拉列表 */
  loadUserCount() {
    return api.get('/api/admin/users?page=1&size=1').then((res) => {
      const n = (res.stats && res.stats.total) || (res.users || []).length;
      this.setData({ userCount: n });
    }).catch(() => {});
  },

  switchTab(e) {
    const k = e.currentTarget.dataset.k;
    if (k === this.data.tab) return;
    this.setData({ tab: k, fbDetail: null, editing: false });
    this.loadTab(k);
  },

  /** 概览数字直达模块，省一次「回首页再点」 */
  statTap(e) {
    const k = e.currentTarget.dataset.k;
    if (!k) return;
    this.openModule({ currentTarget: { dataset: { k } } });
  },

  openModule(e) {
    const k = e.currentTarget.dataset.k;
    if (!k) return;
    wx.vibrateShort && wx.vibrateShort({ type: 'light' });
    this.setData({ viewMode: 'module', tab: k, vsDetail: null, vsShowVisitors: k === 'visitors' });
    wx.pageScrollTo && wx.pageScrollTo({ scrollTop: 0, duration: 180 });
    this.loadTab(k);
  },

  backHome() {
    this.setData({ viewMode: 'home', tab: '', vsDetail: null, vsShowVisitors: false });
    wx.pageScrollTo && wx.pageScrollTo({ scrollTop: 0, duration: 180 });
    // 处理完反馈 / 用户后回首页，角标和总数立刻是新的
    this.loadFeedback();
    this.loadUserCount();
  },

  loadTab(k) {
    if (k === 'users') return this.loadUsers();
    if (k === 'params' || k === 'images') return this.loadCoins();
    if (k === 'series') return this.loadSeries();
    if (k === 'feedback') return this.loadFeedback();
    if (k === 'visitors') return this.loadVisitors();
    return Promise.resolve();
  },

  /* ---------------- 访客统计 ---------------- */
  loadVisitors() {
    this.setData({ vsLoading: true, vsError: '' });
    return api.get('/api/admin/visitors?client=' + this.data.vsClient + '&range=' + this.data.vsRange)
      .then((res) => {
        this.setData({
          vsLoading: false,
          vsError: '',
          visitors: res,
          visRows: this.mapVisRows(res),
        });
      })
      .catch((e) => {
        const msg = (e && e.message) || '加载失败';
        // 错误留在页面上，不再只弹个 toast 一闪而过
        this.setData({ vsLoading: false, vsError: msg, visitors: null, visRows: [] });
      });
  },

  mapVisRows(res) {
    if (!res) return [];
    const name = (k) => ({
      home: '首页', all: '全套清单', plan: '发行计划', series: '系列',
      holdings: '我的藏品', mine: '我的', detail: '品种详情', account: '账户',
      about: '关于', more: '更多', feedback: '反馈', privacy: '隐私',
    }[k] || k);
    const time = (s) => String(s || '').slice(0, 16).replace('T', ' ');
    if (this.data.vsView === 'ip') {
      return (res.ipGroups || []).map((x) => {
        const both = x.clients.indexOf('mp') >= 0 && x.clients.indexOf('web') >= 0;
        const mp = x.clients.indexOf('mp') >= 0;
        const ua = String(x.ua || '');
        return {
          key: x.ip,
          kind: 'ip',
          main: x.name || '访客',
          src: both ? '混合' : (mp ? '小程序' : '网页'),
          srcCls: mp ? 'mp' : 'web',
          device: /iPhone|Android|Mobile/i.test(ua) ? '手机' : (/iPad|Tablet/i.test(ua) ? '平板' : '电脑'),
          meta: x.pv + ' 次 · ' + x.sessionCount + ' 会话 · ' + x.pageCount + ' 页 · ' + x.days + ' 天',
          sub: time(x.last),
          ip: x.ip,
        };
      });
    }
    return (res.sessions || []).map((x) => {
      const mp = x.client === 'mp';
      return {
        key: x.sid,
        kind: 'sid',
        main: x.name || '未登录',
        src: mp ? '小程序' : '网页',
        srcCls: mp ? 'mp' : 'web',
        device: '—',
        meta: x.pageCount + ' 页 · ' + (x.pages || []).map(name).join(' / '),
        sub: time(x.last),
        ip: x.ip || '—',
      };
    });
  },

  setVsClient(e) {
    this.setData({ vsClient: e.currentTarget.dataset.v });
    this.loadVisitors();
  },

  setVsRange(e) {
    this.setData({ vsRange: e.currentTarget.dataset.v });
    this.loadVisitors();
  },

  setVsView(e) {
    const view = e.currentTarget.dataset.v;
    this.setData({ vsView: view, visRows: this.mapVisRows(this.data.visitors) });
  },

  openVsDetail(e) {
    const kind = e.currentTarget.dataset.kind;
    const key = e.currentTarget.dataset.key;
    const q = (kind === 'ip' ? ('ip=' + encodeURIComponent(key)) : ('sid=' + encodeURIComponent(key)))
      + '&range=' + this.data.vsRange;
    api.get('/api/admin/visitors/detail?' + q).then((res) => {
      const name = (k) => ({
        home: '首页', all: '全套清单', plan: '发行计划', series: '系列',
        holdings: '我的藏品', mine: '我的', detail: '品种详情', account: '账户',
      }[k] || k);
      this.setData({
        vsDetail: {
          title: kind === 'ip' ? key : key.slice(0, 8),
          total: res.total,
          rows: (res.rows || []).map((x) => ({
            at: String(x.at || '').slice(5, 16).replace('T', ' '),
            tab: name(x.tab),
            src: x.client === 'mp' ? '小程序' : '网页',
            srcCls: x.client === 'mp' ? 'mp' : 'web',
            user: x.name || '未登录',
          })),
        },
      });
    }).catch((e) => wx.showToast({ title: e.message || '加载失败', icon: 'none' }));
  },

  closeVsDetail() {
    this.setData({ vsDetail: null });
  },

  /* ---------------- 系列 ---------------- */
  loadSeries() {
    return api.get('/api/series').then((res) => {
      const series = (res.items || []).map((s) => Object.assign({}, s, {
        imgUrl: s.img ? api.BASE + '/' + s.img : '',
      }));
      this.setData({ series });
    }).catch((e) => wx.showToast({ title: e.message || '加载失败', icon: 'none' }));
  },

  seriesActions(e) {
    const key = e.currentTarget.dataset.key;
    const it = this.data.series.filter((x) => x.key === key)[0];
    if (!it) return;
    this.setData({
      editingSeries: true,
      seriesForm: { key: it.key, name: it.name, isNew: false },
      seriesFields: [
        { k: 'name', label: '系列名', type: 'text', value: it.name, ph: '如：生肖纪念钞' },
        { k: 'desc', label: '简介', type: 'text', value: it.desc || '', ph: '一句话说明（可空）' },
        { k: 'sort', label: '排序（小的在前）', type: 'number', value: String(it.sort || 0), ph: '10' },
      ],
    });
  },

  newSeries() {
    this.setData({
      editingSeries: true,
      seriesForm: { key: '', name: '', isNew: true },
      seriesFields: [
        { k: 'key', label: '标识（英文/数字）', type: 'text', value: '', ph: '如 SXC' },
        { k: 'name', label: '系列名', type: 'text', value: '', ph: '如：生肖纪念钞' },
        { k: 'desc', label: '简介', type: 'text', value: '', ph: '可空' },
        { k: 'sort', label: '排序', type: 'number', value: String((this.data.series.length + 1) * 10), ph: '10' },
      ],
    });
  },

  onSeriesInput(e) {
    const k = e.currentTarget.dataset.k;
    const v = e.detail.value;
    const seriesFields = this.data.seriesFields.map((f) => (f.k === k ? Object.assign({}, f, { value: v }) : f));
    this.setData({ seriesFields });
  },

  closeSeries() {
    this.setData({ editingSeries: false });
  },

  saveSeries() {
    if (this.data.saving) return;
    const vals = {};
    this.data.seriesFields.forEach((f) => { vals[f.k] = f.value; });
    if (!String(vals.name || '').trim()) { wx.showToast({ title: '系列名不能为空', icon: 'none' }); return; }

    this.setData({ saving: true });
    const done = () => {
      this.setData({ saving: false, editingSeries: false });
      wx.showToast({ title: '已保存', icon: 'success' });
      this.loadSeries();
      this.setData({ allCoins: null });
    };
    const fail = (e) => {
      this.setData({ saving: false });
      wx.showToast({ title: e.message || '保存失败', icon: 'none' });
    };

    if (this.data.seriesForm.isNew) {
      api.post('/api/admin/series', vals).then(done).catch(fail);
    } else {
      api.patch('/api/admin/series/' + this.data.seriesForm.key, vals).then(done).catch(fail);
    }
  },

  uploadSeriesImg() {
    const key = this.data.seriesForm.key;
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sizeType: ['compressed'],
      success: (r) => {
        const file = (r.tempFiles || [])[0];
        if (!file) return;
        wx.getFileSystemManager().readFile({
          filePath: file.tempFilePath,
          encoding: 'base64',
          success: (fr) => {
            const ext = /\.png$/i.test(file.tempFilePath) ? 'png' : 'jpeg';
            wx.showLoading({ title: '上传中', mask: true });
            api.post('/api/admin/series/image', { key: key, data: 'data:image/' + ext + ';base64,' + fr.data })
              .then(() => {
                wx.hideLoading();
                wx.showToast({ title: '已换图', icon: 'success' });
                this.loadSeries();
              })
              .catch((e) => { wx.hideLoading(); wx.showToast({ title: e.message || '上传失败', icon: 'none' }); });
          },
          fail: () => wx.showToast({ title: '读取图片失败', icon: 'none' }),
        });
      },
    });
  },

  deleteSeries() {
    const f = this.data.seriesForm;
    wx.showModal({
      title: '删除系列',
      content: '删除「' + f.name + '」？该系列会从所有品种上移除，但品种本身不删。',
      confirmText: '删除',
      confirmColor: '#c0392b',
      success: (r) => {
        if (!r.confirm) return;
        api.del('/api/admin/series/' + f.key).then(() => {
          wx.showToast({ title: '已删除', icon: 'success' });
          this.setData({ editingSeries: false, allCoins: null });
          this.loadSeries();
        }).catch((e) => wx.showToast({ title: e.message || '删除失败', icon: 'none' }));
      },
    });
  },

  /* ---------------- 用户 ---------------- */
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

  /** 只有测试账号允许删除，真实账号先取消保护 */
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

  /** 藏品明细单独开页：弹窗塞不下，也看不清 */
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

  /* ---------------- 参数 ---------------- */
  loadCoins() {
    return api.get('/api/admin/coins').then((res) => {
      const byId = {};
      cat.coins.forEach((c) => { byId[c.id] = c; });
      const coins = (res.coins || []).map((c) => {
        const id = Number(c.i) + 1;
        const local = byId[id] || {};
        return Object.assign({}, local, c, {
          id: id,
          i: id,
          smallUrl: local.smallUrl || '',
          thumbUrl: local.thumbUrl || '',
          imgUrl: local.imgUrl || '',
        });
      });
      this.setData({ coins, coinCount: coins.length });
      this.applyFilter();
    }).catch((e) => wx.showToast({ title: e.message || '加载失败', icon: 'none' }));
  },

  onKeyword(e) {
    this.setData({ keyword: e.detail.value });
    this.applyFilter();
  },

  clearKeyword() {
    this.setData({ keyword: '' });
    this.applyFilter();
  },

  applyFilter() {
    const kw = String(this.data.keyword || '').trim();
    const all = this.data.allCoins || this.data.coins;
    this.data.allCoins = all;
    const list = !kw ? all : all.filter((c) => String(c.name).indexOf(kw) >= 0 || String(c.year).indexOf(kw) >= 0);
    this.setData({ coins: list });
  },

  editCoin(e) {
    const id = Number(e.currentTarget.dataset.i);
    const c = this.data.coins.filter((x) => x.id === id)[0] || (this.data.allCoins || []).filter((x) => x.id === id)[0];
    if (!c) return;
    this.setData({
      editing: true,
      editId: id,
      editName: c.name,
      editFields: [
        { k: 'face', label: '面额（元）', type: 'digit', value: String(c.face), ph: '10' },
        { k: 'mintage', label: '发行量（万）', type: 'digit', value: String(c.mintage), ph: '10000' },
        { k: 'est', label: '参考价（元/枚）', type: 'digit', value: String(c.est), ph: '11' },
        {
          k: 'setSize',
          label: '一套（枚 / 张）',
          type: 'number',
          value: c.setSize ? String(c.setSize) : '',
          ph: '留空按默认（20）',
        },
        { k: 'material', label: '材质', type: 'text', value: c.material || '', ph: '双色铜合金' },
        { k: 'dia', label: '直径 / 票幅', type: 'text', value: c.dia || '', ph: '27mm' },
        {
          k: 'seriesKeys',
          label: '所属系列',
          type: 'text',
          value: (c.seriesKeys || (c.series ? [c.series] : [])).join(','),
          ph: '逗号分隔，如 CN,SXC',
        },
      ],
    });
  },

  onEditInput(e) {
    const k = e.currentTarget.dataset.k;
    const v = e.detail.value;
    const fields = this.data.editFields.map((f) => (f.k === k ? Object.assign({}, f, { value: v }) : f));
    this.setData({ editFields: fields });
  },

  closeEdit() {
    this.setData({ editing: false });
  },

  saveEdit() {
    if (this.data.saving) return;
    const patch = {};
    this.data.editFields.forEach((f) => {
      if (f.k === 'seriesKeys') {
        patch.seriesKeys = String(f.value || '').split(/[,，\s]+/).filter(Boolean);
      } else {
        patch[f.k] = f.value;
      }
    });
    this.setData({ saving: true });
    api.patch('/api/admin/coin', { id: this.data.editId, patch }).then(() => {
      this.setData({ saving: false, editing: false });
      wx.showToast({ title: '已保存', icon: 'success' });
      this.setData({ allCoins: null });
      this.loadCoins();
    }).catch((e) => {
      this.setData({ saving: false });
      wx.showToast({ title: e.message || '保存失败', icon: 'none' });
    });
  },

  /* ---------------- 图片 ---------------- */
  previewImage(e) {
    const url = e.currentTarget.dataset.url;
    if (!url) { wx.showToast({ title: '这枚还没有图', icon: 'none' }); return; }
    wx.previewImage({ urls: [url], current: url });
  },

  replaceImage(e) {
    const id = Number(e.currentTarget.dataset.i);
    const coin = this.data.coins.filter((x) => x.id === id)[0];
    if (!coin) return;
    wx.showActionSheet({
      itemList: ['上传主图', '上传正面图', '上传背面图', '上传整套图'],
      success: (r) => {
        const kinds = ['main', 'obverse', 'reverse', 'set'];
        this.pickAndUpload(id, kinds[r.tapIndex]);
      },
    });
  },

  pickAndUpload(id, kind) {
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sizeType: ['compressed'],
      success: (r) => {
        const file = (r.tempFiles || [])[0];
        if (!file) return;
        wx.getFileSystemManager().readFile({
          filePath: file.tempFilePath,
          encoding: 'base64',
          success: (fr) => {
            const ext = /\.png$/i.test(file.tempFilePath) ? 'png' : 'jpeg';
            wx.showLoading({ title: '上传中', mask: true });
            api.post('/api/admin/image', { id: id, kind: kind, data: 'data:image/' + ext + ';base64,' + fr.data })
              .then(() => {
                wx.hideLoading();
                wx.showToast({ title: '已上传', icon: 'success' });
                this.setData({ allCoins: null });
                this.loadCoins();
              })
              .catch((e) => { wx.hideLoading(); wx.showToast({ title: e.message || '上传失败', icon: 'none' }); });
          },
          fail: () => wx.showToast({ title: '读取图片失败', icon: 'none' }),
        });
      },
    });
  },

  /* ---------------- 反馈 ---------------- */
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
    this.setData({ fbDetail: Object.assign({}, it, { images: images }) });
  },

  closeFb() {
    this.setData({ fbDetail: null });
  },

  previewFbImage(e) {
    const src = e.currentTarget.dataset.src;
    wx.previewImage({ urls: this.data.fbDetail.images, current: src });
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
