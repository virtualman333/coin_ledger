/**
 * 首页视图（原页面逻辑平移）
 *
 * 业务逻辑一行没改，全在 home.logic.js 里；这里只做 Component 包装，
 * 让宿主页 pages/shell 能把它当"视图"挂载、并手动驱动 onShow / onPullDownRefresh 等
 * 原本由框架调用的生命周期。
 *
 * styleIsolation: apply-shared —— 继续吃 app.wxss 里的 .page / .card / .muted 等全局类。
 */
const def = require('./home.logic');

const methods = {};
Object.keys(def).forEach((k) => {
  if (k !== 'data') methods[k] = def[k];
});

Component({
  options: {
    styleIsolation: 'apply-shared',
  },
  data: def.data || {},
  methods,
});
