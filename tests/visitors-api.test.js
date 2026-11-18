'use strict';
/**
 * 访客时间筛选的接口层测试：起临时后端，走真实 Cookie 登录与 /api/admin/visitors。
 * 数据写在临时目录，不碰仓库 data/。
 * 运行：npm test
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const PORT = 39120;
const BASE = 'http://127.0.0.1:' + PORT;
const ROOT = path.join(__dirname, '..');
let tmpDir = '';
let proc = null;
let cookie = '';

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
function request(method, url, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const headers = { Accept: 'application/json' };
    if (data) headers['Content-Type'] = 'application/json';
    if (cookie) headers.Cookie = cookie;
    const req = http.request(BASE + url, { method, headers }, (res) => {
      let buf = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { buf += c; });
      res.on('end', () => {
        if (res.headers['set-cookie']) {
          cookie = res.headers['set-cookie'].map((s) => s.split(';')[0]).join('; ');
        }
        let json = {};
        try { json = JSON.parse(buf); } catch { /* ignore */ }
        resolve({ status: res.statusCode, body: json });
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}
function iso(daysAgo) {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() - daysAgo, 10, 0, 0).toISOString();
}

before(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cl-visitors-api-'));
  fs.writeFileSync(path.join(tmpDir, 'visits.json'), JSON.stringify({ items: [
    { id: 'a', at: iso(0), sid: 's1', tab: 'home', ip: '1.1.1.1', client: 'web' },
    { id: 'b', at: iso(0), sid: 's1', tab: 'plan', ip: '1.1.1.1', client: 'web' },
    { id: 'c', at: iso(0), sid: 's2', tab: 'home', ip: '2.2.2.2', client: 'mp' },
    { id: 'd', at: iso(30), sid: 's3', tab: 'home', ip: '3.3.3.3', client: 'web' },
  ] }), 'utf8');
  fs.writeFileSync(path.join(tmpDir, 'coins.json'), JSON.stringify({ updated: '2026-01-01', series: {}, sets: {}, defaults: [], coins: [] }), 'utf8');
  proc = spawn(process.execPath, ['server/index.js'], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: String(PORT), HOST: '127.0.0.1', STORAGE: 'json',
      COIN_DATA_DIR: tmpDir, SEED_FILE: path.join(tmpDir, 'coins.json'),
      SUPERADMIN_NAME: 'admin', SUPERADMIN_PASSWORD: 'TestAdmin123!',
      SESSION_SECRET: 'test-secret', WX_APPSECRET: '', NODE_ENV: 'test'
    },
    stdio: 'ignore'
  });
  for (let i = 0; i < 60; i += 1) {
    try {
      const r = await request('GET', '/api/health');
      if (r.status === 200) break;
    } catch { /* not ready */ }
    await sleep(250);
  }
  const login = await request('POST', '/api/auth/login', { name: 'admin', password: 'TestAdmin123!' });
  assert.equal(login.status, 200, '管理员登录失败');
});

after(() => {
  if (proc) proc.kill();
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
});

test('GET /api/admin/visitors?range=today 只统计今日，all 统计全部', async () => {
  const today = await request('GET', '/api/admin/visitors?range=today');
  assert.equal(today.status, 200);
  assert.equal(today.body.range.key, 'today');
  assert.equal(today.body.rangePv, 3);
  assert.equal(today.body.allPv, 4);
  assert.equal(today.body.gran, 'hour');

  const all = await request('GET', '/api/admin/visitors?range=all');
  assert.equal(all.body.range.key, 'all');
  assert.equal(all.body.rangePv, 4);
  assert.equal(all.body.gran, 'month');

  const mp = await request('GET', '/api/admin/visitors?range=today&client=mp');
  assert.equal(mp.body.rangePv, 1);
});

test('明细接口同样吃 range 参数', async () => {
  const today = await request('GET', '/api/admin/visitors/detail?ip=1.1.1.1&range=today');
  assert.equal(today.status, 200);
  assert.equal(today.body.total, 2);
  const all = await request('GET', '/api/admin/visitors/detail?ip=3.3.3.3&range=today');
  assert.equal(all.body.total, 0);
  const ok = await request('GET', '/api/admin/visitors/detail?ip=3.3.3.3&range=all');
  assert.equal(ok.body.total, 1);
});
