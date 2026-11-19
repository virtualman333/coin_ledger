'use strict';
/**
 * 数据源装配与只读语义（`DATA_SOURCE=db|json` 的收口处）。
 *
 * 灰度/回滚的四步（arch 5.3）全部由这一个开关驱动，不动业务代码：
 *   S0 `json`           读 JSON（现状）
 *   S1 `db` + 写落文件   读库
 *   S2 `db`             读写都走库
 *   S3 回滚 `json`      读 JSON 只读，写操作一律 503
 *
 * 默认值必须是 `json`：新代码上线首启不改变现状，切库是显式动作。
 */
const config = require('../config');
const common = require('../schemas/common');
const { createRepos } = require('../repositories');

/** 合法取值 */
const MODES = ['db', 'json'];

/**
 * 解析 DATA_SOURCE：非法值回落 json（并让判断方向永远是「安全」的那一侧）。
 *
 * @param {unknown} raw 原始值
 * @returns {'db'|'json'} 模式
 */
function resolveMode(raw) {
  const v = String(raw === undefined || raw === null ? '' : raw).trim().toLowerCase();
  return v === 'db' ? 'db' : 'json';
}

/**
 * 数据源门面：把「仓储包 + 可写性判断」绑在一起。
 * service 只依赖它的 `repos` 与 `assertWritable()`。
 */
class DataSource {
  /**
   * @param {'db'|'json'} mode 模式
   * @param {object} repos 仓储包（repositories/index.js 的返回值）
   */
  constructor(mode, repos) {
    this.mode = mode;
    this.repos = repos;
  }

  /** 当前模式是否可写目录 */
  get writable() {
    return this.mode === 'db';
  }

  /**
   * 写操作前置断言：只读模式抛 503，文案由管理端原样展示。
   *
   * @returns {void}
   * @throws {common.ReadonlyError} DATA_SOURCE=json 时
   */
  assertWritable() {
    if (!this.writable) throw new common.ReadonlyError();
  }

  /** 安全描述（日志用，不含口令） */
  describe() {
    return { mode: this.mode, writable: this.writable };
  }
}

/**
 * 创建数据源。
 *
 * @param {{mode?: string, pool?: object|null}} [opts] 缺省读环境变量；db 模式必须给 pool
 * @returns {DataSource} 数据源
 */
function createDataSource(opts) {
  const options = opts || {};
  const mode = options.mode ? resolveMode(options.mode) : resolveMode(config.DATA_SOURCE);
  const pool = options.pool || null;
  if (mode === 'db' && !pool) {
    throw new Error('DATA_SOURCE=db 需要传入 mysql 连接池（见 server/plugins/db.js）');
  }
  return new DataSource(mode, createRepos({ mode: mode, pool: pool }));
}

module.exports = {
  MODES: MODES,
  resolveMode: resolveMode,
  DataSource: DataSource,
  createDataSource: createDataSource,
  ReadonlyError: common.ReadonlyError
};
