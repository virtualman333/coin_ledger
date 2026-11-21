const cat = require('../../utils/catalog');
const { ensureAdmin } = require('../../utils/admin-guard');

/**
 * 资料库：按「大品类 → 系列 → 单枚」逐层浏览，而不是把参数/图片/系列拆成三个平铺入口。
 * 数据全部来自本地 catalog，秒开，不依赖接口。
 * 到单枚这一层再分流到「参数」「图片」两个编辑页（带 kw 直接定位到这一枚）。
 */
Page({
  data: {
    level: 0,          // 0 品类 / 1 系列 / 2 品种
    catKey: '',
    catName: '',
    title: '',
    cats: [],
    series: [],
    coins: [],
  },

  onLoad(q) {
    if (!ensureAdmin()) return;
    this.loadCats();
    // 支持深链：?cat=coin&series=SX1 直接落到品种层
    const c = String((q && q.cat) || '');
    if (c === 'coin' || c === 'note') {
      this.openCatByKey(c);
      const s = String((q && q.series) || '');
      if (s) this.openSeriesByKey(s);
    }
  },

  /** 三个大品类：普通纪念币 / 纪念钞 / 贵金属（贵金属不在本地目录，跳全量库） */
  loadCats() {
    const all = cat.coins || [];
    const shape = (key, name, icon, list) => {
      const set = {};
      list.forEach((x) => { if (x.series) set[x.series] = 1; });
      return { key, name, icon, count: list.length, seriesCount: Object.keys(set).length };
    };
    this.setData({
      cats: [
        shape('coin', '普通纪念币', '◉', all.filter((x) => x.kind !== 'note')),
        shape('note', '纪念钞', '▤', all.filter((x) => x.kind === 'note')),
        { key: 'pm', name: '贵金属纪念币', icon: '✦', count: 0, seriesCount: 0, pm: true },
      ],
    });
  },

  coinsOfCat(key) {
    return (cat.coins || []).filter((x) => (key === 'note' ? x.kind === 'note' : x.kind !== 'note'));
  },

  openCat(e) {
    this.openCatByKey(String(e.currentTarget.dataset.key || ''));
  },

  openCatByKey(key) {
    if (key === 'pm') {
      wx.navigateTo({ url: '/pages/admin-pm/admin-pm' });
      return;
    }
    if (key !== 'coin' && key !== 'note') return;

    const map = {};
    this.coinsOfCat(key).forEach((x) => {
      const k = x.series || '_';
      if (!map[k]) map[k] = { key: k, name: x.seriesName || '未归类', count: 0, years: [] };
      map[k].count += 1;
      const y = Number(x.year) || 0;
      if (y) map[k].years.push(y);
    });

    const series = Object.keys(map).map((k) => {
      const g = map[k];
      const ys = g.years.filter(Boolean);
      return {
        key: g.key,
        name: g.name,
        count: g.count,
        yearFrom: ys.length ? Math.min.apply(null, ys) : '',
        yearTo: ys.length ? Math.max.apply(null, ys) : '',
      };
    }).sort((a, b) => String(a.name).localeCompare(String(b.name), 'zh'));

    const catName = key === 'note' ? '纪念钞' : '普通纪念币';
    this.setData({ level: 1, catKey: key, catName, title: catName, series });
  },

  openSeries(e) {
    this.openSeriesByKey(String(e.currentTarget.dataset.key || ''));
  },

  openSeriesByKey(key) {
    const catKey = this.data.catKey;
    const g = this.data.series.filter((x) => x.key === key)[0];
    const list = this.coinsOfCat(catKey)
      .filter((x) => (x.series || '_') === key)
      .sort((a, b) => (Number(b.year) || 0) - (Number(a.year) || 0));

    this.setData({
      level: 2,
      title: g ? g.name : key,
      coins: list.map((x) => ({
        id: x.id,
        name: x.name,
        year: x.year || '',
        img: x.smallUrl || x.thumbUrl || x.imgUrl || '',
        initial: String(x.name || '藏').charAt(0),
        faceText: x.faceText || '',
      })),
    });
    wx.setNavigationBarTitle({ title: g ? g.name : '系列' });
  },

  goRoot() {
    this.setData({ level: 0, catKey: '', title: '' });
    wx.setNavigationBarTitle({ title: '资料库' });
  },

  goSeriesList() {
    this.setData({ level: 1, title: this.data.catName });
    wx.setNavigationBarTitle({ title: this.data.catName });
  },

  /** 单枚上的两个动作：改参数 / 换图片，都带着名字直达那一枚 */
  openEdit(e) {
    const ds = e.currentTarget.dataset;
    const kw = encodeURIComponent(ds.name || '');
    if (ds.act === 'params') {
      wx.navigateTo({ url: '/pages/admin-params/admin-params?kw=' + kw });
      return;
    }
    wx.navigateTo({ url: '/pages/admin-images/admin-images?kw=' + kw });
  },

  onPullDownRefresh() {
    this.loadCats();
    wx.stopPullDownRefresh();
  },
});
