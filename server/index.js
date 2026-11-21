'use strict';
/**
 * 藏币录后端入口（薄壳）。
 *
 * 装配与生命周期全在 server/app.js；路由按域放在 server/routes，业务在 server/services。
 * 这里只保留「启动 / 失败退出」两行，方便 Supervisor 与本地 `npm start` 行为一致。
 *
 * 保持不变的两个外部契约：
 *   1. 启动命令仍是 `node server/index.js`（package.json main 与 Supervisor 配置不动）；
 *   2. 监听地址仍是 HOST:PORT（默认 127.0.0.1:3100）。
 */
const app = require('./app');

app.start().catch(function onBootError(e) {
  console.error('[boot] 启动失败：', e);
  process.exit(1);
});
