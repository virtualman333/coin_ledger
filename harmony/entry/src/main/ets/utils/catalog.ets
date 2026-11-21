/**
 * 品种目录（内置 rawfile，离线可用）。
 * 数据由 tools/build_harmony_data.js 与 Web / 小程序同源生成。
 *
 * 「一套」件数由套系声明：整卷 20 枚 / 整刀 20 张；多枚套币按发行套。
 */
import { util } from '@kit.ArkTS';
import { common } from '@kit.AbilityKit';
import { Config } from './config';
import { fmtMintage, money, pad3, round2, shortName, signed } from './format';
import { Coin, CoinImage, PlanDoc, RawCoin, SeriesItem, SeriesMeta, SetMeta } from '../model/types';

interface CatalogDoc {
  generatedAt: string;
  meta: Record<string, Object>;
  series: Record<string, string>;
  seriesMeta: SeriesMeta[];
  sets: Record<string, SetMeta>;
  coins: RawCoin[];
  plan: PlanDoc;
}

/** AI 推理价的材质系数（与小程序一致，136 个在册品种对数回归得到） */
const AI_MAT: Record<string, number> = {
  '双色铜合金': 0.8456,
  '钢芯镀镍': 0.0384,
  '紫铜合金': 0.8331,
  '铜镍合金': 1.4898,
  '纸质': 1.1127,
  '塑料': 0.7390,
  '铜锌合金': 1.7983,
  '镍包钢': -1.3443
};

export class Catalog {
  static ready: boolean = false;
  static loadError: string = '';
  static coins: Coin[] = [];
  static seriesDict: Record<string, string> = {};
  static seriesMeta: SeriesMeta[] = [];
  static sets: Record<string, SetMeta> = {};
  static seriesList: SeriesItem[] = [];
  static plan: PlanDoc = { years: [] };
  static byId: Record<string, Coin> = {};
  static byName: Record<string, Coin> = {};

  /** 由 EntryAbility 在 onCreate 调用（需要 AbilityContext 读 rawfile） */
  static init(context: common.Context): void {
    if (Catalog.ready) return;
    try {
      const bytes: Uint8Array = context.resourceManager.getRawFileContentSync('catalog.json');
      const text: string = util.TextDecoder.create('utf-8').decodeToString(bytes);
      const doc: CatalogDoc = JSON.parse(text) as CatalogDoc;
      Catalog.seriesDict = doc.series || {};
      Catalog.seriesMeta = doc.seriesMeta || [];
      Catalog.sets = doc.sets || {};
      Catalog.plan = doc.plan || { years: [] };
      Catalog.buildCoins(doc.coins || []);
      Catalog.buildSeries();
      Catalog.ready = true;
      Catalog.loadError = '';
    } catch (e) {
      Catalog.loadError = '品种目录加载失败';
      Catalog.coins = [];
      Catalog.ready = false;
    }
  }

  static categoryOf(c: RawCoin): string {
    if (c && c.category) return c.category;
    return c && c.kind === 'note' ? 'commemorative_note' : 'commemorative_coin';
  }

  static isPm(c: RawCoin): boolean {
    return Catalog.categoryOf(c) === 'precious_metal';
  }

  static setSizeBaseOf(c: RawCoin): number {
    if (c && c.setSize && c.setSize > 0) return c.setSize;
    const meta: SetMeta | undefined = Catalog.sets[c.set || 'single'];
    return meta && meta.size ? meta.size : Config.PER_SET;
  }

  /** 展示口径：管理端设定 > 预约限额 > 套系件数 */
  static setSizeOf(c: RawCoin): number {
    if (c && c.setSize && c.setSize > 0) return c.setSize;
    if (c && c.limit && c.limit > 0) return c.limit;
    return Catalog.setSizeBaseOf(c);
  }

  static groupName(c: RawCoin): string {
    const meta: SetMeta | undefined = c.set ? Catalog.sets[c.set] : undefined;
    return c.set && c.set !== 'single' && meta && meta.name ? meta.name : '独立藏品';
  }

  static keysOf(c: Coin): string[] {
    if (Array.isArray(c.seriesKeys) && c.seriesKeys.length > 0) return c.seriesKeys;
    return c.series ? [c.series] : [];
  }

