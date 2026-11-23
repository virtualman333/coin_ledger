/**
 * 应用级开关（维护状态）。
 *
 * 服务端 GET /api/app-config 返回 { maintenance }，管理端可以随时切换。
 * 开启后小程序隐藏收藏账本相关入口，只保留图鉴 / 发行计划 / 拍照数币。
 *
 * 缓存 60 秒：避免每个页面 onShow 都打一次接口；冷启动时强制刷一次。
 */
const api = require('./api');

const CACHE_MS = 60 * 1000;

let state = { maintenance: false, at: 0 };
let inflight = null;

function get() {
  return { maintenance: !!state.maintenance };
}

function isMaintenance() {
  return !!state.maintenance;
}

/** 是否已经拿到过一次结果（用来区分「关」和「还不知道」，避免首屏闪一下账本） */
function ready() {
  return state.at > 0;
}

/**
 * 拉取最新开关。
 *
 * @param {object} [opts] { force: 忽略 60 秒缓存 }
 * @returns {Promise<{maintenance: boolean}>}
 */
function refresh(opts) {
  const force = !!(opts && opts.force);
  if (!force && Date.now() - state.at < CACHE_MS) return Promise.resolve(get());
  if (inflight) return inflight;
  inflight = api.get('/api/app-config')
    .then((r) => {
      state = { maintenance: !!(r && r.maintenance), at: Date.now() };
      return get();
    })
    .catch(() => {
      // 拉不到就按关闭处理：维护状态是收紧功能，不能因为一次网络失败把用户挡在外面
      state = { maintenance: false, at: Date.now() };
      return get();
    })
    .then((v) => {
      inflight = null;
      return v;
    });
  return inflight;
}

module.exports = { get, isMaintenance, ready, refresh };
