'use strict';
/**
 * 冒烟测试（多用户版）
 *   BASE=http://127.0.0.1:3100 node tools/smoke.js
 * 覆盖：健康检查 / 匿名访问 / 注册 / 登录 / 数据隔离 / 权限 / 改密 / 删除用户 / 参数校验
 * 注意：会创建并删除临时用户，可对生产实例执行（不会动已有账号数据）。
 */
const BASE = process.env.BASE || 'http://127.0.0.1:3100';
const ADMIN = process.env.ADMIN_NAME || 'virtualman';
const ADMIN_PW = process.env.ADMIN_PASSWORD || '';
if (!ADMIN_PW) console.warn('  ! 未设置 ADMIN_PASSWORD，登录相关用例会失败');
const SUFFIX = Date.now().toString().slice(-6);

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${extra ? '  → ' + extra : ''}`); }
}

let cookie = '';
async function call(path, opts = {}) {
  const headers = Object.assign({}, opts.headers || {});
  if (cookie && opts.auth !== false) headers.Cookie = cookie;
  if (opts.body) headers['Content-Type'] = 'application/json';
  const r = await fetch(BASE + path, Object.assign({}, opts, { headers }));
  const sc = r.headers.get('set-cookie');
  if (sc && opts.keepCookie) cookie = sc.split(';')[0];
  const text = await r.text();
  let body; try { body = JSON.parse(text); } catch { body = text; }
  return { status: r.status, body, headers: r.headers };
}

(async () => {
  console.log(`\n冒烟测试 → ${BASE}\n`);

  const health = await call('/api/health', { auth: false });
  ok('健康检查 200', health.status === 200, health.status);
  ok('发行人清单 ≥130 品种', health.body.coins >= 130, health.body.coins);
  ok('实物图 > 0', health.body.images > 0, health.body.images);

  const anon = await call('/api/bootstrap', { auth: false });
  ok('匿名可读发行清单', anon.body.coins.length >= 130, anon.body.coins.length);
  ok('匿名看不到持仓', anon.body.user === null && anon.body.holdings.length === 0);
  ok('匿名 isAdmin=false', anon.body.isAdmin === false);

  // 未登录写持仓
  const noAuth = await call('/api/holdings', { method: 'PUT', auth: false, body: JSON.stringify({ holdings: [] }) });
  ok('未登录写持仓 401', noAuth.status === 401, noAuth.status);

  // 超管登录
  const badLogin = await call('/api/auth/login', { method: 'POST', auth: false,
    body: JSON.stringify({ name: ADMIN, password: 'xxx' + ADMIN_PW }) });
  ok('错误密码 401', badLogin.status === 401, badLogin.status);

  const adminLogin = await call('/api/auth/login', { method: 'POST', auth: false, keepCookie: true,
    body: JSON.stringify({ name: ADMIN, password: ADMIN_PW }) });
  ok('超管登录成功', adminLogin.status === 200 && adminLogin.body.isAdmin === true, JSON.stringify(adminLogin.body).slice(0, 80));
  const adminCookie = cookie;

  const adminBoot = await call('/api/bootstrap');
  ok('超管能读到自己的持仓', Array.isArray(adminBoot.body.holdings), adminBoot.body.holdings.length);

  // 注册新用户
  const uname = 'test' + SUFFIX;
  cookie = '';
  const reg = await call('/api/auth/register', { method: 'POST', auth: false, keepCookie: true,
    body: JSON.stringify({ name: uname, password: 'test12345' }) });
  ok('注册成功', reg.status === 200 && reg.body.user.name === uname, JSON.stringify(reg.body).slice(0, 80));
  const userCookie = cookie;

  const dup = await call('/api/auth/register', { method: 'POST', auth: false,
    body: JSON.stringify({ name: uname, password: 'test12345' }) });
  ok('重名注册 409', dup.status === 409, dup.status);

  const weak = await call('/api/auth/register', { method: 'POST', auth: false,
    body: JSON.stringify({ name: 'weak' + SUFFIX, password: '12345678' }) });
  ok('纯数字密码被拒 400', weak.status === 400, weak.status);

  const boot = await call('/api/bootstrap');
  ok('新用户账本为空', boot.body.holdings.length === 0, boot.body.holdings.length);
  ok('新用户非管理员', boot.body.isAdmin === false);

  // 隔离：新用户写一条，超管不受影响
  const put = await call('/api/holdings', { method: 'PUT',
    body: JSON.stringify({ holdings: [{ name: '世界文化和自然遗产·泰山', rolls: 2, cost: 200, market: 220, group: '世界文化和自然遗产' }] }) });
  ok('新用户写持仓成功', put.status === 200, JSON.stringify(put.body));
  const boot2 = await call('/api/bootstrap');
  ok('新用户读到刚写入的 1 条', boot2.body.holdings.length === 1, boot2.body.holdings.length);

  cookie = adminCookie;
  const adminBoot2 = await call('/api/bootstrap');
  ok('超管持仓未被新用户覆盖', JSON.stringify(adminBoot2.body.holdings) !== JSON.stringify(boot2.body.holdings));

  // 权限
  cookie = userCookie;
  const forbid = await call('/api/admin/users');
  ok('普通用户访问管理端 403', forbid.status === 403, forbid.status);

  const setPrice = await call('/api/prices', { method: 'PUT', body: JSON.stringify({ prices: { 0: 15 } }) });
  ok('普通用户改行情 403', setPrice.status === 403, setPrice.status);

  // 改密
  const pwBad = await call('/api/auth/password', { method: 'POST',
    body: JSON.stringify({ oldPassword: 'wrong', newPassword: 'newpass123' }) });
  ok('原密码错误 400', pwBad.status === 400, pwBad.status);

  const pwOk = await call('/api/auth/password', { method: 'POST',
    body: JSON.stringify({ oldPassword: 'test12345', newPassword: 'newpass123' }) });
  ok('改密成功', pwOk.status === 200, JSON.stringify(pwOk.body));

  cookie = '';
  const relogin = await call('/api/auth/login', { method: 'POST', auth: false, keepCookie: true,
    body: JSON.stringify({ name: uname, password: 'newpass123' }) });
  ok('新密码可登录', relogin.status === 200, relogin.status);

  // 管理端
  cookie = adminCookie;
  const users = await call('/api/admin/users');
  ok('超管可取用户列表', users.status === 200 && users.body.users.length >= 2, users.body.users && users.body.users.length);
  const target = users.body.users.find((u) => u.name === uname);
  ok('列表里能找到新用户', !!target, JSON.stringify(users.body.users.map(u => u.name)));

  const self = users.body.users.find((u) => u.name === ADMIN);
  const delSelf = await call('/api/admin/users/' + self.id, { method: 'DELETE' });
  ok('不能删除自己 400', delSelf.status === 400, delSelf.status);

  if (target) {
    const del = await call('/api/admin/users/' + target.id, { method: 'DELETE' });
    ok('删除测试用户成功', del.status === 200, JSON.stringify(del.body));
    const after = await call('/api/admin/users');
    ok('删除后列表不再包含', !after.body.users.some((u) => u.name === uname));
  }

  // 被删用户的会话应失效
  cookie = userCookie;
  const ghost = await call('/api/bootstrap');
  ok('被删用户会话失效（user 为空）', ghost.body.user === null);

  // 杂项
  cookie = '';
  const notFound = await call('/api/nope', { auth: false });
  ok('未知接口 404', notFound.status === 404, notFound.status);
  const traversal = await call('/../server/index.js', { auth: false });
  ok('目录穿越被拦（403/404）', traversal.status === 403 || traversal.status === 404, traversal.status);

  console.log(`\n结果：${pass} 通过，${fail} 失败\n`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('测试异常：', e); process.exit(1); });
