'use strict';
/**
 * 藏币录后端入口（薄壳）。
 *
 * 从 v3.0.x 起这里是 Fastify 装配的入口；1869 行的裸 http 处理器已原样搬到
 * server/legacy/api-handler.js（T01 绞杀者阶段，未迁移路径全部委托给它）。
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
