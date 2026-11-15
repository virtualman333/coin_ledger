const cat = require('../../utils/catalog');
const store = require('../../utils/store');
const share = require('../../utils/share');

/* 发行信息：把「空行分段 + **粗体**」的轻量标记转成 rich-text 的 nodes 数组。
   用 nodes 而不是 HTML 字符串 —— 结构由我们这段代码生成，文本原样作为纯文本节点，
   不存在把外部 HTML 塞进渲染管线的路径。 */
function descToNodes(md) {
  const text = String(md || '').trim();
  if (!text) return [];
  const P = 'display:block;margin:0 0 18rpx;line-height:1.9;font-size:27rpx;color:#5a5a5a;text-align:justify';
  const B = 'font-weight:600;color:#9a6b1f';
  const out = [];
  text.split(/\n{2,}/).forEach((block) => {
    const b = block.trim();
    if (!b) return;
    if (/^-\s/.test(b)) {
      b.split(/\n/).forEach((line) => {
        const t = line.replace(/^-\s*/, '').trim();
        if (t) out.push({ name: 'p', attrs: { style: P + ';padding-left:24rpx' }, children: [{ type: 'text', text: '· ' + t }] });
      });
      return;
    }
    const children = [];
    b.split(/(\*\*[^*]+\*\*)/).forEach((part) => {
      if (!part) return;
      if (/^\*\*[^*]+\*\*$/.test(part)) {
        children.push({ type: 'text', text: part.slice(2, -2), attrs: { style: B } });
      } else {
        children.push({ type: 'text', text: part });
      }
    });
    out.push({ name: 'p', attrs: { style: P }, children });
  });
  return out;
}

