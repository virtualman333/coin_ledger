'use strict';
/**
 * 应用装配（Fastify）与生命周期。
 *
 * 这里只做「接线」，不做任何业务判断 —— 业务在 services，HTTP 细节在 routes：
 *
 *   插件顺序（= hook 执行顺序，不可调换）
 *     logging   记录 startedAt 并挂 raw 'finish' 兜底日志
 *     security  guard.inspect 分级限流 + 安全头（429/403 文案与阈值不变）
 *     static    接管所有非 /api 请求（ETag / 7 天缓存 / /data 403 / SPA 回落）
 *     auth      decorateRequest('user') + requireLogin / requireAdmin
 *     body      不消费请求体（各路由按需 readBody，体积上限不同）
 *     db        目录域连接池
 *     errors    统一 {ok:false,error} 与 404「接口不存在」
 *
 *   路由
 *     routes/index.js 按域注册（auth / account / feedback / visitors / reminders /
 *     catalog / holdings-extra / admin/* / honeypot），最后 fallback 兜底。
 *
 * bodyLimit 说明：Fastify 实例级给 8MB（够 /api/feedback 的 8MB 图片），
 * 但因为 body 插件把原始流原样交回、Fastify 并不解析，真正的限制是各路由
 * 自己 readBody(limit)：4KB / 16KB / 512KB / 6MB / 8MB。
 */
const Fastify = require('fastify');

const config = require('./config');
const store = require('./store');
const catalogState = require('./state/catalog');
const superadmin = require('./bootstrap/superadmin');
const reminders = require('./reminders');
const registerAll = require('./routes');

/** 实例级上限：留足 /api/feedback（8MB）的余量 */
const DEFAULT_BODY_LIMIT = 8 * 1024 * 1024;

/**
 * 装配一个可测试的 Fastify 实例（不连库、不监听端口）。
 * 调用前必须已经 await store.init() 且 catalogState.loadSeed() 跑过。
 *
 * @param {{ bodyLimit?: number }} [opts] 覆盖项
 * @returns {Promise<import('fastify').FastifyInstance>} Fastify 实例
 */
async function buildApp(opts = {}) {
  const app = Fastify({
    logger: false,                 // 访问日志自己打（单行格式必须与改造前一致）
    bodyLimit: Number(opts.bodyLimit || DEFAULT_BODY_LIMIT),
    disableRequestLogging: true,
    // 默认 keepAliveTimeout(72s) 比 Node 默认值长，只是少建连接，不影响响应内容
    connectionTimeout: 0
  });

  await app.register(require('./plugins/logging'));
  await app.register(require('./plugins/security'));
  await app.register(require('./plugins/static'));
  await app.register(require('./plugins/auth'));
  await app.register(require('./plugins/body'));
  await app.register(require('./plugins/db'));
  await app.register(require('./plugins/errors'));

  // T03：目录域数据源 + catalog.service 一次装配，所有新路由共享同一实例。
  // 只用数据库模式：plugins/db 建好的池。
  const { createDataSource } = require('./services/data-source');
  const catalogService = require('./services/catalog.service');
  const metalPriceService = require('./services/metal-price.service');
  const dataSource = createDataSource({ mode: 'db', pool: app.db });
  app.decorate('dataSource', dataSource);
  app.decorate('catalog', catalogService.create(dataSource));
  app.decorate('metalPrice', metalPriceService.create());

  // /api/* 永不缓存 + nosniff（历史契约：老处理器每条响应都带这两个头）
  app.addHook('onSend', async function apiHeaders(request, reply, payload) {
    const { pathname } = require('url').parse(request.raw.url || '/');
    if (pathname.startsWith('/api/')) {
      reply.header('Cache-Control', 'no-store');
      reply.header('X-Content-Type-Options', 'nosniff');
    }
    return payload;
  });

  // 关闭钩子：把用户域的 commit 队列刷干净再退，避免丢掉最后一次写入
  app.addHook('onClose', async function flushStore() {
    try { await store.flush(); } catch (e) { console.error('[shutdown] store.flush 失败：' + e.message); }
    try { await store.close(); } catch (e) { console.error('[shutdown] store.close 失败：' + e.message); }
  });

  await registerAll(app);
  return app;
}

/**
 * 启动：配置自检 → 存储初始化 → 目录数据载入 → 建超管 → 监听。
 * 顺序不能变：MySQL 模式下 store 必须先 init，之后所有请求才能同步读内存镜像。
 *
 * @returns {Promise<import('fastify').FastifyInstance>} 已监听的实例
 */
async function start() {
  const check = config.selfCheck();
  check.warnings.forEach(function (w) { console.warn('[config] ' + w); });
  if (!check.ok) {
    check.errors.forEach(function (e) { console.error('[config] ' + e); });
    process.exit(1);
  }

  try {
    await store.init();
  } catch (e) {
    console.error('[boot] 存储初始化失败：' + e.message);
    process.exit(1);
  }

  const st = store.info();
  console.log(`[boot] 存储后端 ${st.mode}` +
    (st.mode === 'mysql' ? ` ${st.host}:${st.port}/${st.database}（账号 ${st.user}）` : ` ${st.file}`));

  // 启动顺序有依赖：先载目录数据，再建超管（超管的默认持仓来自 coins.json）
  catalogState.loadSeed();
  await superadmin.ensureSuperadmin();

  const app = await buildApp();
  const pmNames = await catalogState.loadPmNames(app.db);
  console.log('[boot] 贵金属可收藏白名单 ' + pmNames + ' 项');

  let closing = false;
  async function shutdown(sig) {
    if (closing) return;
    closing = true;
    console.log(`[shutdown] 收到 ${sig}，正在关闭…`);
    // 3 秒兜底：老实现同样有这一条，避免连接不释放导致进程挂着
    setTimeout(function forceExit() { process.exit(0); }, 3000).unref();
    try {
      await app.close();
    } catch (e) {
      console.error('[shutdown] 关闭时出错：' + e.message);
    }
    process.exit(0);
  }
  process.on('SIGTERM', function onTerm() { shutdown('SIGTERM'); });
  process.on('SIGINT', function onInt() { shutdown('SIGINT'); });

  await app.listen({ port: config.PORT, host: config.HOST });
  console.log(`[ready] 藏币录后端 v${config.VERSION} 监听 http://${config.HOST}:${config.PORT}`);
  console.log('[ready] DATA_SOURCE=db（仅数据库模式）');
  reminders.start();          // 预约提醒定时器
  return app;
}

module.exports = { buildApp: buildApp, start: start };
