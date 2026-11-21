Component({
  data: {
    selected: 0,
    // 是否允许播放滑动动画。页面刚切过来时必须是 false，
    // 否则"从初始格滑到目标格"会再演一遍动画，衔接不上。
    anim: false,
    list: [
      { pagePath: '/pages/index/index', text: '首页', icon: 'home' },
      { pagePath: '/pages/plan/plan', text: '发行计划', icon: 'plan' },
      { pagePath: '/pages/list/list', text: '全套清单', icon: 'list' },
      { pagePath: '/pages/mine/mine', text: '我的', icon: 'mine' },
    ],
  },

  /**
   * 每个 tab 页各持有一个 tabBar 实例，切页时是新实例、data 回到初始值。
   * 挂载时先按当前路由把药丸摆正（此时 anim=false，没有过渡），
   * 一帧之后再打开动画开关，供用户后续点击使用。
   * 这样"旧页滑过去 → 新页首帧就在目标格"，是连续的，不会二次动画。
   */
  attached() {
    this.syncFromRoute();
    this._readyTimer = setTimeout(() => {
      this._readyTimer = null;
      if (!this.data.anim) this.setData({ anim: true });
    }, 100);
  },

  detached() {
    if (this._navTimer) {
      clearTimeout(this._navTimer);
      this._navTimer = null;
    }
    if (this._readyTimer) {
      clearTimeout(this._readyTimer);
      this._readyTimer = null;
    }
  },

  methods: {
    /** 页面 onShow 调用：同步选中项，默认不播动画（切回页面时不该有滑动） */
    setSelected(index, animate) {
      if (index === this.data.selected) return;

      if (animate) {
        this.setData({ selected: index, anim: true });
        return;
      }

      // 无动画版本：关掉过渡再改位置，改完延迟恢复，防止"页面 onShow 稍晚到"
      // 时又带着动画把药丸推过去（那就是用户看到的二次滑动）
      this.setData({ selected: index, anim: false });
      if (this._readyTimer) clearTimeout(this._readyTimer);
      this._readyTimer = setTimeout(() => {
        this._readyTimer = null;
        if (!this.data.anim) this.setData({ anim: true });
      }, 100);
    },

    syncFromRoute() {
      try {
        const stack = getCurrentPages();
        const cur = stack[stack.length - 1];
        if (!cur || !cur.route) return;
        const path = '/' + cur.route;
        const idx = this.data.list.findIndex((it) => it.pagePath === path);
        if (idx >= 0 && idx !== this.data.selected) {
          this.setData({ selected: idx, anim: false });
        }
      } catch (e) {
        // 取不到页面栈时保持默认，由页面 onShow 的 syncSelected 兜底
      }
    },

    switchTab(e) {
      const index = Number(e.currentTarget.dataset.index);
      const item = this.data.list[index];
      if (!item) return;

      // 轻振动：配合按下的下沉动效，真机上有"按到了实体键"的手感
      try {
        wx.vibrateShort({ type: 'light' });
      } catch (err) { /* 部分机型/模拟器不支持，忽略 */ }

      // 重复点当前 tab：回到顶部，和鸿蒙/系统底栏一致
      if (index === this.data.selected) {
        wx.pageScrollTo({ scrollTop: 0, duration: 220, fail() {} });
        return;
      }

      // 先在本页把药丸滑过去，滑到九成再 switchTab；
      // 目标页 tabBar 挂载时已按路由定格到同一格，接得上。
      const go = () => this.setData({ selected: index });
      if (this.data.anim) go();
      else this.setData({ anim: true }, go);

      if (this._navTimer) clearTimeout(this._navTimer);
      this._navTimer = setTimeout(() => {
        this._navTimer = null;
        wx.switchTab({ url: item.pagePath });
      }, 200);
    },
  },
});
