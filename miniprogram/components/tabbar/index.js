/**
 * 底部 TabBar（常驻版）
 *
 * 和之前的 custom-tab-bar 最大的区别：它挂在宿主页 pages/shell 上，
 * 四个视图切换时这个组件不会被销毁重建，所以药丸的滑动是一段连续动画，
 * 不存在"切页 -> 新实例 -> 再从第一格滑一遍"的问题。
 *
 * 它只负责发出切换意图，真正切视图由 shell 负责。
 */
Component({
  properties: {
    selected: { type: Number, value: 0 },
  },

  data: {
    list: [
      { key: 0, text: '首页', icon: 'home' },
      { key: 1, text: '发行计划', icon: 'plan' },
      { key: 2, text: '全套清单', icon: 'list' },
      { key: 3, text: '我的', icon: 'mine' },
    ],
  },

  methods: {
    onTap(e) {
      const index = Number(e.currentTarget.dataset.index);
      const cur = this.properties.selected;

      // 点当前项：交给宿主决定（回顶），不走切换
      if (index === cur) {
        this.triggerEvent('retap', { index });
        return;
      }

      try {
        wx.vibrateShort({ type: 'light' });
      } catch (err) { /* 部分机型/模拟器不支持 */ }

      this.triggerEvent('change', { index });
    },
  },
});
