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
  proc = spawn(process.execPath, ['server/index.js'], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: String(PORT), HOST: '127.0.0.1', STORAGE: 'json',
      COIN_DATA_DIR: tmpDir, SUPERADMIN_NAME: 'admin',
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
