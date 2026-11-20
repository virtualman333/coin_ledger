'use strict';
/**
 * 回归测试：【新访客首屏与落地路径】匿名访客在公开清单点「+ 加入」不再假成功。
 * - 访客点加入：不写入本机 coll、不弹「已加入」toast，改为弹出带品种名的登录引导
 * - 引导的两个按钮都能到账户页并切到对应表单；「再看看」清掉待记品种
 * - 注册后置顶待记品种为空账本第一张快速添加卡；加入成功后清除待记状态
 * - 已登录用户走原流程（选套/选单枚 → 正常入账），行为不变
 * 运行：node --test tests/guest-add-guide.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const js = fs.readFileSync(path.join(ROOT, 'public/app.js'), 'utf8');

const grab = (name, end) => {
  const a = js.indexOf('function ' + name + '(');
  assert.ok(a >= 0, '应能找到函数 ' + name);
  const b = js.indexOf(end, a);
  assert.ok(b > a, '应能找到函数 ' + name + ' 的结束位置');
  return js.slice(a, b);
};

/** 造一个最小 DOM：document.createElement / getElementById / body.appendChild */
function makeDom() {
  const nodes = {};
  return {
    nodes,
    document: {
      body: {
        appendChild(el) { nodes[el.id] = el; }
      },
      createElement() {
        return { id: '', className: '', innerHTML: '', parentNode: null, onclick: null };
      },
      getElementById(id) { return nodes[id] || null; },
      addEventListener() {},
      removeEventListener() {}
    }
  };
}

function loadCtx(opts) {
  opts = opts || {};
  const dom = makeDom();
  const calls = { toast: [], goto: [], authMode: [], chooser: 0, added: [] };
  const ctx = {
    document: dom.document,
    APP: { user: opts.logged ? { name: 'u' } : null },
    coll: [],
    pendingGuestAdd: null,
    DB: [
      { name: '单价最低币A', i: 1, year: 2020, face: 1, kind: 'coin' },
      { name: '单价最低币B', i: 2, year: 2021, face: 1, kind: 'coin' }
    ],
    findDB: (name) => ({ name, i: 5, year: 2024, face: 5, kind: 'coin' }),
    isOwned: () => false,
    holdingUnitSize: () => 20,
    aiPrice: () => 8,
    REAL_SET: { 2: true, 3: true, 6: true },
    imgSmall: () => '/img/6.jpg',
    money: (n) => '¥' + n,
    esc: (s) => String(s),
    showAddUnitChooser: function(){ calls.chooser++; },
    addHolding: function(name){ calls.added.push(name); return true; },
    toast: function(m){ calls.toast.push(m); },
    goTab: function(t){ calls.goto.push(t); },
    showAuthMode: function(m){ calls.authMode.push(m); },
    console
  };
  // 关键：闭包捕获 ctx 本身，避免在 vm 里引用裸 APP 找不到
  ctx.isLoggedIn = function(){ return !!(ctx.APP && ctx.APP.user && ctx.APP.user.name); };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  const snippet = [
    grab('requestAddHolding', 'function showGuestAddGuide('),
    grab('showGuestAddGuide', 'function showAddUnitChooser('),
    grab('emptyLedgerHtml', 'function ownedIn(')
  ].join('\n');
  vm.runInContext(snippet, ctx);
  return { ctx, calls, dom };
}

test('静态结构：访客门禁在 requestAddHolding 顶部，引导带品种名与两个登录入口', () => {
  const seg = js.slice(js.indexOf('function requestAddHolding('), js.indexOf('function showGuestAddGuide('));
  assert.match(seg, /if \(!isLoggedIn\(\)\) \{ showGuestAddGuide\(name\); return; \}/);
  assert.ok(!/addHolding\(/.test(seg.slice(0, seg.indexOf('function done'))), '访客分支前不得直接入账');
  const guide = js.slice(js.indexOf('function showGuestAddGuide('), js.indexOf('function showAddUnitChooser('));
  assert.match(guide, /记下「' \+ esc\(name\)/);
  assert.match(guide, /data-guest-go="register"/);
  assert.match(guide, /data-guest-go="login"/);
  assert.match(guide, /goTab\('account'\)/);
  assert.match(guide, /showAuthMode\(act\)/);
});

test('访客点「+ 加入」：不写入 coll、不弹已加入、弹出带品种名的登录引导', () => {
  const { ctx, calls, dom } = loadCtx({ logged: false });
  ctx.requestAddHolding('中国京剧艺术普通纪念币（丑角）');
  assert.equal(ctx.coll.length, 0, '访客不得把藏品写进本机账本');
  assert.equal(calls.toast.length, 0, '不得弹「已加入」假成功');
  assert.equal(calls.chooser, 0, '不得进入选套/选单枚流程');
  assert.equal(ctx.pendingGuestAdd, '中国京剧艺术普通纪念币（丑角）');
  const mask = dom.nodes.guestAddMask;
  assert.ok(mask, '应弹出登录引导');
  assert.match(mask.innerHTML, /中国京剧艺术普通纪念币（丑角）/);
  assert.match(mask.innerHTML, /免费注册并记下这枚/);
});

test('引导按钮：注册/登录都落到账户页并切到对应表单', () => {
  const { ctx, calls, dom } = loadCtx({ logged: false });
  ctx.requestAddHolding('测试币');
  const mask = dom.nodes.guestAddMask;
  // 模拟点击「免费注册」
  mask.onclick({ target: { closest: () => ({ getAttribute: () => 'register' }) } });
  assert.deepEqual(calls.goto, ['account']);
  assert.deepEqual(calls.authMode, ['register']);
  assert.equal(ctx.pendingGuestAdd, '测试币', '待记品种保留，注册后置顶');

  // 再走一遍「已有账号，去登录」
  const { ctx: c2, calls: k2, dom: d2 } = loadCtx({ logged: false });
  c2.requestAddHolding('测试币2');
  d2.nodes.guestAddMask.onclick({ target: { closest: () => ({ getAttribute: () => 'login' }) } });
  assert.deepEqual(k2.authMode, ['login']);
});

test('引导「再看看」清掉待记品种', () => {
  const { ctx, dom } = loadCtx({ logged: false });
  ctx.requestAddHolding('测试币');
  dom.nodes.guestAddMask.onclick({ target: { closest: () => ({ getAttribute: () => 'cancel' }) } });
  assert.equal(ctx.pendingGuestAdd, null);
});

test('注册后空账本把待记品种置顶，并带「接着记这枚」角标', () => {
  const { ctx } = loadCtx({ logged: true });
  // 造一个待记品种：i=5（对应 findDB 的 i），排在单价最低的 4 枚之外的场景用同一枚验证置顶
  ctx.pendingGuestAdd = '中国京剧艺术普通纪念币（丑角）';
  const html = ctx.emptyLedgerHtml();
  assert.match(html, /lt-card pending/);
  assert.match(html, /接着记这枚/);
  assert.match(html, /你刚想记的那枚已置顶/);
  const pendingPos = html.indexOf('lt-card pending');
  const otherPos = html.indexOf('data-empty-add="单价最低币A"');
  assert.ok(pendingPos >= 0 && otherPos >= 0 && pendingPos < otherPos,
    '待记卡应在列表最前');
});

test('已登录用户走原流程：进入选套流程并正常入账，pending 不清不干扰', () => {
  const { ctx, calls } = loadCtx({ logged: true });
  ctx.pendingGuestAdd = null;
  ctx.requestAddHolding('测试币');
  assert.equal(calls.chooser, 1, '已登录应进入数量/单位选择');
  assert.equal(calls.toast.length, 0);
});
