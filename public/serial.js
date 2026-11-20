'use strict';
/**
 * 纪念钞冠字号码分析引擎（纯函数，前后端共用同一套规则）。
 *
 * 输入一串号码（可带冠字字母，如 J12345678 / JG12345678），输出识别到的「花样」标签。
 * 规则来自钱币收藏圈通用叫法（见 docs/serial-rules.md）：
 *   尾同号 3~8 位：豹子/狮子/老虎/大象/恐龙/麒麟
 *   吉祥偏好：无4 / 无47 / 无347、倒置号(01689)、圆圆号(0689)、发财号、爱情号、生日号
 *   规律稀缺：顺子/倒顺子(天顺)、雷达号(对称)、乱蛇号(不重复)、开门号、关门号
 *
 * 只做规则识别，不估价、不承诺增值——收藏有风险，价格以市场为准。
 */

/** 尾同号位数 -> 名称。3 位起算，位数越多越稀有。 */
const REPEAT_NAMES = {
  3: '豹子号', 4: '狮子号', 5: '老虎号', 6: '大象号', 7: '恐龙号', 8: '麒麟号'
};

/** 标签稀有度权重，仅用于前端排序/着色：1 普通 ~ 5 顶级 */
const RARITY = {
  '无4': 1, '无47': 2, '无347': 3,
  '发财号': 2, '爱情号': 2, '生日号': 2,
  '倒置号': 3, '圆圆号': 3, '乱蛇号': 3,
  '顺子号': 3, '天顺号': 5, '倒顺子号': 3,
  '雷达号': 4, '小雷达号': 2,
  '豹子号': 2, '狮子号': 3, '老虎号': 4, '大象号': 4, '恐龙号': 5, '麒麟号': 5,
  '开门号': 4, '关门号': 4,
  '连号': 2
};

/**
 * 从任意输入里抽出纯数字流水号。
 * 冠字（字母）忽略；空格/连字符忽略；保留前导 0。
 */
function digits(input) {
  if (input === null || input === undefined) return '';
  return String(input).replace(/[^0-9]/g, '');
}

function isValidDate(y, m, d) {
  if (y < 1900 || y > 2099) return false;
  if (m < 1 || m > 12 || d < 1) return false;
  const days = new Date(y, m, 0).getDate();
  return d <= days;
}

/**
 * 分析单个号码。
 * @param {string} input 冠字号码，如 'J12345678'
 * @returns {{no:string, digits:string, valid:boolean, tags:Array<{name:string,rarity:number,desc:string}>, top:string}}
 */
