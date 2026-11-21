const cat = require('../../utils/catalog');
const api = require('../../utils/api');
const { ensureAdmin } = require('../../utils/admin-guard');

Page({
  data: {
    coins: [], keyword: '', editing: false, editName: '', editId: 0, editFields: [], saving: false,
  },

  onLoad(q) {
    if (!ensureAdmin()) return;
    // 从「资料库」点进来时带着品种名，直接定位到这一枚
    const kw = String((q && q.kw) || '').trim();
    if (kw) this.setData({ keyword: kw });
    this.loadCoins();
  },

  onPullDownRefresh() {
    Promise.resolve(this.loadCoins())
      .then(() => wx.stopPullDownRefresh(), () => wx.stopPullDownRefresh());
  },

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
  noop() {},
});
