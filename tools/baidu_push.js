'use strict';
/**
 * 百度搜索资源平台「普通收录 · API 提交」。
 *
 *   node tools/baidu_push.js              # 推送 sitemap.xml 里的全部 URL
 *   node tools/baidu_push.js --limit 10  # 只推前 N 条（调试）
 *   node tools/baidu_push.js --base      # 只推主页面，不带详情页
 *
 * token 只从环境变量 BAIDU_TOKEN 或 .secrets/baidu-token.txt 读取，
 * 不要写进代码、日志或提交记录。
 */
const fs = require('fs');
const path = require('path');
const http = require('http');

const ROOT = path.join(__dirname, '..');
const SITE = 'https://coin.virtualman.top';
// 百度接口的 site 参数要**裸域名**：带 https:// 会返回 400 site init fail
// （平台页面里给出的示例地址带协议，实测不能用，这里踩过一次）
const PUSH_SITE = SITE.replace(/^https?:\/\//, '').replace(/\/$/, '');
const SITEMAP = path.join(ROOT, 'public/sitemap.xml');
const SECRET = path.join(ROOT, '.secrets/baidu-token.txt');

const argv = process.argv.slice(2);
const limitArg = argv.indexOf('--limit');
const limit = limitArg >= 0 ? Number(argv[limitArg + 1]) || 0 : 0;
const baseOnly = argv.indexOf('--base') >= 0;

const token = String(process.env.BAIDU_TOKEN ||
  (fs.existsSync(SECRET) ? fs.readFileSync(SECRET, 'utf8') : '')).trim();

if (!token) {
  console.error('缺少 token：设置 BAIDU_TOKEN 或写入 .secrets/baidu-token.txt');
  process.exit(1);
}

function urlsFromSitemap() {
  const xml = fs.readFileSync(SITEMAP, 'utf8');
  const out = [];
  const re = /<loc>\s*([^<]+?)\s*<\/loc>/g;
  let m;
  while ((m = re.exec(xml))) {
    const u = m[1].trim();
    // 只推本站 HTTPS 链接；跳转后的最终地址才提交
    if (u.indexOf(SITE) !== 0) continue;
    if (baseOnly && /\/coin\/\d+/.test(u)) continue;
    if (out.indexOf(u) < 0) out.push(u);
  }
  return out;
}

const urls = urlsFromSitemap();
const payload = (limit ? urls.slice(0, limit) : urls).join('\n');
const target = 'http://data.zz.baidu.com/urls?site=' + encodeURIComponent(PUSH_SITE) + '&token=' + encodeURIComponent(token);

if (!payload) {
  console.error('sitemap 里没有可推送的链接');
  process.exit(1);
}

const req = http.request(target, {
  method: 'POST',
  headers: {
    'Content-Type': 'text/plain',
    'Content-Length': Buffer.byteLength(payload),
    'User-Agent': 'curl/8.0 coin-ledger-push/1.0',
  },
}, (res) => {
  let body = '';
  res.on('data', (d) => { body += d; });
  res.on('end', () => {
    console.log('HTTP ' + res.statusCode + ' · 提交 ' + payload.split('\n').length + ' 条（site=' + PUSH_SITE + '）');
    let parsed = null;
    try { parsed = JSON.parse(body); } catch (e) { /* 原样输出 */ }
    if (parsed) {
      console.log('  成功 ' + (parsed.success || 0) + ' 条，今日剩余配额 ' + (parsed.remain || 0));
      if (parsed.not_same_site && parsed.not_same_site.length) console.log('  非本站：', parsed.not_same_site);
      if (parsed.not_valid && parsed.not_valid.length) console.log('  不合法：', parsed.not_valid);
      if (parsed.error) console.log('  错误：', parsed.error, parsed.message || '');
    } else {
      console.log('  返回：', body.slice(0, 400));
    }
    process.exitCode = (res.statusCode === 200 && parsed && !parsed.error) ? 0 : 1;
  });
});
req.on('error', (e) => {
  console.error('推送失败：' + e.message);
  process.exitCode = 1;
});
req.write(payload);
req.end();
