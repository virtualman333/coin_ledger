const cat = require('../../utils/catalog');
const store = require('../../utils/store');
const share = require('../../utils/share');
const api = require('../../utils/api');

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
    allTabs: [], pmTabs: [],   // 两套完全独立的系列：普通币/纪念钞 vs 贵金属发行项目
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
    // 贵金属全量库（金币云集 2823 条）：分页接口，独立于本地 catalog
    pmRows: [],
    pmPage: 0,
    pmPages: 0,
    pmTotal: 0,
    pmLoading: false,
    pmLoaded: false,
    // 视图模式：list=顺序清单（默认）/ series=按系列卡片浏览
    viewMode: 'list',
    seriesCoin: [],
    seriesNote: [],
    seriesPm: [],
    seriesPmLoaded: false,
  },

  onLoad(query) {
    if (query && query.code) {
      wx.setStorageSync('cl_pending_series', query.code);
    }
    this.buildFilterOpts();
    const allTabs = [{ code: '', name: '全部', count: cat.total }].concat(cat.seriesList);
    this.setData({ allTabs, tabs: allTabs });
    this.loadPmSeries();
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
      // 新格式：{code, category} —— 从「按系列」页分组跳转，或首页行情卡进贵金属目录
      // code 可为空（此时只切品类，定位到全部）
      if (pending && typeof pending === 'object' && (pending.code || pending.category)) {
        const category = pending.category === 'pm' ? 'pm'
          : (pending.category === 'note' ? 'note' : 'coin');
        this.applyCategory(category, pending.code || '');
        return;
      }
      // 老格式：纯字符串 code（历史分享链接 ?code= 产生）。推断品类并回到顺序清单，
      // 避免在「按系列」视图下 render 了列表却仍显示系列卡片，看起来像没反应。
      const codeStr = String(pending);
      let guess = 'coin';
      const members = cat.inSeries(codeStr);
      if (members.length && members.filter((c) => cat.categoryOf(c) === 'commemorative_note').length > members.length / 2) {
        guess = 'note';
      }
      this.setData({ code: codeStr, category: guess, viewMode: 'list' });
    }
    this.render();
    if (this.data.viewMode === 'series') this.buildSeriesView();
  },

  onPullDownRefresh() {
    store.refresh().then(() => {
      this.render();
      if (this.data.viewMode === 'series') this.buildSeriesView();
      wx.stopPullDownRefresh();
    }).catch(() => wx.stopPullDownRefresh());
  },

  /** 按系列视图：普通币/纪念钞从本地目录分组，贵金属项目复用已加载的 pmTabs */
  buildSeriesView() {
    const owned = store.ownedNames();
    const coin = [], note = [];
    (cat.seriesList || []).forEach((s) => {
      const members = cat.inSeries(s.code);
      const own = members.filter((c) => owned[c.name]).length;
      const noteN = members.filter((c) => c.kind === 'note').length;
      const row = {
        code: s.code,
        name: s.name,
        count: members.length,
        own: own,
        pct: members.length ? Math.round((own / members.length) * 100) : 0,
        imgUrl: s.img ? api.BASE + '/' + s.img : '',
      };
      (noteN > members.length / 2 ? note : coin).push(row);
    });
    // pmTabs 第一项是「全部项目」，跳过；其余为发行项目。
    // 富字段（年份跨度/材质/封面）由 /api/series?category=pm 返回，loadPmSeries 里合并进 pmTabs。
    const pm = (this.data.pmTabs || []).slice(1).map((t) => {
      const mats = Array.isArray(t.materials) ? t.materials.filter(Boolean) : [];
      const yf = String(t.yearFrom || ''), yt = String(t.yearTo || '');
      return {
        code: t.code,
        name: t.name,
        count: t.count,
        yearText: yf && yt ? (yf === yt ? yf + ' 年' : yf + '—' + yt) : '',
        matText: mats.slice(0, 4).join(' · '),
        thumb: t.thumb ? (String(t.thumb).indexOf('http') === 0 ? t.thumb : api.BASE + t.thumb) : '',
      };
    });
    this.setData({
      seriesCoin: coin, seriesNote: note, seriesPm: pm,
      seriesPmLoaded: this.data.pmTabs.length > 0,
    });
  },

  /** 顺序清单 / 按系列 两模式切换 */
  toggleViewMode(e) {
    const mode = e.currentTarget.dataset.mode === 'series' ? 'series' : 'list';
    if (mode === this.data.viewMode) return;
    this.setData({ viewMode: mode });
    if (mode === 'series') this.buildSeriesView();
  },

  /** 按系列视图点卡片：打开独立系列详情页，只展示该系列品种（不再跳回顺序清单） */
  goSeriesCard(e) {
    const ds = e.currentTarget.dataset;
    const category = ds.cat === 'pm' ? 'pm' : (ds.cat === 'note' ? 'note' : 'coin');
    const code = ds.code || '';
    // 从已构建的分组里取系列名，作为详情页标题（免去重复请求）
    let name = ds.name || '';
    const pool = category === 'pm' ? this.data.seriesPm
      : (category === 'note' ? this.data.seriesNote : this.data.seriesCoin);
    if (!name && Array.isArray(pool)) {
      const hit = pool.filter((s) => s.code === code)[0];
      if (hit) name = hit.name;
    }
    wx.navigateTo({
      url: '/pages/series-detail/series-detail?category=' + category
        + '&code=' + encodeURIComponent(code)
        + '&name=' + encodeURIComponent(name),
    });
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

  /** 贵金属系列 = 发行项目，走独立接口，不混用普通币 series */
  loadPmSeries() {
    api.get('/api/series?category=pm').then((res) => {
      if (!res || !res.ok) return;
      const pmTabs = [{ code: '', name: '全部项目', count: res.items.reduce((a, it) => a + it.count, 0) }]
        .concat(res.items.map((it) => ({
          code: it.code,
          name: it.name,
          count: it.count,
          yearFrom: it.yearFrom || '',
          yearTo: it.yearTo || '',
          materials: Array.isArray(it.materials) ? it.materials : [],
          thumb: it.thumb || '',
        })));
      this.setData({ pmTabs });
      if (this.data.category === 'pm') this.setData({ tabs: pmTabs });
      if (this.data.viewMode === 'series') this.buildSeriesView();
    }).catch(() => {});
  },

  pickCategory(e) {
    const category = e.currentTarget.dataset.cat || 'coin';
    if (this.data.viewMode === 'series') {
      // 按系列模式：只切当前展示的品类分组，不触碰顺序清单的筛选/分页状态
      this.setData({ category });
      return;
    }
    this.applyCategory(category, '');
  },

  /** 切换品类并可选定位到某个系列 code（从「按系列」页分组跳转用） */
  applyCategory(category, code) {
    this.setData({ category }, () => {
      if (category === 'pm') {
        this.setData({
          keyword: '', yearFilter: '', faceFilter: '', matFilter: '', onlyOwn: false,
          hasExtra: false, extraCount: 0, yearIdx: 0, faceIdx: 0, matIdx: 0,
          pmRows: [], pmPage: 1, pmPages: 1, pmTotal: 0, pmLoaded: false,
          filterOpen: false, code: code || '',
          tabs: this.data.pmTabs.length ? this.data.pmTabs : [{ code: '', name: '全部项目' }] });
        this.loadPmFull(1, false);
      } else {
        this.setData({ code: code || '', tabs: this.data.allTabs, category });
        this.render();
      }
    });
  },

  /** 贵金属全量库：从 /api/catalog/pm 分页拉（2823 条），带搜索 q */
  loadPmFull(page, append) {
    if (this.data.pmLoading) return;
    this.setData({ pmLoading: true });
    const kw = String(this.data.keyword || '').trim();
    let path = '/api/catalog/pm?page=' + page + '&pageSize=30';
    if (kw) path += '&q=' + encodeURIComponent(kw);
    if (this.data.code) path += '&project=' + encodeURIComponent(this.data.code);
    api.get(path).then((j) => {
      const items = Array.isArray(j.items) ? j.items : [];
      const rows = items.map((it) => ({
        code: it.code,
        thumb: (it.thumbBack || it.thumb) ? (api.BASE + (it.thumbBack || it.thumb)) : '',
        codeId: it.code,
        name: it.name,
        year: it.year,
        projectName: it.projectName,
        metaText: [it.material, it.weightG ? it.weightG + '克' : '', it.quality].filter(Boolean).join(' · '),
        faceText: it.face != null ? it.face + ' 元' : '—',
        fineness: it.fineness,
        metalClass: /金/.test(it.material || '') ? 'gold' : (/银/.test(it.material || '') ? 'silver' : (/铂/.test(it.material || '') ? 'platinum' : 'other')),
        metalChar: /金/.test(it.material || '') ? '金' : (/银/.test(it.material || '') ? '银' : (/铂/.test(it.material || '') ? '铂' : '币')),
      }));
      this.setData({
        pmRows: append ? this.data.pmRows.concat(rows) : rows,
        pmPage: Number(j.page) || page,
        pmPages: Number(j.pages) || 0,
        pmTotal: Number(j.total) || 0,
        pmLoading: false,
        pmLoaded: true,
        count: Number(j.total) || 0,
      });
    }).catch(() => {
      this.setData({ pmLoading: false, pmLoaded: true, pmRows: [], count: 0 });
      wx.showToast({ title: '贵金属目录加载失败', icon: 'none' });
    });
  },

  loadMorePm() {
    if (!this.data.pmLoaded || this.data.pmLoading) return;
    if (this.data.pmPage < this.data.pmPages) this.loadPmFull(this.data.pmPage + 1, true);
  },

  onReachBottom() {
    if (this.data.category === 'pm') this.loadMorePm();
  },

  /** 点贵金属卡片：进详情页（与普通币详情同款布局） */
  goPmDetail(e) {
    const code = e.currentTarget.dataset.code;
    if (!code) return;
    wx.navigateTo({ url: '/pages/pmdetail/pmdetail?code=' + encodeURIComponent(code) });
  },

  /**
   * 按年份排序（年份容错为数字）：desc 为 true 降序（大年份在前），否则升序。
   * 同年份时用 code/id 兜底，保证顺序稳定、点击可精确反转。
   */
  sortByYear(rows, desc) {
    const yearNum = (y) => { const n = Number(y); return Number.isFinite(n) ? n : 0; };
    const key = (r) => String(r && (r.code != null ? r.code : r.id) || '');
    return (rows || []).slice().sort((a, b) => {
      const diff = (yearNum(a.year) - yearNum(b.year)) || key(a).localeCompare(key(b));
      return desc ? -diff : diff;
    });
  },

  render() {
    const kw = String(this.data.keyword || '').trim().toLowerCase();
    const category = this.data.category || 'coin';
    if (category === 'pm') {
      // pm 由 loadPmFull 单独维护分页；此处只对当前已加载的数据按年份排序，
      // 不重新请求，也不会改动 pmPage/pmPages 等分页状态。
      this.setData({ pmRows: this.sortByYear(this.data.pmRows, this.data.desc) });
      return;
    }
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
      priceText: '¥' + cat.money(cat.aiPriceOf(c) * c.setSize),
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
    const code = e.currentTarget.dataset.code || '';
    this.setData({ code }, () => {
      if (this.data.category === 'pm') this.loadPmFull(1, false);
      else this.render();
    });
  },

  /** 年份排序按钮：切换升/降序并立刻对当前列表生效（箭头由 desc 驱动） */
  toggleSort() {
    const desc = !this.data.desc;
    this.setData({ desc });
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
    // 定位到某系列时，直接分享到独立系列详情页（好友打开只看到这一系列，不再是清单筛选态）
    const code = this.data.code;
    if (code) {
      const name = cat.seriesName(code);
      return {
        title: '藏币录 · ' + (name || '系列') + '（' + this.data.count + ' 个品种）',
        path: '/pages/series-detail/series-detail?category=' + this.data.category
          + '&code=' + encodeURIComponent(code)
          + '&name=' + encodeURIComponent(name || ''),
        imageUrl: share.COVER,
      };
    }
    return share.appMessage('list');
  },

  onShareTimeline() {
    return share.timeline('list');
  },
});
