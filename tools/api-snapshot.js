'use strict';
/**
 * 接口与页面快照（G2 契约零破坏的验收器）
 *
 *   node tools/api-snapshot.js --record [--out tests/snapshots/api-baseline.json]
 *   node tools/api-snapshot.js --check  [--out tests/snapshots/api-baseline.json]
 *
 * 原理：自己起一个临时后端（JSON 存储、临时数据目录、临时 seed/plan 副本），
 * 依次请求「50 个 (method,path) 处理器 + 148 个页面 URL」，把结果规范化后落成 JSON。
 * 迁移前后各跑一次，--check 逐条比对，任何状态码 / 顶层键名 / 错误文案 /
 * 页面 title·description·canonical·og·JSON-LD 的差异都会被点名。
 *
 * 三条设计原则：
 *   1. **不碰仓库数据**：COIN_DATA_DIR / SEED_FILE / PLAN_FILE 全指向临时目录；
 *      会写 public/data/*.json 的接口（gallery / image / series / plan / coins 批量）
 *      一律按「未登录」口径请求（401）—— 既验证了鉴权闸门，又零副作用。
 *   2. **不含易变字段**：serverTime / uptime / token 在比对前被掩码，
 *      否则每次跑都必然 diff。
 *   3. **body 用摘要而非全文**：137 条品种的 bootstrap 有 200KB+，
 *      存 sha256 + 顶层键 + 列表长度，足够了；差异由 --check 的 report 定位。
 *
 * 依赖：只用 Node 内置模块（child_process / fs / os / path / crypto / fetch）。
 */
const { spawn } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const DEFAULT_OUT = path.join(ROOT, 'tests', 'snapshots', 'api-baseline.json');

/* 比对前掩码掉的字段：值本身就是时间/临时路径的函数，多次运行必然不同 */
const MASK_KEYS = new Set([
  'serverTime', 'uptime', 'token', 'exp',        // 时间与会话
  'createdAt', 'lastLogin', 'updatedAt',         // 账号时间戳
  'file', 'tracked', 'generated', 'galleryVer'   // 临时目录路径 / 计数器 / 文件指纹
]);

const ADMIN = { name: 'admin', password: 'TestAdmin123!' };

/**
 * 50 个处理器的清单一览。
 * `auth: true` → 先登录再请求（才能看到真实业务响应）；
 * 写接口一律 `auth: false`，拿到 401 就够证明路由与鉴权闸门都在，且不产生副作用。
 * `body` 里给的载荷刻意选「一定会被拒」的形态（缺字段 / 不存在的 id / 非法类型）。
 */
