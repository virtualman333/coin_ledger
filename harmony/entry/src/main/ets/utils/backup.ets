/**
 * 收藏的导出 / 导入（CSV 表格），口径与小程序 utils/store.js 完全一致：
 * 列顺序固定、按表头名匹配、JSON 备份也能读。
 */
import { Catalog } from './catalog';
import { round2 } from './format';
import { Holding } from '../model/types';

export interface ImportResult {
  ok: boolean;
  items: Holding[];
  error: string;
  dropped: number;
}

const CSV_COLUMNS: string[][] = [
  ['name', '名称'], ['category', '类别'], ['id', '编号'], ['unit', '单位'],
  ['rolls', '数量'], ['cost', '成本合计'], ['market', '市值合计'], ['group', '分组'],
  ['serials', '冠号'], ['form', '形态'], ['thumb', '缩略图'], ['images', '图片'], ['sep', '独立']
];

const HEAD_ALIAS: Record<string, string> = {
  '名称': 'name', '品种': 'name', 'name': 'name',
  '类别': 'category', '品类': 'category', 'category': 'category',
  '编号': 'id', '代码': 'id', 'id': 'id',
  '单位': 'unit', 'unit': 'unit',
  '数量': 'rolls', '份数': 'rolls', '套数': 'rolls', 'rolls': 'rolls',
  '成本': 'cost', '成本合计': 'cost', 'cost': 'cost',
  '市值': 'market', '市值合计': 'market', 'market': 'market',
  '分组': 'group', 'group': 'group',
  '冠号': 'serials', '号码': 'serials', 'serials': 'serials',
  '形态': 'form', 'form': 'form',
  '缩略图': 'thumb', 'thumb': 'thumb',
  '图片': 'images', 'images': 'images',
  '独立': 'sep', 'sep': 'sep'
};

function csvCell(v: string): string {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

function csvCatLabel(c: string): string {
  if (c === 'pm') return '贵金属纪念币';
  if (c === 'note') return '纪念钞';
  return '普通纪念币';
}

function csvFormLabel(f: string): string {
  if (f === 'single') return '单个';
  if (f === 'set') return '整套';
  return '';
}

/** 当前账本 → CSV 文本（不含 BOM，落文件时再加） */
export function holdingsCsv(holdings: Holding[]): string {
  const head = CSV_COLUMNS.map((c: string[]): string => c[1]).map(csvCell).join(',');
  const lines: string[] = [head];
  for (let i = 0; i < holdings.length; i++) {
    const h = holdings[i];
    const cells: string[] = [];
    for (let j = 0; j < CSV_COLUMNS.length; j++) {
      const k = CSV_COLUMNS[j][0];
      let v = '';
      if (k === 'category') v = csvCatLabel(h.category);
      else if (k === 'unit') v = h.unit === 'piece' ? '枚' : '套';
      else if (k === 'form') v = csvFormLabel(h.form);
      else if (k === 'serials') v = Array.isArray(h.serials) ? h.serials.slice(0, 50).join('|') : '';
      else if (k === 'images') v = Array.isArray(h.images) ? h.images.slice(0, 20).join('|') : '';
      else if (k === 'sep') v = '';
      else if (k === 'rolls') v = String(Number(h.rolls) || 0);
      else if (k === 'cost') v = String(round2(Number(h.cost) || 0));
      else if (k === 'market') v = String(round2(Number(h.market) || 0));
      else if (k === 'name') v = h.name;
      else if (k === 'id') v = h.id;
      else if (k === 'group') v = h.group;
      else if (k === 'thumb') v = h.thumb;
      cells.push(csvCell(v));
    }
    lines.push(cells.join(','));
  }
  return lines.join('\r\n') + '\r\n';
}

/** CSV 文本 → 二维数组。逗号 / 制表符自适应（Excel 复制粘贴是制表符） */
export function parseCsvRows(raw: string): string[][] {
  const src = String(raw === null || raw === undefined ? '' : raw)
    .replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  const firstLine = src.split('\n')[0] || '';
  const commas = (firstLine.match(/,/g) || []).length;
  const tabs = (firstLine.match(/\t/g) || []).length;
  const sep = tabs > commas ? '\t' : ',';
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src.charAt(i);
    if (quoted) {
      if (ch === '"') {
        if (src.charAt(i + 1) === '"') {
          cell += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        cell += ch;
      }
      continue;
    }
    if (ch === '"') {
      quoted = true;
      continue;
    }
    if (ch === sep) {
      row.push(cell);
      cell = '';
      continue;
    }
    if (ch === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
      continue;
    }
    cell += ch;
  }
  if (cell !== '' || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r: string[]): boolean => r.some((c: string): boolean => String(c).trim() !== ''));
}

