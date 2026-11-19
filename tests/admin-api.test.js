'use strict';
/**
 * 管理端 API 集成测试：本地起一个 JSON 后端，自建超管，跑完整用户管理链路。
 * 不连生产、不写仓库数据（COIN_DATA_DIR 指向临时目录）。
 *
 * 运行：npm test
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const PORT = 39119;
const BASE = 'http://127.0.0.1:' + PORT;
const ROOT = path.join(__dirname, '..');
let tmpDir = '';
let proc = null;
let cookie = '';

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

function request(method, url, body, withCookie = true) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const headers = { Accept: 'application/json' };
    if (data) headers['Content-Type'] = 'application/json';
    if (withCookie && cookie) headers.Cookie = cookie;
    const req = http.request(BASE + url, { method, headers }, (res) => {
      let buf = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { buf += c; });
      res.on('end', () => {
        if (withCookie && res.headers['set-cookie']) {
          cookie = res.headers['set-cookie'].map((s) => s.split(';')[0]).join('; ');
        }
        let json = {};
        try { json = JSON.parse(buf); } catch { /* 非 JSON 响应 */ }
        resolve({ status: res.statusCode, body: json });
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

before(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cl-admin-api-'));
  // 发行计划写到临时文件，测试不会改动仓库里的 public/data/plan.json
  // 成员管理会写 coins.json，用临时 SEED 隔离，测试不碰仓库数据
  const seedFile = path.join(tmpDir, 'coins.json');
  fs.writeFileSync(seedFile, JSON.stringify({
    updated: '2026-01-01',
    series: { SX1: '一轮生肖贺岁', EV: '周年庆典' },
    sets: {}, defaults: [],
    coins: [
      { i: 0, name: '测试币A', year: 2000, series: 'SX1', seriesKeys: ['SX1'] },
      { i: 1, name: '测试币B', year: 2001, series: 'EV', seriesKeys: ['EV'] }
    ]
  }), 'utf8');
  const planFile = path.join(tmpDir, 'plan.json');
  fs.writeFileSync(planFile, JSON.stringify({
    updated: '2026-01-01', note: 'test fixture',
    years: [{
      year: 2026, publishedAt: '2025-12-01', publishedBy: '中国人民银行',
      items: [{ key: 'test-coin', name: '测试纪念币', kind: 'coin', status: 'upcoming', date: '2026-12-01', face: 10, mintage: 1000 }]
    }]
  }), 'utf8');
  proc = spawn(process.execPath, ['server/index.js'], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: String(PORT), HOST: '127.0.0.1', STORAGE: 'json',
      COIN_DATA_DIR: tmpDir, PLAN_FILE: planFile, SEED_FILE: seedFile, SUPERADMIN_NAME: 'admin',
      SUPERADMIN_PASSWORD: 'TestAdmin123!', SESSION_SECRET: 'test-secret',
      WX_APPSECRET: '', NODE_ENV: 'test'
    },
    stdio: 'ignore'
  });
  for (let i = 0; i < 60; i += 1) {
    try {
      const r = await request('GET', '/api/health', null, false);
      if (r.status === 200) return;
    } catch { /* 还没起来 */ }
    await sleep(250);
  }
  throw new Error('server did not boot');
});

after(() => {
  if (proc) proc.kill();
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
});

test('管理员登录', async () => {
  const r = await request('POST', '/api/auth/login', { name: 'admin', password: 'TestAdmin123!' });
  assert.equal(r.status, 200);
  assert.equal(r.body.isAdmin, true);
});

test('注册 3 个普通用户', async () => {
  for (const name of ['alice', 'bob', 'charlie']) {
    const r = await request('POST', '/api/auth/register',
      { name, password: 'Passw0rd!' + name }, false);
    assert.equal(r.status, 200, name);
  }
});

test('用户列表分页与统计', async () => {
  const r = await request('GET', '/api/admin/users?page=1&size=10&sort=-createdAt');
  assert.equal(r.status, 200);
  assert.equal(r.body.users.length, 4);
  assert.equal(r.body.total, 4);
  assert.equal(r.body.stats.admins, 1);
});

test('搜索与角色筛选', async () => {
  let r = await request('GET', '/api/admin/users?q=alice');
  assert.equal(r.body.users.length, 1);
  assert.equal(r.body.users[0].name, 'alice');
  r = await request('GET', '/api/admin/users?role=user');
  assert.equal(r.body.users.length, 3);
});