const API_CASES = [
  // ---- 公共与目录 ----
  { id: 'GET /api/health', method: 'GET', url: '/api/health' },
  { id: 'GET /api/bootstrap', method: 'GET', url: '/api/bootstrap' },
  { id: 'GET /api/state', method: 'GET', url: '/api/state' },
  { id: 'GET /api/series', method: 'GET', url: '/api/series' },
  { id: 'PUT /api/prices', method: 'PUT', url: '/api/prices', auth: false, body: { prices: {} } },
  { id: 'PUT /api/holdings', method: 'PUT', url: '/api/holdings', auth: false, body: { holdings: [] } },
  { id: 'POST /api/holdings/reset', method: 'POST', url: '/api/holdings/reset', auth: false, body: {} },
  { id: 'POST /api/me/profile', method: 'POST', url: '/api/me/profile', auth: false, body: {} },
  { id: 'POST /api/feature-request', method: 'POST', url: '/api/feature-request', auth: false, body: { text: 'x' } },
  { id: 'POST /api/feedback', method: 'POST', url: '/api/feedback', auth: false, body: { text: 'x' } },
  { id: 'GET /api/reminders', method: 'GET', url: '/api/reminders', auth: true },
  { id: 'POST /api/reminders', method: 'POST', url: '/api/reminders', auth: true, body: {} },
  { id: 'DELETE /api/reminders', method: 'DELETE', url: '/api/reminders', auth: true, body: {} },
  { id: 'POST /api/visit', method: 'POST', url: '/api/visit', body: {} },
  { id: 'GET /api/visit', method: 'GET', url: '/api/visit' },

  // ---- 认证 ----
  { id: 'GET /api/auth/me', method: 'GET', url: '/api/auth/me' },
  { id: 'POST /api/auth/register', method: 'POST', url: '/api/auth/register', body: { name: '', password: '' } },
  { id: 'POST /api/auth/login (bad)', method: 'POST', url: '/api/auth/login', body: { name: ADMIN.name, password: 'wrong-password' } },
  { id: 'POST /api/auth/login (empty body)', method: 'POST', url: '/api/auth/login', body: null, rawBody: '' },
  { id: 'POST /api/auth/logout', method: 'POST', url: '/api/auth/logout', body: {} },
  { id: 'POST /api/auth/password', method: 'POST', url: '/api/auth/password', auth: false, body: {} },
  { id: 'POST /api/auth/wx/login', method: 'POST', url: '/api/auth/wx/login', body: {} },
  { id: 'POST /api/auth/wx/bind', method: 'POST', url: '/api/auth/wx/bind', auth: false, body: {} },
  { id: 'POST /api/auth/wx/unbind', method: 'POST', url: '/api/auth/wx/unbind', auth: false, body: {} },

  // ---- 管理端（读：登录后深比；写：未登录，只验 401） ----
  { id: 'GET /api/admin/guard/bans', method: 'GET', url: '/api/admin/guard/bans', auth: true },
  { id: 'POST /api/admin/guard/unban', method: 'POST', url: '/api/admin/guard/unban', auth: false, body: { ip: '203.0.113.1' } },
  { id: 'GET /api/admin/users', method: 'GET', url: '/api/admin/users', auth: true },
  { id: 'GET /api/admin/users/:id/holdings', method: 'GET', url: '/api/admin/users/u1/holdings', auth: true },
  { id: 'GET /api/admin/users/:id', method: 'GET', url: '/api/admin/users/u1', auth: true },
  { id: 'PATCH /api/admin/users/:id', method: 'PATCH', url: '/api/admin/users/u1', auth: false, body: { isTest: true } },
  { id: 'DELETE /api/admin/users/:id', method: 'DELETE', url: '/api/admin/users/u1', auth: false },
  { id: 'POST /api/admin/users/batch', method: 'POST', url: '/api/admin/users/batch', auth: false, body: { ids: [], action: 'enable' } },
  { id: 'GET /api/admin/audit', method: 'GET', url: '/api/admin/audit', auth: true },
  { id: 'GET /api/admin/visitors', method: 'GET', url: '/api/admin/visitors', auth: true },
  { id: 'GET /api/admin/visitors/detail', method: 'GET', url: '/api/admin/visitors/detail', auth: true },
  { id: 'GET /api/admin/feedback', method: 'GET', url: '/api/admin/feedback', auth: true },
  { id: 'PATCH /api/admin/feedback/:id', method: 'PATCH', url: '/api/admin/feedback/zzz', auth: false, body: { status: 'done' } },
  { id: 'DELETE /api/admin/feedback/:id', method: 'DELETE', url: '/api/admin/feedback/zzz', auth: false },
  { id: 'GET /api/admin/plan', method: 'GET', url: '/api/admin/plan', auth: true },
  { id: 'PUT /api/admin/plan', method: 'PUT', url: '/api/admin/plan', auth: false, body: { plan: { years: [] } } },
  { id: 'POST /api/admin/series/members', method: 'POST', url: '/api/admin/series/members', auth: false, body: { key: 'X', ids: [] } },
  { id: 'POST /api/admin/series', method: 'POST', url: '/api/admin/series', auth: false, body: { key: 'ZZ' } },
  { id: 'POST /api/admin/series/image', method: 'POST', url: '/api/admin/series/image', auth: false, body: { key: 'EV', data: '' } },
  { id: 'PATCH /api/admin/series/:key', method: 'PATCH', url: '/api/admin/series/EV', auth: false, body: { name: 'x' } },
  { id: 'DELETE /api/admin/series/:key', method: 'DELETE', url: '/api/admin/series/ZZZ', auth: false },
  { id: 'GET /api/admin/coins', method: 'GET', url: '/api/admin/coins', auth: true },
  { id: 'PATCH /api/admin/coins', method: 'PATCH', url: '/api/admin/coins', auth: false, body: { items: [] } },
  { id: 'PATCH /api/admin/coin', method: 'PATCH', url: '/api/admin/coin', auth: true, body: { id: 99999, patch: { face: 1 } } },
  { id: 'POST /api/admin/gallery', method: 'POST', url: '/api/admin/gallery', auth: false, body: { id: 1, images: [] } },
  { id: 'POST /api/admin/image', method: 'POST', url: '/api/admin/image', auth: false, body: { id: 1, kind: 'main', data: '' } },
  { id: 'DELETE /api/admin/image', method: 'DELETE', url: '/api/admin/image?id=1&kind=nope', auth: false },
  { id: 'ANY /api/__trap', method: 'GET', url: '/api/__trap' },
  { id: 'GET /api/not-found', method: 'GET', url: '/api/definitely-not-a-route' }
];

