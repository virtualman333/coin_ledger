const cat = require('../../utils/catalog');
const store = require('../../utils/store');
const share = require('../../utils/share');
const api = require('../../utils/api');

module.exports = {
  data: {
    keyword: '',
    code: '',
    desc: true,
    onlyOwn: false,
    searchActive: false,         // 未点击前不渲染 input，彻底避免自动弹输入法
    searchFocus: false,
    rows: [],
    shownRows: [],   // 分批渲染：137 个品种一次全铺会明显卡住
    rowLimit: 40,
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
    pmError: '',
    pmOwnedCount: 0,        // 贵金属已收数量（与普通币的 ownedCount 分开算）
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
    // 页签与下拉都按当前品类生成：纪念钞不该出现纪念币的系列和面额
    this.applyFilterOpts(this.data.category);
    const tabs = this.tabsForCategory(this.data.category);
    this.setData({ allTabs: tabs, tabs: tabs });
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
      // 走 applyCategory 而不是直接 setData：否则页签和筛选选项还停在上一个品类
      this.setData({ viewMode: 'list' });
      this.applyCategory(guess, codeStr);
    }
    this.render();
    if (this.data.viewMode === 'series') this.buildSeriesView();
  },

  onPullDownRefresh() {
    store.refresh().then(() => {
      this.render();
      if (this.data.viewMode === 'series') this.buildSeriesView();
      this.triggerEvent('refreshed');
    }).catch(() => this.triggerEvent('refreshed'));
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
    if (mode === 'series') {
      this.buildSeriesView();
      return;
    }
    // 切回顺序清单：贵金属的数据只在 loadPmFull 里，按系列视图期间从没拉过，
    // 不补这一次就会看到「共 2823 条 + 空网格」
    if (this.data.category === 'pm') {
      // 按系列视图里切到贵金属时没重建页签，回清单要换成发行项目
      this.setData({ tabs: this.data.pmTabs.length ? this.data.pmTabs : [{ code: '', name: '全部项目' }] });
      if (!this.data.pmLoaded || this.data.pmError) {
        this.setData({ pmRows: [], pmPage: 0, pmPages: 0, pmLoaded: false, pmError: '' });
        this.loadPmFull(1, false);
      }
      return;
    }
    // 按系列视图里可以切品类，回到清单时页签与下拉要跟着当前品类刷新
    this.applyFilterOpts(this.data.category);
    this.setData({ tabs: this.tabsForCategory(this.data.category) });
    this.render();
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

  /** 从全量品种里生成三个下拉的选项（普通币/纪念钞用） */
  /** 该品类下的品种（纪念币 / 纪念钞 / 贵金属各自一套） */
  coinsOf(category) {
    return cat.coins.filter((c) => {
      const cc = cat.categoryOf(c);
      if (category === 'note') return cc === 'commemorative_note';
      if (category === 'pm') return cc === 'precious_metal';
      return cc === 'commemorative_coin';
    });
  },

  /**
   * 系列页签只列「该品类自己出现过的系列」。
   * 以前用的是全量 seriesList，于是切到纪念钞，下面还挂着一轮生肖贺岁、
   * 世界文化遗产这些纪念币系列，选中必然 0 条。
   */
  tabsForCategory(category) {
    const items = this.coinsOf(category);
    const counts = {};
    items.forEach((c) => {
      (c.seriesKeys || [c.series]).forEach((k) => {
        if (k) counts[k] = (counts[k] || 0) + 1;
      });
    });
    const tabs = cat.seriesList
      .filter((s) => counts[s.code])
      .sort((a, b) => (a.sort || 0) - (b.sort || 0))
      .map((s) => ({ code: s.code, name: s.name, count: counts[s.code] }));
    return [{ code: '', name: '全部', count: items.length }].concat(tabs);
  },

  /** 三个下拉的选项也按品类各生成一套：纪念钞没有 5 元面额，年份区间也不一样 */
  buildFilterOpts(category) {
    const items = this.coinsOf(category);
    const years = [...new Set(items.map((c) => c.year))].sort((a, b) => b - a);
    const faces = [...new Set(items.map((c) => Number(c.face)))]
      .filter((n) => n > 0)
      .sort((a, b) => a - b);
    const matCount = {};
    items.forEach((c) => {
      if (!c.material) return;
      matCount[c.material] = (matCount[c.material] || 0) + 1;
    });
    const mats = Object.keys(matCount).sort((a, b) => matCount[b] - matCount[a]);
    return {
      yearOpts: ['全部年份'].concat(years.map(String)),
      faceOpts: ['全部面额'].concat(faces.map((f) => f + ' 元')),
      matOpts: ['全部材质'].concat(mats),
    };
  },

  /** 贵金属的三组选项来自接口 facets（2823 条，不能靠本地 catalog 推） */
  buildPmFilterOpts(facets) {
    if (!facets) return;
    const years = (facets.years || []).map(String);
    const faces = (facets.faces || [])
      .map((f) => String(Number(f)))
      .filter((f, i, a) => f !== 'NaN' && a.indexOf(f) === i);
    const mats = (facets.materials || []).map(String);
    this.filterOpts = this.filterOpts || {};
    this.filterOpts.pm = {
      yearOpts: ['全部年份'].concat(years),
      faceOpts: ['全部面额'].concat(faces.map((f) => f + ' 元')),
      matOpts: ['全部材质'].concat(mats),
    };
    if (this.data.category === 'pm') this.setData(this.filterOpts.pm);
  },

  /** 切品类时把下拉选项换成该品类的（三套各自缓存，互不污染） */
  applyFilterOpts(category) {
    this.filterOpts = this.filterOpts || {};
    if (category === 'pm') {
      this.setData(this.filterOpts.pm
        || { yearOpts: ['全部年份'], faceOpts: ['全部面额'], matOpts: ['全部材质'] });
      return;
    }
    if (!this.filterOpts[category]) this.filterOpts[category] = this.buildFilterOpts(category);
    this.setData(this.filterOpts[category]);
  },

  /** 记住当前品类的筛选，切走再切回来还能接着用 */
  saveFilterSnap(category) {
    if (!category) return;
    this._filterSnap = this._filterSnap || {};
    this._filterSnap[category] = {
      yearIdx: this.data.yearIdx,
      faceIdx: this.data.faceIdx,
      matIdx: this.data.matIdx,
      yearFilter: this.data.yearFilter,
      faceFilter: this.data.faceFilter,
      matFilter: this.data.matFilter,
      onlyOwn: this.data.onlyOwn,
    };
  },

  restoreFilterSnap(category) {
    const s = (this._filterSnap && this._filterSnap[category]) || {
      yearIdx: 0, faceIdx: 0, matIdx: 0,
      yearFilter: '', faceFilter: '', matFilter: '', onlyOwn: false,
    };
    this.setData(s);
  },

  pickYear(e) {
    const i = Number(e.detail.value) || 0;
    this.setData({ yearIdx: i, yearFilter: i ? String(this.data.yearOpts[i]) : '' });
    this.syncExtra();
    this.refreshAfterFilter();
  },
  pickFace(e) {
    const i = Number(e.detail.value) || 0;
    const label = i ? this.data.faceOpts[i] : '';
    this.setData({ faceIdx: i, faceFilter: label ? label.replace(' 元', '') : '' });
    this.syncExtra();
    this.refreshAfterFilter();
  },
  pickMat(e) {
    const i = Number(e.detail.value) || 0;
    this.setData({ matIdx: i, matFilter: i ? this.data.matOpts[i] : '' });
    this.syncExtra();
    this.refreshAfterFilter();
  },
  /** 贵金属的数据在服务端（2823 条 / 分页），筛选条件变了必须回第一页重新拉，不能只在已加载的 30 条里过滤 */
  refreshAfterFilter() {
    if (this.data.category === 'pm') {
      this.setData({ pmRows: [], pmPage: 0, pmPages: 0, pmLoaded: false, pmError: '' });
      this.loadPmFull(1, false);
      return;
    }
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
    // extraCount 也要归零，否则「筛选」按钮上的角标会一直留着已清空的条件数
    this.setData({
      yearIdx: 0, faceIdx: 0, matIdx: 0,
      yearFilter: '', faceFilter: '', matFilter: '', hasExtra: false, extraCount: 0,
    });
    this.refreshAfterFilter();
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
    const prev = this.data.category;
    // 切走之前先把上一个品类的筛选记下来，切回来还能接着用
    if (prev && prev !== category) this.saveFilterSnap(prev);
    this.setData({ category }, () => {
      // 下拉选项必须换成对应数据源的，否则贵金属会列出普通币的年份
      this.applyFilterOpts(category);
      if (category === 'pm') {
        this.setData({
          keyword: '', yearFilter: '', faceFilter: '', matFilter: '', onlyOwn: false,
          hasExtra: false, extraCount: 0, yearIdx: 0, faceIdx: 0, matIdx: 0,
          pmRows: [], pmPage: 1, pmPages: 1, pmTotal: 0, pmLoaded: false, pmError: '',
          pmOwnedCount: 0,
          filterOpen: false, code: code || '',
          tabs: this.data.pmTabs.length ? this.data.pmTabs : [{ code: '', name: '全部项目' }] });
        this.loadPmFull(1, false);
      } else {
        // 恢复该品类自己的筛选，页签也只列它自己的系列
        this.restoreFilterSnap(category);
        this.syncExtra();
        this.setData({ code: code || '', tabs: this.tabsForCategory(category), category });
        this.render();
      }
    });
  },

  /**
   * 贵金属全量库：从 /api/catalog/pm 分页拉（2823 条）。
   * 年份/面额/材质/排序全部交给服务端（本地只有一页，前端过滤会漏数据）；
   * 首屏顺带取 facets 拼筛选项。
   */
  loadPmFull(page, append) {
    append = !!append;
    // 追加请求在 loading 期间直接丢掉（上拉会连点），但要在自增序号之前返回，
    // 否则会把正在飞的那个请求判成过期，列表就永远停在「加载中」
    if (append && this.data.pmLoading) return;
    // 序号守卫：改筛选条件时旧请求可能还在路上，晚到的响应不能覆盖新结果
    const seq = this._pmSeq = (this._pmSeq || 0) + 1;
    this.setData({ pmLoading: true });

    const kw = String(this.data.keyword || '').trim();
    const first = !append;
    let path = '/api/catalog/pm?page=' + page + '&pageSize=30'
      + '&sort=' + (this.data.desc ? 'year_desc' : 'year_asc');
    if (kw) path += '&q=' + encodeURIComponent(kw);
    if (this.data.code) path += '&project=' + encodeURIComponent(this.data.code);
    if (this.data.yearFilter) path += '&year=' + encodeURIComponent(this.data.yearFilter);
    if (this.data.faceFilter) path += '&face=' + encodeURIComponent(this.data.faceFilter);
    if (this.data.matFilter) path += '&material=' + encodeURIComponent(this.data.matFilter);
    if (first) path += '&facets=1';

    api.get(path).then((j) => {
      if (seq !== this._pmSeq) return;
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
      if (first && j.facets) this.buildPmFilterOpts(j.facets);
      const holdings = store.getState().holdings || [];
      this.setData({
        pmRows: append ? this.data.pmRows.concat(rows) : rows,
        pmPage: Number(j.page) || page,
        pmPages: Number(j.pages) || 0,
        pmTotal: Number(j.total) || 0,
        pmLoading: false,
        pmLoaded: true,
        pmError: '',
        pmOwnedCount: holdings.filter((h) => h.category === 'pm').length,
      });
    }).catch(() => {
      if (seq !== this._pmSeq) return;
      // 失败不等于「没有匹配品种」：以前会把 2823 条库伪装成空结果且无重试入口
      this.setData({ pmLoading: false, pmLoaded: true, pmRows: [], pmError: '贵金属目录加载失败' });
    });
  },

  retryPmFull() {
    this.setData({ pmError: '', pmLoaded: false, pmRows: [] });
    this.loadPmFull(1, false);
  },

  loadMorePm() {
    if (!this.data.pmLoaded || this.data.pmLoading) return;
    if (this.data.pmPage < this.data.pmPages) this.loadPmFull(this.data.pmPage + 1, true);
  },

  onReachBottom() {
    if (this.data.category === 'pm') {
      this.loadMorePm();
      return;
    }
    const rows = this.data.rows || [];
    if (this.data.shownRows.length >= rows.length) return;
    const limit = (this.data.rowLimit || 40) + 40;
    this.setData({ rowLimit: limit, shownRows: rows.slice(0, limit) });
  },

  /** 点贵金属卡片：进详情页（与普通币详情同款布局） */
  goPmDetail(e) {
    const code = e.currentTarget.dataset.code;
    if (!code) return;
    wx.navigateTo({ url: '/pages/pmdetail/pmdetail?code=' + encodeURIComponent(code) });
  },

  render() {
    const kw = String(this.data.keyword || '').trim().toLowerCase();
    const category = this.data.category || 'coin';
    if (category === 'pm') {
      // 贵金属全量库的顺序与筛选都由服务端负责（本地只有一页），这里不再二次排序
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
      shownRows: rows.slice(0, this.data.rowLimit || 40),
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
    if (this.data.category === 'pm') {
      // 贵金属要打接口，逐字请求太费；停手 320ms 再查
      clearTimeout(this._pmSearchTimer);
      this._pmSearchTimer = setTimeout(() => {
        if (this.data.category !== 'pm') return;
        this.setData({ pmRows: [], pmPage: 0, pmPages: 0, pmLoaded: false, pmError: '' });
        this.loadPmFull(1, false);
      }, 320);
      return;
    }
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
    clearTimeout(this._pmSearchTimer);
    if (this.data.category === 'pm') {
      this.setData({ pmRows: [], pmPage: 0, pmPages: 0, pmLoaded: false, pmError: '' });
      this.loadPmFull(1, false);
      return;
    }
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
    // 贵金属的排序在服务端做（本地只有一页数据，排了也不是全库顺序）
    if (this.data.category === 'pm') {
      this.setData({ pmRows: [], pmPage: 0, pmPages: 0, pmLoaded: false });
      this.loadPmFull(1, false);
      return;
    }
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
    const isPm = this.data.category === 'pm';
    if (code) {
      // 贵金属的「系列」是发行项目，名称在 pmTabs 里，条数是 pmTotal；
      // 用 cat.seriesName/count 会得到「（0 个品种）」
      const name = isPm
        ? ((this.data.pmTabs.filter((t) => t.code === code)[0] || {}).name || '发行项目')
        : (cat.seriesName(code) || '系列');
      const n = isPm ? this.data.pmTotal : this.data.count;
      return {
        title: '藏币录 · ' + name + (n ? '（共 ' + n + (isPm ? ' 枚）' : ' 个品种）') : ''),
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
};
;
