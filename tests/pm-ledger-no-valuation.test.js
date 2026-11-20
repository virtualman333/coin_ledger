'use strict';
/**
 * 账本里的贵金属口径：不出估值、不算盈亏、不显示「面值 ¥0.00」。
 *
 * 背景：贵金属（category === 'pm'）不在本地 catalog 里，面额/发行量/推理价都拿不到。
 * 以前它们被直接并入普通币的合计：
 *   - 面值算 0，却把成本减进了盈亏 → 账本显示一笔凭空的「浮动亏损」
 *   - 卡片写「面值 ¥0.00」、群体头部写「推理价 ¥0.00」
 * 这里把口径钉死，双端各一组断言。
 *
 * 运行：node --test tests/pm-ledger-no-valuation.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const readWeb = () => fs.readFileSync(path.join(ROOT, 'public/app.js'), 'utf8');
const readMp = (p) => fs.readFileSync(path.join(ROOT, 'miniprogram', p), 'utf8');

/* ---------------- Web：真的跑一遍 calc() ---------------- */
function loadCalc() {
  const src = readWeb();
  const start = src.indexOf('function calc(){');
  const end = src.indexOf('/* =========================================================\n   7. 渲染：藏品卡片');
  assert.ok(start > 0 && end > start, '找不到 calc() 函数体');
  const body = src.slice(start, end);

  const sandbox = {
    coll: [],
    // 普通币：面值 10、一整套 20 枚；贵金属在 catalog 里找不到
    findDB: (name) => (name === '普通币' ? { i: 1, name: '普通币', face: 10, kind: 'coin', set: 'set', setSize: 20 } : undefined),
    itemFace: (d, rolls) => (d ? (d.face || 0) * (d.setSize || 1) * (Number(rolls) || 0) : 0),
    setSizeBase: (d) => (d && d.setSize) || 20,
  };
  vm.createContext(sandbox);
  vm.runInContext(body + '\nthis.__calc = calc;', sandbox);
  return sandbox;
}

test('贵金属的成本不会造出一笔假亏损', () => {
  const sb = loadCalc();
  sb.coll = [
    { name: '普通币', category: 'coin', rolls: 1, cost: 150, market: 200 },
    { name: '熊猫金币', category: 'pm', id: 'G20240101', rolls: 2, cost: 8000, market: 0 },
  ];
  const r = vm.runInContext('this.__calc()', sb);

  // 普通币：市值 200 - 成本 150 = +50
  assert.equal(r.main.cost, 150, '贵金属成本不能混进主账本成本');
  assert.equal(r.main.market, 200);
  assert.equal(r.main.pnl, 50, '盈亏只能是普通币的，不能被贵金属成本拖成负数');
  assert.equal(r.main.rolls, 1);
  assert.equal(r.main.kinds, 1);

  // 贵金属单独一档
  assert.equal(r.pm.kinds, 1);
  assert.equal(r.pm.rolls, 2);
  assert.equal(r.pm.cost, 8000);
});

test('只有贵金属时，主账本盈亏为 0 而不是 -成本', () => {
  const sb = loadCalc();
  sb.coll = [{ name: '熊猫金币', category: 'pm', id: 'G20240101', rolls: 3, cost: 12000, market: 0 }];
  const r = vm.runInContext('this.__calc()', sb);
  assert.equal(r.main.pnl, 0);
  assert.equal(r.main.cost, 0);
  assert.equal(r.pm.kinds, 1);
  assert.equal(r.pm.rolls, 3);
});

