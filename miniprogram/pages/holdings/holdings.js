const cat = require('../../utils/catalog');
const api = require('../../utils/api');
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
    summary: { kinds: 0, rolls: 0, faceText: '0', aiText: '0', costText: '0' },
    stats: {
      faceText: '0',
      aiText: '0',
      costText: '0',
      rolls: 0,
      kinds: 0,
    },
    groups: [],
    holdCat: 'all',
    holdCats: [
      { code: 'all', name: '全部' }, { code: 'coin', name: '普通币' },
      { code: 'note', name: '纪念钞' }, { code: 'pm', name: '贵金属' },
    ],
    empty: true,
    swipeId: '',        // 左滑展开操作的那张卡片（持仓 id）
    shareCode: '',      // 收藏快照分享码（进页面时预生成）
    selectMode: false,  // 多选分享模式：点卡片改为勾选
    selected: {},       // 持仓 id -> true
    selectedCount: 0,
  },

  onLoad(q) {
    // 朋友圈分享打开的是当前页，带 code 时转到只读快照页，别让人看到自己的空账本
    const code = String((q && q.code) || '').slice(0, 32);
    if (code) {
      wx.redirectTo({ url: '/pages/colshare/colshare?code=' + encodeURIComponent(code) });
      return;
    }
  },

  onShow() {
    this.render();
    this.prepareShare();
    store.refresh().then(() => {
      this.render();
      this.prepareShare();
    }).catch((err) => {
      this.setData({ syncTip: err.message || '同步失败' });
    });
  },

  /** 预生成只读快照：分享回调是同步的，必须提前拿到分享码 */
  prepareShare() {
    if (!store.isLogin()) return;
    const hs = store.getState().holdings || [];
    if (!hs.length) return;
    const sig = hs.map((h) => [h.id, h.rolls, h.unit, h.category, h.name].join(':')).join('|');
    if (this.data.shareCode && sig === this._shareSig) return;
    if (this._shareBusy) return;
    this._shareSig = sig;
    this._shareBusy = true;

    const items = hs.map((h) => {
      const c = cat.byName[h.name];
      const size = c ? (c.setSizeBase || c.setSize) : 20;
      const rolls = Number(h.rolls) || 0;
      const qty = h.unit === 'piece' ? rolls : rolls * size;
      let imgUrl = '';
      if (h.category === 'pm' && h.thumb) {
        imgUrl = String(h.thumb).indexOf('http') === 0 ? h.thumb : api.BASE + h.thumb;
      } else if (c) {
        imgUrl = c.smallUrl || c.thumbUrl || c.imgUrl || '';
      }
      return {
        name: h.name,
        year: c ? c.year : 0,
        category: h.category === 'pm' ? 'pm' : ((c && c.kind === 'note') ? 'note' : 'coin'),
        qty,
        qtyLabel: qty + ' ' + ((c && c.kind === 'note') ? '张' : '枚'),
        seriesName: (c && c.seriesName) || h.group || '',
        imgUrl,
      };
    });

    return api.post('/api/colshare', { items }).then((r) => {
      this._shareBusy = false;
      if (r && r.ok && r.code) this.setData({ shareCode: r.code });
    }).catch(() => { this._shareBusy = false; });
  },

  switchCat(e) {
    this.setData({ holdCat: e.currentTarget.dataset.cat }, () => this.render());
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
    const allH = store.state.holdings || [];
    const hs = allH.filter((h) => {
      if (this.data.holdCat === 'all') return true;
      if (this.data.holdCat === 'pm') return h.category === 'pm';
      if (h.category === 'pm') return false;
      const c = cat.byName[h.name];
      return this.data.holdCat === 'note' ? (c && c.kind === 'note') : !(c && c.kind === 'note');
    });
    const groups = [];
    const map = {};
    hs.forEach((h) => {
      const coin = cat.byName[h.name];
      // 分组跟「系列」走（系列主数据里的名字），而不是品种上的历史 group 字段
      const seriesCode = (coin && coin.series) || '';
      const groupName = (coin && coin.seriesName) || h.group || '独立藏品';
      if (!map[groupName]) {
        map[groupName] = { name: groupName, code: seriesCode, items: [], aiSum: 0 };
        groups.push(map[groupName]);
      }
      const rolls = Number(h.rolls) || 0;
      // 账本按「物理几卷几套」算，别用展示口径的预约限额
      const size = coin ? (coin.setSizeBase || coin.setSize) : 20;
      const isPiece = h.unit === 'piece';             // 用户选的是「按单枚/单张」记
      const qty = isPiece ? rolls : rolls * size;     // 件数：枚 / 张
      // 推理价：单枚理论价 × 这件持仓的件数
      const aiUnit = coin ? cat.aiPriceOf(coin) : 0;
      const aiTotal = cat.round2(aiUnit * qty);
      map[groupName].items.push({
        id: h.id,
        coinId: coin ? coin.id : 0,
        isPm: h.category === 'pm',
        pmCode: h.category === 'pm' ? h.id : '',
        imgUrl: (h.category === 'pm' && h.thumb) ? (String(h.thumb).indexOf('http') === 0 ? h.thumb : api.BASE + h.thumb) : (coin ? (coin.smallUrl || coin.thumbUrl || coin.imgUrl) : ''),
        name: h.name,
        year: coin ? coin.year : '',
        rolls,
        qty,
        qtyLabel: qty + ' ' + (coin && coin.kind === 'note' ? '张' : '枚'),
        badgeLabel: isPiece ? (rolls + (coin && coin.kind === 'note' ? ' 张' : ' 枚')) : (rolls + ' 套'),
        faceText: cat.money((coin ? (coin.setFaceBase || coin.setFace) : 0) * rolls),
        costText: cat.money(h.cost),
        unitCostText: cat.money(Math.round((Number(h.cost) || 0) / (rolls || 1))),
        unitWord: isPiece ? (coin && coin.kind === 'note' ? '张' : '枚') : '套',
        aiText: aiTotal ? cat.money(aiTotal) : '',
        // 藏品增强字段
        isNote: !!(coin && coin.kind === 'note') || h.category === 'note',
        serials: Array.isArray(h.serials) ? h.serials : [],
        form: h.form || '',
        images: Array.isArray(h.images) ? h.images : [],
        luckyTags: [],
      });
      map[groupName].aiSum = cat.round2(map[groupName].aiSum + aiTotal);
    });
    const singlesTotal = cat.coins.filter((c) => !c.set || c.set === 'single').length;
    let collapsed = {};
    try {
      (wx.getStorageSync('cl_mine_collapsed') || []).forEach((n) => { collapsed[n] = true; });
    } catch (e) { collapsed = {}; }

    groups.forEach((g) => {
      g.open = !collapsed[g.name];
      g.aiText = cat.money(g.aiSum);
      // 分组进度：按「该系列有多少个品种」算，没系列就算独立品种
      g.total = g.code ? cat.inSeries(g.code).length : singlesTotal;
      g.own = g.items.length;
      g.pct = g.total ? Math.min(100, Math.round((g.own / g.total) * 100)) : 0;
      g.progLabel = g.own + ' / ' + g.total;
    });
    const solo = groups.filter((g) => g.name === '独立藏品');
    const rest = groups.filter((g) => g.name !== '独立藏品');
    // 推理价合计（全账本口径，和分组金额一致）
    const aiAllSum = allH.reduce((sum, h) => {
      const c = cat.byName[h.name];
      if (!c) return sum;
      const r = Number(h.rolls) || 0;
      const baseSize = c.setSizeBase || c.setSize || 20;
      const q = h.unit === 'piece' ? r : r * baseSize;
      return sum + cat.aiPriceOf(c) * q;
    }, 0);
    const aiAllText = cat.money(cat.round2(aiAllSum));

    this.setData({
      loggedIn: !!state.user,
      userName: state.user ? state.user.name : '',
      stats: {
        faceText: cat.money(st.face),
        aiText: aiAllText,
        costText: cat.money(st.cost),
        rolls: st.rolls,
        kinds: st.kinds,
      },
      summary: {
        kinds: st.kinds,
        rolls: st.rolls,
        faceText: cat.money(st.face),
        aiText: aiAllText,
        costText: cat.money(st.cost),
      },
      groups: rest.concat(solo),
      empty: state.holdings.length === 0,
      syncTip: state.synced ? '' : (state.error || ''),
    });
  },

  /** 长按卡片 / 左滑点操作 → 底部编辑面板；多选模式下长按 = 勾选 */
  openSheet(e) {
    if (this.data.selectMode) { this.toggleSelect(e); return; }
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
        aiText: item.aiText,
        costText: item.costText,
        unitCost: String(Math.round((Number(item.unitCostText.replace(/,/g, '')) || 0))),
        // 藏品增强：号码 / 形态 / 图片
        isNote: !!(item.isNote),
        serialsText: (item.serials || []).join('\n'),
        luckyTags: item.luckyTags || [],
        form: item.form || '',
        images: item.images || [],
        // 左滑「改成本」直接聚焦输入框；「改数量」聚焦步进器
        focus: ds.focus || '',
      },
    });
    // 纪念钞有号码时请求服务端分析花样（后端与 Web 共用同一套规则）
    if (item.isNote && item.serials && item.serials.length) {
      api.post('/api/serial/analyze-batch', { nos: item.serials }).then((r) => {
        if (!r || !r.ok || !this.data.sheet) return;
        const tags = {};
        (r.items || []).forEach((it) => (it.tags || []).forEach((t) => { tags[t.name] = t.rarity || 1; }));
        const arr = Object.keys(tags).sort((a, b) => tags[b] - tags[a]).map((n) => ({ name: n, rarity: tags[n] }));
        this.setData({ 'sheet.luckyTags': arr });
      }).catch(() => {});
    }
  },

  onSheetSerials(e) {
    this.setData({ 'sheet.serialsText': e.detail.value });
  },

  setForm(e) {
    const form = e.currentTarget.dataset.form || '';
    this.setData({ 'sheet.form': form });
  },

  addImage() {
    const sheet = this.data.sheet;
    if (!sheet) return;
    if ((sheet.images || []).length >= 3) {
      wx.showToast({ title: '最多 3 张图片', icon: 'none' });
      return;
    }
    wx.chooseMedia({
      count: 1, mediaType: ['image'], sizeType: ['compressed'], sourceType: ['album', 'camera'],
      success: (res) => {
        const file = res.tempFiles && res.tempFiles[0];
        if (!file) return;
        if (file.size > 2 * 1024 * 1024) { wx.showToast({ title: '图片不能超过 2MB', icon: 'none' }); return; }
        wx.showLoading({ title: '上传中', mask: true });
        wx.getFileSystemManager().readFile({
          filePath: file.tempFilePath, encoding: 'base64',
          success: (fr) => {
            store.uploadImage('data:image/jpeg;base64,' + fr.data).then((r) => {
              wx.hideLoading();
              if (!r || !r.ok) throw new Error((r && r.error) || '上传失败');
              const images = (this.data.sheet.images || []).concat([r.path]);
              this.setData({ 'sheet.images': images });
            }).catch((err) => { wx.hideLoading(); wx.showToast({ title: err.message || '上传失败', icon: 'none' }); });
          },
          fail: () => { wx.hideLoading(); wx.showToast({ title: '读取图片失败', icon: 'none' }); },
        });
      },
    });
  },

  delImage(e) {
    const idx = Number(e.currentTarget.dataset.idx);
    const images = (this.data.sheet.images || []).slice();
    images.splice(idx, 1);
    this.setData({ 'sheet.images': images });
  },

  shareToPlaza() {
    const sheet = this.data.sheet;
    if (!sheet) return;
    const serials = (sheet.serialsText || '').split(/[\n,，\s]+/).filter(Boolean).slice(0, 200);
    wx.showModal({
      title: '分享到藏品广场',
      content: '把「' + sheet.name + '」' + (serials.length ? '（' + serials.length + ' 个号码）' : '') + ' 分享到广场？',
      success: (res) => {
        if (!res.confirm) return;
        api.post('/api/shares', {
          holdingName: sheet.name, serials, images: sheet.images || [], form: sheet.form || '', caption: '',
        }).then((r) => {
          if (!r || !r.ok) throw new Error((r && r.error) || '分享失败');
          wx.showToast({ title: '已分享', icon: 'success' });
        }).catch((err) => wx.showToast({ title: err.message || '分享失败', icon: 'none' }));
      },
    });
  },

  /* ---------------- 多选分享（长按进入，勾选后一次分享多件） ---------------- */
  toggleSelectMode() {
    if (!store.isLogin()) { wx.showToast({ title: '请先登录', icon: 'none' }); return; }
    if (this.data.selectMode) { this.exitSelectMode(); return; }
    this.setData({ selectMode: true, selected: {}, selectedCount: 0, swipeId: '', sheet: null });
  },

  exitSelectMode() {
    this.setData({ selectMode: false, selected: {}, selectedCount: 0 });
  },

  /** 多选模式下点卡片 = 勾选；普通模式仍进详情（见 goDetail / openSheet 分流） */
  toggleSelect(e) {
    const id = String((e.currentTarget.dataset && e.currentTarget.dataset.hold) || '');
    if (!id) return;
    const selected = Object.assign({}, this.data.selected);
    if (selected[id]) delete selected[id]; else selected[id] = true;
    this.setData({ selected, selectedCount: Object.keys(selected).length });
  },

  selectAll() {
    const all = {};
    (this.data.groups || []).forEach((g) => (g.items || []).forEach((it) => { all[it.id] = true; }));
    this.setData({ selected: all, selectedCount: Object.keys(all).length });
  },

  /** 把选中的持仓映射为批量分享 items（与单件口径一致：名称+号码+图片+形态） */
  batchShareToPlaza() {
    const ids = Object.keys(this.data.selected || {});
    if (!ids.length) { wx.showToast({ title: '请先勾选藏品', icon: 'none' }); return; }
    const hs = store.getState().holdings || [];
    const items = hs.filter((h) => ids.indexOf(String(h.id)) >= 0).map((h) => ({
      holdingName: h.name,
      serials: Array.isArray(h.serials) ? h.serials.slice(0, 200) : [],
      images: Array.isArray(h.images) ? h.images.slice(0, 3) : [],
      form: h.form || '',
      caption: '',
    })).filter((it) => !!it.holdingName);
    if (!items.length) { wx.showToast({ title: '选中的藏品已不存在', icon: 'none' }); return; }
    if (items.length > 20) { wx.showToast({ title: '一次最多分享 20 件', icon: 'none' }); return; }
    wx.showModal({
      title: '分享到藏品广场',
      content: '把选中的 ' + items.length + ' 件藏品分享到广场？每件会成为一张卡片。',
      success: (res) => {
        if (!res.confirm) return;
        wx.showLoading({ title: '分享中', mask: true });
        api.post('/api/shares/batch', { items }).then((r) => {
          wx.hideLoading();
          if (!r || !r.ok) throw new Error((r && r.error) || '分享失败');
          this.exitSelectMode();
          wx.showToast({ title: '已分享 ' + (r.count || items.length) + ' 件', icon: 'success' });
        }).catch((err) => { wx.hideLoading(); wx.showToast({ title: err.message || '分享失败', icon: 'none' }); });
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
    const serials = (sheet.serialsText || '').split(/[\n,，\s]+/).map((s) => s.trim()).filter(Boolean).slice(0, 200);
    const tasks = [];
    if (sheet.rolls !== sheet.origRolls) tasks.push(store.setRolls(sheet.id, sheet.rolls));
    tasks.push(store.setCost(sheet.id, unit));
    tasks.push(store.patchHolding(sheet.id, { serials, form: sheet.form || '', images: sheet.images || [] }));
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
    // 多选模式：点卡片 = 勾选，不跳详情
    if (this.data.selectMode) { this.toggleSelect(e); return; }
    // 卡片处于左滑展开状态时，点一下先收起，不跳详情
    if (this.data.swipeId) { this.setData({ swipeId: '' }); return; }
    const ds = e.currentTarget.dataset;
    if (ds.ispm === '1' || ds.ispm === true) {
      if (ds.pmcode) wx.navigateTo({ url: '/pages/pmdetail/pmdetail?code=' + encodeURIComponent(ds.pmcode) });
      return;
    }
    const id = ds.id;
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
    const d = this.data;
    if (!d.shareCode) return share.appMessage('mine');
    return {
      title: '我的藏品 · ' + d.summary.kinds + ' 个品种，来看看都有哪些（藏币录）',
      path: '/pages/colshare/colshare?code=' + encodeURIComponent(d.shareCode),
      imageUrl: share.COVER,
    };
  },

  onShareTimeline() {
    const d = this.data;
    if (!d.shareCode) return share.timeline('mine');
    return {
      title: '我的藏品 · ' + d.summary.kinds + ' 个品种（藏币录）',
      query: 'code=' + encodeURIComponent(d.shareCode),
      imageUrl: share.COVER,
    };
  },
});
