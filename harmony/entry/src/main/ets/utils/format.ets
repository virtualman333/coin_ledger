/** 金额 / 数量 / 时间格式化 —— 口径与小程序 utils/catalog.js 完全一致 */

export function round2(n: number): number {
  return Math.round((Number(n) || 0) * 100) / 100;
}

/** 千分位金额，去掉多余的 .00 */
export function money(n: number): string {
  const v = round2(n);
  const neg = v < 0;
  const abs = Math.abs(v);
  const fixed = abs.toFixed(2);
  const parts = fixed.split('.');
  const intPart = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const trim = String(parts[1] || '').replace(/0+$/, '');
  const dec = trim.length > 0 ? '.' + trim : '';
  return (neg ? '-' : '') + intPart + dec;
}

export function signed(n: number): string {
  const v = round2(n);
  if (v > 0) return '+' + money(v);
  return money(v);
}

export function pad3(n: number): string {
  const s = String(n);
  return s.length >= 3 ? s : ('00' + s).slice(-3);
}

/** 发行量：万 → 亿（保留 1 位） */
export function fmtMintage(w: number): string {
  const n = Number(w) || 0;
  if (!n) return '—';
  if (n >= 10000) {
    const y = Math.round((n / 10000) * 10) / 10;
    return y + ' 亿';
  }
  return n + ' 万';
}

/** 简称：去掉「（xx）」与年份前缀，取「·」后段 */
export function shortName(name: string): string {
  const text = String(name || '');
  const head = text.split('（')[0];
  if (head.indexOf('·') >= 0) return head.split('·').pop() || head;
  const inner = /（(.+?)）/.exec(text);
  if (inner && inner[1]) {
    const seg = inner[1].split('·')[0].trim();
    if (seg.length <= 5) return seg;
  }
  const trimmed = head.replace(/^\d{4}年贺岁/, '').trim();
  return trimmed.length > 0 ? trimmed : text;
}

/** ISO → 本地 HH:MM */
export function hhmm(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return ('0' + String(d.getHours())).slice(-2) + ':' + ('0' + String(d.getMinutes())).slice(-2);
}

/** 相对时间：刚刚 / N 分钟前 / N 小时前 / N 天前 / M月D日 */
export function agoText(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const diff = Date.now() - d.getTime();
  if (diff < 60000) return '刚刚';
  if (diff < 3600000) return Math.floor(diff / 60000) + ' 分钟前';
  if (diff < 86400000) return Math.floor(diff / 3600000) + ' 小时前';
  if (diff < 604800000) return Math.floor(diff / 86400000) + ' 天前';
  return (d.getMonth() + 1) + '月' + d.getDate() + '日';
}

/** 金额保留两位，非数字回退 -- */
export function fmtPrice(n: number): string {
  const v = Number(n);
  return isFinite(v) ? v.toFixed(2) : '--';
}

/** 数量 + 单位（枚 / 张） */
export function qtyText(n: number, kind: string): string {
  return String(Number(n) || 0) + ' ' + (kind === 'note' ? '张' : '枚');
}
