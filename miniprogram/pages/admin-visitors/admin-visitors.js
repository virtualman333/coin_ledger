const api = require('../../utils/api');
const { ensureAdmin } = require('../../utils/admin-guard');

/**
 * 访客统计（管理端）。
 *
 * 三端同源：接口是 /api/admin/visitors（?client & ?range），字段口径见
 * server/visitors.js。容易踩的坑都在下面列着：
 *   1. 后端存 UTC ISO，直接 slice 会差 8 小时 → 统一走 fmtTime()；
 *   2. 今日 PV / 来源 PV 必须和「客户端筛选」同口径，否则会出现
 *      「访问 48 次 / 今日 464」这种自相矛盾的组合；
 *   3. 小程序 UA 为空时不能判成「电脑」，只能按来源兜底；
 *   4. 会话列表服务端只回最近 40 条，要显式提示被截断；
 *   5. 页面名是英文 key，必须映射成中文，否则明细里全是 admin-visitors。
 */

const PAGE_SIZE = 20;

const TAB_NAMES = {
  home: '首页',
  shell: '主界面',
  all: '全套清单',
  plan: '发行计划',
  series: '全部系列',
  'series-detail': '系列详情',
  holdings: '我的收藏',
  mine: '我的',
  detail: '品种详情',
  pmdetail: '贵金属详情',
  pm: '贵金属独立页',
  account: '账户',
  profile: '个人资料',
  about: '关于',
  more: '更多',
  'more-tools': '更多功能',
  feedback: '反馈',
  myfeedback: '我的反馈',
  privacy: '隐私政策',
  sitemap: '站点地图',
  count: '拍照数币',
  backup: '收藏备份',
  colshare: '收藏快照',
  admin: '管理端',
  'admin-users': '用户管理',
  'admin-user': '用户详情',
  'admin-visitors': '访客统计',
  'admin-feedback': '反馈管理',
  'admin-params': '参数管理',
  'admin-cats': '品类管理',
  'admin-pm': '贵金属管理',
  'admin-series': '系列管理',
  'admin-images': '图片管理',
  'admin-browse': '内容浏览',
  plaza: '收藏广场（已下线）',
};

const RANGE_LABELS = { today: '今日', week: '近 7 天', month: '近 30 天', all: '全部' };

/** 头像可能是站内相对路径（/avatar/x.jpg），小程序要拼接口域名 */
function avatarUrl(p) {
  const s = String(p || '');
  if (!s) return '';
  return s.indexOf('http') === 0 ? s : api.BASE + s;
}

/** 来源标签：同一行可能既有网页又有小程序 */
function srcOf(clients) {
  const c = Array.isArray(clients) ? clients : [];
  const hasMp = c.indexOf('mp') >= 0;
  const hasWeb = c.indexOf('web') >= 0;
  if (hasMp && hasWeb) return { text: '混合', cls: 'mix' };
  return hasMp ? { text: '小程序', cls: 'mp' } : { text: '网页', cls: 'web' };
}

function tabName(k) {
  if (!k) return '—';
  return TAB_NAMES[k] || k;
}

/** 后端存 UTC ISO；直接截串会差 8 小时，这里按本地时区显示 */
function fmtTime(v, withYear) {
  if (!v) return '—';
  const d = new Date(v);
  if (isNaN(d.getTime())) return String(v).replace('T', ' ').slice(0, 16);
  const p = (n) => (n < 10 ? '0' + n : String(n));
  const md = p(d.getMonth() + 1) + '-' + p(d.getDate());
  const hm = p(d.getHours()) + ':' + p(d.getMinutes());
  return (withYear ? d.getFullYear() + '-' : '') + md + ' ' + hm;
}

/** 设备识别：平板要先判，iPad 的 UA 里也带 Mobile；小程序无 UA 时按来源兜底 */
function deviceOf(ua, client) {
  const s = String(ua || '');
  if (!s) return client === 'mp' ? '小程序' : '—';
  if (/iPad|Tablet/i.test(s)) return '平板';
  if (/iPhone|Android|Mobile/i.test(s)) return '手机';
  return '电脑';
}

