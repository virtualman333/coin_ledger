'use strict';
/**
 * 契约冒烟测试（T01 验收②③④）
 *
 * 起一个真实的 Fastify 进程（JSON 存储 + 临时数据目录），把「换框架不能破契约」
 * 这条红线固化成断言：状态码、错误文案、顶层键名、页面 meta、静态头、限流行为。
 *
 * 与 tools/api-snapshot.js 的分工：
 *   - 本测试：跑得快、断言明确，进 `npm test`，专门守几个最容易破的点；
 *   - 快照工具：跑得慢（200+ 请求），人工执行 `npm run snapshot:record|check`，
 *     用来做「迁移前后逐条 diff」。
 *
 * 不连生产、不写仓库数据：COIN_DATA_DIR / SEED_FILE / PLAN_FILE 全部指向临时目录。
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const PORT = 39121;
const BASE = 'http://127.0.0.1:' + PORT;

let tmpDir = '';
let proc = null;
let cookie = '';

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

/**
 * 发一个请求。
 * @param {string} method 方法
 * @param {string} url 相对路径
 * @param {object|string|null} body JSON 对象或原始字符串
 * @param {object} extraHeaders 额外头
 * @returns {Promise<{status:number, headers:Headers, text:string, json:object|null}>} 响应
 */
async function req(method, url, body, extraHeaders) {
  const headers = Object.assign({ Accept: '*/*' }, extraHeaders || {});
  if (cookie) headers.Cookie = cookie;
  let payload;
  if (body !== undefined && body !== null) {
    headers['Content-Type'] = 'application/json';
    payload = typeof body === 'string' ? body : JSON.stringify(body);
  }
  const res = await fetch(BASE + url, { method, headers, body: payload, redirect: 'manual' });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch (e) { json = null; }
  const sc = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
  if (sc.length) cookie = sc.map((s) => s.split(';')[0]).join('; ');
  return { status: res.status, headers: res.headers, text, json };
}

before(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cl-contract-'));
  const seedFile = path.join(tmpDir, 'coins.json');
  const planFile = path.join(tmpDir, 'plan.json');
  fs.copyFileSync(path.join(ROOT, 'public', 'data', 'coins.json'), seedFile);
  fs.copyFileSync(path.join(ROOT, 'public', 'data', 'plan.json'), planFile);

  proc = spawn(process.execPath, ['server/index.js'], {
    cwd: ROOT,
    env: Object.assign({}, process.env, {
      PORT: String(PORT),
      HOST: '127.0.0.1',
      NODE_ENV: 'test',
      STORAGE: 'json',
      DATA_SOURCE: 'json',
      COIN_DATA_DIR: tmpDir,
      SEED_FILE: seedFile,
      PLAN_FILE: planFile,
      SUPERADMIN_NAME: 'admin',
      SUPERADMIN_PASSWORD: 'TestAdmin123!',
      SESSION_SECRET: 'contract-secret',
      WX_APPSECRET: '',
      RL_READ: '2'          // 故意很小的读额度，用来验证 429 仍然生效
    }),
    stdio: 'ignore'
  });

  for (let i = 0; i < 100; i += 1) {
    try {
      const r = await fetch(BASE + '/api/health');
      if (r.status === 200) return;
    } catch (e) { /* 还没起来 */ }
    await sleep(100);
  }
  throw new Error('测试后端未能在 10 秒内启动');
});

after(async () => {
  if (proc) {
    await new Promise((resolve) => {
      proc.once('exit', resolve);
      try { proc.kill('SIGTERM'); } catch (e) { resolve(); }
      setTimeout(resolve, 3000).unref();
    });
  }
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (e) { /* ignore */ }
});

test('GET /api/health：200 且顶层键名不变', async () => {
  const r = await req('GET', '/api/health');
  assert.equal(r.status, 200);
  assert.deepEqual(Object.keys(r.json), ['ok', 'version', 'uptime', 'coins', 'images', 'users', 'rev', 'storage', 'guard']);
  assert.equal(r.json.ok, true);
  assert.equal(r.json.coins, 137);
  assert.equal(r.headers.get('cache-control'), 'no-store');
});

test('未知 /api/*：404 且文案逐字一致（不是 Fastify 默认文案）', async () => {
  const r = await req('GET', '/api/definitely-not-a-route');
  assert.equal(r.status, 404);
  assert.deepEqual(r.json, { ok: false, error: '接口不存在' });
});

