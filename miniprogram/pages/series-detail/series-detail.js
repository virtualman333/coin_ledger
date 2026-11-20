const cat = require('../../utils/catalog');
const store = require('../../utils/store');
const api = require('../../utils/api');
const share = require('../../utils/share');

/** 图片路径补全：接口返回相对路径时拼站点域名 */
function absoluteImg(p) {
  if (!p) return '';
  const s = String(p);
  if (s.indexOf('http') === 0) return s;
  return api.BASE + (s.charAt(0) === '/' ? s : '/' + s);
}

/**
 * URL 参数容错解码。
 * 本页是全项目唯一通过 URL 传中文标题的页面：各入口统一 encodeURIComponent(name)，
 * 但小程序不同基础库 / 分享卡片 / 扫码进入时，onLoad 拿到的可能是已解过一次的中文、
 * 也可能是 %E4%B8%80... 形式的编码串，甚至分享链路的双重编码串。
 * 只在检测到合法 %XX 序列时解码（最多两层），遇到非法序列原样返回，
 * 避免误伤本身含 % 的标题（如「100% 纯银」）。
 */
function safeDecode(s) {
  if (typeof s !== 'string' || !s) return '';
  let out = s;
  for (let i = 0; i < 2; i++) {
    if (!/%[0-9a-fA-F]{2}/.test(out)) break;
    try {
      const d = decodeURIComponent(out);
      if (d === out) break;
      out = d;
    } catch (e) { break; }
  }
  return out;
}

/**
 * 独立「系列详情页」：只展示某一系列下的全部品种。
 * 入参 ?category=coin|note|pm&code=<系列key|贵金属project_code>&name=<标题>
 * - 普通币 / 纪念钞：用内置目录（离线可用，图片/推理价齐全），与全套清单口径一致
 * - 贵金属：走 /api/series/detail?category=pm 聚合接口（本地无贵金属全量库）
 */
