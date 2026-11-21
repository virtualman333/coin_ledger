'use strict';
/**
 * 藏品广场后端回归（mock app.db，不连库、不启服务）：
 * - POST /api/shares/batch：多件一次落库、字段清洗（号码/图片白名单/标签重算）、上限 20
 * - GET /api/shares/:id/comments：给当前用户返回 mine 标记（删除按钮依据）
 * 运行：node --test tests/plaza-batch-api.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const ROOT = path.join(__dirname, '..');
let BODY = {};
function inject(file, exportsObj) {
  const p = path.join(ROOT, file);
  delete require.cache[require.resolve(p)];
  require.cache[require.resolve(p)] = { id: p, filename: p, loaded: true, exports: exportsObj };
}

// 在加载路由前注入依赖桩
inject('server/core/http.js', { readBody: async () => BODY });
inject('server/wxsec.js', { checkText: async () => ({ ok: true }), checkImage: async () => ({ ok: true }) });
inject('server/config.js', { PUBLIC_DIR: path.join(ROOT, 'public') });

const plazaRoutes = require('../server/routes/plaza');

function fakeApp(db, user) {
  const routes = {};
  const key = (m, p) => m + ' ' + p;
  return {
    get(path, h) { routes[key('GET', path)] = h; },
    post(path, a, h) { routes[key('POST', path)] = h || a; },
    delete(path, a, h) { routes[key('DELETE', path)] = h || a; },
    _routes: routes,
    _key: key,
    db: db || { query: async () => [] },
    currentUser: () => user || null,
    requireLogin: () => (req, reply, done) => done && done(),
  };
}
function call(handler, opts) {
  opts = opts || {};
  return new Promise((resolve) => {
    const reply = {
      _code: 200, _body: null,
      code(c) { this._code = c; return this; },
      send(b) { this._body = b; resolve({ status: this._code, body: b }); },
    };
    Promise.resolve(handler({ user: { id: 'u1', wxOpenid: '' }, params: opts.params || {}, query: opts.query || {}, raw: {} }, reply)).catch((e) => resolve({ error: e }));
  });
}

test('批量分享：多件一次落库，号码花样标签服务端重算', async () => {
  BODY = {
    items: [
      { holdingName: '生肖币A', serials: ['J88888888'], images: ['/collection/a.jpg', 'evil.png'], form: 'single' },
      { holdingName: '纪念钞B', serials: [], images: [], form: 'set' },
    ],
    caption: '我的收藏',
  };
  const inserts = [];
  const app = fakeApp({ query: async (sql, params) => {
    if (/INSERT INTO cl_share/.test(sql)) { inserts.push(params); return []; }
    return [];
  } });
  await plazaRoutes(app);
  const res = await call(app._routes['POST /api/shares/batch']);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.count, 2);
  assert.equal(inserts.length, 2, '应插入两条帖子，广场里两张卡片');
  assert.equal(inserts[0][2], '生肖币A');
  assert.equal(inserts[0][3], JSON.stringify(['J88888888']));
  // 图片白名单：evil.png 被过滤，只留合法路径
  assert.equal(inserts[0][4], JSON.stringify(['/collection/a.jpg']));
  assert.equal(inserts[0][5], 'single');
  assert.equal(inserts[0][6], '我的收藏');
  // 标签由服务端按号码重算（麒麟号）
  const tags = JSON.parse(inserts[0][7]);
  assert.ok(tags.some((t) => t.name === '麒麟号'));
  assert.equal(inserts[1][2], '纪念钞B');
  assert.equal(inserts[1][6], '我的收藏');
});

test('批量分享：空 items 被拒绝，超过 20 件被截断', async () => {
  let inserts = 0;
  const app = fakeApp({ query: async (sql) => {
    if (/INSERT INTO cl_share/.test(sql)) { inserts++; return []; }
    return [];
  } });
  await plazaRoutes(app);
  BODY = { items: [] };
  const r1 = await call(app._routes['POST /api/shares/batch']);
  assert.equal(r1.status, 400);
  assert.equal(r1.body.ok, false);
  BODY = { items: Array.from({ length: 30 }, (_, i) => ({ holdingName: '币' + i })) };
  const r2 = await call(app._routes['POST /api/shares/batch']);
  assert.equal(r2.body.ok, true);
  assert.equal(r2.body.count, 20, '30 件应截断到 20');
  assert.equal(inserts, 20);
});

test('评论列表：当前用户的评论带 mine=true，其他用户为 false', async () => {
  BODY = {};
  const app = fakeApp({
    query: async () => [[
      { id: 'c1', uid: 'u1', nickname: '我', avatar: '', text: '我的评论', created_at: new Date() },
      { id: 'c2', uid: 'u2', nickname: '他人', avatar: '', text: '别人的', created_at: new Date() },
    ]],
  }, { id: 'u1' });
  await plazaRoutes(app);
  const res = await call(app._routes['GET /api/shares/:id/comments'], { params: { id: 's1' } });
  assert.ok(res.body, 'comments handler 未 send：' + (res.error && res.error.message));
  assert.equal(res.body.items[0].uid, 'u1', 'uid 应为 u1');
  assert.equal(res.body.items[0].mine, true);
  assert.equal(res.body.items.length, 2);
  assert.equal(res.body.items[0].mine, true);
  assert.equal(res.body.items[1].mine, false);
});
