const api = require('../../utils/api');
const cat = require('../../utils/catalog');
const { ensureAdmin } = require('../../utils/admin-guard');

/**
 * 管理首页：只负责「概览 + 入口」。
 * 每个模块是独立的页面（真实导航栈），所以系统返回键 = 回这一页，
 * 不会再像以前那样从「用户管理」一按返回直接跳出管理端。
 */
const MODULE_PATHS = {
  browse: '/pages/admin-browse/admin-browse',
  cats: '/pages/admin-cats/admin-cats',
  pmall: '/pages/admin-pm/admin-pm',
  params: '/pages/admin-params/admin-params',
  images: '/pages/admin-images/admin-images',
  series: '/pages/admin-series/admin-series',
  users: '/pages/admin-users/admin-users',
  feedback: '/pages/admin-feedback/admin-feedback',
  visitors: '/pages/admin-visitors/admin-visitors',
};

Page({
  data: {
    modules: [
      { group: '内容', cls: 'g-content', items: [
        { k: 'browse', t: '资料库', d: '品类 → 系列 → 单枚', i: '◉' },
        { k: 'cats', t: '大分类', d: '品类总览与规模', i: '▤' },
        { k: 'pmall', t: '贵金属库', d: '全量检索与查看', i: '✦' },
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
    userCount: 0,
    coinCount: 0,
    openCount: 0,
  },

  onLoad() {
    this.authorized = ensureAdmin();
    if (!this.authorized) return;
    this.setData({ coinCount: cat.total });
  },

  /** 从三级页返回时刷新角标与总数 */
  onShow() {
    if (!this.authorized) return;
    this.loadCounts();
  },

  onPullDownRefresh() {
    Promise.resolve(this.loadCounts())
      .then(() => wx.stopPullDownRefresh(), () => wx.stopPullDownRefresh());
  },

  /** 首页只要数字，列表在各个子页面里取 */
  loadCounts() {
    const users = api.get('/api/admin/users?page=1&size=1').then((res) => {
      const n = (res && res.stats && res.stats.total) || ((res && res.users) || []).length;
      this.setData({ userCount: n });
    }).catch(() => {});
    const feedback = api.get('/api/admin/feedback?status=open').then((res) => {
      this.setData({ openCount: (res && res.open) || 0 });
    }).catch(() => {});
    return Promise.all([users, feedback]);
  },

  /** 概览三格与列表行共用同一个跳转 */
  goModule(e) {
    const k = e.currentTarget.dataset.k;
    const url = MODULE_PATHS[k];
    if (!url) return;
    wx.vibrateShort && wx.vibrateShort({ type: 'light' });
    wx.navigateTo({ url: url });
  },

  statTap(e) {
    this.goModule(e);
  },
});
