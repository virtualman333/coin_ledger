/**
 * 转发分享：统一文案与落地页。
 * 微信要求每个页面自己实现 onShareAppMessage（转发给朋友）和 onShareTimeline（朋友圈），
 * 这里集中配置，页面里只写一行调用。
 */
const COVER = '/images/share-cover.png';

const PAGES = {
  home: {
    title: '藏币录 · 中国纪念币图鉴与收藏记录',
    path: '/pages/index/index',
    query: '',
  },
  list: {
    title: '全套纪念币品种清单，面额、发行量、规格都能查',
    path: '/pages/list/list',
    query: '',
  },
  mine: {
    title: '我的纪念币收藏记录 · 面值、投入、数量一目了然',
    path: '/pages/mine/mine',
    query: '',
  },
  plan: {
    title: '纪念币发行计划：下一枚什么时候发',
    path: '/pages/plan/plan',
    query: '',
  },
  series: {
    title: '藏币录 · 按系列看纪念币、纪念钞、贵金属',
    path: '/pages/series/series',
    query: '',
  },
};

/** 转发给朋友 */
function appMessage(key, extra) {
  const base = PAGES[key] || PAGES.home;
  return Object.assign({ title: base.title, path: base.path, imageUrl: COVER }, extra || {});
}

/** 分享到朋友圈 */
function timeline(key, query) {
  const base = PAGES[key] || PAGES.home;
  return { title: base.title, query: query || base.query || '', imageUrl: COVER };
}

/** 单个品种的分享：标题带年份与面额，落地到详情页 */
function coinMessage(coin) {
  if (!coin) return appMessage('home');
  return {
    title: coin.name + '｜' + coin.year + ' 年 · 面额 ' + coin.faceText,
    path: '/pages/detail/detail?id=' + coin.id,
    imageUrl: coin.imgUrl || COVER,
  };
}

function coinTimeline(coin) {
  if (!coin) return timeline('home');
  return {
    title: coin.name + '｜' + coin.year + ' 年 · 面额 ' + coin.faceText,
    query: 'id=' + coin.id,
    imageUrl: coin.imgUrl || COVER,
  };
}

/** 贵金属单品的分享：标题带编号与项目，落地到 pmdetail?code=XXX */
function pmMessage(item) {
  if (!item) return appMessage('home');
  var title = item.name || item.code;
  if (item.projectName) title += '｜' + item.projectName;
  return {
    title: title,
    path: '/pages/pmdetail/pmdetail?code=' + encodeURIComponent(item.code),
    imageUrl: item.thumbUrl || COVER,
  };
}

function pmTimeline(item) {
  if (!item) return timeline('home');
  var title = item.name || item.code;
  if (item.projectName) title += '｜' + item.projectName;
  return {
    title: title,
    query: 'code=' + encodeURIComponent(item.code),
    imageUrl: item.thumbUrl || COVER,
  };
}

module.exports = {
  COVER,
  appMessage,
  timeline,
  coinMessage,
  coinTimeline,
  pmMessage,
  pmTimeline,
};