function analyze(input) {
  const raw = digits(input);
  const no = String(input || '').trim();
  const result = { no, digits: raw, valid: false, tags: [], top: '' };

  // 纪念钞流水号通常 7~9 位（三冠 7 位、两冠 8 位、关门号 9 位）
  if (raw.length < 4 || raw.length > 9) return result;
  result.valid = true;

  const add = (name, desc) => {
    if (!name) return;
    if (!result.tags.some((t) => t.name === name)) {
      result.tags.push({ name, rarity: RARITY[name] || 1, desc: desc || '' });
    }
  };

  // ---- 尾同号：从末尾数连续相同数字的最大长度 ----
  let tail = 1;
  for (let i = raw.length - 1; i > 0; i--) {
    if (raw[i] === raw[i - 1]) tail++;
    else break;
  }
  // 尾同号末尾必须是非零数字；全 0 结尾是关门号/开门票，不算豹子家族
  if (tail >= 3 && raw[raw.length - 1] !== '0') {
    const name = REPEAT_NAMES[Math.min(tail, 8)];
    add(name, '尾号 ' + tail + ' 位相同（' + raw[raw.length - 1] + '）');
  }

  // ---- 无 4 / 无 47 / 无 347（按稀有度取最高一档， tiers 可叠加展示）----
  const has4 = raw.indexOf('4') >= 0;
  const has7 = raw.indexOf('7') >= 0;
  const has3 = raw.indexOf('3') >= 0;
  if (!has4 && !has7 && !has3) add('无347', '全号不含 3、4、7');
  else if (!has4 && !has7) add('无47', '全号不含 4、7');
  else if (!has4) add('无4', '全号不含 4');

  // ---- 倒置号：仅由 0/1/6/8/9 组成，倒过来看仍是数字 ----
  if (/^[01689]+$/.test(raw)) {
    add('倒置号', '仅含 0/1/6/8/9，倒置可读');
    // 圆圆号：更严格，仅 0/6/8/9（全带圈）
    if (/^[0689]+$/.test(raw)) add('圆圆号', '仅含 0/6/8/9，皆为圆圈');
  }

  // ---- 顺子 / 天顺 / 倒顺子（连续递增或递减，至少 4 位）----
  const seq = (s, step) => {
    for (let i = 1; i < s.length; i++) {
      if ((Number(s[i]) - Number(s[i - 1])) !== step) return false;
    }
    return true;
  };
  const tail4 = raw.slice(-4);
  if (tail4.length === 4 && seq(tail4, 1)) {
    if (raw.length === 8 && seq(raw, 1) && raw[0] === '1' && raw[raw.length - 1] === '8') {
      add('天顺号', '12345678 全序递增');
    } else add('顺子号', '尾号递增 ' + tail4);
  }
  if (tail4.length === 4 && seq(tail4, -1)) add('倒顺子号', '尾号递减 ' + tail4);

  // ---- 雷达号：整个流水号左右对称；小雷达：中间部分对称 ----
  const isPalin = (s) => {
    for (let i = 0, j = s.length - 1; i < j; i++, j--) if (s[i] !== s[j]) return false;
    return true;
  };
  if (raw.length >= 4 && isPalin(raw)) add('雷达号', '号码左右完全对称');
  else {
    // 中间连续对称段 >= 4 视为小雷达（如 1233218）
    let best = 0;
    for (let i = 0; i < raw.length; i++) {
      for (let j = raw.length - 1; j > i; j--) {
        let lo = i, hi = j, ok = true;
        while (lo < hi) { if (raw[lo] !== raw[hi]) { ok = false; break; } lo++; hi--; }
        if (ok) best = Math.max(best, j - i + 1);
      }
    }
    if (best >= 4) add('小雷达号', '中间 ' + best + ' 位对称');
  }

  // ---- 乱蛇号：8 位且 0-9 中不重复（每个都独一份）----
  if (raw.length === 8 && new Set(raw.split('')).size === 8) {
    add('乱蛇号', '8 位数字互不重复');
  }

  // ---- 发财 / 爱情 / 生日号（尾号语义）----
  const tail3 = raw.slice(-3);
  if (['888', '666', '168'].indexOf(tail3) >= 0) add('发财号', '尾号 ' + tail3 + ' 寓意吉利');
  if (raw.indexOf('520') >= 0 || raw.indexOf('1314') >= 0 || raw.indexOf('521') >= 0) {
    add('爱情号', '含 520/1314 谐音');
  }
  if (raw.length >= 8) {
    const last8 = raw.slice(-8);
    const y = Number(last8.slice(0, 4)), m = Number(last8.slice(4, 6)), d = Number(last8.slice(6, 8));
    if (isValidDate(y, m, d)) add('生日号', '尾号形如 ' + y + '-' + m + '-' + d);
  }

  // ---- 开门号 / 关门号 ----
  // 开门号：冠字后全 0 收尾仅末位 1（如 J00000001）；关门号：1 后全 0（如 J100000000）
  if (/^0{3,}1$/.test(raw)) add('开门号', '冠字号段首张');
  if (/^1?0{7,}$/.test(raw) || raw === '100000000') add('关门号', '冠字号段末张');

  // 按稀有度降序、名称稳定排序
  result.tags.sort((a, b) => b.rarity - a.rarity || a.name.localeCompare(b.name, 'zh'));
  result.top = result.tags.length ? result.tags[0].name : '';
  return result;
}

/**
 * 批量号码分析：识别组内「连号」（相邻流水号 +1）。
 * @param {Array<string>} inputs 号码数组
 * @returns {{items:Array, runs:Array<{start:number,end:number,len:number,nos:string[]}>}}
 */
function analyzeBatch(inputs) {
  const list = Array.isArray(inputs) ? inputs : [];
  const items = list.map((n) => analyze(n));
  const runs = [];
  // 只把「同一冠字、流水号连续」的相邻项归为一段连号
  let cur = [];
  const keyOf = (item) => {
    const m = /^([A-Za-z]*)(.*)$/.exec(item.no || '');
    return {冠: (m && m[1]) || '', n: Number(item.digits) };
  };
  const flush = () => {
    if (cur.length >= 2) {
      runs.push({
        start: 0, end: cur.length - 1, len: cur.length,
        nos: cur.map((x) => x.no)
      });
    }
    cur = [];
  };
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    if (!it.valid) { flush(); continue; }
    const k = keyOf(it);
    if (!cur.length) { cur.push(it); continue; }
    const prev = keyOf(cur[cur.length - 1]);
    if (k.冠 === prev.冠 && k.n === prev.n + 1) cur.push(it);
    else { flush(); cur.push(it); }
  }
  flush();
  // 给连号段内的每个 item 打上「连号」标签
  runs.forEach((r) => {
    r.nos.forEach((no) => {
      const target = items.find((x) => x.no === no);
      if (target) addTag(target, '连号', r.len + ' 连号');
    });
  });
  return { items, runs };
}

function addTag(item, name, desc) {
  if (!item || item.tags.some((t) => t.name === name)) return;
  item.tags.push({ name, rarity: RARITY[name] || 1, desc: desc || '' });
  item.tags.sort((a, b) => b.rarity - a.rarity || a.name.localeCompare(b.name, 'zh'));
  if (item.tags.length) item.top = item.tags[0].name;
}

const API = { analyze, analyzeBatch, digits, RARITY };

// 同一份规则前后端共用：Node 走 module.exports，浏览器走 window.SerialAnalyze
if (typeof module !== 'undefined' && module.exports) module.exports = API;
if (typeof window !== 'undefined') window.SerialAnalyze = API;
