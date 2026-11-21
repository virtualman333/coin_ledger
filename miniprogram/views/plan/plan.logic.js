const cat = require('../../utils/catalog');
const api = require('../../utils/api');
const store = require('../../utils/store');
const share = require('../../utils/share');

// 订阅消息模板（日程提醒）。后台改模板时要同步这里
const TMPL_ID = 'VbGee94SWDa5DUBkHx2Kii8Dp0OobE1PneOJg9Id_ao';

/**
 * 预约状态：带时刻的公告按「当前时刻」算（如 11-17 22:00 至 11-18 24:00）。
 * 24:00 按次日 00:00 处理；只有日期的公告返回 null，沿用按天倒计时。
 */
function reserveRange(text) {
  if (!text) return null;
  const s = String(text).replace(/\s+/g, ' ').trim();
  const m = s.match(/^(\d{4}-\d{2}-\d{2})(?:\s+(\d{1,2}):(\d{2}))?\s*至\s*(?:(\d{4})-)?(\d{2})-(\d{2})(?:\s+(\d{1,2}):(\d{2}))?/);
  if (!m) return null;
  const y = m[1].slice(0, 4);
  const start = new Date(m[1] + 'T' + (m[2] || '00') + ':' + (m[3] || '00') + ':00');
  const endY = m[4] || y;
  const eh = m[7], em = m[8];
  let end;
  if (eh === '24') {
    end = new Date(endY + '-' + m[5] + '-' + m[6] + 'T00:00:00');
    end.setDate(end.getDate() + 1);
  } else {
    end = new Date(endY + '-' + m[5] + '-' + m[6] + 'T' + (eh || '23') + ':' + (em || '59') + ':00');
  }
  if (isNaN(start.getTime()) || isNaN(end.getTime())) return null;
  return { start, end };
}

function reserveState(text) {
  if (!/\d{1,2}:\d{2}/.test(String(text || ''))) return null;
  const r = reserveRange(text);
  if (!r) return null;
  const now = new Date();
  if (now < r.start) {
    const h = Math.ceil((r.start - now) / 3600000);
    return { cls: 'soon', text: h < 24 ? ('距预约 ' + h + ' 小时') : ('距预约 ' + Math.ceil(h / 24) + ' 天') };
  }
  if (now <= r.end) {
    return { cls: 'now', text: '预约中 · 剩 ' + Math.ceil((r.end - now) / 3600000) + ' 小时' };
  }
  return { cls: 'end', text: '预约已结束' };
}