Page({
  data: {
    vsClient: 'all',
    vsClients: [
      { v: 'all', t: '全部' },
      { v: 'web', t: '网页' },
      { v: 'mp', t: '小程序' },
    ],
    vsRange: 'today',
    vsRanges: [
      { v: 'today', t: '今日' },
      { v: 'week', t: '近 7 天' },
      { v: 'month', t: '近 30 天' },
      { v: 'all', t: '全部' },
    ],
    vsView: 'ip',
    vsViews: [
      { v: 'ip', t: '按 IP' },
      { v: 'user', t: '按用户' },
      { v: 'sid', t: '按会话' },
    ],
    visitors: null,
    vsCards: [],
    vsNote: '',
    vsRows: [],
    vsAll: [],
    vsTotal: 0,
    vsHasMore: false,
    vsSessionsCapped: false,
    vsLoading: true,
    vsLoaded: false,
    vsError: '',
    vsDetail: null,
    vsDetailLoading: false,
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
    const q = '/api/admin/visitors?client=' + this.data.vsClient + '&range=' + this.data.vsRange;
    return api.get(q)
      .then((res) => {
        const rows = this.mapRows(res);
        this.setData({
          vsLoading: false,
          vsLoaded: true,
          vsError: '',
          visitors: res,
          vsCards: this.buildCards(res),
          vsNote: this.buildNote(res),
          vsAll: rows,
          vsTotal: rows.length,
          vsSessionsCapped: this.data.vsView === 'sid'
            && (res.sessionsTotal || 0) > (res.sessions || []).length,
          vsRows: rows.slice(0, PAGE_SIZE),
          vsHasMore: rows.length > PAGE_SIZE,
        });
      })
      .catch((e) => {
        const msg = (e && e.message) || '加载失败';
        // 错误留在页面上，不再只弹个 toast 一闪而过
        this.setData({
          vsLoading: false, vsLoaded: true, vsError: msg,
          visitors: null, vsCards: [], vsNote: '', vsRows: [], vsAll: [], vsTotal: 0,
          vsHasMore: false, vsSessionsCapped: false,
        });
      });
  },

  /** 顶部卡片：口径必须跟着 client / range 走，不能拿全站数字冒充筛选结果 */
  buildCards(res) {
    if (!res) return [];
    const label = RANGE_LABELS[res.range && res.range.key] || '所选区间';
    const by = res.byClient || {};
    const web = by.web || { pv: 0, uv: 0 };
    const mp = by.mp || { pv: 0, uv: 0 };
    const cards = [
      { n: res.rangePv || 0, k: label + ' PV' },
      { n: res.rangeUv || 0, k: label + '独立 IP' },
    ];
    if (this.data.vsClient === 'web') {
      cards.push({ n: web.pv, k: '网页 PV · ' + web.uv + ' IP' });
    } else if (this.data.vsClient === 'mp') {
      cards.push({ n: mp.pv, k: '小程序 PV · ' + mp.uv + ' IP' });
    } else {
      cards.push({ n: web.pv, k: '网页 PV · ' + web.uv + ' IP' });
      cards.push({ n: mp.pv, k: '小程序 PV · ' + mp.uv + ' IP' });
    }
    if (res.range && res.range.key !== 'today') {
      cards.push({ n: res.todayPv || 0, k: '今日 PV' });
    }
    cards.push({ n: res.allPv || 0, k: '累计 PV' });
    cards.push({ n: res.avgPages || 0, k: '平均每会话页' });
    return cards;
  },

  buildNote(res) {
    if (!res) return '';
    const r = res.range || {};
    const span = r.from ? r.from + ' 至 ' + r.to : '全部时间';
    return '区间 ' + span + ' · 累计 ' + (res.allPv || 0) + ' 次访问';
  },

  /** 把接口结果加工成列表行（不截断，分页交给 slice） */
  mapRows(res) {
    if (!res) return [];
    if (this.data.vsView === 'ip') {
      return (res.ipGroups || []).map((x) => {
        // 老数据可能没有 clients 字段；缺字段不能让整张表抛错变空
        const clients = Array.isArray(x.clients) ? x.clients : [];
        const hasMp = clients.indexOf('mp') >= 0;
        const hasWeb = clients.indexOf('web') >= 0;
        const mixed = hasMp && hasWeb;
        const who = x.nickName || x.name || '访客';
        return {
          key: x.ip,
          kind: 'ip',
          main: who,
          acc: (x.nickName && x.name && x.name !== x.nickName) ? x.name : '',
          avatar: avatarUrl(x.avatar),
          initial: String(who).slice(0, 1),
          src: mixed ? '混合' : (hasMp ? '小程序' : '网页'),
          srcCls: mixed ? 'mix' : (hasMp ? 'mp' : 'web'),
          device: deviceOf(x.ua, hasMp && !hasWeb ? 'mp' : 'web'),
          meta: (x.pv || 0) + ' 次 · ' + (x.sessionCount || 0) + ' 会话 · '
            + (x.pageCount || 0) + ' 页 · ' + (x.days || 0) + ' 天',
          sub: fmtTime(x.last),
          ip: x.ip || '—',
        };
      });
    }
    if (this.data.vsView === 'user') {
      return (res.userGroups || []).map((x) => {
        const src = srcOf(x.clients);
        const who = x.nickName || x.name || (x.uid ? '用户 ' + String(x.uid).toUpperCase() : '未登录访客');
        return {
          key: x.uid || x.ip,
          kind: x.uid ? 'uid' : 'ip',
          main: who,
          acc: (x.nickName && x.name && x.name !== x.nickName) ? x.name : '',
          avatar: avatarUrl(x.avatar),
          initial: String(who).slice(0, 1),
          src: src.text,
          srcCls: src.cls,
          // 用户视图没有 UA 可信（可能多设备），换成「几个 IP」这个更有用的信息
          device: (x.ipCount || 0) > 1 ? x.ipCount + ' 个 IP' : '',
          meta: (x.pv || 0) + ' 次 · ' + (x.sessionCount || 0) + ' 会话 · '
            + (x.pageCount || 0) + ' 页 · ' + (x.days || 0) + ' 天',
          sub: fmtTime(x.last),
          ip: x.ip || '—',
        };
      });
    }
    return (res.sessions || []).map((x) => {
      const isMp = x.client === 'mp';
      const pages = (x.pages || []).map(tabName).join(' / ');
      return {
        key: x.sid,
        kind: 'sid',
        main: x.nickName || x.name || '未登录',
        acc: (x.nickName && x.name && x.name !== x.nickName) ? x.name : '',
        avatar: avatarUrl(x.avatar),
        initial: String(x.nickName || x.name || '未').slice(0, 1),
        src: isMp ? '小程序' : '网页',
        srcCls: isMp ? 'mp' : 'web',
        device: deviceOf(x.ua, x.client),
        meta: (x.pageCount || 0) + ' 页' + (pages ? ' · ' + pages : ''),
        sub: fmtTime(x.last),
        ip: x.ip || '—',
      };
    });
  },

  /** 只切视图：用已拉到的数据重排，不重复请求 */
  setVsView(e) {
    const view = e.currentTarget.dataset.v;
    if (view === this.data.vsView) return;
    this.setData({ vsView: view }, () => {
      const rows = this.mapRows(this.data.visitors);
      const res = this.data.visitors;
      this.setData({
        vsAll: rows,
        vsTotal: rows.length,
        vsRows: rows.slice(0, PAGE_SIZE),
        vsHasMore: rows.length > PAGE_SIZE,
        vsSessionsCapped: view === 'sid' && !!res
          && (res.sessionsTotal || 0) > (res.sessions || []).length,
      });
    });
  },

  loadMore() {
    if (!this.data.vsHasMore) return;
    const next = Math.min(this.data.vsAll.length, this.data.vsRows.length + PAGE_SIZE);
    this.setData({
      vsRows: this.data.vsAll.slice(0, next),
      vsHasMore: next < this.data.vsAll.length,
    });
  },

  setVsClient(e) {
    const v = e.currentTarget.dataset.v;
    if (v === this.data.vsClient) return;
    this.setData({ vsClient: v });
    this.loadVisitors();
  },

  setVsRange(e) {
    const v = e.currentTarget.dataset.v;
    if (v === this.data.vsRange) return;
    this.setData({ vsRange: v });
    this.loadVisitors();
  },

  openVsDetail(e) {
    if (this.data.vsDetailLoading) return;
    const kind = e.currentTarget.dataset.kind;
    const key = e.currentTarget.dataset.key;
    const who = e.currentTarget.dataset.who;
    const field = kind === 'ip' ? 'ip' : (kind === 'uid' ? 'uid' : 'sid');
    const q = field + '=' + encodeURIComponent(key) + '&range=' + this.data.vsRange;
    this.setData({ vsDetailLoading: true });
    api.get('/api/admin/visitors/detail?' + q).then((res) => {
      const rows = res.rows || [];
      const sidSet = {};
      const tabSet = {};
      rows.forEach((x) => {
        sidSet[x.sid] = 1;
        tabSet[x.tab] = 1;
      });
      this.setData({
        vsDetailLoading: false,
        vsDetail: {
          title: kind === 'ip' ? key
            : (kind === 'uid' ? (who || '用户') : (who || '会话') + ' · ' + String(key || '').slice(0, 6)),
          total: res.total || rows.length,
          sessions: Object.keys(sidSet).length,
          pages: Object.keys(tabSet).length,
          ip: rows.length ? (rows[0].ip || '') : '',
          rows: rows.map((x) => ({
            at: fmtTime(x.at),
            tab: tabName(x.tab),
            src: x.client === 'mp' ? '小程序' : '网页',
            srcCls: x.client === 'mp' ? 'mp' : 'web',
            ip: x.ip || '—',
            user: x.name || '未登录',
            nick: x.nickName || '',
          })),
        },
      });
    }).catch((err) => {
      this.setData({ vsDetailLoading: false });
      wx.showToast({ title: err.message || '加载失败', icon: 'none' });
    });
  },

  closeVsDetail() {
    this.setData({ vsDetail: null });
  },

  noop() {},
});
