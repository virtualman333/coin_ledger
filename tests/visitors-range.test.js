'use strict';
/**
 * 访客分析时间筛选的回归测试。
 * 覆盖：区间边界（含头不含尾）、默认口径、趋势粒度自适应、来源筛选与明细同口径。
 * 运行：npm test
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const visitors = require('../server/visitors');

const now = new Date();
function at(daysAgo, hour, minute) {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - daysAgo, hour, minute, 0);
  return d.toISOString();
}
function item(iso, ip, sid, tab, client) {
  return { at: iso, ip, sid, tab, client: client || 'web', userName: '' };
}

const items = [
  item(at(0, 9, 30), '1.1.1.1', 's1', 'home', 'web'),
  item(at(0, 9, 45), '1.1.1.1', 's1', 'plan', 'web'),
  item(at(0, 10, 15), '2.2.2.2', 's2', 'plan', 'mp'),
  item(at(1, 11, 0), '3.3.3.3', 's3', 'home', 'web'),
  item(at(10, 12, 0), '4.4.4.4', 's4', 'home', 'web'),
  item(new Date(now.getFullYear() - 2, 5, 15, 12, 0).toISOString(), '5.5.5.5', 's5', 'home', 'mp'),
];
const meta = (id, x) => Object.assign({ id }, x);

test('resolveRange：today / week 起点正确，未知值退回 all', () => {
  const today = visitors.resolveRange('today');
  assert.equal(today.key, 'today');
  assert.equal(today.end - today.start, 24 * 3600 * 1000);
  const week = visitors.resolveRange('week');
  const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - ((now.getDay() + 6) % 7));
  assert.equal(week.start.getTime(), monday.getTime());
  assert.equal(week.end - week.start, 7 * 24 * 3600 * 1000);
  assert.equal(visitors.resolveRange('garbage').key, 'all');
  assert.equal(visitors.resolveRange(undefined).key, 'all');
});

test('filterByRange：含起点、不含终点', () => {
  const r = visitors.resolveRange('today');
  const edge = [
    meta('start', { at: r.start.toISOString(), ip: 'a', sid: 'a', tab: 'home' }),
    meta('end', { at: r.end.toISOString(), ip: 'b', sid: 'b', tab: 'home' }),
  ];
  const got = visitors.filterByRange(edge, r);
  assert.equal(got.length, 1);
  assert.equal(got[0].id, 'start');
});

test('今日：PV/IP 按区间算，累计与今日各自独立，趋势按小时', () => {
  const s = visitors.stats(items, { range: 'today' });
  assert.equal(s.range.key, 'today');
  assert.equal(s.gran, 'hour');
  assert.equal(s.rangePv, 3);
  assert.equal(s.rangeUv, 2);          // 1.1.1.1 访问两次仍算一个 IP
  assert.equal(s.todayPv, 3);
  assert.equal(s.allPv, items.length);
  assert.deepEqual(s.daily.map((d) => d.date), ['09', '10']);
  assert.equal(s.daily[0].label, '09:00');
  assert.equal(s.byClient.web.pv, 2);  // 来源分布也跟区间走
  assert.equal(s.byClient.mp.pv, 1);
  assert.equal(s.ipGroups.length, 2);
});

test('本周 / 本月 / 本年 / 全部：边界正确，趋势粒度自适应', () => {
  const week = visitors.stats(items, { range: 'week' });
  assert.equal(week.gran, 'day');
  assert.ok(week.rangePv >= 3 && week.rangePv <= 4); // 昨天是否属本周取决于今天星期几
  assert.ok(week.daily.every((d) => /^\d{4}-\d{2}-\d{2}$/.test(d.date) && /^\d{2}-\d{2}$/.test(d.label)));

  const month = visitors.stats(items, { range: 'month' });
  assert.equal(month.gran, 'day');
  assert.ok(month.rangePv >= 3);
  assert.ok(month.allPv - month.rangePv >= 1); // 两年前那条始终在区间外

  const year = visitors.stats(items, { range: 'year' });
  assert.equal(year.gran, 'month');
  assert.equal(year.rangePv, items.length - 1);
  assert.ok(year.daily.every((d) => /^\d{4}-\d{2}$/.test(d.date)));

  const all = visitors.stats(items, { range: 'all' });
  assert.equal(all.gran, 'month');
  assert.equal(all.rangePv, items.length);
  assert.equal(all.rangeUv, 5);
});

test('来源筛选与明细共用同一区间口径', () => {
  const mp = visitors.stats(items, { range: 'today', client: 'mp' });
  assert.equal(mp.rangePv, 1);
  assert.equal(mp.rangeUv, 1);
  assert.equal(mp.allPv, items.length); // 累计不受来源筛选影响，供对比
  assert.equal(mp.byClient.mp.pv, 1);

  const range = visitors.resolveRange('today');
  const scoped = visitors.filterByRange(items, range);
  const d = visitors.detail(scoped, { ip: '1.1.1.1' });
  assert.equal(d.total, 2);
  const dAll = visitors.detail(items, { ip: '1.1.1.1' });
  assert.equal(dAll.total, 2);
});