module.exports = {
  data: {
    years: [],
    next: null,
    has: false,
    source: '',
    reminded: {},        // { planKey: '11月17日 09:00' }
    loggedIn: false,
    totalCoins: 0,
    tab: 'coin',                 // coin=普通纪念币（钞） / pm=贵金属
    pmYears: [],                 // 当前已渲染的贵金属计划（分批）
    pmAllCount: 0,               // 贵金属计划总年数
    plansFromApi: null,
    plansError: '',              // wxml 在用，之前没声明，首帧是 undefined
    detail: null,                // 计划项详情弹层
  },

  onLoad() {
    this.build();           // 先本地兜底渲染一次
    this.loadPlans();       // 接口回来再重绘一次
    this.startTicker();
  },

  /** 后端一个 API 服务：Web 与小程序共用 /api/plans */
  loadPlans() {
    return api.getPlans().then((res) => {
      if (!res || !res.ok) return;
      this.setData({ plansFromApi: res });
      this.build();
      this.buildPm();
    }).catch(() => {
      this.setData({ plansError: '计划数据加载失败，点此重试' });
    });
  },

  /** 贵金属计划按项目（套）展示，不做预约倒计时 */
  buildPm() {
    const src = this.data.plansFromApi && this.data.plansFromApi.planPm;
    if (!src || !Array.isArray(src.years)) return;
    const all = src.years.map((y) => ({
      year: y.year,
      total: y.items.length,
      pieces: y.items.reduce((a, it) => a + (Number(it.pieces) || 0), 0),
      items: y.items.map((it) => ({
        key: it.key,
        name: it.name,
        code: it.code,
        pieces: it.pieces,
        dateText: it.release || '',
        announce: it.announce || '',
      })),
    }));
    this._pmAll = all;
    // 首屏先渲染 2 年，滚到底再续 3 年（贵金属项目上千条，一次性渲染会卡）
    const shown = Math.min(this.data.pmYears.length || 2, all.length);
    this.setData({ pmAllCount: all.length, pmYears: all.slice(0, shown) });
  },

  /** 贵金属分段滚到底继续加载 */
  onReachBottom() {
    if (this.data.tab !== 'pm') return;
    const all = this._pmAll || [];
    if (this.data.pmYears.length >= all.length) return;
    this.setData({ pmYears: all.slice(0, Math.min(this.data.pmYears.length + 3, all.length)) });
  },

  retryPlans() {
    this.setData({ plansError: '' });
    this.loadPlans();
  },

  onPullDownRefresh() {
    // loadPlans 内含 build() + buildPm()，普通币与贵金属一次刷新到位。
    // 转圈跟着真实请求结束，不要用固定 600ms 抢跑（接口慢时圈会先消失）
    const done = () => wx.stopPullDownRefresh();
    Promise.resolve(this.retryPlans()).then(done, done);
  },

  switchTab(e) {
    const tab = e.currentTarget.dataset.tab;
    if (tab === this.data.tab) return;
    this.setData({ tab });
  },

  onShow() {
    this.build();
    this.loadReminders();
    this.startTicker();
  },

  onHide() { this.stopTicker(); },

  onUnload() { this.stopTicker(); },

  /** 预约状态按当前时刻算，页面开着也要跟着走；后台挂起时靠 onShow 重建 */
  startTicker() {
    this.stopTicker();
    this._ticker = setInterval(() => {
      this.build();
      if (this.data.detail) {
        const all = this.data.years.reduce((a, y) => a.concat(y.items), []);
        const fresh = all.filter((x) => x.key === this.data.detail.key)[0];
        this.setData({ detail: fresh || null });
      }
    }, 60000);
  },

  stopTicker() {
    if (this._ticker) {
      clearInterval(this._ticker);
      this._ticker = null;
    }
  },

  /** 把 plan.json 转成渲染结构：算倒计时、把待发行排前面 */
  build() {
    const apiPlan = this.data.plansFromApi && this.data.plansFromApi.plan;
    const plan = (apiPlan && apiPlan.years) ? apiPlan : ((cat.plan && cat.plan.years) ? cat.plan : { years: [] });
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    let next = null;
    let source = '';

    const years = (plan.years || []).map((y) => {
      if (y.sourceUrl && !source) source = '中国人民银行 ' + (y.publishedAt || '') + ' 公布';
      const items = (y.items || []).map((it) => {
        const d = it.date ? new Date(it.date + 'T00:00:00') : null;
        const days = d ? Math.round((d - today) / 86400000) : null;
        const isUp = it.status === 'upcoming';
        const rs = reserveState(it.reserve);
        const cdCls = rs ? ('cd-' + rs.cls) : '';
        const reserveNow = !!(rs && rs.cls === 'now');
        // 只有待发行、预约未结束、发行日未过的项目才允许提醒
        const canRemind = isUp && cdCls !== 'cd-end' && days !== null && days >= 0;
        let cdText = rs ? rs.text : '';
        if (!cdText && isUp && days !== null) {
          cdText = days > 0 ? ('还有 ' + days + ' 天') : (days === 0 ? '今天发行' : '已过发行日');
        }
        const badgeText = reserveNow ? '预约中' : (isUp ? '待发行' : '已发行');
        const row = {
          key: it.key,
          name: it.name,
          short: it.short || it.name,
          kindText: it.kind === 'note' ? '纪念钞' : '纪念币',
          face: it.face,
          unit: it.kind === 'note' ? '张' : '枚',
          mintageText: it.mintage ? cat.money(it.mintage) + ' 万' : '',
          note: it.note || '',
          badgeText,
          reserveNow,
          canRemind,
          cdCls,
          dateText: it.date ? it.date.slice(5).replace(/-/g, '/') : '待定',
          dateFull: it.date || '',
          reserveText: it.reserve ? it.reserve.replace(/-/g, '/') : '',
          exchangeText: it.exchange ? it.exchange.replace(/-/g, '/') : '',
          limitText: it.limit ? ('每人限 ' + it.limit + (it.kind === 'note' ? ' 张' : ' 枚')) : '',
          // 详情弹层用
          schedule: it.schedule || [],
          verifyText: it.verify ? it.verify.replace(/-/g, '/') : '',
          banks: it.banks || '',
          proxy: it.proxy || 0,
          ob: (it.design && it.design.obverse) || '',
          rev: (it.design && it.design.reverse) || '',
          sourceText: it.sourceText || '',
          sourceUrl: it.sourceUrl || '',
          specText: [
            it.face ? it.face + ' 元' : '',
            it.material || '',
            it.dia || '',
            it.mintage ? cat.money(it.mintage) + ' 万' + (it.kind === 'note' ? '张' : '枚') : '',
          ].filter(Boolean).join(' · '),
          extra: !!it.extra,
          isUp,
          days,
          cdText,
          coinId: it.coinNo || 0,
        };
        if (isUp && days !== null && days >= 0) {
          if (!next || days < next.days) next = row;
        }
        return row;
      });
      // 一律按发行日倒序：最新（含最近的待发行）永远在最前
      items.sort((a, b) => String(b.dateFull || '').localeCompare(String(a.dateFull || '')));
      return {
        year: y.year,
        publishedAt: y.publishedAt || '',
        total: items.length,
        planCount: items.filter((i) => !i.extra).length,
        extraCount: items.filter((i) => i.extra).length,
        doneCount: items.filter((i) => !i.isUp).length,
        items,
      };
    });

    years.sort((a, b) => b.year - a.year);
    this.setData({ years, next, has: years.length > 0, source, totalCoins: cat.total });
  },

  /** 拉一次我的提醒，标在对应项目上 */
  loadReminders() {
    const state = store.getState();
    this.setData({ loggedIn: !!state.user });
    if (!state.user) return;
    api.get('/api/reminders').then((res) => {
      const map = {};
      (res.items || []).forEach((it) => {
        if (it.status !== 'pending') return;
        const d = new Date(it.remindAt);
        map[it.key] = (d.getMonth() + 1) + '月' + d.getDate() + '日 ' +
          String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
      });
      this.setData({ reminded: map });
    }).catch(() => { /* 未登录或网络问题，忽略 */ });
  },

  /**
   * 点「提醒我」：
   * 一次性订阅必须由点击直接触发，所以先 requestSubscribeMessage，拿到 accept 再报给服务端。
   */
  remind(e) {
    const ds = e.currentTarget.dataset;
    const key = ds.key;
    const name = ds.name || '纪念币';
    if (!key) return;

    // 渲染层用 canRemind 隐藏按钮，这里再校验一次，防止旧渲染残留绕过
    const all = (this.data.years || []).reduce((a, y) => a.concat(y.items || []), []);
    const row = all.filter((x) => x.key === key)[0];
    if (!row || !row.canRemind) return;

    const state = store.getState();
    if (!state.user) {
      wx.showModal({
        title: '需要先登录',
        content: '订阅提醒要用微信登录，这样到点才能把通知发给你。',
        confirmText: '去登录',
        success: (r) => { if (r.confirm) wx.navigateTo({ url: '/pages/account/account' }); },
      });
      return;
    }

    wx.requestSubscribeMessage({
      tmplIds: [TMPL_ID],
      success: (res) => {
        const st = res && res[TMPL_ID];
        if (st !== 'accept') {
          const tip = st === 'reject' ? '你拒绝了通知授权' : '没有开启通知';
          wx.showToast({ title: tip + '，可以再点一次', icon: 'none' });
          return;
        }
        api.post('/api/reminders', { key }).then((r) => {
          wx.showToast({ title: '预约日 ' + r.remindText + ' 提醒你', icon: 'none' });
          this.loadReminders();
        }).catch((err) => {
          wx.showToast({ title: (err && err.message) || '设置失败，请重试', icon: 'none' });
        });
      },
      fail: () => {
        wx.showToast({ title: '没能开启通知，请检查微信设置', icon: 'none' });
      },
    });
  },

  /** 点计划项：已发行的进品种详情；未发行的展开公告详情 */
  onItemTap(e) {
    const id = Number(e.currentTarget.dataset.id) || 0;
    if (id) { this.goCoin(e); return; }
    const key = e.currentTarget.dataset.key;
    const all = this.data.years.reduce((a, y) => a.concat(y.items), []);
    const row = all.filter((x) => x.key === key)[0];
    if (!row) return;
    this.setData({ detail: row });
  },

  closeDetail() {
    this.setData({ detail: null });
  },

  copySource() {
    const url = this.data.detail && this.data.detail.sourceUrl;
    if (!url) return;
    wx.setClipboardData({ data: url });
  },

  noop() {},

  goCoin(e) {
    const id = Number(e.currentTarget.dataset.id) || 0;
    if (!id) return;
    wx.navigateTo({ url: '/pages/detail/detail?id=' + id });
  },

  goList() {
    this.triggerEvent('switchtab', { index: 2 });
  },

  onShareAppMessage() {
    return share.appMessage('plan');
  },

  onShareTimeline() {
    return share.timeline('plan');
  },
};
;
