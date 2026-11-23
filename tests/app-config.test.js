'use strict';
/**
 * 维护状态开关：读库 / 写库 / 失败兜底。
 * 不连真库，用一个假的 app.db 记录 SQL。
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const SERVICE = path.join(__dirname, '..', 'server', 'services', 'app-config.service.js');

/** 每次重新加载模块，避免 10 秒缓存串场 */
function fresh() {
  delete require.cache[require.resolve(SERVICE)];
  return require(SERVICE);
}

function fakeApp(store) {
  return {
    db: {
      query: async (sql, params) => {
        if (/^SELECT/i.test(sql)) return [[{ v: store.value }]];
        if (/INSERT/i.test(sql)) {
          store.written = params[1];
          store.value = params[1];
          return [{}];
        }
        return [{}];
      }
    }
  };
}

test('读：cl_meta 里 1 表示维护中，0 表示关闭', async () => {
  const svc = fresh();
  assert.equal(await svc.getMaintenance(fakeApp({ value: '1' })), true);
  const svc2 = fresh();
  assert.equal(await svc2.getMaintenance(fakeApp({ value: '0' })), false);
});

test('写：落库为 1/0，并且立刻生效（不用等缓存过期）', async () => {
  const svc = fresh();
  const store = { value: '0' };
  const app = fakeApp(store);
  await svc.setMaintenance(app, true);
  assert.equal(store.written, '1');
  assert.equal(await svc.getMaintenance(app), true, '写入后应直接返回新值');
  await svc.setMaintenance(app, false);
  assert.equal(await svc.getMaintenance(app), false);
});

test('查库失败时按关闭处理，不能把所有人挡在外面', async () => {
  const svc = fresh();
  const app = { db: { query: async () => { throw new Error('db down'); } } };
  assert.equal(await svc.getMaintenance(app), false);
});
