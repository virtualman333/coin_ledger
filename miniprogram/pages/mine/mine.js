/**
 * 兼容壳：这个路径以前是 tab 页，老分享链接和外部入口都指向它。
 * 现在主容器是 pages/shell（TabBar 常驻其中），这里只做一次重定向，避免 404。
 */
const TAB = 3;

Page({
  onLoad() {
    wx.reLaunch({
      url: '/pages/shell/shell?tab=' + TAB,
      fail() {
        // reLaunch 极少数情况会被拒绝，退化为切到宿主 tab
        wx.switchTab({ url: '/pages/shell/shell' });
      },
    });
  },
});