/** 页面 URL：10 个 tab + sitemap.xml + 137 个品种页 */
function pageUrls() {
  const tabs = ['/', '/all', '/plan', '/overview', '/series', '/holdings', '/cost', '/sitemap', '/account', '/admin'];
  const out = tabs.slice();
  out.push('/sitemap.xml');
  for (let i = 1; i <= 137; i += 1) out.push('/coin/' + i);
  return out;
}

/* ---------------- 规范化 ---------------- */

/** 深拷贝并把易变字段替换成占位符 */
function mask(value) {
  if (Array.isArray(value)) return value.map(mask);
  if (value && typeof value === 'object') {
    const out = {};
    Object.keys(value).forEach((k) => {
      out[k] = MASK_KEYS.has(k) ? '<masked>' : mask(value[k]);
    });
    return out;
  }
  return value;
}

function sha256(text) {
  return crypto.createHash('sha256').update(String(text)).digest('hex');
}

/** 从 HTML 里抽 SEO 关键位（正则足够：模板固定，不引入解析器） */
function extractHtmlMeta(html) {
  const pick = (re) => { const m = re.exec(html); return m ? m[1].trim() : ''; };
  const lds = html.match(/<script type="application\/ld\+json">[\s\S]*?<\/script>/g) || [];
  return {
    title: pick(/<title>([\s\S]*?)<\/title>/),
    description: pick(/<meta name="description" content="([\s\S]*?)">/),
    ogTitle: pick(/<meta property="og:title" content="([\s\S]*?)">/),
    ogDescription: pick(/<meta property="og:description" content="([\s\S]*?)">/),
    ogUrl: pick(/<meta property="og:url" content="([\s\S]*?)">/),
    canonical: pick(/<link rel="canonical" href="([\s\S]*?)">/),
    jsonLdCount: lds.length,
    jsonLdTypes: lds.map((s) => {
      const m = /"@type":"([^"]+)"/.exec(s);
      return m ? m[1] : '?';
    }).join('+'),
    htmlSha256: sha256(html)
  };
}

/**
 * 请求一次并规范化结果。
 *
 * @param {string} base 形如 http://127.0.0.1:39190
 * @param {object} spec 用例（id/method/url/body/auth）
 * @param {string} cookie 登录后的 Cookie 头
 * @returns {Promise<object>} 快照条目
 */
