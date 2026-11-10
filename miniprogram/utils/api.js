/**
 * 与网站后端通信。数据落在服务器数据库里，账号与网页版互通。
 * 小程序没有 Cookie 会话，这里用 Authorization: Bearer <token>。
 */
const BASE = 'https://coin.virtualman.top';
const TOKEN_KEY = 'cl_token';

function getToken() {
  return wx.getStorageSync(TOKEN_KEY) || '';
}

function setToken(token) {
  if (token) {
    wx.setStorageSync(TOKEN_KEY, token);
  } else {
    wx.removeStorageSync(TOKEN_KEY);
  }
}

function request(method, path, data) {
  return new Promise((resolve, reject) => {
    const header = { 'content-type': 'application/json' };
    const token = getToken();
    if (token) {
      header.Authorization = 'Bearer ' + token;
    }
    wx.request({
      url: BASE + path,
      method,
      data,
      header,
      timeout: 15000,
      success(res) {
        const body = res.data && typeof res.data === 'object' ? res.data : {};
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(body);
          return;
        }
        if (res.statusCode === 401 && token) {
          setToken('');
        }
        const err = new Error(body.error || '服务器返回错误（' + res.statusCode + '）');
        err.status = res.statusCode;
        reject(err);
      },
      fail(res) {
        const msg = res && res.errMsg ? res.errMsg : '';
        const err = new Error(
          /timeout/i.test(msg) ? '请求超时，请稍后重试' : '连不上服务器，请检查网络'
        );
        err.status = 0;
        reject(err);
      },
    });
  });
}

module.exports = {
  BASE,
  getToken,
  setToken,
  get: (path) => request('GET', path),
  put: (path, data) => request('PUT', path, data),
  post: (path, data) => request('POST', path, data),
  patch: (path, data) => request('PATCH', path, data),
  del: (path, data) => request('DELETE', path, data),
};
