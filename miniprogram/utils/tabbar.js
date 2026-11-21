/**
 * 自定义 tabBar 的选中态同步。
 *
 * 微信的自定义 tabBar 是每个 tab 页各自一个组件实例，切页时不会自动更新
 * selected，必须在目标页 onShow 里手动 setData。漏了就会出现"点第 3 个、
 * 高亮还停在第 1 个"。统一走这个函数，避免每页重复 try/catch。
 *
 * 首次进入页面时 getTabBar() 可能还没就绪（返回 null），这里补两次短延迟重试，
 * 避免冷启动直接落在非首个 tab 时高亮错位。
 */
function syncSelected(page, index, attempt) {
  const tries = attempt || 0;

  let bar = null;
  try {
    bar = page && page.getTabBar && page.getTabBar();
  } catch (e) {
    bar = null;
  }

  if (bar && typeof bar.setData === 'function') {
    bar.setData({ selected: index });
    return;
  }

  if (tries >= 2) return;
  setTimeout(() => syncSelected(page, index, tries + 1), 60);
}

module.exports = { syncSelected };
