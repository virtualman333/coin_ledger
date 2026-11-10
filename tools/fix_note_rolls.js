'use strict';
/**
 * 修正历史持仓里「纪念钞按张数记」的旧数据。
 *
 * 早期纪念钞的口径是「1 套 = 1 张」，所以马钞那条持仓存成了 rolls=20（20 张）。
 * 现在统一为「1 套 = 20 张」，同一条数据就变成了 20 套 = 400 张，面值虚高 20 倍。
 *
 * 规则：只处理纪念钞；当 rolls 能被 20 整除、且 cost 与「(rolls/20) 套」的面值相当时，
 * 折算成套数。其它情况只报告不动。
 *
 *   node tools/fix_note_rolls.js            # 预演
 *   node tools/fix_note_rolls.js --write    # 写回服务器
 */
const https = require('https');
const fs = require('fs');
const path = require('path');

const HOST = 'coin.virtualman.top';
const WRITE = process.argv.includes('--write');

function call(method, p, body, token) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const req = https.request({
      hostname: HOST, path: p, method,
      headers: Object.assign(
        { 'content-type': 'application/json' },
        token ? { Authorization: 'Bearer ' + token } : {},
        data ? { 'Content-Length': Buffer.byteLength(data) } : {}
      ),
    }, (res) => {
      let s = '';
      res.setEncoding('utf8');
      res.on('data', (d) => { s += d; });
      res.on('end', () => {
        let body2 = s;
        try { body2 = JSON.parse(s); } catch (e) { /* keep */ }
        resolve({ status: res.statusCode, body: body2 });
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

(async () => {
  const doc = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'public', 'data', 'coins.json'), 'utf8'));
  const byName = {};
  doc.coins.forEach((c) => { byName[c.name] = c; });

  const login = await call('POST', '/api/auth/login', { name: 'virtualman', password: process.env.ADMIN_PASSWORD || '' });
  if (login.status !== 200) throw new Error('登录失败：' + JSON.stringify(login.body));

  const st = await call('GET', '/api/state', null, login.body.token);
  const holdings = st.body.holdings || [];
  console.log(`当前 ${holdings.length} 条持仓`);

  let changed = 0;
  const next = holdings.map((h) => {
    const c = byName[h.name];
    if (!c || c.kind !== 'note') return h;
    const meta = doc.sets[c.set];
    const size = meta && meta.size ? meta.size : 20;      // 纪念钞一套 20 张
    const rolls = Number(h.rolls) || 0;
    if (rolls <= 1 || rolls % size !== 0) return h;

    const setFace = Number(c.face) || 0;                  // 单张面额
    const implied = (rolls / size) * setFace * size;      // 折算后的面值
    const cost = Number(h.cost) || 0;
    console.log(`\n[${h.name}]`);
    console.log(`  现在：${rolls} 套（≈${rolls * size} 张），成本 ¥${cost}，市值 ¥${h.market}`);
    console.log(`  折算：${rolls / size} 套（≈${rolls} 张），面值 ¥${implied}`);
    if (Math.abs(implied - cost) > cost * 0.5) {
      console.log('  成本与面值差太多，跳过（人工确认）');
      return h;
    }
    changed += 1;
    return Object.assign({}, h, { rolls: rolls / size });
  });

  if (!changed) {
    console.log('\n没有需要修正的持仓');
    return;
  }

  const payload = next.map((h) => ({
    id: h.id, name: h.name, rolls: h.rolls, cost: h.cost, market: h.market, group: h.group,
  }));

  if (!WRITE) {
    console.log(`\n预演：将修正 ${changed} 条（加 --write 写回）`);
    return;
  }

  const put = await call('PUT', '/api/holdings', { holdings: payload }, login.body.token);
  console.log('\n写回结果：', put.status, JSON.stringify(put.body).slice(0, 120));

  const after = await call('GET', '/api/state', null, login.body.token);
  const list = after.body.holdings || [];
  let face = 0, cost = 0, market = 0, rolls = 0;
  list.forEach((h) => {
    const c = byName[h.name];
    if (!c) return;
    const meta = doc.sets[c.set];
    const size = meta && meta.size ? meta.size : 20;
    let unit = Number(c.face) || 0;
    if (c.kind === 'note' && /对钞/.test(c.name)) unit /= 2;
    face += unit * size * (Number(h.rolls) || 0);
    cost += Number(h.cost) || 0;
    market += Number(h.market) || 0;
    rolls += Number(h.rolls) || 0;
  });
  console.log(`修正后合计：面值 ¥${Math.round(face)} · 投入 ¥${cost} · 市值 ¥${market} · ${list.length} 个品种 ${rolls} 套`);
})().catch((e) => {
  console.error('失败：', e.message);
  process.exit(1);
});
