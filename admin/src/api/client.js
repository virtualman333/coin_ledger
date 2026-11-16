/**
 * 统一 API 客户端。
 * - 同源 Cookie 会话（与前台共用 cl_session），不另造登录体系
 * - 统一错误模型：ApiError(message, status, payload, needLogin)
 * - 支持 AbortSignal，页面切换时可取消在途请求
 */

export class ApiError extends Error {
  constructor(message, status = 0, payload = null) {
    super(message || '请求失败');
    this.name = 'ApiError';
    this.status = status;
    this.payload = payload;
    this.needLogin = status === 401;
  }
}

function buildUrl(path, params) {
  let url = '/api' + path;
  if (params && typeof params === 'object') {
    const q = new URLSearchParams();
    Object.keys(params).forEach((k) => {
      const v = params[k];
      if (v === undefined || v === null || v === '') return;
      q.append(k, String(v));
    });
    const s = q.toString();
    if (s) url += (url.includes('?') ? '&' : '?') + s;
  }
  return url;
}

export function request(path, options = {}) {
  const { method = 'GET', body, params, signal } = options;
  const init = {
    method,
    credentials: 'same-origin',
    headers: { Accept: 'application/json' },
    signal
  };
  if (body !== undefined) {
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  return fetch(buildUrl(path, params), init).then(async (res) => {
    let data = null;
    try {
      data = await res.json();
    } catch {
      data = null;
    }
    if (!res.ok || (data && data.ok === false)) {
      const msg = (data && (data.error || data.message)) || `HTTP ${res.status}`;
      throw new ApiError(msg, res.status, data);
    }
    return data;
  });
}

export const http = {
  get: (path, params, signal) => request(path, { params, signal }),
  post: (path, body, signal) => request(path, { method: 'POST', body, signal }),
  put: (path, body, signal) => request(path, { method: 'PUT', body, signal }),
  patch: (path, body, signal) => request(path, { method: 'PATCH', body, signal }),
  del: (path, body, signal) => request(path, { method: 'DELETE', body, signal })
};

/** 把任意异常转成可读文案，页面统一用这个，不各自拼字符串 */
export function errorMessage(err) {
  if (!err) return '未知错误';
  if (err.needLogin) return '登录已失效，请重新登录';
  return err.message || String(err);
}