test('GET /api/bootstrap：137 条品种且 i 从 0 连续，desc 128 条', async () => {
  const r = await req('GET', '/api/bootstrap');
  assert.equal(r.status, 200);
  const keys = Object.keys(r.json);
  assert.deepEqual(keys, ['version', 'rev', 'serverTime', 'user', 'isAdmin', 'coins', 'series', 'sets',
    'defaults', 'holdings', 'imgSet', 'imgReal', 'gallery', 'galleryVer', 'plan', 'seriesMeta', 'desc', 'userCount']);
  assert.equal(r.json.coins.length, 137);
  assert.equal(r.json.coins[0].i, 0);
  assert.equal(r.json.coins[136].i, 136);
  // 零漂移的两个已知坑：dia 的「—」与 mintage 的小数
  assert.equal(r.json.coins[39].dia, '—');
  assert.equal(r.json.coins[1].mintage, 261.5);
  assert.equal(Object.keys(r.json.desc).length, 128);
});

test('GET /coin/1：title/description/canonical/og/JSON-LD 都由服务端注入', async () => {
  const r = await req('GET', '/coin/1');
  assert.equal(r.status, 200);
  assert.match(r.text, /<title>[^<]*中华人民共和国成立三十五周年[^<]*<\/title>/);
  assert.match(r.text, /<link rel="canonical" href="https:\/\/coin\.virtualman\.top\/coin\/1">/);
  assert.match(r.text, /<meta property="og:url" content="https:\/\/coin\.virtualman\.top\/coin\/1">/);
  assert.match(r.text, /"@type":"Product"/);
  assert.match(r.text, /"@type":"BreadcrumbList"/);
  assert.match(r.text, /id="ssrCoin"/);
});

test('GET /coin/999：越界页码回落成 404 纯文本（与改造前一致）', async () => {
  const r = await req('GET', '/coin/999');
  assert.equal(r.status, 404);
  assert.equal(r.text, '404 Not Found');
});

test('静态资源：ETag + 7 天强缓存 + If-None-Match 命中 304', async () => {
  const r = await req('GET', '/img/001.jpg');
  assert.equal(r.status, 200);
  const etag = r.headers.get('etag');
  assert.ok(etag && etag.startsWith('W/"'), 'ETag 应为弱校验格式：' + etag);
  assert.equal(r.headers.get('cache-control'), 'public, max-age=604800');
  assert.equal(r.headers.get('x-content-type-options'), 'nosniff');

  const r304 = await req('GET', '/img/001.jpg', null, { 'If-None-Match': etag });
  assert.equal(r304.status, 304);
});

test('非 GET/HEAD 的静态路径：405 纯文本', async () => {
  const r = await req('POST', '/all', {});
  assert.equal(r.status, 405);
  assert.equal(r.text, '405 Method Not Allowed');
});

test('空 body 的 JSON POST：走到业务分支（401），不是 400/500', async () => {
  const r = await req('POST', '/api/auth/login', null);
  assert.equal(r.status, 401);
  assert.deepEqual(r.json, { ok: false, error: '用户名或密码不正确' });
});

test('非法 JSON：400 且文案与改造前一致', async () => {
  const r = await req('POST', '/api/auth/login', '{bad');
  assert.equal(r.status, 400);
  assert.deepEqual(r.json, { ok: false, error: '请求体不是合法 JSON' });
});

test('未登录写接口：401 + needLogin', async () => {
  const r = await req('PUT', '/api/holdings', { holdings: [] });
  assert.equal(r.status, 401);
  assert.deepEqual(r.json, { ok: false, error: '请先登录', needLogin: true });
});

test('登录后可读管理端列表（Cookie 会话照旧）', async () => {
  const login = await req('POST', '/api/auth/login', { name: 'admin', password: 'TestAdmin123!' });
  assert.equal(login.status, 200);
  assert.equal(login.json.ok, true);
  assert.ok(cookie, '应下发会话 Cookie');

  const coins = await req('GET', '/api/admin/coins');
  assert.equal(coins.status, 200);
  assert.equal(coins.json.coins.length, 137);
  assert.equal(Object.keys(coins.json.sets).length, 21);
});

test('guard 限额仍然生效：第 3 次读返回 429 + Retry-After', async () => {
  // 本机 IP 在 guard 里豁免，用 X-Forwarded-For 冒充外部 IP 才能触发限流
  const headers = { 'X-Forwarded-For': '203.0.113.7' };
  const seen = [];
  for (let i = 0; i < 3; i += 1) seen.push((await req('GET', '/api/health', null, headers)).status);
  assert.deepEqual(seen.slice(0, 2), [200, 200]);
  assert.equal(seen[2], 429);

  const limited = await req('GET', '/api/health', null, headers);
  assert.equal(limited.status, 429);
  assert.deepEqual(limited.json, { ok: false, error: '请求过于频繁，请稍后再试' });
  assert.ok(limited.headers.get('retry-after'), '应带 Retry-After');
});

