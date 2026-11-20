'use strict';
/**
 * 存储门面：对上暴露与 v2 完全相同的接口（load / snapshot / commit / flush），
 * 对下按 STORAGE 环境变量选择后端：
 *
 *   STORAGE=mysql   MySQL 关系表（默认生产用法，见 store-mysql.js）
 *   STORAGE=json    data/db.json 单文档（老行为，作为回退与本地开发默认值）
 *
 * 两个后端都要求「先 await init()，之后 load() 同步返回内存镜像」：
 * 业务代码照旧读内存里的整份文档，只有写路径变成异步 ——
 * commit 把 mutator 串进一条队列，逐个在事务里落库，落库成功才替换内存镜像，
 * 因此并发请求不会互相覆盖，落库失败时内存也不会领先于磁盘/数据库。
 */
// 只保留数据库模式：STORAGE 开关已移除，避免环境变量误配悄悄回退到 JSON 文件
const MODE = 'mysql';
const backend = require('./store-mysql');

let doc = null;
let chain = Promise.resolve();   // commit 串行队列

function load() {
  if (doc) return doc;
  if (MODE === 'mysql') {
    // MySQL 模式下没有同步读：必须等 init() 把镜像拉回来
    throw new Error('[store] MySQL 模式必须先 await store.init()');
  }
  doc = backend.load();
  return doc;
}

function snapshot() {
  return JSON.parse(JSON.stringify(load()));
}

async function init() {
  doc = await backend.init();
  return doc;
}

/**
 * 读-改-写提交一次变更，返回 mutator 的返回值。
 * 注意：返回 Promise，调用方必须 await（JSON 模式下 await 普通值也无副作用）。
 */
function commit(mutator) {
  const run = async () => {
    const base = load();
    const draft = JSON.parse(JSON.stringify(base));
    const result = mutator(draft);
    draft.updatedAt = new Date().toISOString();
    draft.rev = (base.rev || 0) + 1;
    await backend.save(draft, base);
    doc = draft;                 // 落库成功后才对读路径可见
    return result;
  };
  const p = chain.then(run);
  chain = p.then(() => undefined, () => undefined);   // 单次失败不阻塞后续请求
  return p;
}

async function flush() {
  await backend.flush();
}

async function close() {
  await backend.close();
}

function info() {
  return backend.info();
}

module.exports = {
  MODE, init, load, snapshot, commit, flush, close, info,
  DB_FILE: backend.DB_FILE,
  DATA_DIR: backend.DATA_DIR
};