test('禁用账号后无法登录', async () => {
  const r = await request('PATCH', '/api/admin/users/u2', { disabled: true });
  assert.equal(r.status, 200);
  const login = await request('POST', '/api/auth/login',
    { name: 'alice', password: 'Passw0rd!alice' }, false);
  assert.equal(login.status, 403);
});

test('批量操作', async () => {
  const r = await request('POST', '/api/admin/users/batch',
    { ids: ['u2', 'u3'], action: 'markTest' });
  assert.equal(r.status, 200);
  assert.equal(r.body.affected, 2);
});

test('角色调整', async () => {
  const r = await request('PATCH', '/api/admin/users/u3', { role: 'admin' });
  assert.equal(r.status, 200);
  assert.equal(r.body.role, 'admin');
});

test('审计日志覆盖用户管理与解封', async () => {
  const unban = await request('POST', '/api/admin/guard/unban', { ip: '203.0.113.9' });
  assert.equal(unban.status, 200);
  const r = await request('GET', '/api/admin/audit?q=user');
  assert.equal(r.status, 200);
  assert.ok(r.body.total >= 3);
  const all = await request('GET', '/api/admin/audit?size=200');
  assert.ok(all.body.items.some((x) => x.action === 'guard.unban'), '解封操作应写入审计');
});

test('真实账号可一步删除（旧版要求先标记测试）', async () => {
  const r = await request('DELETE', '/api/admin/users/u4');
  assert.equal(r.status, 200);
  const gone = await request('GET', '/api/admin/users/u4');
  assert.equal(gone.status, 404);
});

test('不能删除自己', async () => {
  const r = await request('DELETE', '/api/admin/users/u1');
  assert.equal(r.status, 400);
});


test('发行计划：读取、整份保存与字段规范化', async () => {
  let r = await request('GET', '/api/admin/plan');
  assert.equal(r.status, 200);
  assert.equal(r.body.plan.years.length, 1);
  assert.equal(r.body.plan.years[0].items.length, 1);

  const plan = r.body.plan;
  plan.years[0].items.push({
    key: 'test-coin-2', name: '第二枚测试币', kind: 'note',
    status: 'issued', face: '5', mintage: '2000'
  });
  r = await request('PUT', '/api/admin/plan', { plan });
  assert.equal(r.status, 200);
  assert.equal(r.body.items, 2);

  const again = await request('GET', '/api/admin/plan');
  assert.equal(again.body.plan.years[0].items.length, 2);
  assert.equal(again.body.plan.years[0].items[1].face, 5, '数字字段应被规范化为 number');
  assert.equal(again.body.plan.years[0].items[1].mintage, 2000);
});

test('发行计划：重复 key 被拒绝', async () => {
  const r = await request('GET', '/api/admin/plan');
  const plan = r.body.plan;
  plan.years[0].items.push({ key: 'test-coin', name: '重复标识', kind: 'coin', status: 'issued' });
  const bad = await request('PUT', '/api/admin/plan', { plan });
  assert.equal(bad.status, 400);
  assert.ok(/重复/.test(bad.body.error || ''));
});

test('审计记录发行计划更新', async () => {
  const r = await request('GET', '/api/admin/audit?q=plan');
  assert.equal(r.status, 200);
  assert.ok(r.body.total >= 1);
  assert.ok(r.body.items.some((x) => x.action === 'plan.update'));
});


test('系列成员：整份设置与 count 更新', async () => {
  const r = await request('POST', '/api/admin/series/members', { key: 'SX1', ids: [1, 2] });
  assert.equal(r.status, 200);
  assert.equal(r.body.count, 2);
  assert.equal(r.body.changed, 1);   // 币A 本来就在 SX1，只需给币B 加上
  const series = await request('GET', '/api/series');
  const sx = series.body.items.find((x) => x.key === 'SX1');
  assert.equal(sx.count, 2);
});

test('系列成员：移除后 count 归零，不回退到主系列', async () => {
  const r = await request('POST', '/api/admin/series/members', { key: 'SX1', ids: [] });
  assert.equal(r.status, 200);
  assert.equal(r.body.count, 0);
  const series = await request('GET', '/api/series');
  assert.equal(series.body.items.find((x) => x.key === 'SX1').count, 0);
});

test('系列成员：不存在的系列被拒绝', async () => {
  const r = await request('POST', '/api/admin/series/members', { key: 'NOPE', ids: [1] });
  assert.equal(r.status, 400);
});

test('审计记录系列成员变更', async () => {
  const r = await request('GET', '/api/admin/audit?q=series.members');
  assert.equal(r.status, 200);
  assert.ok(r.body.total >= 1);
  assert.ok(r.body.items.some((x) => x.action === 'series.members'));
});
