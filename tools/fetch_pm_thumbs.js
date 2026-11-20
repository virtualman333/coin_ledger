'use strict';
/**
 * 抓取贵金属纪念币正面图 → 生成 480/160 方形缩略图 → 输出数据库更新 SQL。
 *
 * 数据源：data/seeds/pm-ecgci-all.json（2823 条）里的 frontPicture
 * 图片走 ecgci CDN 的 w_600 压缩参数，落到 public/img/pm/{480,160}/<code>.jpg
 * 同时生成 cl_ecgci_pm 的 thumb 列 UPDATE SQL（数据库要存地址）
 *
 * 用法：node tools/fetch_pm_thumbs.js [--limit 20] [--concurrency 8]
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'data', 'seeds', 'pm-ecgci-all.json');
const DIR480 = path.join(ROOT, 'public', 'img', 'pm', '480');
const DIR160 = path.join(ROOT, 'public', 'img', 'pm', '160');
const SIDE = process.argv.indexOf('--side') > 0 ? process.argv[process.argv.indexOf('--side') + 1] : 'front';
const SUFFIX = SIDE === 'back' ? '-b' : '';
const OUTSQL = path.join(ROOT, '.testdata', 'pm-thumbs-' + SIDE + '.sql');
const CDN = 'https://chngc-prod-c2c-cdn.ecgci.com';
const arg = (n, d) => { const i = process.argv.indexOf(n); return i > 0 ? Number(process.argv[i + 1]) : d; };
const LIMIT = arg('--limit', 0);
const CONC = Math.max(1, Math.min(30, arg('--concurrency', 8)));

const doc = JSON.parse(fs.readFileSync(SRC, 'utf8'));
let items = (doc.items || []).filter((x) => SIDE === 'back' ? x.backPicture : x.frontPicture);
if (LIMIT) items = items.slice(0, LIMIT);
[DIR480, DIR160].forEach((d) => fs.mkdirSync(d, { recursive: true }));

const imgUrl = (p) => {
  let u = String(p).indexOf('http') === 0 ? String(p) : CDN + (String(p).charAt(0) === '/' ? p : '/' + p);
  // 中文/空格必须转义，否则 fetch 直接失败
  try { u = encodeURI(u); } catch (e) {}
  if (u.indexOf('x-oss-process') < 0) u += (u.indexOf('?') > 0 ? '&' : '?') + 'x-oss-process=image/resize,w_600';
  return u;
};

let done = 0, fail = 0;
const failed = [];
const queue = items.slice();

async function worker() {
  while (queue.length) {
    const it = queue.shift();
    const code = String(it.code).toUpperCase();
    const f480 = path.join(DIR480, code + SUFFIX + '.jpg');
    if (!fs.existsSync(f480)) {
      try {
        const r = await fetch(imgUrl(SIDE === 'back' ? it.backPicture : it.frontPicture), { signal: AbortSignal.timeout(25000) });
        if (!r.ok) throw new Error('HTTP ' + r.status);
        const buf = Buffer.from(await r.arrayBuffer());
        if (buf.length < 1000) throw new Error('图片过小');
        fs.writeFileSync(path.join(ROOT, '.testdata', 'pmraw', code + SUFFIX + '.img'), buf);
      } catch (e) {
        fail++; failed.push(code + ' ' + e.message);
        done++; process.stdout.write(`\r下载 ${done}/${items.length} 失败 ${fail}`);
        continue;
      }
    }
    done++;
    if (done % 20 === 0) process.stdout.write(`\r下载 ${done}/${items.length} 失败 ${fail}`);
  }
}

(async () => {
  fs.mkdirSync(path.join(ROOT, '.testdata', 'pmraw'), { recursive: true });
  console.log(`开始：${items.length} 张（${SIDE === 'back' ? '背面' : '正面'}），并发 ${CONC}`);
  await Promise.all(Array.from({ length: CONC }, worker));
  console.log(`\n下载完成：成功 ${items.length - fail}，失败 ${fail}`);

  // SQL：数据库存本地地址（正面缩略图）
  const q = (s) => "'" + String(s).replace(/'/g, "''") + "'";
  const lines = ['-- 贵金属缩略图地址回写（自动生成）',
    SIDE === 'back'
      ? 'ALTER TABLE cl_ecgci_pm ADD COLUMN thumb_back VARCHAR(128) NULL;'
      : 'ALTER TABLE cl_ecgci_pm ADD COLUMN thumb VARCHAR(128) NULL;'];
  items.forEach((it) => {
    if (failed.some((f) => f.indexOf(String(it.code)) === 0)) return;
    const col = SIDE === 'back' ? 'thumb_back' : 'thumb';
    lines.push(`UPDATE cl_ecgci_pm SET ${col}=${q('/img/pm/480/' + String(it.code).toUpperCase() + SUFFIX + '.jpg')} WHERE code=${q(it.code)};`);
  });
  fs.writeFileSync(OUTSQL, lines.join('\n') + '\n');
  fs.writeFileSync(path.join(ROOT, '.testdata', 'pm-thumbs-failed.txt'), failed.join('\n'));
  console.log(`SQL 已写 ${path.relative(ROOT, OUTSQL)}：${lines.length - 2} 条`);
})();