function csvCategory(v: string): string {
  const s = String(v === null || v === undefined ? '' : v).trim();
  if (!s) return '';
  if (/贵金属|^pm$/i.test(s)) return 'pm';
  if (/纪念钞|^note$/i.test(s)) return 'note';
  if (/普通|纪念币|^coin$/i.test(s)) return 'coin';
  return '';
}

function csvUnitOf(v: string): string {
  return /枚|piece/i.test(String(v === null || v === undefined ? '' : v)) ? 'piece' : 'set';
}

function csvFormOf(v: string): string {
  const s = String(v === null || v === undefined ? '' : v).trim();
  if (!s) return '';
  if (/单个|单枚|single/i.test(s)) return 'single';
  if (/整套|set|^套$/i.test(s)) return 'set';
  return '';
}

function csvNumber(v: string): number {
  const s = String(v === null || v === undefined ? '' : v).replace(/[,，\s¥￥元]/g, '');
  const n = Number(s);
  return isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : 0;
}

function csvList(v: string): string[] {
  return String(v === null || v === undefined ? '' : v)
    .split(/[|｜、;；\n]+/)
    .map((x: string): string => x.trim())
    .filter((x: string): boolean => x !== '');
}

function newId(): string {
  return 'h' + Date.now().toString(36) + Math.floor(Math.random() * 1000).toString(36);
}

/** 逐条校验并归一化；JSON 与 CSV 共用，非法条目丢弃计数 */
function normalizeItem(it: Record<string, Object>): Holding | null {
  if (!it) return null;
  const name = String(it['name'] === undefined || it['name'] === null ? '' : it['name']).trim();
  if (!name || name.length > 60) return null;
  const rollsNum = Math.floor(Number(it['rolls']));
  if (!(rollsNum >= 1)) return null;
  const catRaw = String(it['category'] === undefined || it['category'] === null ? '' : it['category']);
  const category = catRaw === 'pm' ? 'pm' : (catRaw === 'note' ? 'note' : (catRaw === 'coin' ? 'coin' : ''));
  const id = String(it['id'] === undefined || it['id'] === null ? '' : it['id']).trim().slice(0, 40);
  if (category === 'pm' && !id) return null;
  const serialsRaw = it['serials'];
  const imagesRaw = it['images'];
  return {
    id: id || newId(),
    name: name,
    category: category,
    thumb: String(it['thumb'] === undefined || it['thumb'] === null ? '' : it['thumb']).slice(0, 200),
    unit: String(it['unit']) === 'piece' ? 'piece' : 'set',
    rolls: Math.min(9999, rollsNum),
    cost: csvNumber(String(it['cost'] === undefined || it['cost'] === null ? '' : it['cost'])),
    market: csvNumber(String(it['market'] === undefined || it['market'] === null ? '' : it['market'])),
    group: String(it['group'] === undefined || it['group'] === null ? '' : it['group']).slice(0, 30),
    serials: Array.isArray(serialsRaw) ? (serialsRaw as string[]).slice(0, 50).map((x: string): string => String(x)) : [],
    form: String(it['form']) === 'single' || String(it['form']) === 'set' ? String(it['form']) : '',
    images: Array.isArray(imagesRaw) ? (imagesRaw as string[]).slice(0, 20).map((x: string): string => String(x)) : []
  };
}