  private static buildCoins(raw: RawCoin[]): void {
    const out: Coin[] = [];
    const byId: Record<string, Coin> = {};
    const byName: Record<string, Coin> = {};
    for (let i = 0; i < raw.length; i++) {
      const c = raw[i];
      const face = round2(c.face);
      const est = round2(c.est || 0);
      const size = Catalog.setSizeOf(c);
      const sizeBase = Catalog.setSizeBaseOf(c);
      const isNote = c.kind === 'note';
      const imgs: CoinImage[] = [];
      if (c.imgs && c.imgs.length > 0) {
        for (let j = 0; j < c.imgs.length; j++) {
          const it = c.imgs[j];
          imgs.push({ url: Config.BASE + '/img/' + it.f, f: it.f, k: it.k, label: it.label });
        }
      } else if (c.img) {
        imgs.push({
          url: Config.BASE + '/img/' + pad3(c.id) + '.jpg',
          f: pad3(c.id) + '.jpg',
          k: 'main',
          label: '主图'
        });
      }
      const item: Coin = {
        id: c.id,
        no: c.no,
        category: Catalog.categoryOf(c),
        hasPrice: c.hasPrice,
        year: c.year,
        name: c.name,
        series: c.series,
        seriesKeys: c.seriesKeys || [],
        face: c.face,
        mintage: c.mintage,
        material: c.material,
        dia: c.dia,
        diaText: c.diaText,
        diaLabel: c.diaLabel,
        thickness: c.thickness || '',
        weight: c.weight || '',
        caster: c.caster || '',
        edge: c.edge || '',
        obverse: c.obverse || '',
        reverse: c.reverse || '',
        specFrom: c.specFrom || '',
        limit: c.limit || 0,
        kind: c.kind,
        est: c.est,
        set: c.set || 'single',
        pieces: c.pieces || 1,
        setSize: c.setSize || 0,
        img: c.img,
        imgs: imgs,
        desc: c.desc || '',
        descMd: c.descMd || '',
        descTitle: c.descTitle || '',
        descSrc: c.descSrc || '',
        pm: c.pm,
        faceUnit: face,
        estUnit: est,
        setSizeCalc: size,
        setSizeBase: sizeBase,
        setFace: round2(face * size),
        setFaceBase: round2(face * sizeBase),
        setEst: round2(est * size),
        group: Catalog.groupName(c),
        short: shortName(c.name),
        seriesName: Catalog.isPm(c) ? '贵金属' : (Catalog.seriesDict[c.series] || '其他'),
        imgUrl: c.img ? Config.BASE + '/img/' + pad3(c.id) + '.jpg' : '',
        thumbUrl: c.img ? Config.BASE + '/img/th/' + pad3(c.id) + '.jpg' : '',
        smallUrl: c.img ? Config.BASE + '/img/th/s/' + pad3(c.id) + '.jpg' : '',
        faceText: face + ' 元/' + (isNote ? '张' : '枚'),
        mintageText: fmtMintage(c.mintage || 0),
        diaFullText: /^\d+(\.\d+)?$/.test(String(c.dia))
          ? c.dia + ' 毫米'
          : (c.diaText && c.diaText !== '—' ? String(c.diaText).replace('mm', ' 毫米') : '—')
      };
      out.push(item);
      byId[String(item.id)] = item;
      byName[item.name] = item;
    }
    Catalog.coins = out;
    Catalog.byId = byId;
    Catalog.byName = byName;
  }

  private static buildSeries(): void {
    const list: SeriesItem[] = [];
    if (Catalog.seriesMeta.length > 0) {
      for (let i = 0; i < Catalog.seriesMeta.length; i++) {
        const m = Catalog.seriesMeta[i];
        const count = Catalog.coins.filter((c: Coin) => Catalog.keysOf(c).indexOf(m.key) >= 0).length;
        list.push({
          code: m.key,
          name: m.name,
          desc: m.desc || '',
          img: m.img || '',
          sort: m.sort || 0,
          count: count
        });
      }
    } else {
      const keys = Object.keys(Catalog.seriesDict);
      for (let i = 0; i < keys.length; i++) {
        const code = keys[i];
        const count = Catalog.coins.filter((c: Coin) => Catalog.keysOf(c).indexOf(code) >= 0).length;
        list.push({
          code: code,
          name: Catalog.seriesDict[code],
          desc: '',
          img: '',
          sort: 0,
          count: count
        });
      }
    }
    Catalog.seriesList = list.filter((s: SeriesItem) => s.count > 0)
      .sort((a: SeriesItem, b: SeriesItem) => a.sort - b.sort);
  }

  static seriesName(code: string): string {
    const hit = Catalog.seriesList.filter((s: SeriesItem) => s.code === code);
    if (hit.length > 0) return hit[0].name;
    return Catalog.seriesDict[code] || '';
  }

  static inSeries(code: string): Coin[] {
    if (!code) return Catalog.coins;
    return Catalog.coins.filter((c: Coin) => Catalog.keysOf(c).indexOf(code) >= 0);
  }

  static coinsOf(category: string): Coin[] {
    return Catalog.coins.filter((c: Coin) => {
      const cc = Catalog.categoryOf(c);
      if (category === 'note') return cc === 'commemorative_note';
      if (category === 'pm') return cc === 'precious_metal';
      return cc === 'commemorative_coin';
    });
  }

  /**
   * AI 推理价：只用公开参数估的理论价。
   * ln(P) = 12.605 − 2.2721·ln(M) + 0.1102·ln(M)² + 0.3325·ln(1+age) + 材质 + 钞
   */
  static aiPriceOf(coin: Coin): number {
    if (!coin) return 0;
    const thisYear = new Date().getFullYear();
    const m = Math.max(1, Number(coin.mintage) || 1000);
    const age = Math.max(0, thisYear - (Number(coin.year) || thisYear));
    const lm = Math.log(m);
    let ln = 12.605 - 2.2721 * lm + 0.1102 * lm * lm + 0.3325 * Math.log(1 + age);
    ln += AI_MAT[coin.material] || 0;
    if (coin.kind === 'note') ln += 1.8516;
    let p = Math.exp(ln);
    const face = Number(coin.face) || 1;
    const infl = Math.pow(1.025, age);
    const floor = Math.max(face * 1.2, face * infl);
    if (!isFinite(p) || p < floor) p = floor;
    return Math.round(p * 10) / 10;
  }

  static total(): number {
    return Catalog.coins.length;
  }

  static money(n: number): string {
    return money(n);
  }

  static signed(n: number): string {
    return signed(n);
  }
}
