'use strict';
/**
 * 藏品增强（号码分析）+ 广场字段白名单 单元测试。
 * 纯逻辑，不连数据库、不启服务。
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const serial = require('../public/serial.js');

test('号码分析：尾同号家族分级正确', () => {
  const cases = {
    'J12345678': '天顺号',
    'J88888888': '麒麟号',
    'J12345666': '豹子号',
    'J12346666': '狮子号',
    'J12366666': '老虎号',
    'J12666666': '大象号',
  };
  Object.keys(cases).forEach((no) => {
    const tags = serial.analyze(no).tags.map((t) => t.name);
    assert.ok(tags.indexOf(cases[no]) >= 0, no + ' 应含 ' + cases[no] + '，实际：' + tags.join('/'));
  });
});

test('号码分析：无 4 / 无 47 / 无 347 分级', () => {
  // 12356901 不含 4、7 但含 3 → 无47（不是无347）
  assert.ok(serial.analyze('J12356901').tags.some((t) => t.name === '无47'));
  assert.ok(!serial.analyze('J12356901').tags.some((t) => t.name === '无347'));
  // 12568901 纯 0/1/2/5/6/8/9 才算无347
  assert.ok(serial.analyze('J12568901').tags.some((t) => t.name === '无347'));
});

test('号码分析：关门号不被误判成麒麟号', () => {
  const tags = serial.analyze('J100000000').tags.map((t) => t.name);
  assert.ok(tags.indexOf('关门号') >= 0);
  assert.ok(tags.indexOf('麒麟号') < 0);
});

test('号码分析：雷达号 / 倒置号 / 圆圆号', () => {
  assert.ok(serial.analyze('JG12344321').tags.some((t) => t.name === '雷达号'));
  assert.ok(serial.analyze('J01689168').tags.some((t) => t.name === '倒置号'));
  assert.ok(serial.analyze('J06890689').tags.some((t) => t.name === '圆圆号'));
});

test('号码分析：爱情号 / 生日号 / 发财号', () => {
  assert.ok(serial.analyze('J5201314X').tags.some((t) => t.name === '爱情号'));
  assert.ok(serial.analyze('J19981001').tags.some((t) => t.name === '生日号'));
  assert.ok(serial.analyze('J16888888').tags.some((t) => t.name === '发财号'));
});

test('号码分析：无效输入降级为 valid=false 而非抛错', () => {
  assert.equal(serial.analyze('').valid, false);
  assert.equal(serial.analyze('ABCDEFG').valid, false);
  assert.equal(serial.analyze(null).valid, false);
});

test('批量分析：识别连续号为一段连号并打标签', () => {
  const r = serial.analyzeBatch(['J12345670', 'J12345671', 'J12345672', 'J99999999']);
  assert.equal(r.runs.length, 1);
  assert.equal(r.runs[0].len, 3);
  assert.ok(r.items[0].tags.some((t) => t.name === '连号'));
  assert.ok(!r.items[3].tags.some((t) => t.name === '连号'));
});

test('前后端规则同源：server/serial 与 public/serial 导出一致', () => {
  const serverApi = require('../server/serial.js');
  assert.equal(serverApi.analyze('J88888888').top, serial.analyze('J88888888').top);
});
