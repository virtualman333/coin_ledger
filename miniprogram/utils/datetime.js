/** 日期显示工具（管理端列表、反馈、访客共用） */

/** 时间戳 / ISO 字符串 → 2026/11/9；拿不到就显示破折号 */
function dayText(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  return d.getFullYear() + '/' + (d.getMonth() + 1) + '/' + d.getDate();
}

module.exports = { dayText };
