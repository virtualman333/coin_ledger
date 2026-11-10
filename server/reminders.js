'use strict';
/**
 * 发行预约提醒（订阅消息）。
 *
 * 流程：
 *   1. 用户在小程序「发行计划」里点「提醒我」→ wx.requestSubscribeMessage 授权（一次性订阅，授权一次可发一条）
 *   2. 前端把 key 报到 POST /api/reminders，这里算出提醒时间并落库
 *   3. 定时器每分钟扫一次，到点调用 subscribeMessage.send，成功后置 sent
 *
 * 一次性订阅的特点：一条授权只能发一条消息。所以「一个项目 = 一次授权 = 一条提醒」，
 * 不同项目要分别点。重复点同一个项目不会叠加，只会刷新时间。
 *
 * 失败处理：
 *   43101 用户拒收 / 未授权 → 标记 invalid，不再重试
 *   其它错误（网络、token）→ 保留 pending，下次扫描重试，最多 5 次后置 failed
 */
const fs = require('fs');
const path = require('path');
const https = require('https');
const crypto = require('crypto');
const wxsec = require('./wxsec');

const TEMPLATE_ID = process.env.WX_REMINDER_TMPL || 'VbGee94SWDa5DUBkHx2Kii8Dp0OobE1PneOJg9Id_ao';

const DIR = process.env.COIN_DATA_DIR || path.join(__dirname, '..', 'data');
const FILE = path.join(DIR, 'reminders.json');

const REMIND_HOUR = 9;          // 预约首日 09:00 提醒
const MAX_TRIES = 5;
const EXPIRE_HOURS = 6;         // 超过提醒时间 6 小时就不再发，避免半夜补发

function now() { return Date.now(); }

function load() {
  try {
    const raw = fs.readFileSync(FILE, 'utf8');
    const doc = JSON.parse(raw);
    if (doc && Array.isArray(doc.items)) return doc;
  } catch (e) { /* 首次运行没有文件 */ }
  return { items: [] };
}

function save(doc) {
  try {
    fs.mkdirSync(DIR, { recursive: true });
    if (fs.existsSync(FILE)) fs.copyFileSync(FILE, FILE + '.bak');
    const tmp = FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(doc, null, 1));
    fs.renameSync(tmp, FILE);
  } catch (e) {
    console.error('[reminder] 写入失败：' + e.message);
  }
}

/** "2026-11-17 至 11-18" → 2026-11-17 */
function reserveStart(reserve) {
  const m = /(\d{4})-(\d{2})-(\d{2})/.exec(String(reserve || ''));
  return m ? m[0] : '';
}

/** 算出提醒时间：预约首日 09:00（+08:00）；没有预约期就用发行日 */
function remindAtOf(item) {
  const day = reserveStart(item && item.reserve) || (item && item.date) || '';
  if (!day) return null;
  const at = new Date(day + 'T' + String(REMIND_HOUR).padStart(2, '0') + ':00:00+08:00');
  return isNaN(at.getTime()) ? null : at;
}

function timeText(d) {
  const p = (n) => String(n).padStart(2, '0');
  return d.getFullYear() + '年' + (d.getMonth() + 1) + '月' + d.getDate() + '日 ' + p(d.getHours()) + ':' + p(d.getMinutes());
}

function clip(s, n) {
  const str = String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
  return str.length > n ? str.slice(0, n - 1) + '…' : str;
}

function post(urlPath, body) {
  return new Promise((resolve, reject) => {
    const buf = Buffer.from(JSON.stringify(body));
    const req = https.request({
      method: 'POST',
      hostname: 'api.weixin.qq.com',
      path: urlPath,
      headers: { 'content-type': 'application/json', 'content-length': buf.length },
    }, (r) => {
      let raw = '';
      r.setEncoding('utf8');
      r.on('data', (c) => { raw += c; });
      r.on('end', () => {
        try { resolve(JSON.parse(raw)); } catch (e) { reject(new Error('微信返回无法解析')); }
      });
    });
    req.on('error', reject);
    req.setTimeout(8000, () => req.destroy(new Error('发送超时')));
    req.write(buf);
    req.end();
  });
}

/** 组装订阅消息数据：字段名按模板固定 */
function payloadOf(r) {
  const at = new Date(r.remindAt);
  const before = (at.getTime() - now()) > 0;
  return {
    thing2: { value: clip(r.short || r.name || '纪念币预约', 20) },
    time25: { value: timeText(at) },
    thing14: { value: clip(r.platform || '手机银行 APP', 20) },
    thing11: { value: clip(r.note || '今日开始预约，记得提前准备身份证与银行卡', 20) },
  };
}

