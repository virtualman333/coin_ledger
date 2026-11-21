Component({
  data: {
    selected: 0,
    list: [
      { pagePath: '/pages/index/index', text: '首页', icon: 'home' },
      { pagePath: '/pages/plan/plan', text: '发行计划', icon: 'plan' },
      { pagePath: '/pages/list/list', text: '全套清单', icon: 'list' },
      { pagePath: '/pages/mine/mine', text: '我的', icon: 'mine' },
    ],
  },

  methods: {
    switchTab(e) {
      const index = Number(e.currentTarget.dataset.index);
      if (!this.data.list[index]) return;

      // 轻振动：配合按下的下沉动效，真机上有"按到了实体键"的手感
      try {
        wx.vibrateShort({ type: 'light' });
      } catch (err) { /* 部分机型/模拟器不支持，忽略 */ }

      // 重复点当前 tab：回到顶部，和鸿蒙/系统底栏一致
      if (index === this.data.selected) {
        wx.pageScrollTo({ scrollTop: 0, duration: 220, fail() {} });
        return;
      }

      wx.switchTab({
        url: this.data.list[index].pagePath,
        // 高亮交给目标页 onShow 同步（见 utils/tabbar.js），
        // 这里不改 selected，避免切页前的视觉跳变
      });
    },
  },
});
