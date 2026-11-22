const api = require('../../utils/api');
const { ensureAdmin } = require('../../utils/admin-guard');

Page({
  data: {
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
  },

  onLoad() {
    if (!ensureAdmin()) return;
    this.loadVisitors();
  },

  onPullDownRefresh() {
    Promise.resolve(this.loadVisitors())
      .then(() => wx.stopPullDownRefresh(), () => wx.stopPullDownRefresh());
  },

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
      holdings: '我的收藏', mine: '我的', detail: '品种详情', account: '账户',
      about: '关于', more: '更多', feedback: '反馈', privacy: '隐私',
    }[k] || k);
    const time = (s) => String(s || '').slice(0, 16).replace('T', ' ');
    if (this.data.vsView === 'ip') {
      return (res.ipGroups || []).map((x) => {
        // 老数据可能没有 clients 字段；缺字段不能让整张表抛错变空
        const clients = Array.isArray(x.clients) ? x.clients : [];
        const both = clients.indexOf('mp') >= 0 && clients.indexOf('web') >= 0;
        const mp = clients.indexOf('mp') >= 0;
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
        holdings: '我的收藏', mine: '我的', detail: '品种详情', account: '账户',
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
            nick: x.nickName || '',
          })),
        },
      });
    }).catch((e) => wx.showToast({ title: e.message || '加载失败', icon: 'none' }));
  },
  closeVsDetail() {
    this.setData({ vsDetail: null });
  },
  noop() {},
});