async function hit(base, spec, cookie) {
  const headers = { Accept: '*/*' };
  if (spec.auth && cookie) headers.Cookie = cookie;
  let payload;
  if (spec.rawBody !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = spec.rawBody;
  } else if (spec.body !== undefined && spec.body !== null) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(spec.body);
  }
  const res = await fetch(base + spec.url, { method: spec.method, headers: headers, body: payload, redirect: 'manual' });
  const buf = Buffer.from(await res.arrayBuffer());
  const ct = String(res.headers.get('content-type') || '');
  const entry = { id: spec.id, status: res.status, contentType: ct };

  if (ct.indexOf('application/json') >= 0) {
    let json = null;
    try { json = JSON.parse(buf.toString('utf8')); } catch (e) { json = null; }
    if (json && typeof json === 'object') {
      entry.jsonKeys = Object.keys(json);
      entry.jsonSha256 = sha256(JSON.stringify(mask(json)));
      // 几个「一眼能量化」的字段，diff 时比摘要更可读
      const quant = {};
      ['ok', 'coins', 'images', 'users', 'count', 'total', 'saved', 'affected', 'items', 'years', 'images'].forEach((k) => {
        if (json[k] !== undefined && typeof json[k] !== 'object') quant[k] = json[k];
      });
      if (Array.isArray(json.coins)) quant.coinsLen = json.coins.length;
      if (Array.isArray(json.items)) quant.itemsLen = json.items.length;
      if (Array.isArray(json.users)) quant.usersLen = json.users.length;
      entry.quant = quant;
    } else {
      entry.bodySha256 = sha256(buf);
    }
    entry.cacheControl = res.headers.get('cache-control') || '';
    return entry;
  }

  if (ct.indexOf('text/html') >= 0) {
    Object.assign(entry, extractHtmlMeta(buf.toString('utf8')));
    entry.cacheControl = res.headers.get('cache-control') || '';
    return entry;
  }

  // 静态资源（/img/...）：只比状态、头与长度
  entry.headers = {
    etag: res.headers.get('etag') || '',
    cacheControl: res.headers.get('cache-control') || '',
    contentType: ct,
    contentLength: res.headers.get('content-length') || ''
  };
  entry.bodySha256 = sha256(buf);
  return entry;
}

/* ---------------- 起服务 / 收服务 ---------------- */

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

/**
 * 起一个临时后端实例。
 *
 * @param {number} port 端口
 * @param {object} extraEnv 额外环境变量（如把 RL_READ 调小以验证 429）
 * @returns {Promise<{child: import('node:child_process').ChildProcess, dir: string}>} 句柄
 */
async function bootServer(port, extraEnv) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cl-snapshot-'));
  // seed/plan 用副本：管理端接口万一写文件，也只污染临时目录
  const seedFile = path.join(dir, 'coins.json');
  const planFile = path.join(dir, 'plan.json');
  fs.copyFileSync(path.join(ROOT, 'public', 'data', 'coins.json'), seedFile);
  fs.copyFileSync(path.join(ROOT, 'public', 'data', 'plan.json'), planFile);

  const env = Object.assign({}, process.env, {
    PORT: String(port),
    HOST: '127.0.0.1',
    NODE_ENV: 'test',
    STORAGE: 'json',
    DATA_SOURCE: 'json',
    COIN_DATA_DIR: dir,
    SEED_FILE: seedFile,
    PLAN_FILE: planFile,
    SUPERADMIN_NAME: ADMIN.name,
    SUPERADMIN_PASSWORD: ADMIN.password,
    SESSION_SECRET: 'snapshot-secret',
    WX_APPSECRET: '',
    // 快照要打 200+ 次请求，必须把限流桶调高，否则自己把自己 429 掉
    RL_READ: '100000',
    RL_WRITE: '100000',
    RL_ADMIN_WRITE: '100000',
    RL_LOGIN: '100000',
    RL_STATIC: '100000'
  }, extraEnv || {});

  const child = spawn(process.execPath, ['server/index.js'], { cwd: ROOT, env: env, stdio: ['ignore', 'pipe', 'pipe'] });
  let bootLog = '';
  child.stdout.on('data', (d) => { bootLog += d.toString(); });
  child.stderr.on('data', (d) => { bootLog += d.toString(); });

  const base = 'http://127.0.0.1:' + port;
  for (let i = 0; i < 100; i += 1) {
    try {
      const r = await fetch(base + '/api/health');
      if (r.status === 200) return { child: child, dir: dir };
    } catch (e) { /* 还没起来 */ }
    await sleep(100);
  }
  try { child.kill('SIGKILL'); } catch (e) { /* ignore */ }
  throw new Error('后端未能在 10 秒内启动：\n' + bootLog);
}

