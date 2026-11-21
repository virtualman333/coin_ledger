const cat = require('../../utils/catalog');
const api = require('../../utils/api');
const feature = require('../../utils/feature');
const store = require('../../utils/store');
const share = require('../../utils/share');
const privacy = require('../../utils/privacy');

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
      { code: 'all', name: '全部' }, { code: 'coin', name: '普通纪念币' },
      { code: 'note', name: '纪念钞' }, { code: 'pm', name: '贵金属纪念币' },
    ],
    empty: true,
    shareCode: '',      // 收藏快照分享码（进页面时预生成）
    shareOpen: false,   // 分享内容选择面板
    shareBusy: false,   // 正在按选项生成快照
    shareOpts: { list: true, qty: true, face: true, ai: true },
    shareOptList: [
      { key: 'list', name: '品种清单', desc: '具体有哪些币' },
      { key: 'qty', name: '数量', desc: '每个品种几枚 / 几套' },
      { key: 'face', name: '面值合计', desc: '按面额累加' },
      { key: 'ai', name: '推理价合计', desc: '按目录推理价估算' }
    ],
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
    // 选项也算签名的一部分：改了勾选就必须重新生成快照
    const sig = hs.map((h) => [h.id, h.rolls, h.unit, h.category, h.name].join(':')).join('|')
      + '|' + JSON.stringify(this.data.shareOpts);
    if (this.data.shareCode && sig === this._shareSig) return;
    if (this._shareBusy) return;
    this._shareSig = sig;
    this._shareBusy = true;
    this.setData({ shareBusy: true });

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
      // 面值按套计（一套面额 × 套数），推理价按件计；贵金属没有这套口径，都是 0
      const faceOne = c ? (Number(c.setFaceBase || c.setFace) || 0) : 0;
      const aiUnit = c ? (Number(cat.aiPriceOf(c)) || 0) : 0;
      return {
        name: h.name,
        year: c ? c.year : 0,
        category: h.category === 'pm' ? 'pm' : ((c && c.kind === 'note') ? 'note' : 'coin'),
        qty,
        qtyLabel: qty + ' ' + ((c && c.kind === 'note') ? '张' : '枚'),
        seriesName: (c && c.seriesName) || h.group || '',
        imgUrl,
        face: Math.round(faceOne * rolls * 100) / 100,
        ai: Math.round(aiUnit * qty * 100) / 100,
      };
    });

    return api.post('/api/colshare', { items, options: this.data.shareOpts }).then((r) => {
      this._shareBusy = false;
      this.setData({ shareBusy: false });
      if (r && r.ok && r.code) this.setData({ shareCode: r.code });
    }).catch(() => { this._shareBusy = false; this.setData({ shareBusy: false }); });
  },

  switchCat(e) {
    // 别用 cat 命名：文件顶部的 cat 是 catalog 模块
    const next = e.currentTarget.dataset.cat;
    if (next === this.data.holdCat) return;
    // 切分类时退出多选：否则 selected 里留着看不见的藏品，
    // 底部「已选 N 件」点分享会把当前分类外的也带出去
    this.setData({ holdCat: next, selectMode: false, selected: {}, selectedCount: 0 },
      () => this.render());
  },

  /* ---------------- 分享内容选择 ---------------- */

  openShareSheet() {
    if (!store.isLogin()) {
      wx.showToast({ title: '登录后才能分享', icon: 'none' });
      return;
    }
    if (!(store.state.holdings || []).length) {
      wx.showToast({ title: '账本还是空的', icon: 'none' });
      return;
    }
    this.setData({ shareOpen: true });
    this.prepareShare();
  },

  closeShare() {
    if (this.data.shareBusy) return;
    this.setData({ shareOpen: false });
  },

  toggleShareOpt(e) {
    const key = e.currentTarget.dataset.key;
    if (!key) return;
    const opts = Object.assign({}, this.data.shareOpts);
    opts[key] = !opts[key];
    // 四项全关就没东西可分享了，留最后一项不让关
    if (!opts.list && !opts.qty && !opts.face && !opts.ai) {
      wx.showToast({ title: '至少保留一项', icon: 'none' });
      return;
    }
    this.setData({ shareOpts: opts }, () => this.prepareShare(true));
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
      const rawGroup = (coin && coin.seriesName) || h.group || '独立藏品';
      // 老数据 group 存的是「贵金属」，展示统一成全称
      const groupName = rawGroup === '贵金属' ? '贵金属纪念币' : rawGroup;
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
        // 卡片副标题：套数与总件数合成一句（原先是图片角标「2 套」+ 副标题「40 枚」，
        // 用户得自己换算；而且角标压在图上显挤）
        qtyText: isPiece
          ? (rolls + (coin && coin.kind === 'note' ? ' 张' : ' 枚'))
          : (rolls + ' 套 · ' + qty + (coin && coin.kind === 'note' ? ' 张' : ' 枚')),
        // 贵金属不在本地 catalog 里，拿不到真实面值 —— 宁可留空，也不能显示「面值 ¥0.00」
        faceText: coin ? cat.money((coin.setFaceBase || coin.setFace) * rolls) : '',
        costText: cat.money(h.cost),
        unitCostText: cat.money(Math.round((Number(h.cost) || 0) / (rolls || 1))),
        unitWord: isPiece ? (coin && coin.kind === 'note' ? '张' : '枚') : '套',
        aiText: aiTotal ? cat.money(aiTotal) : '',
        // 藏品增强字段
        isNote: !!(coin && coin.kind === 'note') || h.category === 'note',
        setSize: size,               // 一套几件，面板里切形态时按它换算
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
      // 贵金属没有「系列进度」也没有推理价：分母不能拿普通币的单品种数冒充，
      // 金额也不能显示 0.00（贵金属全站不出估值）
      g.isPm = g.items.length > 0 && g.items.every((it) => it.isPm);
      if (g.isPm) {
        g.aiText = '';
        g.total = g.own = g.items.length;
        g.pct = 0;
        g.progLabel = g.own + ' 枚';
        return;
      }
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
        pmKinds: st.pmKinds,
        pmRolls: st.pmRolls,
      },
      summary: {
        kinds: st.kinds,
        rolls: st.rolls,
        pmKinds: st.pmKinds,
        pmRolls: st.pmRolls,
        faceText: cat.money(st.face),
        aiText: aiAllText,
        costText: cat.money(st.cost),
      },
      groups: rest.concat(solo),
      empty: state.holdings.length === 0,
      // 有藏品但当前分类下一条都没有：以前会渲染成「0 个分组」+ 一片空白，像页面坏了
      catEmpty: state.holdings.length > 0 && hs.length === 0,
      syncTip: state.synced ? '' : (state.error || ''),
    });
  },

  /** 点卡片右侧「⋯」→ 底部编辑面板（多选模式下点卡片是勾选，不进这里） */
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
      sheet: {
        id: item.id,
        coinId: item.coinId,
        pmCode: item.pmCode || '',
        name: item.name,
        imgUrl: item.imgUrl,
        rolls: item.rolls,
        origRolls: item.rolls,
        unitWord: item.unitWord,
        qtyLabel: item.qtyLabel,
        isPm: !!item.isPm,
        aiText: item.aiText,
        costText: item.costText,
        unitCost: String(Math.round((Number(item.unitCostText.replace(/,/g, '')) || 0))),
        // 藏品增强：号码 / 形态 / 图片
        isNote: !!(item.isNote),
        setSize: Number(item.setSize) || 1,
        costLabel: item.unitWord === '套' ? '每套成本' : '单个成本',
        serialsText: (item.serials || []).join('\n'),
        luckyTags: item.luckyTags || [],
        // 形态以真实记账口径（unit）为准：老数据里 form 和 unit 可能对不上
        form: item.unitWord === '套' ? '' : 'single',
        origForm: item.unitWord === '套' ? '' : 'single',
        images: item.images || [],
        focus: ds.focus || '',
      },
    });
    // 记一份「打开时的样子」，关闭时据此判断有没有没保存的改动
    this._sheetSnap = this.sheetSnapshot(this.data.sheet);
    // 纪念钞有号码时请求服务端分析花样（后端与 Web 共用同一套规则）
    if (item.isNote && item.serials && item.serials.length) {
      const sheetId = item.id;
      api.post('/api/serial/analyze-batch', { nos: item.serials }).then((r) => {
        // 关掉 A 面板再开 B 时，A 的花样标签不能写进 B
        if (!r || !r.ok || !this.data.sheet || this.data.sheet.id !== sheetId) return;
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

  /**
   * 整套 / 单个切换。
   * 这套账的口径是「1 套 = N 件」：整套按套数记，单个按枚/张记。
   * 切换时必须同时换单位、并按 N 换算数量与单价 —— 只改标签不改数，账就错了。
   * 总价保持不变：1 套 200 元 → 20 枚 × 10 元。
   */
  setForm(e) {
    const form = e.currentTarget.dataset.form || '';
    const sheet = this.data.sheet;
    if (!sheet) return;

    const next = form === 'single' ? 'single' : 'set';
    const cur = sheet.form === 'single' ? 'single' : 'set';
    if (next === cur) return;

    const size = Math.max(1, Number(sheet.setSize) || 1);   // 一套几件
    const noteWord = sheet.isNote ? '张' : '枚';
    let rolls = Number(sheet.rolls) || 1;
    let unitCost = Number(sheet.unitCost) || 0;

    if (next === 'single') {
      // 套 → 件：数量放大，单价摊薄
      rolls = rolls * size;
      unitCost = unitCost ? Math.round((unitCost / size) * 100) / 100 : 0;
    } else {
      // 件 → 套：必须凑得成整
      const sets = Math.floor(rolls / size);
      if (sets < 1) {
        wx.showToast({ title: '不满 ' + size + ' ' + noteWord + '，凑不成一套', icon: 'none' });
        return;
      }
      if (rolls % size !== 0) {
        wx.showToast({ title: '按 ' + sets + ' 套计，多的 ' + (rolls - sets * size) + ' ' + noteWord + ' 舍去', icon: 'none' });
      }
      rolls = sets;
      unitCost = unitCost ? Math.round(unitCost * size * 100) / 100 : 0;
    }

    this.setData({
      'sheet.form': next === 'single' ? 'single' : '',
      'sheet.rolls': rolls,
      'sheet.unitCost': String(unitCost),
      'sheet.unitWord': next === 'single' ? noteWord : '套',
      'sheet.costLabel': next === 'single' ? '单个成本' : '每套成本',
      'sheet.qtyLabel': next === 'single'
        ? (rolls + ' ' + noteWord)
        : (rolls + ' 套 · ' + (rolls * size) + ' ' + noteWord),
    });
  },

  addImage() {
    const sheet = this.data.sheet;
    if (!sheet) return;
    const sheetId = sheet.id;                 // 记录发起时的持仓，防止异步回包写进另一个面板
    if ((sheet.images || []).length >= 3) {
      wx.showToast({ title: '最多 3 张图片', icon: 'none' });
      return;
    }
    // 与 feedback/count 一致：调 chooseMedia 前先确认隐私授权
    privacy.ensure().then((ok) => {
      if (!ok) { wx.showToast({ title: '需要授权后才能选择图片', icon: 'none' }); return; }
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
                // 上传期间用户可能关掉面板或换了另一枚藏品，此时不能把图塞进错的面板
                const cur = this.data.sheet;
                if (!cur || cur.id !== sheetId) return;
                const images = (cur.images || []).concat([r.path]);
                this.setData({ 'sheet.images': images });
              }).catch((err) => { wx.hideLoading(); wx.showToast({ title: err.message || '上传失败', icon: 'none' }); });
            },
            fail: () => { wx.hideLoading(); wx.showToast({ title: '读取图片失败', icon: 'none' }); },
          });
        },
      });
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
    this.setData({ selectMode: true, selected: {}, selectedCount: 0, sheet: null });
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

  noop() {},

  /** 面板里值得保存的字段串成一行，用来判断「改没改」 */
  sheetSnapshot(sheet) {
    if (!sheet) return '';
    const serials = String(sheet.serialsText || '')
      .split(/[\n,，\s]+/).map((x) => x.trim()).filter(Boolean).slice(0, 200);
    return JSON.stringify({
      rolls: sheet.rolls,
      unitCost: String(Number(sheet.unitCost) || 0),
      serials: serials,
      form: sheet.form || '',
      images: sheet.images || [],
    });
  },

  closeSheet() {
    if (!this.data.sheet) return;
    // 改了一半点遮罩：以前会静默丢弃，用户以为存上了
    if (this._sheetSnap && this.sheetSnapshot(this.data.sheet) !== this._sheetSnap) {
      wx.showModal({
        title: '放弃修改？',
        content: '这次改的数量、成本或号码还没有保存。',
        confirmText: '放弃',
        cancelText: '继续编辑',
        confirmColor: '#c0392b',
        success: (r) => { if (r.confirm) this.dismissSheet(); },
      });
      return;
    }
    this.dismissSheet();
  },

  dismissSheet() {
    this._sheetSnap = null;
    this.setData({ sheet: null });
  },

  /** 面板里直接看这枚币的资料，不用关掉再点卡片 */
  goSheetDetail() {
    const s = this.data.sheet;
    if (!s) return;
    this.dismissSheet();
    if (s.isPm) {
      const code = s.pmCode || s.id;
      if (code) wx.navigateTo({ url: '/pages/pmdetail/pmdetail?code=' + encodeURIComponent(code) });
      return;
    }
    if (s.coinId) wx.navigateTo({ url: '/pages/detail/detail?id=' + s.coinId });
  },

  sheetStep(e) {
    const sheet = this.data.sheet;
    if (!sheet) return;
    const delta = Number(e.currentTarget.dataset.delta);
    const next = Math.max(1, Math.min(999, sheet.rolls + delta));
    if (next === sheet.rolls) return;
    this.setData({ 'sheet.rolls': next });
  },

  onSheetCost(e) {
    this.setData({ 'sheet.unitCost': e.detail.value });
  },

  saveSheet() {
    const sheet = this.data.sheet;
    if (!sheet) return;
    const unitCost = Number(sheet.unitCost) || 0;
    const rolls = Number(sheet.rolls) || 1;
    const serials = (sheet.serialsText || '').split(/[\n,，\s]+/).map((s) => s.trim()).filter(Boolean).slice(0, 200);
    const tasks = [];

    // 形态换了就不能按套数缩放 —— setRolls 会按新旧 rolls 之比缩放市值，
    // 1 套改成 20 枚时市值会被放大 20 倍。换口径走 setUnitForm，按件数换算。
    const formChanged = !sheet.isPm && (sheet.form === 'single') !== (sheet.origForm === 'single');
    if (formChanged) {
      tasks.push(store.setUnitForm(
        sheet.id,
        sheet.form === 'single' ? 'piece' : 'set',
        rolls,
        Math.round(unitCost * rolls * 100) / 100
      ));
    } else {
      if (rolls !== sheet.origRolls) tasks.push(store.setRolls(sheet.id, rolls));
      tasks.push(store.setCost(sheet.id, unitCost));
    }

    tasks.push(store.patchHolding(sheet.id, {
      serials,
      form: sheet.form || '',
      images: sheet.images || [],
    }));
    wx.showLoading({ title: '保存中', mask: true });
    Promise.all(tasks)
      .then(() => store.refresh({ force: true }))
      .then(() => {
        wx.hideLoading();
        this._sheetSnap = null;
        this.setData({ sheet: null });
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
          this._sheetSnap = null;
          this.setData({ sheet: null });
          this.render();
          wx.showToast({ title: '已移出', icon: 'success' });
        }).catch((err) => {
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
    const ds = e.currentTarget.dataset;
    if (ds.ispm === '1' || ds.ispm === true) {
      if (ds.pmcode) wx.navigateTo({ url: '/pages/pmdetail/pmdetail?code=' + encodeURIComponent(ds.pmcode) });
      // 以前这里直接 return，点了没反应也不说为什么
      else wx.showToast({ title: '这枚暂无详情页', icon: 'none' });
      return;
    }
    const id = ds.id;
    // coinId 缺失 = 目录里查不到（改名或已下架），别让点击变成哑巴
    if (!id) { wx.showToast({ title: '该品种暂无详情页', icon: 'none' }); return; }
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
    getApp().goTab(2);
  },

  goBack() {
    const pages = getCurrentPages();
    if (pages.length > 1) wx.navigateBack();
    else getApp().goTab(3);
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