test('guard 恶意 UA：403 文案不变', async () => {
  const r = await req('GET', '/api/health', null, {
    'X-Forwarded-For': '203.0.113.8',
    'User-Agent': 'python-requests/2.31'
  });
  assert.equal(r.status, 403);
  assert.deepEqual(r.json, { ok: false, error: '请求被拒绝' });
});

/* ---------------- T03：目录接口层 ---------------- */

test('GET /api/series：20 个系列 + count，与 legacy 同构', async () => {
  const r = await req('GET', '/api/series');
  assert.equal(r.status, 200);
  assert.deepEqual(Object.keys(r.json), ['ok', 'items']);
  assert.equal(r.json.items.length, 20);
  assert.deepEqual(Object.keys(r.json.items[0]), ['key', 'name', 'desc', 'img', 'sort', 'imgFrom', 'count']);
  assert.ok(r.json.items.every((s) => Number.isInteger(s.count)));
});

test('GET /api/catalog：统一排序 category_rank → year DESC → no ASC', async () => {
  const all = await req('GET', '/api/catalog?page=1&size=5');
  assert.equal(all.status, 200);
  assert.deepEqual(Object.keys(all.json), ['ok', 'total', 'page', 'size', 'items']);
  assert.equal(all.json.total, 137);
  assert.equal(all.json.page, 1);
  assert.equal(all.json.size, 5);
  // 2026 年的普通币排在最前，且 no 升序
  assert.deepEqual(all.json.items.map((x) => x.no), [132, 133, 134, 137, 127]);
  assert.ok(all.json.items.every((x) => x.category === 'commemorative_coin'));

  const notes = await req('GET', '/api/catalog?category=note');
  assert.equal(notes.json.total, 10);
  assert.ok(notes.json.items.every((x) => x.category === 'commemorative_note'));

  const pm = await req('GET', '/api/catalog?category=pm');
  assert.equal(pm.json.total, 0, '当前还没有贵金属，T04 落库后这里应为 3');

  // 公开接口不接受伪造 status=draft
  const draft = await req('GET', '/api/catalog?status=draft');
  assert.equal(draft.json.total, 137);
});

test('GET /api/coin/:no：单品种含描述与多图，未知编号 404', async () => {
  const one = await req('GET', '/api/coin/1');
  assert.equal(one.status, 200);
  assert.equal(one.json.coin.no, 1);
  assert.ok(one.json.desc && one.json.desc.text, '应有央行公告原文');
  assert.equal(one.json.images.length, 2);

  const missing = await req('GET', '/api/coin/999');
  assert.equal(missing.status, 404);
  assert.deepEqual(missing.json, { ok: false, error: '品种不存在' });
});

test('T03 写接口鉴权闸门：未登录仍是 401，登录后可访问', async () => {
  const paths = [
    ['PATCH', '/api/admin/coin'],
    ['PATCH', '/api/admin/coins'],
    ['POST', '/api/admin/series'],
    ['POST', '/api/admin/series/members'],
    ['PUT', '/api/admin/plan'],
    ['POST', '/api/admin/gallery'],
    ['POST', '/api/admin/image'],
    ['DELETE', '/api/admin/image?id=1&kind=main']
  ];
  const loggedCookie = cookie;
  cookie = '';   // 前面的登录测试已把 Cookie 挂到全局，这里显式匿名
  try {
    for (const [method, url] of paths) {
      const anonymous = await req(method, url, {});
    assert.equal(anonymous.status, 401, method + ' ' + url + ' 应拦在登录闸门外');
      assert.deepEqual(anonymous.json, { ok: false, error: '请先登录', needLogin: true });
    }
  } finally {
    cookie = loggedCookie;
  }

  // 登录后的错误文案与 legacy 一致（用不存在的 id，不写文件）
  const badCoin = await req('PATCH', '/api/admin/coin', { id: 99999, patch: { face: 1 } });
  assert.equal(badCoin.status, 404);
  assert.deepEqual(badCoin.json, { ok: false, error: '品种不存在' });

  const badKind = await req('POST', '/api/admin/image', { id: 1, kind: 'bad', data: '' });
  assert.equal(badKind.status, 400);
  assert.deepEqual(badKind.json, { ok: false, error: '图片类型不合法' });
});

test('T03 发行计划整份替换：保存后 bootstrap 立即生效', async () => {
  const current = await req('GET', '/api/admin/plan');
  assert.equal(current.status, 200);
  const plan = current.json.plan;

  const saved = await req('PUT', '/api/admin/plan', { plan: JSON.parse(JSON.stringify(plan)) });
  assert.equal(saved.status, 200);
  assert.deepEqual(saved.json, { ok: true, years: 2, items: 10 });

  const boot = await req('GET', '/api/bootstrap');
  assert.equal(boot.json.plan.years.length, plan.years.length);
  assert.equal(boot.json.plan.years[0].items.length, plan.years[0].items.length);
});
