'use strict';
/* 把已核实的「每人预约、兑换限额」写进 public/data/coins.json。
 * 数据源见 tools/_data/limits-verified.json（每条都留公告链接）。
 * 用法：node tools/apply-limits.js [--write]
 */
const fs = require('fs');
const path = require('path');
const COINS = path.join(__dirname, '..', 'public', 'data', 'coins.json');
const VERIFIED = path.join(__dirname, '_data', 'limits-verified.json');

const doc = JSON.parse(fs.readFileSync(COINS, 'utf8'));
const v = JSON.parse(fs.readFileSync(VERIFIED, 'utf8'));
const plan = [];

for (const rec of v.items) {
  const c = doc.coins.find((x) => x.i === rec.i);
  if (!c) { plan.push({ ...rec, status: '缺品种' }); continue; }
  if (c.name !== rec.name) { plan.push({ ...rec, status: '编号不符：' + c.name }); continue; }
  if (c.limit === rec.limit) { plan.push({ ...rec, status: '已是该值' }); continue; }
  plan.push({ ...rec, status: (c.limit ? `改 ${c.limit} → ${rec.limit}` : `新增 ${rec.limit}`), apply: true });
}

for (const p of plan) console.log(`${String(p.i).padStart(3)} ${p.name.slice(0, 22).padEnd(24)} ${String(p.limit).padStart(3)} ${p.status}`);

if (process.argv.includes('--write')) {
  let n = 0;
  for (const p of plan) if (p.apply) {
    const c = doc.coins.find((x) => x.i === p.i);
    c.limit = p.limit;
    n++;
  }
  fs.writeFileSync(COINS, JSON.stringify(doc) + '\n');   // 保持与原始文件一致的紧凑格式
  console.log(`\n已写入 ${n} 个品种 → ${COINS}`);
} else {
  console.log('\n（预演，未写入；加 --write 执行）');
}
