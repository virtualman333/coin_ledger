const assert = require('assert');
const reminders = require('../server/reminders');

let pass = 0, fail = 0;
function ok(cond, msg) {
  if (cond) { pass++; console.log('  ✓ ' + msg); }
  else { fail++; console.log('  ✗ ' + msg); }
}

console.log('[1] 提醒时间计算');
const a = reminders.remindAtOf({ date: '2026-11-24', reserve: '2026-11-17 至 11-18' });
ok(a && new Date(a).toISOString() === '2026-11-17T01:00:00.000Z',
  '有预约期 → 取预约首日 09:00（+08:00）：' + (a && a.toISOString()));
const b = reminders.remindAtOf({ date: '2026-12-01' });
ok(b && new Date(b).toISOString() === '2026-12-01T01:00:00.000Z', '没有预约期 → 用发行日 09:00');
ok(reminders.remindAtOf({}) === null, '都没有日期 → null');

console.log('\n[2] 时间文案');
ok(reminders.timeText(new Date('2026-11-17T01:00:00.000Z')) === '2026年11月17日 09:00',
  '转成模板要的「年月日 时:分」');

console.log('\n[3] 模板字段长度（thing 类上限 20 字）');
const data = reminders.payloadOf({
  name: '中国京剧艺术普通纪念币（丑角）', short: '京剧·丑角',
  remindAt: '2026-11-17T01:00:00.000Z',
  note: '京剧艺术系列第 4 枚，每人限 20 枚，记得带身份证和银行卡',
});
Object.keys(data).forEach((k) => {
  ok(data[k].value.length <= 20, k + ' 长度 ' + data[k].value.length + '：' + data[k].value);
});

console.log('\n结果：' + pass + ' 通过，' + fail + ' 失败');
process.exit(fail ? 1 : 0);