function stopServer(handle) {
  return new Promise((resolve) => {
    if (!handle || !handle.child) return resolve();
    const child = handle.child;
    const done = () => {
      try { fs.rmSync(handle.dir, { recursive: true, force: true }); } catch (e) { /* ignore */ }
      resolve();
    };
    child.once('exit', done);
    try { child.kill('SIGTERM'); } catch (e) { /* ignore */ }
    setTimeout(() => { try { child.kill('SIGKILL'); } catch (e) { /* ignore */ } }, 3000).unref();
  });
}

/**
 * 采集一份完整快照。
 *
 * @param {number} [port] 端口（默认 39190）
 * @returns {Promise<object>} { generatedBy, cases[], pages[] }
 */
async function capture(port) {
  const usePort = port || Number(process.env.SNAPSHOT_PORT || 39190);
  const handle = await bootServer(usePort, {});
  const base = 'http://127.0.0.1:' + usePort;
  try {
    // 登录：管理端读接口才能拿到真实响应
    const loginRes = await fetch(base + '/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(ADMIN)
    });
    const setCookie = loginRes.headers.getSetCookie ? loginRes.headers.getSetCookie() : [];
    const cookie = setCookie.map((s) => s.split(';')[0]).join('; ');
    if (!cookie) throw new Error('快照前置登录失败：status=' + loginRes.status);

    const cases = [];
    for (const spec of API_CASES) cases.push(await hit(base, spec, cookie));

    const pages = [];
    for (const u of pageUrls()) {
      pages.push(await hit(base, { id: 'GET ' + u, method: 'GET', url: u }, cookie));
    }
    // 静态资源响应头（ETag / 7 天缓存）单独锁一条
    pages.push(await hit(base, { id: 'GET /img/001.jpg', method: 'GET', url: '/img/001.jpg' }, cookie));
    pages.push(await hit(base, { id: 'HEAD /img/001.jpg', method: 'HEAD', url: '/img/001.jpg' }, cookie));

    return { version: 1, cases: cases, pages: pages };
  } finally {
    await stopServer(handle);
  }
}

/**
 * 采集 guard 行为（限流 429 / 恶意 UA 403）。
 * 单独起一个限流阈值很小的实例，用 X-Forwarded-For 伪装成外部 IP
 * —— 本机 IP 在 guard 里是豁免的，不打这个头永远测不到 429。
 *
 * @param {number} [port] 端口（默认 39191）
 * @returns {Promise<object>} { rateLimited, badUa }
 */
async function captureGuard(port) {
  const usePort = port || Number(process.env.SNAPSHOT_GUARD_PORT || 39191);
  const handle = await bootServer(usePort, { RL_READ: '2', RL_LOGIN: '2' });
  const base = 'http://127.0.0.1:' + usePort;
  const headers = { 'X-Forwarded-For': '203.0.113.7' };
  try {
    const statuses = [];
    for (let i = 0; i < 3; i += 1) {
      const r = await fetch(base + '/api/health', { headers: headers });
      if (i === 2) {
        const body = await r.text();
        statuses.push({
          status: r.status,
          error: JSON.parse(body).error,
          retryAfterHeader: r.headers.has('retry-after'),
          cacheControl: r.headers.get('cache-control')
        });
      } else {
        statuses.push({ status: r.status });
      }
    }
    const uaRes = await fetch(base + '/api/health', { headers: { 'X-Forwarded-For': '203.0.113.8', 'User-Agent': 'python-requests/2.31' } });
    const uaBody = await uaRes.json();
    return {
      rateLimit: statuses,
      badUa: { status: uaRes.status, error: uaBody.error }
    };
  } finally {
    await stopServer(handle);
  }
}

