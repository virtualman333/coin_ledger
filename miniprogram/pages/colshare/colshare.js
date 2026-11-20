const api = require('../../utils/api');
const share = require('../../utils/share');

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
        timeText: timeText(r.createdAt),
        loading: false,
      });
    }).catch(() => this.setData({ loading: false, err: '加载失败，请稍后重试' }));
  },

  preview(e) {
    const src = e.currentTarget.dataset.src;
    if (src) wx.previewImage({ urls: [src], current: src });
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
