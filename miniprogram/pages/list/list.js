const cat = require('../../utils/catalog');
const store = require('../../utils/store');
const share = require('../../utils/share');

Page({
  data: {
    keyword: '',
    code: '',
    desc: true,
    onlyOwn: false,
    searchActive: false,         // 未点击前不渲染 input，彻底避免自动弹输入法
    searchFocus: false,
    rows: [],
    category: 'coin',
    categories: [{ code: 'coin', name: '普通纪念币' }, { code: 'note', name: '纪念钞' }, { code: 'pm', name: '贵金属' }],
    count: 0,
    ownedCount: 0,
    tabs: [],
    // 年份 / 面额 / 材质 三个筛选（picker，索引 0 都是「全部」）
    yearOpts: ['全部年份'], faceOpts: ['全部面额'], matOpts: ['全部材质'],
    yearIdx: 0, faceIdx: 0, matIdx: 0,
    yearFilter: '', faceFilter: '', matFilter: '',
    hasExtra: false,
    filterOpen: false,      // 筛选项默认收起，避免顶部占掉半屏
    extraCount: 0,          // 已生效的筛选条件数量（角标）
  },

  onLoad(query) {
    if (query && query.code) {
      wx.setStorageSync('cl_pending_series', query.code);
    }
    this.buildFilterOpts();
    this.setData({
      tabs: [{ code: '', name: '全部', count: cat.total }].concat(cat.seriesList),
    });
    this.render();
  },

  onShow() {
    // 每次显示都回到「假框」状态：不渲染 input，就不会弹输入法
    if (this.data.searchActive || this.data.searchFocus) {
      this.setData({ searchActive: false, searchFocus: false });
    }
    const pending = wx.getStorageSync('cl_pending_series');
    if (pending) {
      wx.removeStorageSync('cl_pending_series');
      this.setData({ code: pending });
    }
    this.render();
  },

  onPullDownRefresh() {
    store.refresh().then(() => {
      this.render();
      wx.stopPullDownRefresh();
    }).catch(() => wx.stopPullDownRefresh());
  },

  /** 从全量品种里生成三个下拉的选项 */
  buildFilterOpts() {
    const years = [...new Set(cat.coins.map((c) => c.year))].sort((a, b) => b - a);
    const faces = [...new Set(cat.coins.map((c) => Number(c.face)))].sort((a, b) => a - b);
    const matCount = {};
    cat.coins.forEach((c) => {
      if (!c.material) return;
      matCount[c.material] = (matCount[c.material] || 0) + 1;
    });
    const mats = Object.keys(matCount).sort((a, b) => matCount[b] - matCount[a]);
    this.setData({
      yearOpts: ['全部年份'].concat(years.map(String)),
      faceOpts: ['全部面额'].concat(faces.map((f) => f + ' 元')),
      matOpts: ['全部材质'].concat(mats),
    });
  },

  pickYear(e) {
    const i = Number(e.detail.value) || 0;
    this.setData({ yearIdx: i, yearFilter: i ? String(this.data.yearOpts[i]) : '' });
    this.syncExtra();
    this.render();
  },
  pickFace(e) {
    const i = Number(e.detail.value) || 0;
    const label = i ? this.data.faceOpts[i] : '';
    this.setData({ faceIdx: i, faceFilter: label ? label.replace(' 元', '') : '' });
    this.syncExtra();
    this.render();
  },
  pickMat(e) {
    const i = Number(e.detail.value) || 0;
    this.setData({ matIdx: i, matFilter: i ? this.data.matOpts[i] : '' });
    this.syncExtra();
    this.render();
  },
  syncExtra() {
    this.setData({
      hasExtra: !!(this.data.yearFilter || this.data.faceFilter || this.data.matFilter),
      extraCount: [this.data.yearFilter, this.data.faceFilter, this.data.matFilter, this.data.onlyOwn ? 1 : '']
        .filter(Boolean).length,
    });
  },
  toggleFilter() {
    this.setData({ filterOpen: !this.data.filterOpen });
  },

  clearExtra() {
    this.setData({
      yearIdx: 0, faceIdx: 0, matIdx: 0,
      yearFilter: '', faceFilter: '', matFilter: '', hasExtra: false,
    });
    this.render();
  },

  applySeries(code) {
    this.setData({ code: code || '' });
    this.render();
  },

  pickCategory(e) {
    this.setData({ category: e.currentTarget.dataset.cat || 'coin' }, () => this.render());
  },

  render() {
    const kw = String(this.data.keyword || '').trim().toLowerCase();
    const category = this.data.category || 'coin';
    const code = this.data.code;
    const owned = store.ownedNames();
    const onlyOwn = this.data.onlyOwn;
    let list = cat.coins.filter((c) => {
      const ccat = cat.categoryOf(c);
      if (category === 'pm' && ccat !== 'precious_metal') return false;
      if (category === 'coin' && ccat !== 'commemorative_coin') return false;
      if (category === 'note' && ccat !== 'commemorative_note') return false;
      if (code && (c.seriesKeys || [c.series]).indexOf(code) < 0) return false;
      if (this.data.yearFilter && String(c.year) !== this.data.yearFilter) return false;
      if (this.data.faceFilter && Number(c.face) !== Number(this.data.faceFilter)) return false;
      if (this.data.matFilter && c.material !== this.data.matFilter) return false;
      if (onlyOwn && !owned[c.name]) return false;
      if (!kw) return true;
      return c.name.toLowerCase().indexOf(kw) >= 0
        || String(c.year).indexOf(kw) >= 0
        || (c.short || '').toLowerCase().indexOf(kw) >= 0;   // 「马钞」「净角」这类简称也能搜到
    });
    list = list.sort((a, b) => {
      const diff = (a.year - b.year) || (a.id - b.id);
      return this.data.desc ? -diff : diff;
    });
    const rows = list.map((c) => ({
      id: c.id,
      name: c.name,
      year: c.year,
      imgUrl: c.smallUrl || c.thumbUrl || c.imgUrl,
      owned: !!owned[c.name],
      metaText: c.seriesName + ' · ' + c.faceText,
      mintageLabel: c.mintageText ? ('发行 ' + c.mintageText + (c.kind === 'note' ? '张' : '枚')) : '',
      setLabel: '一套 ' + c.setSize + (c.kind === 'note' ? ' 张' : ' 枚'),
      priceText: '¥' + cat.money(store.setPriceOf(c)),
    }));
    this.setData({
      rows,
      count: rows.length,
      ownedCount: rows.filter((r) => r.owned).length,
    });
  },

  /** 点「假搜索框」才真正挂上 input 并聚焦 */
  activateSearch() {
    this.setData({ searchActive: true, searchFocus: true });
  },

  onSearch(e) {
    this.setData({ keyword: e.detail.value, searchFocus: true });
    this.render();
  },

  onSearchBlur() {
    if (!this.data.searchActive) return;
    // 没有关键词就收回假框，下次进来仍是「不会弹键盘」的状态
    this.setData({ searchFocus: false, searchActive: !!this.data.keyword });
  },

  /** 点搜索框才聚焦（输入框自身也能聚焦，这里保证状态一致） */
  focusSearch() {
    if (!this.data.searchFocus) this.setData({ searchFocus: true });
  },

  clearSearch() {
    this.setData({ keyword: '', searchFocus: false, searchActive: false });
    this.render();
  },

  pickTab(e) {
    this.setData({ code: e.currentTarget.dataset.code });
    this.render();
  },

  toggleSort() {
    this.setData({ desc: !this.data.desc });
    this.render();
  },

  toggleOwn() {
    this.setData({ onlyOwn: !this.data.onlyOwn });
    this.syncExtra();
    this.render();
  },

  imgErr(e) {
    const id = e.currentTarget.dataset.id;
    const rows = this.data.rows.map((r) => (r.id === id ? Object.assign({}, r, { imgFail: true }) : r));
    this.setData({ rows });
  },

  goDetail(e) {
    wx.navigateTo({ url: '/pages/detail/detail?id=' + e.currentTarget.dataset.id });
  },

  onShareAppMessage(e) {
    // 从列表转发时，带上当前筛选条件，好友打开就是同一批品种
    const code = this.data.code;
    const extra = code ? { title: '藏币录 · ' + cat.seriesName(code) + ' 系列', path: '/pages/list/list?code=' + code } : null;
    return share.appMessage('list', extra || undefined);
  },

  onShareTimeline() {
    return share.timeline('list');
  },
});
