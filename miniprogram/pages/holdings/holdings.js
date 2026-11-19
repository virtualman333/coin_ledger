const cat = require('../../utils/catalog');
const store = require('../../utils/store');
const share = require('../../utils/share');

Page({
  data: {
    allOpen: true,
    sheet: null,
    loggedIn: false,
    userName: '',
    syncTip: '',
    version: '',
    summary: { kinds: 0, rolls: 0, marketText: '0' },
    stats: {
      faceText: '0',
      costText: '0',
      marketText: '0',
      profitText: '0',
      up: true,
      rolls: 0,
      kinds: 0,
    },
    groups: [],
    empty: true,
    swipeId: '',        // 左滑展开操作的那张卡片（持仓 id）
  },

  onShow() {
    this.render();
    store.refresh().then(() => this.render()).catch((err) => {
      this.setData({ syncTip: err.message || '同步失败' });
    });
  },

  onPullDownRefresh() {
    store.refresh().then(() => {
      this.render();
      wx.stopPullDownRefresh();
    }).catch(() => wx.stopPullDownRefresh());
  },

  render() {
    const state = store.getState();
    const st = store.stats();
    const groups = [];
    const map = {};
    state.holdings.forEach((h) => {
      const coin = cat.byName[h.name];
      // 分组跟「系列」走（系列主数据里的名字），而不是品种上的历史 group 字段
      const seriesCode = (coin && coin.series) || '';
      const groupName = (coin && coin.seriesName) || h.group || '独立藏品';
      if (!map[groupName]) {
        map[groupName] = { name: groupName, code: seriesCode, items: [], sumText: 0 };
        groups.push(map[groupName]);
      }
      const rolls = Number(h.rolls) || 0;
      // 账本按「物理几卷几套」算，别用展示口径的预约限额
      const size = coin ? (coin.setSizeBase || coin.setSize) : 20;
      const isPiece = h.unit === 'piece';             // 用户选的是「按单枚/单张」记
      const qty = isPiece ? rolls : rolls * size;     // 件数：枚 / 张
      const pnl = cat.round2((Number(h.market) || 0) - (Number(h.cost) || 0));
      // AI 推理价：单枚理论价 × 这件持仓的件数，和市值对比看溢价/低估
      const aiUnit = coin ? cat.aiPriceOf(coin) : 0;
      const aiTotal = cat.round2(aiUnit * qty);
      const marketNum = Number(h.market) || 0;
      const aiGap = aiTotal > 0 ? (marketNum - aiTotal) / aiTotal : 0;
      map[groupName].items.push({
        id: h.id,
        coinId: coin ? coin.id : 0,
        name: h.name,
        year: coin ? coin.year : '',
        imgUrl: coin ? (coin.smallUrl || coin.thumbUrl || coin.imgUrl) : '',
        rolls,
        qty,
        qtyLabel: qty + ' ' + (coin && coin.kind === 'note' ? '张' : '枚'),
        badgeLabel: isPiece ? (rolls + (coin && coin.kind === 'note' ? ' 张' : ' 枚')) : (rolls + ' 套'),
        faceText: cat.money((coin ? (coin.setFaceBase || coin.setFace) : 0) * rolls),
        costText: cat.money(h.cost),
        marketText: cat.money(h.market),
        unitCostText: cat.money(Math.round((Number(h.cost) || 0) / (rolls || 1))),
        unitWord: isPiece ? (coin && coin.kind === 'note' ? '张' : '枚') : '套',
        pnlPct: (Number(h.cost) || 0) > 0
          ? cat.round2((pnl / Number(h.cost)) * 100)
          : null,
        profit: pnl,
        pnlText: (pnl >= 0 ? '+' : '-') + '¥' + cat.money(Math.abs(pnl)),
        aiText: aiTotal ? cat.money(aiTotal) : '',
        aiDiffText: !aiTotal
          ? ''
          : (Math.abs(aiGap) < 0.05
            ? '与市价相当'
            : (aiGap > 0 ? '市价高 ' + Math.round(aiGap * 100) + '%' : '市价低 ' + Math.round(-aiGap * 100) + '%')),
        pnlCls: pnl >= 0 ? 'up' : 'down',
      });
      map[groupName].sumText = cat.round2(map[groupName].sumText + (Number(h.market) || 0));
    });
    const singlesTotal = cat.coins.filter((c) => !c.set || c.set === 'single').length;
    let collapsed = {};
    try {
      (wx.getStorageSync('cl_mine_collapsed') || []).forEach((n) => { collapsed[n] = true; });
    } catch (e) { collapsed = {}; }

    groups.forEach((g) => {
      g.open = !collapsed[g.name];
      g.sumLabel = cat.money(g.sumText);
      // 分组进度：按「该系列有多少个品种」算，没系列就算独立品种
      g.total = g.code ? cat.inSeries(g.code).length : singlesTotal;
      g.own = g.items.length;
      g.pct = g.total ? Math.min(100, Math.round((g.own / g.total) * 100)) : 0;
      g.progLabel = g.own + ' / ' + g.total;
    });
    const solo = groups.filter((g) => g.name === '独立藏品');
    const rest = groups.filter((g) => g.name !== '独立藏品');

    this.setData({
      loggedIn: !!state.user,
      userName: state.user ? state.user.name : '',
      stats: {
        faceText: cat.money(st.face),
        costText: cat.money(st.cost),
        marketText: cat.money(st.market),
        profitText: cat.signed(st.profit),
        up: st.profit >= 0,
        rolls: st.rolls,
        kinds: st.kinds,
        pnlText: (st.profit >= 0 ? '+' : '-') + '¥' + cat.money(Math.abs(st.profit)),
        pnlPct: st.cost ? cat.round2((st.profit / st.cost) * 100) : 0,
      },
      summary: {
        kinds: st.kinds,
        rolls: st.rolls,
        marketText: cat.money(st.market),
      },
      groups: rest.concat(solo),
      empty: state.holdings.length === 0,
      syncTip: state.synced ? '' : (state.error || ''),
    });
  },

  /** 长按卡片 / 左滑点操作 → 底部编辑面板 */
  openSheet(e) {
    const ds = e.currentTarget.dataset;
    const gi = Number(ds.g);
    const ii = Number(ds.i);
    const group = this.data.groups[gi];
    const item = group && group.items[ii];
    if (!item) return;
    wx.vibrateShort && wx.vibrateShort({ type: 'light' });
    this.setData({
      swipeId: '',
      sheet: {
        id: item.id,
        coinId: item.coinId,
        name: item.name,
        imgUrl: item.imgUrl,
        rolls: item.rolls,
        origRolls: item.rolls,
        unitWord: item.unitWord,
        qtyLabel: item.qtyLabel,
        marketText: item.marketText,
        costText: item.costText,
        unitCost: String(Math.round((Number(item.unitCostText.replace(/,/g, '')) || 0))),
        // 左滑「改成本」直接聚焦输入框；「改数量」聚焦步进器
        focus: ds.focus || '',
      },
    });
  },

  swipeStart(e) {
    const t = e.touches && e.touches[0];
    if (!t) return;
    this._swipe = { x: t.clientX, y: t.clientY, id: e.currentTarget.dataset.hold || '' };
  },

  /** 只在水平位移明显大于垂直时判为左滑，避免和页面上下滚动打架 */
  swipeEnd(e) {
    const s = this._swipe;
    this._swipe = null;
    const t = e.changedTouches && e.changedTouches[0];
    if (!s || !t || !s.id) return;
    const dx = t.clientX - s.x;
    const dy = t.clientY - s.y;
    if (Math.abs(dx) < 40 || Math.abs(dx) < Math.abs(dy) * 1.4) return;
    this.setData({ swipeId: dx < 0 ? s.id : '' });
  },

  closeSwipe() {
    if (this.data.swipeId) this.setData({ swipeId: '' });
  },

  noop() {},

  closeSheet() {
    this.setData({ sheet: null });
  },

  sheetStep(e) {
    const sheet = this.data.sheet;
    if (!sheet) return;
    const delta = Number(e.currentTarget.dataset.delta);
    const next = Math.max(1, Math.min(99, sheet.rolls + delta));
    if (next === sheet.rolls) return;
    this.setData({ 'sheet.rolls': next });
  },

  onSheetCost(e) {
    this.setData({ 'sheet.unitCost': e.detail.value });
  },

  saveSheet() {
    const sheet = this.data.sheet;
    if (!sheet) return;
    const unit = Number(sheet.unitCost) || 0;
    const tasks = [];
    if (sheet.rolls !== sheet.origRolls) tasks.push(store.setRolls(sheet.id, sheet.rolls));
    tasks.push(store.setCost(sheet.id, unit));
    wx.showLoading({ title: '保存中', mask: true });
    Promise.all(tasks)
      .then(() => store.refresh({ force: true }))
      .then(() => {
        wx.hideLoading();
        this.setData({ sheet: null, swipeId: '' });
        this.render();
        wx.showToast({ title: '已保存', icon: 'success' });
      })
      .catch((err) => {
        wx.hideLoading();
        wx.showToast({ title: err.message || '保存失败', icon: 'none' });
      });
  },

  sheetRemove() {
    const sheet = this.data.sheet;
    if (!sheet) return;
    wx.showModal({
      title: '移出藏品',
      content: '把「' + sheet.name + '」从我的藏品里移出？',
      confirmText: '移出',
      confirmColor: '#c0392b',
      success: (res) => {
        if (!res.confirm) return;
        store.removeHolding(sheet.id).then(() => store.refresh({ force: true })).then(() => {
          this.setData({ sheet: null, swipeId: '' });
          this.render();
          wx.showToast({ title: '已移出', icon: 'success' });
        }).catch((err) => {
          wx.showToast({ title: err.message || '操作失败', icon: 'none' });
        });
      },
    });
  },

  changeRolls(e) {
    const id = e.currentTarget.dataset.id;
    const delta = Number(e.currentTarget.dataset.delta);
    if (this.pendingRolls && this.pendingRolls[id]) return;   // 同一行还在保存，先别叠请求
    const target = store.getState().holdings.filter((h) => h.id === id)[0];
    if (!target) return;
    const next = (Number(target.rolls) || 0) + delta;
    if (next < 1) {
      wx.showToast({ title: '至少保留 1 套，移出请用删除', icon: 'none' });
      return;
    }
    this.pendingRolls = this.pendingRolls || {};
    this.pendingRolls[id] = true;
    store.setRolls(id, next).then(() => store.refresh({ force: true })).then(() => {
      delete this.pendingRolls[id];
      this.render();
    }).catch((err) => {
      delete this.pendingRolls[id];
      wx.showToast({ title: err.message || '保存失败', icon: 'none' });
      this.render();
    });
  },

  removeItem(e) {
    const id = e.currentTarget.dataset.id;
    const name = e.currentTarget.dataset.name;
    wx.showModal({
      title: '移出藏品',
      content: '把「' + name + '」从我的藏品里移出？',
      confirmText: '移出',
      confirmColor: '#c0392b',
      success: (res) => {
        if (!res.confirm) return;
        store.removeHolding(id).then(() => store.refresh({ force: true })).then(() => {
          this.render();
          wx.showToast({ title: '已移出', icon: 'success' });
        }).catch((err) => {
          this.render();
          wx.showToast({ title: err.message || '操作失败', icon: 'none' });
        });
      },
    });
  },

  imgErr(e) {
    const g = Number(e.currentTarget.dataset.g);
    const i = Number(e.currentTarget.dataset.i);
    const groups = this.data.groups.slice();
    if (!groups[g] || !groups[g].items[i]) return;
    groups[g] = Object.assign({}, groups[g], {
      items: groups[g].items.map((it, idx) => (idx === i ? Object.assign({}, it, { imgFail: true }) : it)),
    });
    this.setData({ groups });
  },

  goDetail(e) {
    // 卡片处于左滑展开状态时，点一下先收起，不跳详情
    if (this.data.swipeId) { this.setData({ swipeId: '' }); return; }
    const id = e.currentTarget.dataset.id;
    if (!id) return;
    wx.navigateTo({ url: '/pages/detail/detail?id=' + id });
  },

  goAccount() {
    wx.navigateTo({ url: '/pages/account/account' });
  },

  /** 折叠/展开单个分组，状态记在本地，下次进来保持 */
  toggleGroup(e) {
    const gi = Number(e.currentTarget.dataset.gi);
    const g = this.data.groups[gi];
    if (!g) return;
    const open = !g.open;
    this.setData({ ['groups[' + gi + '].open']: open });
    this.saveCollapsed();
  },

  toggleAll() {
    const open = !this.data.allOpen;
    const patch = { allOpen: open };
    this.data.groups.forEach((g, i) => { patch['groups[' + i + '].open'] = open; });
    this.setData(patch);
    this.saveCollapsed();
  },

  saveCollapsed() {
    const names = this.data.groups.filter((g) => !g.open).map((g) => g.name);
    try { wx.setStorageSync('cl_mine_collapsed', names); } catch (e) { /* 忽略 */ }
    const allOpen = names.length === 0;
    if (allOpen !== this.data.allOpen) this.setData({ allOpen });
  },

  goList() {
    wx.switchTab({ url: '/pages/list/list' });
  },

  goBack() {
    const pages = getCurrentPages();
    if (pages.length > 1) wx.navigateBack();
    else wx.switchTab({ url: '/pages/mine/mine' });
  },

  onShareAppMessage() {
    return share.appMessage('mine');
  },

  onShareTimeline() {
    return share.timeline('mine');
  },
});
