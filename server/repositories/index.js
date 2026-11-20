'use strict';
/**
 * 仓储工厂。
 *
 * 这是 `DATA_SOURCE=db|json` 唯一的分叉点（arch 1.1 H6）：
 * 上层（service / route）拿到的永远是同一个接口族，不知道背后是库还是文件。
 * 回滚 = 改一个环境变量 + 重启，不需要动任何业务代码。
 *
 * 每个仓储都是「无状态工厂」：create(pool) 返回对象；json 版忽略 pool。
 */
const coinRepo = require('./coin.repo');
const descriptionRepo = require('./description.repo');
const seriesRepo = require('./series.repo');
const setRepo = require('./set.repo');
const imageRepo = require('./image.repo');
const planRepo = require('./plan.repo');
const defaultHoldingsRepo = require('./default-holdings.repo');
const pmPieceRepo = require('./pm-piece.repo');

/**
 * 装配一组仓储。
 *
 * @param {{mode?: string, pool?: object|null}} opts mode='db' 时必须给 pool
 * @returns {{mode: string, coins: object, descriptions: object, series: object,
 *            sets: object, images: object, plan: object, defaultHoldings: object, pmPieces: object}} 仓储包
 */
function createRepos(opts) {
  const options = opts || {};
  const pool = options.pool || null;
  if (!pool) throw new Error('数据库模式必须提供 mysql 连接池');
  return {
    mode: 'db',
    coins: coinRepo.create(pool),
    descriptions: descriptionRepo.create(pool),
    series: seriesRepo.create(pool),
    sets: setRepo.create(pool),
    images: imageRepo.create(pool),
    plan: planRepo.create(pool),
    defaultHoldings: defaultHoldingsRepo.create(pool),
    pmPieces: pmPieceRepo.create(pool)
  };
}

module.exports = { createRepos: createRepos };
