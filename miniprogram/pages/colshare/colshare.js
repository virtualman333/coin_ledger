const api = require('../../utils/api');
const share = require('../../utils/share');

/** 金额：千分位 + 最多两位小数。不引 catalog，落地页是给外人看的，越轻越好 */
function money(n) {
  const v = Math.round((Number(n) || 0) * 100) / 100;
  const neg = v < 0;
  const p = Math.abs(v).toFixed(2).split('.');
  const int = p[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const dec = String(p[1] || '').replace(/0+$/, '');
  return (neg ? '-' : '') + int + (dec ? '.' + dec : '');
}

/** 分享出去的时间按手机本地时区显示 */
function timeText(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return (d.getMonth() + 1) + '月' + d.getDate() + '日';
}

Page({
  data: {
    code: '',
    owner: '',
    kinds: 0,
    total: 0,
    items: [],
    loading: true,
    err: '',
    timeText: '',
    faceText: '',
    aiText: '',
    listHidden: false,
  },

  onLoad(q) {
    const code = String((q && q.code) || '').slice(0, 32);
    this.setData({ code });
    if (!code) {
      this.setData({ loading: false, err: '分享链接不完整' });
      return;
    }
    return api.get('/api/colshare/' + encodeURIComponent(code)).then((r) => {
      if (!r || !r.ok) {
        this.setData({ loading: false, err: (r && r.error) || '分享不存在或已失效' });
        return;
      }
      const owner = r.owner || '藏友';
      const items = (Array.isArray(r.items) ? r.items : []).map((it) => ({
        name: it.name || '',
        nameInitial: String(it.name || '藏').charAt(0),  // WXML 不支持 (expr)[0]，预算好
        year: Number(it.year) || 0,
        category: it.category || 'coin',
        qty: Number(it.qty) || 0,
        qtyLabel: it.qtyLabel || '',
        seriesName: it.seriesName || '',
        imgUrl: it.imgUrl || '',
        tagText: (it.luckyTags || []).slice(0, 3).join(' · '),
      }));
      wx.setNavigationBarTitle({ title: owner + '的收藏' });
      this.setData({
        owner,
        kinds: Number(r.kinds) || items.length,
        total: Number(r.total) || 0,
        items,
        faceText: Number(r.faceTotal) > 0 ? money(r.faceTotal) : '',
        aiText: Number(r.aiTotal) > 0 ? money(r.aiTotal) : '',
        listHidden: !!r.listHidden,
        timeText: timeText(r.createdAt),
        loading: false,
      });
    }).catch(() => this.setData({ loading: false, err: '加载失败，请稍后重试' }));
  },

  preview(e) {
    const src = e.currentTarget.dataset.src;
    if (src) wx.previewImage({ urls: [src], current: src });
  },

  /** 从微信会话/朋友圈打开时页面栈只有一层，switchTab 才能把新用户带回主界面。
   *  朋友圈单页模式（scene 1154）下 tabBar 不可达，用 reLaunch 兜底。 */
  goHome() {
    let scene = 0;
    try { scene = Number((wx.getLaunchOptionsSync() || {}).scene || 0); } catch (e) { /* 老基础库忽略 */ }
    if (scene === 1154) wx.reLaunch({ url: '/pages/index/index' });
    else getApp().goTab(0);
  },

  onShareAppMessage() {
    const d = this.data;
    return {
      title: (d.owner || '藏友') + '的收藏 · ' + d.kinds + ' 个品种（藏币录）',
      path: '/pages/colshare/colshare?code=' + encodeURIComponent(d.code),
      imageUrl: share.COVER,
    };
  },

  onShareTimeline() {
    const d = this.data;
    return {
      title: (d.owner || '藏友') + '的收藏 · ' + d.kinds + ' 个品种（藏币录）',
      query: 'code=' + encodeURIComponent(d.code),
      imageUrl: share.COVER,
    };
  },
});
