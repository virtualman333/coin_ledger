const api = require('../../utils/api');
const cat = require('../../utils/catalog');
const { dayText } = require('../../utils/datetime');
const store = require('../../utils/store');

Page({
  data: {
    loading: true,
    userName: '',
    accountName: '',
    avatarText: '藏',
    avatarUrl: '',
    roleText: '用户',
    isAdmin: false,
    isTest: false,
    disabled: false,
    wx: false,
    nameChanged: false,
    loginText: '—',
    nameChangedText: '未改过名',
    createdText: '—',
    lastLoginText: '—',
    metaText: '',
    user: {},
    items: [],
    summary: { kinds: 0, costText: '0', marketText: '0', pnlText: '¥0', up: true },
  },

  onLoad(query) {
    const state = store.getState();
    if (!state.isAdmin) {
      wx.showModal({
        title: '没有权限',
        content: '只有管理员能查看用户的藏品。',
        showCancel: false,
        success: () => wx.navigateBack(),
      });
      return;
    }
    this.uid = query.id || '';
    this.setData({ userName: query.name || '用户' });
    this.load();
  },

  onPullDownRefresh() {
    this.load().then(() => wx.stopPullDownRefresh());
  },

  load() {
    this.setData({ loading: true });
    return api.get('/api/admin/users/' + encodeURIComponent(this.uid) + '/holdings')
      .then((res) => {
        const user = res.user || {};
        const list = res.holdings || [];
        let cost = 0;
        let market = 0;
        let pmKinds = 0;
        let pmCost = 0;
        const items = list.map((h) => {
          const coin = cat.byName[h.name];
          // 本地 catalog 只有普通币/纪念钞，查不到的（贵金属）既没有面值也没有市值；
          // 以前直接按 0 记账，会让管理员看到「市值 ¥0 / 盈亏 -¥8000」这种假数据
          const isPm = !coin;
          const rolls = Number(h.rolls) || 1;
          const size = coin ? (coin.setSizeBase || coin.setSize || 1) : 1;
          const qty = rolls * size;
          const unit = coin ? (coin.kind === 'note' ? '张' : '枚') : '枚';
          const c = Number(h.cost) || 0;
          const m = Number(h.market) || 0;
          cost += c;
          if (isPm) {
            pmKinds += 1;
            pmCost += c;
          } else {
            market += m;
          }
          const pnl = Math.round((m - c) * 100) / 100;
          return {
            id: h.id,
            name: h.name,
            isPm: isPm,
            imgUrl: coin ? (coin.smallUrl || coin.thumbUrl || coin.imgUrl) : '',
            qtyLabel: qty + ' ' + unit,
            faceText: coin ? cat.money((coin.setFaceBase || coin.setFace) * rolls) : '',
            costText: cat.money(c),
            marketText: cat.money(m),
            unitCostText: cat.money(Math.round(c / rolls)),
            pnlText: (pnl >= 0 ? '+' : '-') + '¥' + cat.money(Math.abs(pnl)),
            pnlCls: pnl >= 0 ? 'up' : 'down',
          };
        });
        // 市值/盈亏只统计能估值的品种；贵金属成本另算，不参与盈亏
        const pnl = Math.round((market - (cost - pmCost)) * 100) / 100;
        const nick = user.nickname || user.name || '';
        const isAdmin = user.role === 'admin';
        const roleText = isAdmin ? '管理员' : (user.isTest ? '测试账号' : '普通用户');
        // 头像存相对路径（/avatar/xxx.jpg），小程序要拼接口域名才能显示
        const avatarUrl = user.avatar
          ? (String(user.avatar).indexOf('http') === 0 ? user.avatar : api.BASE + user.avatar)
          : '';
        const createdText = dayText(user.createdAt);
        const lastLoginText = dayText(user.lastLogin);
        const loginText = ((user.hasPassword ? '账号密码' : '')
          + (user.hasPassword && user.wx ? ' + ' : '')
          + (user.wx ? '微信' : '')) || '—';
        this.setData({
          loading: false,
          user,
          userName: nick || this.data.userName,
          accountName: user.name || '',
          avatarText: nick ? nick.slice(0, 1) : '藏',
          avatarUrl,
          roleText,
          isAdmin,
          isTest: !!user.isTest,
          disabled: !!user.disabled,
          wx: !!user.wx,
          nameChanged: !!user.nameChanged,
          loginText,
          nameChangedText: user.nameChanged ? '已用过改名机会' : '未改过名',
          createdText,
          lastLoginText,
          metaText: roleText + ' · ' + (user.disabled ? '已禁用' : '正常') + ' · 注册 ' + createdText,
          items: items,
          summary: {
            kinds: items.length - pmKinds,
            pmKinds: pmKinds,
            pmCostText: cat.money(pmCost),
            costText: cat.money(cost),
            marketText: cat.money(market),
            pnlText: (pnl >= 0 ? '+' : '-') + '¥' + cat.money(Math.abs(pnl)),
            up: pnl >= 0,
          },
        });
      })
      .catch((e) => {
        this.setData({ loading: false });
        wx.showToast({ title: e.message || '加载失败', icon: 'none' });
      });
  },
});
