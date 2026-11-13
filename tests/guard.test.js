'use strict';
/**
 * server/guard.js 回归测试 —— 重点盯「蜜罐误伤正常用户」。
 *
 * 背景：诱饵链接 /api/__trap 曾被搜索引擎索引，真人从搜索结果点进去
 * 就被「命中即封 24h」挡在全站 API 之外。这里锁死修复后的行为。
 *
 * 运行：npm test
 */
const test = require('node:test');
const assert = require('node:assert/strict');

// guard 在模块加载时读 env，所以配置要先设好
process.env.BAN_MS = '60000';
process.env.TRAP_WINDOW_MS = '60000';
process.env.TRAP_BAN_THRESHOLD = '3';
process.env.GUARD_WHITELIST = '203.0.113.7,198.51.100.*';

const guard = require('../server/guard');
const auth = require('../server/auth');

function req(headers) { return { headers: headers || {} }; }
const BROWSER = {
  'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36'
};

test('普通请求正常放行', () => {
  assert.equal(guard.inspect(req(BROWSER), { ip: '192.0.2.10', cls: 'read' }), null);
});

test('蜜罐只命中一次：不封禁，接口仍可用', () => {
  const ip = '192.0.2.20';
  const r = guard.trap(ip, req(BROWSER));
  assert.equal(r.banned, false);
  assert.equal(r.hits, 1);
  assert.equal(guard.isBanned(ip), null);
  assert.equal(guard.inspect(req(BROWSER), { ip, cls: 'read' }), null);
});

test('窗口内反复命中才封，且是短封不是 24 小时', () => {
  const ip = '192.0.2.21';
  assert.equal(guard.trap(ip, req(BROWSER)).banned, false);
  assert.equal(guard.trap(ip, req(BROWSER)).banned, false);
  const third = guard.trap(ip, req(BROWSER));
  assert.equal(third.banned, true);
  assert.equal(third.banMs, 60000);
  const blocked = guard.inspect(req(BROWSER), { ip, cls: 'read' });
  assert.equal(blocked && blocked.status, 403);
  assert.ok(Number(blocked.headers['Retry-After']) <= 60);
});

test('已登录会话不受 IP 连坐（Bearer 与 Cookie 都放行）', () => {
  const ip = '192.0.2.22';
  guard.trap(ip, req(BROWSER));
  guard.trap(ip, req(BROWSER));
  guard.trap(ip, req(BROWSER));
  const token = auth.issueToken({ id: 'u1', role: 'user' });
  assert.equal(
    guard.inspect(req(Object.assign({}, BROWSER, { authorization: 'Bearer ' + token })), { ip, cls: 'read' }),
    null
  );
  const cookie = auth.COOKIE + '=' + encodeURIComponent(token);
  assert.equal(
    guard.inspect(req(Object.assign({}, BROWSER, { cookie })), { ip, cls: 'read' }),
    null
  );
});

test('搜索引擎 UA 命中蜜罐：只忽略，不封', () => {
  const ip = '192.0.2.23';
  const r = guard.trap(ip, req({
    'user-agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)'
  }));
  assert.equal(r.ignored, true);
  assert.equal(guard.isBanned(ip), null);
});

test('白名单 IP：不受封禁也不受限流（支持前缀通配）', () => {
  const ip = '203.0.113.7';
  assert.equal(guard.trap(ip, req(BROWSER)).ignored, true);
  for (let i = 0; i < 200; i++) {
    assert.equal(guard.inspect(req(BROWSER), { ip, cls: 'read' }), null);
  }
  assert.equal(guard.trap('198.51.100.42', req(BROWSER)).ignored, true);
});

test('本机豁免：自检和运维脚本不能把自己封掉', () => {
  assert.equal(guard.trap('127.0.0.1', req(BROWSER)).ignored, true);
  assert.equal(guard.inspect(req(BROWSER), { ip: '127.0.0.1', cls: 'read' }), null);
});

test('管理端解封：清封禁、清计数、可重复调用', () => {
  const ip = '192.0.2.24';
  guard.trap(ip, req(BROWSER));
  guard.trap(ip, req(BROWSER));
  guard.trap(ip, req(BROWSER));
  assert.ok(guard.isBanned(ip));
  assert.equal(guard.unban(ip), true);
  assert.equal(guard.unban(ip), false);
  assert.equal(guard.isBanned(ip), null);
  assert.equal(guard.inspect(req(BROWSER), { ip, cls: 'read' }), null);
  // 解封后重新累计，不会带着旧账立刻再封
  assert.equal(guard.trap(ip, req(BROWSER)).banned, false);
});

test('封禁列表可用于管理端排查', () => {
  const ip = '192.0.2.25';
  guard.ban(ip, 60000, 'manual-test');
  const row = guard.listBans().find((x) => x.ip === ip);
  assert.ok(row);
  assert.equal(row.reason, 'manual-test');
  assert.ok(row.remainMs > 0 && row.remainMs <= 60000);
  guard.unban(ip);
});

test('可疑 UA 计数在恢复正常 UA 后清零，不会累积成误封', () => {
  const ip = '192.0.2.26';
  const bad = { 'user-agent': 'python-requests/2.31.0' };
  assert.equal(guard.inspect(req(bad), { ip, cls: 'read' }).status, 403);
  assert.equal(guard.inspect(req(bad), { ip, cls: 'read' }).status, 403);
  assert.equal(guard.inspect(req(BROWSER), { ip, cls: 'read' }), null);
  assert.equal(guard.inspect(req(bad), { ip, cls: 'read' }).status, 403);
  assert.equal(guard.isBanned(ip), null);
});

test('health stats 暴露蜜罐配置，便于线上核对', () => {
  const s = guard.stats();
  assert.equal(s.trap.threshold, 3);
  assert.equal(s.trap.banMs, 60000);
  assert.equal(s.whitelist, 2);
});