Page({
  data: {
    id: 0,
    coin: null,
    facts: [],
    priceRows: [],
    aiPrice: '',
    aiDiffText: '',
    same: [],
    peek: null,
    owned: false,
    holding: null,
    loggedIn: false,
    setInfo: null,
    gal: [],
    mainUrl: '',
    mainLabel: '',
    mainIdx: 0,
    descSrc: '',
    busy: false,
    notFound: false,
    imgFail: false,
  },

  onLoad(query) {
    this.coinId = Number(query.id) || 0;
    this.render();
  },

  onShow() {
    this.render();
  },

  render() {
    const coin = cat.byId[this.coinId];
    if (!coin) {
      this.setData({ notFound: true, coin: null });
      return;
    }
    const state = store.getState();
    const holding = store.findHolding(coin.name);
    const unitNow = cat.round2(store.priceOf(coin));
    const same = cat.coins
      .filter((c) => c.series === coin.series && c.id !== coin.id)
      .slice(0, 8)
      .map((c) => ({ id: c.id, name: c.short || c.name, year: c.year }));

    // 所属套系的收集进度（成套系列才有）
    let setInfo = null;
    const meta = coin.set && coin.set !== 'single' ? cat.sets[coin.set] : null;
    if (meta) {
      const members = cat.coins.filter((c) => c.set === coin.set);
      const own = members.filter((c) => store.findHolding(c.name)).length;
      setInfo = { name: meta.name, total: meta.total, owned: own };
    }

    const gal = (coin.imgs && coin.imgs.length)
      ? coin.imgs.map((g) => Object.assign({}, g, {
        // 缩略条用小图，点开大图仍走原图
        small: g.url === coin.imgUrl && coin.smallUrl ? coin.smallUrl : g.url,
      }))
      : (coin.imgUrl ? [{ url: coin.imgUrl, small: coin.smallUrl || coin.imgUrl, kind: 'main', label: '主图' }] : []);

    this.setData({
      id: coin.id,
      coin,
      gal,
      mainUrl: gal.length ? gal[0].url : '',
      mainLabel: gal.length ? gal[0].label : '',
      mainIdx: 0,
      setInfo,
      notFound: false,
      // 厚度/重量/铸造单位/边齿 来自实物参数补充，缺的就不占位
      facts: [
        { k: '面额', v: coin.faceText },
        { k: '材质', v: coin.material || '—' },
        { k: coin.diaLabel || '直径', v: coin.diaText || '—' },
        { k: '发行量', v: coin.mintageText },
      ]
        .concat(coin.thickness ? [{ k: coin.specFrom ? '厚度*' : '厚度', v: coin.thickness }] : [])
        .concat(coin.weight ? [{ k: coin.specFrom ? '重量*' : '重量', v: coin.weight }] : [])
        .concat(coin.caster ? [{ k: '铸造单位', v: coin.caster, wide: true }] : [])
        .concat(coin.edge ? [{ k: '边齿', v: coin.edge, wide: true }] : [])
        .concat([
          { k: '系列', v: coin.seriesName },
          { k: '类型', v: coin.kind === 'note' ? '纪念钞' : '纪念币' },
        ])
        .concat(coin.setSize > 1
          ? [{ k: '一套面值', v: cat.money(coin.setFace) + ' 元 · ' + coin.setSize + (coin.kind === 'note' ? ' 张' : ' 枚') }]
          : []),
      specNote: coin.specFrom ? '* 该品种央行公告未公布厚度与重量，这里按同系列同规格推定' : '',
      // 3D 展示：需要正、反两张干净图
      // AI 推理价（只用发行量/材质/年代/面值算，不含题材溢价）
      aiPrice: cat.money(cat.aiPriceOf(coin)),
      aiDiffText: (function () {
        const ai = cat.aiPriceOf(coin);
        if (!ai || !unitNow) return '';
        const d = (unitNow - ai) / ai;
        if (Math.abs(d) < 0.05) return '与参考价基本一致';
        return d > 0
          ? '参考价高 ' + Math.round(d * 100) + '%'
          : '参考价低 ' + Math.round(-d * 100) + '%';
      })(),
      // 价格不再占一整块：单枚价放标题右侧，一套相关收进 facts
      unitPrice: cat.money(unitNow),
      unitLabel: coin.kind === 'note' ? '张' : '枚',
      setPrice: coin.setSize > 1 ? cat.money(store.setPriceOf(coin)) : '',
      setSizeText: coin.setSize + (coin.kind === 'note' ? ' 张' : ' 枚'),
      priceRows: [
        { k: '单' + (coin.kind === 'note' ? '张' : '枚') + '参考价', v: cat.money(unitNow) },
        { k: '一套面值', v: cat.money(coin.setFace) },
        { k: '一套参考价（' + coin.setSize + ' ' + (coin.kind === 'note' ? '张' : '枚') + '）', v: cat.money(store.setPriceOf(coin)) },
      ],
      owned: !!holding,
      holding: holding || null,
      same,
      loggedIn: !!state.user,
      descSrc: coin.descSrc || '',
      descNodes: descToNodes(coin.descMd || coin.desc),
      obverse: coin.obverse || '',
      reverse: coin.reverse || '',
    });
  },

  addCoin() {
    if (this.data.busy) return;
    const coin = cat.byId[this.coinId];
    if (!coin) return;
    if (!store.isLogin()) {
      wx.showModal({
        title: '还没登录',
        content: '登录后藏品会存到你的账号里，和网页版同步。',
        confirmText: '去登录',
        success: (res) => {
          if (res.confirm) wx.navigateTo({ url: '/pages/account/account' });
        },
      });
      return;
    }
    const size = cat.setSizeOf(coin);
    const u = coin.kind === 'note' ? '张' : '枚';

    // 第二步：问数量（默认 1，可直接改成任意 1–9999）
    const askQty = (unit) => {
      if (typeof wx.showModal !== 'function') { this.doAdd(coin, unit, 1); return; }
      wx.showModal({
        title: '加入几' + (unit === 'piece' ? u : (size > 1 ? '套' : u)) + '？',
        content: '1',
        editable: true,
        placeholderText: '数量（1–9999）',
        confirmText: '加入',
        success: (r) => {
          if (!r.confirm) return;
          let n = Math.floor(Number(String((r.content || '')).trim()) || 1);
          n = Math.max(1, Math.min(9999, n));
          this.doAdd(coin, unit, n);
        },
      });
    };

    // 第一步：多枚一套的品种先选记法
    if (size > 1 && typeof wx.showActionSheet === 'function') {
      wx.showActionSheet({
        itemList: ['按套记（1 套 = ' + size + ' ' + u + '）', '按单' + u + '记'],
        success: (r) => askQty(r.tapIndex === 0 ? 'set' : 'piece'),
      });
      return;
    }
    askQty('set');
  },

  doAdd(coin, unit, qty) {
    this.setData({ busy: true });
    let task;
    try {
      task = store.addCoin(coin, unit, qty || 1);
    } catch (err) {
      this.setData({ busy: false });
      wx.showToast({ title: err.message, icon: 'none' });
      return;
    }
    wx.showLoading({ title: '保存中', mask: true });
    task.then(() => store.refresh({ force: true })).then(() => {
      wx.hideLoading();
      this.setData({ busy: false });
      this.render();
      wx.showToast({ title: '已加入我的藏品', icon: 'success' });
    }).catch((err) => {
      wx.hideLoading();
      this.setData({ busy: false });
      this.render();
      wx.showToast({ title: err.message || '保存失败', icon: 'none' });
    });
  },

  removeCoin() {
    const holding = this.data.holding;
    if (!holding) return;
    wx.showModal({
      title: '移出藏品',
      content: '把「' + holding.name + '」从我的藏品里移出？',
      confirmText: '移出',
      confirmColor: '#c0392b',
      success: (res) => {
        if (!res.confirm) return;
        wx.showLoading({ title: '处理中', mask: true });
        store.removeHolding(holding.id).then(() => store.refresh({ force: true })).then(() => {
          wx.hideLoading();
          this.render();
          wx.showToast({ title: '已移出', icon: 'success' });
        }).catch((err) => {
          wx.hideLoading();
          this.render();
          wx.showToast({ title: err.message || '操作失败', icon: 'none' });
        });
      },
    });
  },

  /** 切图：点缩略图换主图 */
  /** 纠错反馈：未登录先去登录 */
  goFeedback() {
    const coin = this.data.coin;
    if (!coin) return;
    if (!this.data.owned && !store.getState().user) {
      wx.showModal({
        title: '需要先登录',
        content: '登录后才能提交反馈，方便我们跟进。',
        confirmText: '去登录',
        success: (r) => { if (r.confirm) wx.navigateTo({ url: '/pages/account/account' }); },
      });
      return;
    }
    wx.navigateTo({ url: '/pages/feedback/feedback?id=' + coin.id });
  },

  pickImg(e) {
    const i = Number(e.currentTarget.dataset.i) || 0;
    const g = this.data.gal[i];
    if (!g) return;
    this.setData({ mainUrl: g.url, mainLabel: g.label, mainIdx: i, imgFail: false });
  },

  /** 左右滑动切换主图 */
  onSwiper(e) {
    const i = Number(e.detail.current) || 0;
    const g = this.data.gal[i];
    if (!g) return;
    // 只同步当前下标与标签，url 由 swiper 自己的 item 负责显示
    this.setData({ mainIdx: i, mainUrl: g.url, mainLabel: g.label, imgFail: false });
  },

  /** 点主图看大图：走微信原生预览，可双指放大、左右滑、长按保存 */
  previewImg() {
    const gal = this.data.gal;
    if (!gal.length) return;
    wx.previewImage({
      current: this.data.mainUrl,
      urls: gal.map((g) => g.url),
    });
  },

  imgErr() {
    this.setData({ imgFail: true });
  },

  /** 同系列：先弹简介，不直接跳详情 */
  peekCoin(e) {
    const id = Number(e.currentTarget.dataset.id);
    const c = cat.coins.filter((x) => x.id === id)[0];
    if (!c) return;
    const isNote = c.kind === 'note';
    this.setData({
      peek: {
        id: c.id,
        name: c.name,
        year: c.year,
        face: c.face,
        mintageText: c.mintage ? cat.fmtMintage(c.mintage) : '',
        unit: isNote ? '张' : '枚',
        desc: c.desc || '',
        imgUrl: c.imgUrl || c.smallUrl || '',
      },
    });
  },

  closePeek() {
    this.setData({ peek: null });
  },

  /** 弹窗里点「查看详情」才真正切换品种（redirectTo：同层替换，避免页面栈堆积） */
  goPeek() {
    const p = this.data.peek;
    if (!p) return;
    this.setData({ peek: null });
    wx.redirectTo({ url: '/pages/detail/detail?id=' + p.id });
  },

  noop() {},

  goCoin(e) {
    wx.redirectTo({ url: '/pages/detail/detail?id=' + e.currentTarget.dataset.id });
  },

  onShareAppMessage() {
    return share.coinMessage(this.data.coin);
  },

  onShareTimeline() {
    return share.coinTimeline(this.data.coin);
  },
});
