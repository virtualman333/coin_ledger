const api = require('../../utils/api');
const { ensureAdmin } = require('../../utils/admin-guard');

Page({
  data: {
    pmAll: [], pmPage: 1, pmPages: 1, pmTotal: 0, pmQ: '', pmLoading: false,
  },

  onLoad() {
    if (!ensureAdmin()) return;
    this.loadPmAll(1);
  },

  onPullDownRefresh() {
    Promise.resolve(this.loadPmAll(1))
      .then(() => wx.stopPullDownRefresh(), () => wx.stopPullDownRefresh());
  },

  loadPmAll(page) {
    if (this.data.pmLoading) return Promise.resolve();
    this.setData({ pmLoading: true });
    return api.get('/api/admin/pm-all?page=' + page + '&size=30&q=' + encodeURIComponent(this.data.pmQ)).then((res) => {
      if (!res || !res.ok) return this.setData({ pmLoading: false });
      this.setData({
        pmAll: (res.items || []).map((x) => Object.assign({}, x, {
          thumbUrl: x.thumb ? api.BASE + x.thumb : '',
        })),
        pmPage: res.page, pmPages: res.pages, pmTotal: res.total, pmLoading: false,
      });
    }).catch(() => this.setData({ pmLoading: false }));
  },
  onPmQ(e) { this.setData({ pmQ: e.detail.value }); },
  pmSearch() { this.loadPmAll(1); },
  pmPrev() { if (this.data.pmPage > 1) this.loadPmAll(this.data.pmPage - 1); },
  pmNext() { if (this.data.pmPage < this.data.pmPages) this.loadPmAll(this.data.pmPage + 1); },
});
