const cat = require('../../utils/catalog');
const store = require('../../utils/store');
const appconfig = require('../../utils/appconfig');
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
    aiPrice: '',
    formulaOpen: false,
    same: [],
    peek: null,
    owned: false,
    holding: null,
    loggedIn: false,
    maintenance: false,
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

  /** 推理价计算方式：默认收起，点问号展开/收起 */
  toggleFormula() {
    this.setData({ formulaOpen: !this.data.formulaOpen });
  },

  onLoad(query) {
    this.coinId = Number(query.id) || 0;
    this.render();
  },

  onShow() {
    this.render();
    appconfig.refresh().then(() => this.render()).catch(() => {});
  },

  render() {
    const coin = cat.byId[this.coinId];
    if (!coin) {
      this.setData({ notFound: true, coin: null });
      return;
    }
    const state = store.getState();
    const holding = store.findHolding(coin.name);
    // 同系列做成卡片：带缩略图、年份面额和「已收」标记，比纯文字胶囊好扫读
    const ownedMap = store.ownedNames();
    const same = cat.coins
      .filter((c) => c.series === coin.series && c.id !== coin.id)
      .slice(0, 12)
      .map((c) => ({
        id: c.id,
        name: c.short || c.name,
        year: c.year,
        imgUrl: c.smallUrl || c.thumbUrl || c.imgUrl || '',
        faceText: c.face ? (Number(c.face) + ' 元') : '',
        owned: !!ownedMap[c.name],
      }));

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
      maintenance: appconfig.isMaintenance(),
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
      // 推理价（只用发行量/材质/年代/面值算，不含题材溢价）；参考价不再展示
      aiPrice: cat.money(cat.aiPriceOf(coin)),
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
    if (appconfig.isMaintenance()) { wx.showToast({ title: '账本功能调整中', icon: 'none' }); return; }
    const coin = cat.byId[this.coinId];
    if (!coin) return;
    if (!store.isLogin()) {
      wx.showModal({
        title: '还没登录',
        content: '登录后收藏会存到你的账号里，和网页版同步。',
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
      wx.showToast({ title: '已加入我的收藏', icon: 'success' });
    }).catch((err) => {
      wx.hideLoading();
      this.setData({ busy: false });
      this.render();
      wx.showToast({ title: err.message || '保存失败', icon: 'none' });
    });
  },

  removeCoin() {
    if (appconfig.isMaintenance()) { wx.showToast({ title: '账本功能调整中', icon: 'none' }); return; }
    const holding = this.data.holding;
    if (!holding) return;
    wx.showModal({
      title: '移出收藏',
      content: '把「' + holding.name + '」从我的收藏里移出？',
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

  /** 弹窗里点「查看详情」新开详情页（navigateTo 保留返回栈，可逐层退回上一枚） */
  goPeek() {
    const p = this.data.peek;
    if (!p) return;
    this.setData({ peek: null });
    wx.navigateTo({ url: '/pages/detail/detail?id=' + p.id });
  },

  noop() {},

  goCoin(e) {
    wx.navigateTo({ url: '/pages/detail/detail?id=' + e.currentTarget.dataset.id });
  },

  onShareAppMessage() {
    return share.coinMessage(this.data.coin);
  },

  onShareTimeline() {
    return share.coinTimeline(this.data.coin);
  },
});
