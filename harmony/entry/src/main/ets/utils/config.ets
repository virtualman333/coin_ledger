/** 全局常量：接口域名、版本、口径参数 */
export class Config {
  /** 与网站 / 小程序同一个后端（多端数据同源） */
  static readonly BASE: string = 'https://coin.virtualman.top';
  static readonly APP_NAME: string = '藏币录';
  static readonly APP_VERSION: string = '1.0.0';
  static readonly WEB_URL: string = 'https://coin.virtualman.top';
  static readonly PRIVACY_VERSION: string = '1';
  /** 整卷 / 整刀 默认 20 枚（张） */
  static readonly PER_SET: number = 20;
  /** 请求超时（毫秒） */
  static readonly TIMEOUT: number = 15000;
}

/** preferences 文件名与键 */
export class Keys {
  static readonly STORE: string = 'coin_ledger';
  static readonly TOKEN: string = 'cl_token';
  static readonly CACHE: string = 'cl_cache';
  static readonly PRIVACY: string = 'cl_privacy_agreed';
}
