const api = require('../../utils/api');
const { ensureAdmin } = require('../../utils/admin-guard');

Page({
  data: {
    series: [], editingSeries: false, seriesForm: {}, seriesFields: [], saving: false,
  },

  onLoad() {
    if (!ensureAdmin()) return;
    this.loadSeries();
  },

  onPullDownRefresh() {
    Promise.resolve(this.loadSeries())
      .then(() => wx.stopPullDownRefresh(), () => wx.stopPullDownRefresh());
  },

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
  noop() {},
});
