const store = require('./store');

/**
 * 管理端页面的权限闸门。
 *
 * 管理首页和各子页面都从 URL 直接可达，只在首页拦一次不够 ——
 * 用户从收藏的链接或分享卡片进到某个三级页时同样要挡。
 * 非管理员：提示后返回上一页；没有上一页（直链进入）就回「我的」。
 */
function ensureAdmin() {
  const state = store.getState ? store.getState() : store.state;
  if (state && state.isAdmin) return true;
  wx.showModal({
    title: '没有权限',
    content: '只有管理员能进入管理端。',
    showCancel: false,
    success: () => {
      wx.navigateBack({
        fail: () => {
          wx.switchTab({ url: '/pages/mine/mine' });
        },
      });
    },
  });
  return false;
}

module.exports = { ensureAdmin };
