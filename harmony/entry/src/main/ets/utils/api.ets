/**
 * 与后端通信。数据落在服务器数据库里，账号与网页版 / 小程序互通。
 * 使用 Authorization: Bearer <token>（不依赖 Cookie）。
 */
import { http } from '@kit.NetworkKit';
import { BusinessError } from '@kit.BasicServicesKit';
import { Config } from './config';

export class ApiError extends Error {
  status: number = 0;
  needLogin: boolean = false;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
    this.needLogin = status === 401;
  }
}

/** 服务端错误体（只关心 error 字段） */
class ErrorBody {
  error?: string;
}

export class Api {
  static BASE: string = Config.BASE;
  static token: string = '';
  /** 401 时由 Store 注入：清登录态与缓存 */
  static onExpired: (() => void) | null = null;

  static setToken(token: string): void {
    Api.token = token || '';
  }

  static async request<T>(method: http.RequestMethod, path: string, body?: Object): Promise<T> {
    const req = http.createHttp();
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (Api.token) {
      headers['Authorization'] = 'Bearer ' + Api.token;
    }
    const options: http.HttpRequestOptions = {
      method: method,
      header: headers,
      connectTimeout: Config.TIMEOUT,
      readTimeout: Config.TIMEOUT,
      expectDataType: http.HttpDataType.STRING
    };
    if (body !== undefined) {
      options.extraData = JSON.stringify(body);
    }

    let res: http.HttpResponse;
    try {
      res = await req.request(Api.BASE + path, options);
    } catch (e) {
      const be = e as BusinessError;
      const msg = be && be.message ? be.message : '';
      req.destroy();
      if (/timeout/i.test(msg)) {
        throw new ApiError('请求超时，请稍后重试', 0);
      }
      throw new ApiError('连不上服务器，请检查网络', 0);
    }
    req.destroy();

    const code: number = res.responseCode;
    const raw: string = typeof res.result === 'string' ? res.result : '';

    if (code >= 200 && code < 300) {
      return JSON.parse(raw.length > 0 ? raw : '{}') as T;
    }

    if (code === 401 && Api.token) {
      Api.setToken('');
      if (Api.onExpired) Api.onExpired();
    }
    let msg = '';
    if (raw.length > 0) {
      let errBody: ErrorBody = new ErrorBody();
      try {
        errBody = JSON.parse(raw) as ErrorBody;
      } catch (e) {
        errBody = new ErrorBody();
      }
      if (errBody.error) msg = String(errBody.error);
    }
    if (code === 401) msg = '登录已过期，请重新登录';
    if (!msg) msg = '服务器返回错误（' + code + '）';
    throw new ApiError(msg, code);
  }

  static get<T>(path: string): Promise<T> {
    return Api.request<T>(http.RequestMethod.GET, path);
  }

  static post<T>(path: string, body?: Object): Promise<T> {
    return Api.request<T>(http.RequestMethod.POST, path, body);
  }

  static put<T>(path: string, body?: Object): Promise<T> {
    return Api.request<T>(http.RequestMethod.PUT, path, body);
  }

  /**
   * 鸿蒙 http 的 RequestMethod 没有 PATCH 成员（只有 OPTIONS/GET/HEAD/POST/PUT/DELETE/TRACE/CONNECT）。
   * 枚举本质是字符串，这里显式断言成枚举值，让底层按 PATCH 发出；管理端接口依赖它。
   */
  static patch<T>(path: string, body?: Object): Promise<T> {
    return Api.request<T>('PATCH' as http.RequestMethod, path, body);
  }

  static del<T>(path: string, body?: Object): Promise<T> {
    return Api.request<T>(http.RequestMethod.DELETE, path, body);
  }

  /** 图片地址：服务端可能返回相对路径 */
  static imgUrl(path: string): string {
    if (!path) return '';
    const u = path.indexOf('http') === 0 ? path : Api.BASE + path;
    // CDN 原图文件名带空格（…/3克铂正 0916.png），不编码会整张图加载失败
    return u.replace(/ /g, '%20');
  }
}
