'use strict';
/**
 * 从金币云集（ecgci.com）抓取全部贵金属纪念币目录。
 *
 * 接口：POST https://www.ecgci.com/api/portal/web/search/product-group
 * 请求体：{ pageSize, defaultSort:true, isGolden:true, pageNo, searchProduct:'', projectAbbreviation:null }
 * 响应：result.total / result.data[] -> projects[] -> productDocInfos[]（单枚）
 *
 * 用法：node tools/crawl-ecgci.js [--out <file>]
 * 默认写到 data/seeds/pm-ecgci-all.json（原始字段，不加工；加工留给导入脚本）
 */
const fs = require('fs');
const path = require('path');

const API = 'https://www.ecgci.com/api/portal/web/search/product-group';
const PAGE_SIZE = 100;
const ROOT = path.join(__dirname, '..');
const argIdx = process.argv.indexOf('--out');
const OUT = argIdx >= 0
  ? path.resolve(process.argv[argIdx + 1])
  : path.join(ROOT, 'data', 'seeds', 'pm-ecgci-all.json');

const HEADERS = {
  'content-type': 'application/json',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36',
  'Referer': 'https://www.ecgci.com/coin-list',
  'Accept': 'application/json, text/plain, */*'
};

async function post(pageNo, retries = 3) {
  const body = {
    pageSize: PAGE_SIZE,
    defaultSort: true,
    isGolden: true,
    pageNo,
    searchProduct: '',
    projectAbbreviation: null
  };
  for (let i = 0; i < retries; i++) {
    try {
      const r = await fetch(API, { method: 'POST', headers: HEADERS, body: JSON.stringify(body) });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const j = await r.json();
      if (!j || !j.result || !Array.isArray(j.result.data)) throw new Error('响应结构异常');
      return j.result;
    } catch (e) {
      if (i === retries - 1) throw e;
      await new Promise((r) => setTimeout(r, 800 * (i + 1)));
    }
  }
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

(async () => {
  const first = await post(1);
  const total = Number(first.total) || 0;
  const pages = Math.ceil(total / PAGE_SIZE);
  console.log(`目录总数 ${total}，共 ${pages} 页（每页 ${PAGE_SIZE}）`);

  const byCode = new Map();
  const projects = new Map();

  function absorb(result) {
    (result.data || []).forEach((yg) => {
      (yg.projects || []).forEach((p) => {
        if (!projects.has(p.projectCode)) {
          // 年份/公告不在 project 上，而在同项目的第一枚币（或年组）里
          const first = (p.productDocInfos || [])[0] || {};
          projects.set(p.projectCode, {
            code: p.projectCode,
            id: p.projectId,
            name: p.projectName,
            year: String(p.projectYear || first.projectYear || yg.projectYear || ''),
            announce: p.projectAnnounceName || first.projectAnnounceName || '',
            announceAttachment: p.projectAnnounceAttachment || first.projectAnnounceAttachment || '',
            pieces: []
          });
        }
        const proj = projects.get(p.projectCode);
        (p.productDocInfos || []).forEach((it) => {
          if (it.code && !byCode.has(it.code)) {
            byCode.set(it.code, it);
            proj.pieces.push(it.code);
          }
        });
      });
    });
  }

  absorb(first);
  process.stdout.write('第 1/' + pages + ' 页');
  for (let page = 2; page <= pages; page++) {
    await sleep(250);
    const r = await post(page);
    absorb(r);
    process.stdout.write(`\r第 ${page}/${pages} 页 · 已收 ${byCode.size} 枚`);
  }
  process.stdout.write('\n');

  const doc = {
    source: 'https://www.ecgci.com/coin-list',
    api: API,
    crawledAt: new Date().toISOString(),
    total: total,
    fetched: byCode.size,
    projects: Array.from(projects.values()),
    items: Array.from(byCode.values())
  };

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(doc, null, 1) + '\n');
  console.log(`已写入 ${path.relative(ROOT, OUT)}：${doc.projects.length} 套 / ${doc.items.length} 枚`);
  console.log(`文件大小 ${(fs.statSync(OUT).size / 1024 / 1024).toFixed(2)} MB`);

  if (doc.items.length < total) {
    console.warn(`! 只拿到 ${doc.items.length}/${total}，可能有重复或分页不稳定`);
  }
})().catch((e) => { console.error('抓取失败：', e.message); process.exit(1); });