async function sendOne(r, force) {
  if (!r.openid) return { ok: false, code: 'no-openid' };
  const token = await wxsec.getToken(force).catch((e) => { throw new Error('取 token 失败：' + e.message); });
  if (!token) throw new Error('没有 access_token');
  const res = await post('/cgi-bin/message/subscribe/send?access_token=' + encodeURIComponent(token), {
    touser: r.openid,
    template_id: TEMPLATE_ID,
    page: 'pages/plan/plan',
    miniprogram_state: process.env.WX_STATE || 'formal',
    lang: 'zh_CN',
    data: payloadOf(r),
  });
  if (res.errcode === 40001 || res.errcode === 42001) {
    const fresh = await wxsec.getToken(true);
    return sendOne(r, false, fresh);   // token 失效重试一次
  }
  return res;
}

/** 扫一遍待发的提醒 */
async function tick() {
  const doc = load();
  const due = doc.items.filter((r) => r.status === 'pending' && new Date(r.remindAt).getTime() <= now());
  if (!due.length) return 0;

  let sent = 0;
  for (const r of due) {
    const late = now() - new Date(r.remindAt).getTime();
    if (late > EXPIRE_HOURS * 3600 * 1000) {
      r.status = 'expired';
      r.doneAt = new Date().toISOString();
      continue;
    }
    try {
      const res = await sendOne(r);
      if (res.errcode === 0 || res.errcode === undefined && res.errmsg === 'ok') {
        r.status = 'sent';
        r.doneAt = new Date().toISOString();
        sent += 1;
        console.log('[reminder] 已发送 → ' + r.name + '（uid ' + r.uid + '）');
      } else if (res.errcode === 43101) {
        r.status = 'invalid';
        r.err = '用户未授权或已关闭接收';
        console.warn('[reminder] 43101 未授权 uid=' + r.uid + ' key=' + r.key);
      } else {
        r.tries = (r.tries || 0) + 1;
        r.err = res.errcode + ' ' + (res.errmsg || '');
        if (r.tries >= MAX_TRIES) r.status = 'failed';
        console.warn('[reminder] 发送失败 ' + r.err + '（第 ' + r.tries + ' 次）');
      }
    } catch (e) {
      r.tries = (r.tries || 0) + 1;
      r.err = e.message;
      if (r.tries >= MAX_TRIES) r.status = 'failed';
      console.warn('[reminder] 发送异常 ' + e.message);
    }
  }
  save(doc);
  return sent;
}

/** 新建/更新一条提醒（同一用户同一项目只保留一条） */
function upsert(user, planItem, extra) {
  const at = remindAtOf(planItem);
  if (!at) return { ok: false, error: '这个项目还没有确定的日期' };
  const doc = load();
  const exist = doc.items.filter((r) => r.uid === user.id && r.key === planItem.key && r.status === 'pending')[0];
  const rec = {
    id: exist ? exist.id : crypto.randomBytes(6).toString('hex'),
    uid: user.id,
    uname: user.name,                 // 下单的人
    openid: user.wxOpenid || '',
    key: planItem.key,
    name: planItem.name,              // 项目名（发通知用）
    short: planItem.short || planItem.name,
    platform: (extra && extra.platform) || '手机银行 APP',
    note: (extra && extra.note) || (planItem.note || ''),
    remindAt: at.toISOString(),
    date: planItem.date || '',
    reserve: planItem.reserve || '',
    status: 'pending',
    tries: 0,
    err: '',
    createdAt: new Date().toISOString(),
  };
  doc.items = doc.items.filter((r) => r.id !== rec.id);
  doc.items.push(rec);
  save(doc);
  return { ok: true, item: rec };
}

function listOf(uid) {
  return load().items
    .filter((r) => r.uid === uid)
    .sort((a, b) => String(a.remindAt).localeCompare(String(b.remindAt)))
    .map((r) => ({
      id: r.id, key: r.key, name: r.name, short: r.short,
      remindAt: r.remindAt, status: r.status,
    }));
}

function cancel(uid, id) {
  const doc = load();
  const hit = doc.items.filter((r) => r.uid === uid && (r.id === id || r.key === id))[0];
  if (!hit) return false;
  doc.items = doc.items.filter((r) => r !== hit);
  save(doc);
  return true;
}

let timer = null;
function start() {
  if (timer) return;
  // 每 60 秒检查一次；启动 10 秒后先跑一次，避免重启后积压很久
  setTimeout(() => { tick().catch((e) => console.warn('[reminder] ' + e.message)); }, 10000);
  timer = setInterval(() => {
    tick().catch((e) => console.warn('[reminder] ' + e.message));
  }, 60 * 1000);
  timer.unref && timer.unref();
  console.log('[reminder] 预约提醒已启动（模板 ' + TEMPLATE_ID.slice(0, 8) + '…，每日 ' + REMIND_HOUR + ':00 提醒）');
}

module.exports = { TEMPLATE_ID, remindAtOf, timeText, upsert, listOf, cancel, tick, start, load, payloadOf };