function collectItems(list: Record<string, Object>[]): ImportResult {
  const items: Holding[] = [];
  let dropped = 0;
  for (let i = 0; i < list.length; i++) {
    const ok = normalizeItem(list[i]);
    if (ok) items.push(ok);
    else dropped += 1;
  }
  if (items.length === 0) {
    return { ok: false, items: [], error: dropped > 0 ? '没有一条能识别的收藏' : '收藏是空的', dropped: dropped };
  }
  return { ok: true, items: items, error: '', dropped: dropped };
}

function csvToItems(raw: string): ImportResult {
  const rows = parseCsvRows(raw);
  if (rows.length < 2) return { ok: false, items: [], error: '表格里没有数据行', dropped: 0 };
  const head = rows[0].map((h: string): string => HEAD_ALIAS[h.trim()] || '');
  if (head.indexOf('name') < 0) {
    return { ok: false, items: [], error: '表格缺少「名称」列，第一行要是表头', dropped: 0 };
  }
  const list: Record<string, Object>[] = [];
  for (let r = 1; r < rows.length; r++) {
    const item: Record<string, Object> = {};
    const row = rows[r];
    for (let i = 0; i < row.length; i++) {
      const k = head[i];
      if (!k) continue;
      const v = String(row[i] === null || row[i] === undefined ? '' : row[i]).trim();
      if (k === 'category') item['category'] = csvCategory(v);
      else if (k === 'unit') item['unit'] = csvUnitOf(v);
      else if (k === 'form') item['form'] = csvFormOf(v);
      else if (k === 'serials') item['serials'] = csvList(v);
      else if (k === 'images') item['images'] = csvList(v);
      else if (k === 'sep') item['sep'] = /^(是|y|yes|true|1)$/i.test(v);
      else if (k === 'rolls' || k === 'cost' || k === 'market') item[k] = csvNumber(v);
      else item[k] = v;
    }
    list.push(item);
  }
  return collectItems(list);
}

/** 解析导入内容：CSV 表格为主，旧版 { holdings: [...] } JSON 备份照样能读 */
export function parseImport(raw: string): ImportResult {
  let text = String(raw === null || raw === undefined ? '' : raw).trim();
  if (!text) return { ok: false, items: [], error: '内容是空的', dropped: 0 };
  text = text.replace(/^\uFEFF/, '');
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence && fence[1]) text = fence[1].trim();

  if (text.charAt(0) === '{' || text.charAt(0) === '[') {
    let data: Object;
    try {
      data = JSON.parse(text) as Object;
    } catch (e) {
      return { ok: false, items: [], error: '不是合法的 JSON', dropped: 0 };
    }
    const arr = Array.isArray(data) ? data as Record<string, Object>[]
      : (data as Record<string, Object>)['holdings'] as Record<string, Object>[];
    if (!Array.isArray(arr)) return { ok: false, items: [], error: '找不到 holdings 列表', dropped: 0 };
    return collectItems(arr);
  }
  return csvToItems(text);
}

/** 去重键：贵金属按编号，普通币/钞按名称 */
export function holdingKey(h: Holding): string {
  if (h.category === 'pm' && h.id) return 'pm|' + h.id;
  return (h.category || 'coin') + '|' + h.name;
}

/** 当前账本里出现的品种，用于导入时提示 */
export function knownNames(holdings: Holding[]): Record<string, boolean> {
  const map: Record<string, boolean> = {};
  for (let i = 0; i < holdings.length; i++) map[holdings[i].name] = true;
  return map;
}

/** 名称能否在目录里找到（提示用，不阻断导入） */
export function inCatalog(name: string): boolean {
  return !!Catalog.byName[name];
}