/* ---------------- diff ---------------- */

function diffEntries(before, after, label) {
  const problems = [];
  const bMap = new Map((before || []).map((e) => [e.id, e]));
  const aMap = new Map((after || []).map((e) => [e.id, e]));

  bMap.forEach((b, id) => {
    const a = aMap.get(id);
    if (!a) { problems.push(`[${label}] 缺失：${id}`); return; }
    const keys = new Set(Object.keys(b).concat(Object.keys(a)));
    keys.forEach((k) => {
      if (k === 'id') return;
      const bv = JSON.stringify(b[k]);
      const av = JSON.stringify(a[k]);
      if (bv !== av) problems.push(`[${label}] ${id} 字段 ${k} 变化：${bv} → ${av}`);
    });
  });
  aMap.forEach((a, id) => { if (!bMap.has(id)) problems.push(`[${label}] 新增：${id}`); });
  return problems;
}

/**
 * 比对两份快照。
 *
 * @param {object} baseline 基线
 * @param {object} current 当前
 * @returns {{ok: boolean, problems: string[]}} 比对结果
 */
function diff(baseline, current) {
  const problems = []
    .concat(diffEntries(baseline.cases, current.cases, 'api'))
    .concat(diffEntries(baseline.pages, current.pages, 'page'))
    .concat(diffEntries([baseline.guard], [current.guard], 'guard'));
  return { ok: problems.length === 0, problems: problems };
}

/* ---------------- CLI ---------------- */

async function main(argv) {
  const args = argv.slice(2);
  const record = args.indexOf('--record') >= 0;
  const check = args.indexOf('--check') >= 0;
  const outIdx = args.indexOf('--out');
  const outFile = outIdx >= 0 ? args[outIdx + 1] : DEFAULT_OUT;
  const portIdx = args.indexOf('--port');
  const port = portIdx >= 0 ? Number(args[portIdx + 1]) : undefined;

  if (!record && !check) {
    console.log('用法：node tools/api-snapshot.js --record|--check [--out 文件] [--port 端口]');
    process.exit(2);
  }

  const snapshot = await capture(port);
  snapshot.guard = await captureGuard(port ? port + 1 : undefined);
  snapshot.generatedAt = new Date().toISOString();

  if (record) {
    fs.mkdirSync(path.dirname(outFile), { recursive: true });
    fs.writeFileSync(outFile, JSON.stringify(snapshot, null, 1) + '\n', 'utf8');
    console.log(`已记录快照：${outFile}`);
    console.log(`  API ${snapshot.cases.length} 条 / 页面 ${snapshot.pages.length} 条 / guard 1 组`);
    return;
  }

  if (!fs.existsSync(outFile)) {
    console.error('找不到基线文件：' + outFile + '（先跑 --record）');
    process.exit(2);
  }
  const baseline = JSON.parse(fs.readFileSync(outFile, 'utf8'));
  const result = diff(baseline, snapshot);
  if (result.ok) {
    console.log(`契约一致：API ${snapshot.cases.length} 条 / 页面 ${snapshot.pages.length} 条，diff = 0`);
    return;
  }
  console.error('契约有差异（' + result.problems.length + ' 项）：');
  result.problems.slice(0, 80).forEach((p) => console.error('  - ' + p));
  if (result.problems.length > 80) console.error(`  ... 其余 ${result.problems.length - 80} 项省略`);
  process.exit(1);
}

module.exports = {
  capture: capture,
  captureGuard: captureGuard,
  diff: diff,
  bootServer: bootServer,
  stopServer: stopServer,
  API_CASES: API_CASES,
  pageUrls: pageUrls,
  mask: mask
};

if (require.main === module) {
  main(process.argv).catch((e) => {
    console.error('[snapshot] 失败：', e);
    process.exit(1);
  });
}