Page({
  data: {
    category: 'coin',
    code: '',
    name: '',
    loading: true,
    loaded: false,
    loadingMore: false,
    series: null,      // { name, desc, img, count, own, pct, yearText, matText }
    rows: [],
    total: 0,
    totalPrice: '',
    page: 1,
    pages: 1,
    desc: true,        // 年份降序
    onlyOwn: false,
    showOnlyOwn: false,
    loadError: '',
  },

  onLoad(query) {
    const q = query || {};
    const category = q.category === 'pm' ? 'pm' : (q.category === 'note' ? 'note' : 'coin');
    // 各入口统一 encodeURIComponent(name)；不同进入方式拿到的可能是编码串或已解码中文，统一在此兜底解码
    const code = safeDecode(q.code);
    const name = safeDecode(q.name);
    this.setData({
      category: category,
      code: code,
      name: name,
    }, () => {
      wx.setNavigationBarTitle({
        title: name || (category === 'pm' ? '贵金属项目' : '系列详情'),
      });
      // 分享卡片/扫码可能丢 code。cat.inSeries('') 会返回全部 137 个品种，
      // 若继续渲染等于凭空造出一个「包含全站」的系列，必须早退。
      if (!code) {
        this.setData({ loading: false, loaded: true, rows: [], series: null, loadError: '缺少系列参数' });
        return;
      }
      this.reload();
    });
  },

  goHome() {
    wx.switchTab({ url: '/pages/index/index' });
  },

  reload() {
    this.setData({ page: 1, rows: [], loading: true, loadError: '' });
    return this.build(1, false);
  },

  /** 按品类分流数据源，统一返回 Promise（便于 onReachBottom / 测试 await） */
  build(page, append) {
    if (this.data.category === 'pm') return this.loadPm(page, append);
    return Promise.resolve(this.buildLocal());
  },

  /** 普通币 / 纪念钞：本地目录筛选 + 收藏进度 + 推理价 */
  buildLocal() {
    const code = this.data.code;
    const meta = (cat.seriesList || []).filter((s) => s.code === code)[0];
    const members = cat.inSeries(code);
    const owned = store.ownedNames();
    const rows = (members || []).map((c) => ({
      id: c.id,
      name: c.name,
      year: c.year,
      imgUrl: c.smallUrl || c.thumbUrl || c.imgUrl || '',
      owned: !!owned[c.name],
      faceText: c.faceText || (c.face != null ? c.face + ' 元' : ''),
      setLabel: c.setSize ? ('一套 ' + c.setSize + (c.kind === 'note' ? ' 张' : ' 枚')) : '',
      priceText: '¥' + cat.money(cat.aiPriceOf(c) * (c.setSize || 1)),
      _price: cat.aiPriceOf(c) * (c.setSize || 1),
    }));
    const own = rows.filter((r) => r.owned).length;
    const sum = rows.reduce((a, r) => a + (r._price || 0), 0);
    this.setData({
      series: {
        name: this.data.name || (meta && meta.name) || '系列',
        desc: (meta && meta.desc) || '',
        img: (meta && meta.img) ? absoluteImg(meta.img) : '',
        count: rows.length,
        own: own,
        pct: rows.length ? Math.round((own / rows.length) * 100) : 0,
        yearText: '',
        matText: '',
      },
      rows: this.sortRows(rows, this.data.desc),
      total: rows.length,
      totalPrice: rows.length ? ('¥' + cat.money(sum)) : '',
      pages: 1,
      showOnlyOwn: own > 0,
      loading: false,
      loaded: true,
    });
  },

  /** 贵金属：项目元信息 + 成员分页，来自后端聚合接口 */
  loadPm(page, append) {
    const path = '/api/series/detail?category=pm&code=' + encodeURIComponent(this.data.code)
      + '&page=' + page + '&size=30'
      + '&sort=' + (this.data.desc ? 'year_desc' : 'year_asc');
    return api.get(path).then((res) => {
      if (!res || !res.ok) throw new Error('series detail failed');
      const s = res.series || {};
      const items = Array.isArray(res.items) ? res.items : [];
      const rows = items.map((it) => ({
        id: 'pm-' + it.code,     // 与 buildLocal 的 id 口径一致，避免 wx:key 全为 undefined
        code: it.code,
        name: it.name,
        year: it.year,
        imgUrl: absoluteImg(it.thumbBack || it.thumb || it.frontPicture),
        metaText: [it.material, it.weightG ? it.weightG + ' 克' : '', it.quality].filter(Boolean).join(' · '),
        faceText: it.face != null ? it.face + ' 元' : '',
      }));
      const yf = String(s.yearFrom || ''), yt = String(s.yearTo || '');
      const mats = Array.isArray(s.materials) ? s.materials : [];
      const allRows = append ? this.data.rows.concat(rows) : rows;
      this.setData({
        series: {
          name: this.data.name || s.name || '贵金属项目',
          desc: '',
          img: absoluteImg(s.thumb),
          count: Number(s.count) || 0,
          own: 0,
          pct: 0,
          yearText: yf && yt ? (yf === yt ? (yf + ' 年') : (yf + '—' + yt)) : '',
          matText: mats.slice(0, 4).join(' · '),
        },
        // 服务端已经排好序，这里不再二次排序（二次排只会打乱「同年份按 code」的稳定序）
        rows: allRows,
        total: Number(res.total) || 0,
        page: Number(res.page) || page,
        pages: Number(res.pages) || 0,
        showOnlyOwn: false,
        loading: false,
        loaded: true,
        loadError: '',
      });
    }).catch(() => {
      // 失败不能渲染成「这个系列暂时没有品种」，两者语义完全不同
      this.setData({
        loading: false,
        loaded: true,
        rows: append ? this.data.rows : [],
        loadError: append ? '' : '系列加载失败',
      });
      if (append) wx.showToast({ title: '加载更多失败，上拉重试', icon: 'none' });
    });
  },

  /** 年份排序：容错为数字，同年份用名称兜底保证稳定 */
  sortRows(rows, desc) {
    const yearNum = (y) => { const n = Number(y); return Number.isFinite(n) ? n : 0; };
    return (rows || []).slice().sort((a, b) => {
      const diff = (yearNum(a.year) - yearNum(b.year))
        || String(a.name || '').localeCompare(String(b.name || ''));
      return desc ? -diff : diff;
    });
  },

  toggleSort() {
    const desc = !this.data.desc;
    // 贵金属成员是分页的，只排当前已加载的 30 条等于没排 —— 回第一页让服务端重排
    if (this.data.category === 'pm') {
      this.setData({ desc, rows: [], page: 0, pages: 0, loading: true });
      this.loadPm(1, false);
      return;
    }
    this.setData({ desc: desc, rows: this.sortRows(this.data.rows, desc) });
  },

  toggleOwn() {
    this.setData({ onlyOwn: !this.data.onlyOwn });
  },

  /** 点品种进独立详情：coin/note 用 id，pm 用 code */
  goDetail(e) {
    const ds = e.currentTarget.dataset;
    if (this.data.category === 'pm') {
      if (ds.code) wx.navigateTo({ url: '/pages/pmdetail/pmdetail?code=' + encodeURIComponent(ds.code) });
    } else if (ds.id) {
      wx.navigateTo({ url: '/pages/detail/detail?id=' + ds.id });
    }
  },

  onReachBottom() {
    if (this.data.category !== 'pm' || this.data.loadingMore) return;
    if (this.data.page < this.data.pages) {
      this.setData({ loadingMore: true });
      this.build(this.data.page + 1, true).then(() => this.setData({ loadingMore: false }));
    }
  },

  onPullDownRefresh() {
    this.reload().then(() => wx.stopPullDownRefresh());
  },

  imgErr(e) {
    const id = e.currentTarget.dataset.id;
    const code = e.currentTarget.dataset.code;
    const rows = this.data.rows.map((r) => {
      if ((id != null && r.id === id) || (code && r.code === code)) {
        return Object.assign({}, r, { imgFail: true });
      }
      return r;
    });
    this.setData({ rows: rows });
  },

  goBack() {
    wx.navigateBack();
  },

  onShareAppMessage() {
    const s = this.data.series || {};
    const nm = s.name || this.data.name || '系列';
    const query = 'category=' + this.data.category
      + '&code=' + encodeURIComponent(this.data.code)
      + '&name=' + encodeURIComponent(nm);
    return {
      title: '藏币录 · ' + nm + '（' + (s.count || 0) + ' 个品种）',
      path: '/pages/series-detail/series-detail?' + query,
      imageUrl: s.img || share.COVER,
    };
  },

  onShareTimeline() {
    const s = this.data.series || {};
    const nm = s.name || this.data.name || '系列';
    const query = 'category=' + this.data.category
      + '&code=' + encodeURIComponent(this.data.code)
      + '&name=' + encodeURIComponent(nm);
    return {
      title: '藏币录 · ' + nm,
      query: query,
      imageUrl: s.img || share.COVER,
    };
  },
});