test('藏品卡片：贵金属不写面值、不显示浮动', () => {
  const s = readWeb();
  assert.match(s, /qtyTxt \+ \(c\.category === 'pm' \? '' : '面值 ' \+ money\(face\)\)/, '卡片仍会写「面值 ¥0.00」');
  assert.match(s, /\(c\.category === 'pm' \? '' :\s*'<div class="pnl">/, '贵金属仍会显示浮动盈亏');
});

test('分组头部：贵金属组不显示面值/推理价合计', () => {
  const s = readWeb();
  assert.match(s, /var groupIsPm = items\.length > 0 && items\.every/, '缺「整组都是贵金属」的判断');
  assert.match(s, /\(groupIsPm \? '' : ' · 面值 <b>'/, '贵金属组仍会显示面值合计');
});

test('KPI 文案把贵金属单独说明，并声明不计入估值', () => {
  const s = readWeb();
  assert.match(s, /pm\.kinds[\s\S]{0,40}另含/, 'KPI 副文案没提贵金属');
  assert.match(s, /不计入估值与盈亏/);
});

/* ---------------- Web：贵金属筛选参数 ---------------- */
test('Web 贵金属列表把年份/面额/材质/排序/facets 传给接口', () => {
  const s = readWeb();
  const fn = s.slice(s.indexOf('function loadPmFull(page, append)'), s.indexOf('function resetPmFull'));
  for (const k of ['&year=', '&face=', '&material=', 'facets=1', 'year_desc', 'year_asc']) {
    assert.ok(fn.includes(k), 'loadPmFull 漏了 ' + k);
  }
  // 筛选控件确实渲染出来了
  for (const id of ['pmFullYear', 'pmFullFace', 'pmFullMat', 'pmFullSort']) {
    assert.ok(s.includes(id), '缺筛选控件 ' + id);
  }
});

test('Web 贵金属列表并发请求有序号守卫', () => {
  const s = readWeb();
  assert.match(s, /PM_FULL\._seq/);
  assert.match(s, /if \(seq !== PM_FULL\._seq\) return/);
});

/* ---------------- Web：离开页面兜底写库 ---------------- */
test('离开页面兜底用 PUT + keepalive（sendBeacon 只会 POST，必被路由丢掉）', () => {
  const s = readWeb();
  const i = s.indexOf("window.addEventListener('beforeunload'");
  assert.ok(i > 0, '找不到 beforeunload');
  const body = s.slice(i, i + 700);
  assert.match(body, /method: 'PUT'/);
  assert.match(body, /keepalive: true/);
  assert.doesNotMatch(body, /sendBeacon/, 'sendBeacon 固定 POST，/api/holdings 只收 PUT');
});

/* ---------------- 小程序 ---------------- */
test('小程序藏品卡片：贵金属不写面值、不写推理价', () => {
  const wxml = readMp('pages/holdings/holdings.wxml');
  assert.match(wxml, /wx:if="\{\{item\.faceText\}\}"|wx:if="\{\{!item\.isPm\}\}"/, '面值没有按贵金属隐藏');
  const js = readMp('pages/holdings/holdings.js');
  assert.match(js, /faceText: coin \? cat\.money/, '贵金属的 faceText 应留空，而不是 0.00');
  // 编辑弹层同样不能出现「推理价 ¥」
  assert.match(wxml, /!sheet\.isPm/, '编辑弹层仍会给贵金属写推理价');
});

test('小程序贵金属分组：不显示推理价合计，进度不拿普通币品种数当分母', () => {
  const js = readMp('pages/holdings/holdings.js');
  assert.match(js, /g\.isPm = g\.items\.length > 0 && g\.items\.every/);
  assert.match(js, /g\.progLabel = g\.own \+ ' 枚'/);
  const wxml = readMp('pages/holdings/holdings.wxml');
  // 贵金属分组头部不能出现「推理价」
  const gsum = wxml.match(/<text class="gsum"[^>]*>/);
  assert.ok(gsum, '找不到 .gsum');
  assert.match(gsum[0], /!group\.isPm/, '贵金属分组仍会写「推理价 ¥0」');
  // 左侧 gprog 已经写了「N 枚」，右侧不能再重复一遍同样的数字
  assert.doesNotMatch(wxml, /\{\{group\.own\}\} *枚<\//, '同一个「N 枚」印了两遍');
  // 进度条对贵金属没有意义，别画一条永远空的
  const gbar = wxml.match(/<view class="gbar"[^>]*>/);
  assert.ok(gbar, '找不到 .gbar');
  assert.match(gbar[0], /!group\.isPm/, '贵金属分组仍会画空进度条');
});

test('小程序账本统计把贵金属单独计数', () => {
  const s = readMp('utils/store.js');
  assert.match(s, /pmKinds/);
  assert.match(s, /pmRolls/);
  // 贵金属不计入 kinds（否则「N 个品种 · 0 套」）
  assert.match(s, /kinds \+= 1/, 'kinds 已改为计数累加，不再直接取 holdings.length');
});

test('克重价文案与「不提供估值」口径不打架', () => {
  const mp = readMp('pages/pmdetail/pmdetail.wxml');
  assert.match(mp, /仅材料价值/);
  assert.doesNotMatch(mp, /本站不提供参考估值/, '这句话和上方克重价冲突');
  const web = readWeb();
  assert.doesNotMatch(web, /本站不提供参考估值/);
  assert.match(web, /克重价只是材料价值/);
});
