/**
 * 自定义 tabBar 的选中态同步。
 *
 * 微信的自定义 tabBar 是每个 tab 页各自一个组件实例，切页时不会自动更新
 * selected，必须在目标页 onShow 里手动同步。漏了就会出现"点第 3 个、
 * 高亮还停在第 1 个"。
 *
 * 这里固定走 setSelected(index, false)：切到/切回页面时药丸直接定格，
 * 不播滑动动画。否则会和点击时那一段滑动叠起来，看着像闪了两下。
 * 滑动动画只由 tabBar 内部的点击逻辑触发。
 *
 * 首次进入页面时 getTabBar() 可能还没就绪（返回 null），补两次短延迟重试。
 */
function syncSelected(page, index, attempt) {
  const tries = attempt || 0;

  let bar = null;
  try {
    bar = page && page.getTabBar && page.getTabBar();
  } catch (e) {
    bar = null;
  }

  if (bar) {
    if (typeof bar.setSelected === 'function') {
      bar.setSelected(index, false);
      return;
    }
    if (typeof bar.setData === 'function') {
      bar.setData({ selected: index, anim: false });
      return;
    }
  }

  if (tries >= 2) return;
  setTimeout(() => syncSelected(page, index, tries + 1), 60);
}

module.exports = { syncSelected };
