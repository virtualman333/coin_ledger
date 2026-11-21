/**
 * 应用状态：账号 / 藏品 / 行情。
 * 权威数据在服务器（与网站、小程序共用一套库），本机只做一份缓存用于秒开。
 *
 * UI 通过 AppStorage 的 cl_dataRev 感知数据变化，业务数据仍从 Store.getState() 读取，
 * 避免把大对象反复在装饰器里做深拷贝。
 */
import { preferences } from '@kit.ArkData';
import { common } from '@kit.AbilityKit';
import { Api, ApiError } from './api';
import { Catalog } from './catalog';
import { Config, Keys } from './config';
import { round2 } from './format';
import { Coin, Holding, StateResponse, Stats, User } from '../model/types';

export class StoreState {
  booted: boolean = false;
  user: User | null = null;
  isAdmin: boolean = false;
  holdings: Holding[] = [];
  prices: Record<string, number> = {};
  userCount: number = 0;
  rev: number = 0;
  synced: boolean = false;
  error: string = '';
}

interface CacheDoc {
  user: User | null;
  holdings: Holding[];
  prices: Record<string, number>;
  rev: number;
  userCount: number;
  synced: boolean;
}

interface PutResponse {
  ok: boolean;
  rev: number;
}

/** PUT /api/holdings 的请求体（ArkTS 不允许无类型对象字面量） */
class HoldingsBody {
  holdings: Holding[];

  constructor(holdings: Holding[]) {
    this.holdings = holdings;
  }
}

export class Store {
  static readonly K_USER: string = 'cl_userJson';
  static readonly K_DATA_REV: string = 'cl_dataRev';
  static readonly K_SYNCED: string = 'cl_synced';
  static readonly K_ERROR: string = 'cl_error';

  static state: StoreState = new StoreState();
  private static pref: preferences.Preferences | null = null;
  private static inflight: Promise<StoreState> | null = null;
  private static seq: number = 0;
  private static tail: Promise<void> = Promise.resolve();
  private static dataRev: number = 0;

  /** 同步初始化：首帧就能拿到登录态与缓存，未同意隐私政策前由调用方跳过 */
  static init(context: common.Context): void {
    if (Store.pref) return;
    const opt: preferences.Options = { name: Keys.STORE };
    Store.pref = preferences.getPreferencesSync(context, opt);
    const token = Store.pref.getSync(Keys.TOKEN, '') as string;
    Api.setToken(token);
    Api.onExpired = (): void => {
      Store.clearUser();
    };
    Store.hydrate();
    Store.publish();
  }

  static getState(): StoreState {
    return Store.state;
  }

  static isLogin(): boolean {
    return Store.state.user !== null;
  }

  private static publish(): void {
    const s = Store.state;
    AppStorage.setOrCreate<string>(Store.K_USER, s.user ? JSON.stringify(s.user) : '');
    AppStorage.setOrCreate<boolean>(Store.K_SYNCED, s.synced);
    AppStorage.setOrCreate<string>(Store.K_ERROR, s.error);
    Store.dataRev += 1;
    AppStorage.setOrCreate<number>(Store.K_DATA_REV, Store.dataRev);
  }

  /** 当前登录用户（AppStorage 里存的是 JSON，页面需要对象时用它） */
  static currentUser(): User | null {
    return Store.state.user;
  }

  static saveToken(token: string): void {
    Api.setToken(token || '');
    if (Store.pref) {
      Store.pref.putSync(Keys.TOKEN, token || '');
      Store.pref.flushSync();
    }
  }

  private static hydrate(): void {
    Store.state.booted = true;
    if (!Store.pref) return;
    const raw = Store.pref.getSync(Keys.CACHE, '') as string;
    if (!raw) return;
    try {
      const cache = JSON.parse(raw) as CacheDoc;
      if (cache && cache.user) {
        Store.state.user = cache.user;
        Store.state.holdings = Array.isArray(cache.holdings) ? cache.holdings : [];
        Store.state.prices = cache.prices || {};
        Store.state.rev = cache.rev || 0;
        Store.state.userCount = cache.userCount || 0;
        Store.state.synced = !!cache.synced;
      }
    } catch (e) {
      // 缓存损坏：忽略，等服务器返回
    }
  }

  private static saveCache(): void {
    if (!Store.pref) return;
    const doc: CacheDoc = {
      user: Store.state.user,
      holdings: Store.state.holdings,
      prices: Store.state.prices,
      rev: Store.state.rev,
      userCount: Store.state.userCount,
      synced: Store.state.synced
    };
    try {
      Store.pref.putSync(Keys.CACHE, JSON.stringify(doc));
      Store.pref.flushSync();
    } catch (e) {
      // 缓存失败不影响主流程
    }
  }

  /**
   * 从服务器拉一次全量状态。
   * 并发调用共用同一个请求；写操作之后用 refresh(true)。
   * 序号守卫：旧的慢响应一律作废，避免覆盖刚写入的新状态。
   */
  static refresh(force: boolean = false): Promise<StoreState> {
    if (Store.inflight && !force) return Store.inflight;
    Store.seq += 1;
    const my = Store.seq;
    const p: Promise<StoreState> = Store.doRefresh(my);
    Store.inflight = p;
    return p;
  }

  private static async doRefresh(my: number): Promise<StoreState> {
    try {
      const res = await Api.get<StateResponse>('/api/state');
      if (my !== Store.seq) return Store.state;
      Store.state.user = res.user || null;
      Store.state.isAdmin = !!res.isAdmin;
      Store.state.holdings = Array.isArray(res.holdings) ? res.holdings : [];
      Store.state.prices = res.prices || {};
      Store.state.userCount = res.userCount || 0;
      Store.state.rev = res.rev || 0;
      Store.state.synced = true;
      Store.state.error = '';
      if (!Store.state.user) {
        Store.state.holdings = [];
      }
      Store.publish();
      await Store.saveCache();
      Store.inflight = null;
      return Store.state;
    } catch (e) {
      if (my !== Store.seq) return Store.state;
      Store.inflight = null;
      Store.state.synced = false;
      Store.state.error = (e as Error).message || '同步失败';
      Store.publish();
      throw new Error(Store.state.error);
    }
  }

  /** 单件市价（服务器行情优先） */
  static priceOf(coin: Coin): number {
    const p = Store.state.prices[String(coin.id - 1)];
    return typeof p === 'number' ? round2(p) : (coin.est || 0);
  }

  static setPriceOf(coin: Coin): number {
    return round2(Store.priceOf(coin) * coin.setSizeCalc);
  }

  static findHolding(name: string): Holding | null {
    for (let i = 0; i < Store.state.holdings.length; i++) {
      if (Store.state.holdings[i].name === name) return Store.state.holdings[i];
    }
    return null;
  }

  static ownedNames(): Record<string, boolean> {
    const map: Record<string, boolean> = {};
    for (let i = 0; i < Store.state.holdings.length; i++) {
      map[Store.state.holdings[i].name] = true;
    }
    return map;
  }

  static stats(): Stats {
    let face = 0;
    let cost = 0;
    let market = 0;
    let rolls = 0;
    let kinds = 0;
    let pmKinds = 0;
    let pmRolls = 0;
    for (let i = 0; i < Store.state.holdings.length; i++) {
      const h = Store.state.holdings[i];
      if (h.category === 'pm') {
        pmKinds += 1;
        pmRolls += Number(h.rolls) || 0;
        cost += Number(h.cost) || 0;
        continue;
      }
      const coin: Coin | undefined = Catalog.byName[h.name];
      if (!coin) continue;
      const r = Number(h.rolls) || 0;
      face += coin.setFace * r;
      cost += Number(h.cost) || 0;
      market += Number(h.market) || 0;
      rolls += r;
      kinds += 1;
    }
    return {
      face: round2(face),
      cost: round2(cost),
      market: round2(market),
      profit: round2(market - cost),
      rolls: rolls,
      kinds: kinds,
      pmKinds: pmKinds,
      pmRolls: pmRolls
    };
  }

  static requireLogin(): void {
    if (!Store.state.user) {
      throw new ApiError('登录后才能记录藏品', 401);
    }
  }

  private static newId(): string {
    return 'h' + Date.now().toString(36) + Math.floor(Math.random() * 1000).toString(36);
  }

  private static payloadOf(): Holding[] {
    const out: Holding[] = [];
    for (let i = 0; i < Store.state.holdings.length; i++) {
      const h = Store.state.holdings[i];
      out.push({
        id: h.id,
        name: h.name,
        rolls: h.rolls,
        cost: round2(h.cost),
        market: round2(h.market),
        group: h.group,
        category: h.category,
        thumb: h.thumb,
        unit: h.unit,
        serials: Array.isArray(h.serials) ? h.serials : [],
        form: h.form === 'single' || h.form === 'set' ? h.form : '',
        images: Array.isArray(h.images) ? h.images : []
      });
    }
    return out;
  }

  /**
   * 全量 PUT 串行化：多次写并发时按调用顺序发送，
   * 保证服务端最终收到的是最后一次完整状态。
   */
  static persist(): Promise<PutResponse> {
    const payload = Store.payloadOf();
    const run: Promise<PutResponse> = Store.tail.then((): Promise<PutResponse> => {
      return Api.put<PutResponse>('/api/holdings', new HoldingsBody(payload));
    });
    Store.tail = run.then((): void => {
    }).catch((): void => {
    });
    return run.then((res: PutResponse): PutResponse => {
      Store.state.rev = res.rev || Store.state.rev;
      Store.state.synced = true;
      Store.state.error = '';
      Store.publish();
      Store.saveCache();
      return res;
    }).catch((e: Error): never => {
      Store.state.synced = false;
      Store.state.error = e.message || '保存失败，尚未同步';
      Store.publish();
      throw new Error(Store.state.error);
    });
  }

  static addCoin(coin: Coin, unit: string, qty: number): Promise<PutResponse> {
    Store.requireLogin();
    if (Store.findHolding(coin.name)) {
      const err = new ApiError('这一枚已经在你的藏品里了', 400);
      return Promise.reject(err);
    }
    const size = Math.max(1, Number(coin.setSizeCalc) || 1);
    const isPiece = unit === 'piece' && size > 1;
    const n = Math.max(1, Math.min(9999, Math.floor(Number(qty) || 1)));
    const setFace = coin.setFace;
    const setMarket = Store.setPriceOf(coin);
    const oneCost = isPiece ? setFace / size : setFace;
    const oneMarket = isPiece ? setMarket / size : setMarket;
    const item: Holding = {
      id: Store.newId(),
      name: coin.name,
      category: '',
      thumb: '',
      unit: isPiece ? 'piece' : 'set',
      rolls: n,
      cost: Math.round(oneCost * n * 100) / 100,
      market: Math.round(oneMarket * n * 100) / 100,
      group: coin.group,
      serials: [],
      form: '',
      images: []
    };
    Store.state.holdings = Store.state.holdings.concat([item]);
    Store.publish();
    return Store.persist();
  }

  /** 贵金属入账本：按枚记，不套用普通币的整卷口径 */
  static addPm(code: string, name: string, face: number, thumb: string, rolls: number): Promise<PutResponse> {
    Store.requireLogin();
    const hit = Store.state.holdings.filter((h: Holding) => h.category === 'pm' && h.id === code);
    if (hit.length > 0) {
      return Promise.reject(new ApiError('这枚已经在你的藏品里了', 400));
    }
    const qty = Math.max(1, Number(rolls) || 1);
    const item: Holding = {
      id: code,
      name: name,
      category: 'pm',
      thumb: thumb || '',
      unit: 'piece',
      rolls: qty,
      cost: Math.round((Number(face) || 0) * qty * 100) / 100,
      market: 0,
      group: '贵金属',
      serials: [],
      form: '',
      images: []
    };
    Store.state.holdings = Store.state.holdings.concat([item]);
    Store.publish();
    return Store.persist();
  }

  static removeHolding(id: string): Promise<PutResponse> {
    Store.requireLogin();
    Store.state.holdings = Store.state.holdings.filter((h: Holding) => h.id !== id);
    Store.publish();
    return Store.persist();
  }

  static setCost(id: string, unitCost: number): Promise<PutResponse | null> {
    Store.requireLogin();
    const target = Store.state.holdings.filter((h: Holding) => h.id === id);
    if (target.length === 0) return Promise.resolve(null);
    const h = target[0];
    const rolls = Number(h.rolls) || 1;
    const unit = Math.max(0, Number(unitCost) || 0);
    h.cost = Math.round(unit * rolls * 100) / 100;
    Store.state.holdings = Store.state.holdings.slice();
    Store.publish();
    return Store.persist();
  }

  static setRolls(id: string, rolls: number): Promise<PutResponse | null> {
    Store.requireLogin();
    const next = Math.max(1, Math.min(999, Number(rolls) || 1));
    const target = Store.state.holdings.filter((h: Holding) => h.id === id);
    if (target.length === 0) return Promise.resolve(null);
    const h = target[0];
    const oldRolls = Number(h.rolls) || 1;
    const unitCost = (Number(h.cost) || 0) / oldRolls;
    const unitMarket = (Number(h.market) || 0) / oldRolls;
    h.rolls = next;
    h.cost = round2(unitCost * next);
    h.market = round2(unitMarket * next);
    Store.state.holdings = Store.state.holdings.slice();
    Store.publish();
    return Store.persist();
  }

  /** 切换记账口径：整套 ↔ 单个。按件数换算，市值不变。 */
  static setUnitForm(id: string, unit: string, rolls: number, totalCost: number): Promise<PutResponse | null> {
    Store.requireLogin();
    const target = Store.state.holdings.filter((h: Holding) => h.id === id);
    if (target.length === 0) return Promise.resolve(null);
    const h = target[0];
    const coin: Coin | undefined = Catalog.byName[h.name];
    const size = Math.max(1, Number(coin ? (coin.setSizeBase || coin.setSizeCalc) : 1) || 1);
    const oldRolls = Math.max(1, Number(h.rolls) || 1);
    const oldQty = h.unit === 'piece' ? oldRolls : oldRolls * size;
    const nextUnit = unit === 'piece' ? 'piece' : 'set';
    const nextRolls = Math.max(1, Math.min(999, Math.floor(Number(rolls) || 1)));
    const nextQty = nextUnit === 'piece' ? nextRolls : nextRolls * size;
    const oldMarket = Number(h.market) || 0;
    h.unit = nextUnit;
    h.rolls = nextRolls;
    h.cost = round2(Math.max(0, Number(totalCost) || 0));
    h.market = oldQty > 0 ? round2((oldMarket / oldQty) * nextQty) : oldMarket;
    Store.state.holdings = Store.state.holdings.slice();
    Store.publish();
    return Store.persist();
  }

  static patchHolding(id: string, serials: string[] | null, form: string | null,
    unit: string | null, images: string[] | null): Promise<PutResponse | null> {
    Store.requireLogin();
    const target = Store.state.holdings.filter((h: Holding) => h.id === id);
    if (target.length === 0) return Promise.resolve(null);
    const h = target[0];
    if (serials !== null) {
      h.serials = serials.slice(0, 200)
        .map((s: string): string => String(s || '').trim())
        .filter((s: string): boolean => s.length > 0);
    }
    if (form !== null) h.form = form;
    if (unit !== null && (unit === 'piece' || unit === 'set')) h.unit = unit;
    if (images !== null) h.images = images.slice(0, 3);
    Store.state.holdings = Store.state.holdings.slice();
    Store.publish();
    return Store.persist();
  }

  /** 导入收藏：replace=true 覆盖，否则按「贵金属编号 / 普通币名称」去重合并 */
  static importHoldings(items: Holding[], replace: boolean): Promise<PutResponse> {
    Store.requireLogin();
    if (replace) {
      Store.state.holdings = items.slice();
      Store.publish();
      return Store.persist();
    }
    const seen: Record<string, boolean> = {};
    for (let i = 0; i < Store.state.holdings.length; i++) {
      const h = Store.state.holdings[i];
      seen[(h.category === 'pm' && h.id ? 'pm|' + h.id : (h.category || 'coin') + '|' + h.name)] = true;
    }
    let added = 0;
    const merged = Store.state.holdings.slice();
    for (let i = 0; i < items.length; i++) {
      const h = items[i];
      const key = h.category === 'pm' && h.id ? 'pm|' + h.id : (h.category || 'coin') + '|' + h.name;
      if (seen[key]) continue;
      seen[key] = true;
      merged.push(h);
      added += 1;
    }
    if (added === 0) {
      const same: PutResponse = { ok: true, rev: Store.state.rev };
      return Promise.resolve(same);
    }
    Store.state.holdings = merged;
    Store.publish();
    return Store.persist();
  }

  /** 本机记录的预约提醒（鸿蒙端不做微信订阅消息，只在应用内标记） */
  static getLocalReminders(): Record<string, string> {
    if (!Store.pref) return {};
    const raw = Store.pref.getSync('cl_reminders', '') as string;
    if (!raw) return {};
    try {
      return JSON.parse(raw) as Record<string, string>;
    } catch (e) {
      return {};
    }
  }

  static setLocalReminder(key: string, text: string): void {
    if (!Store.pref || !key) return;
    const map = Store.getLocalReminders();
    map[key] = text;
    Store.pref.putSync('cl_reminders', JSON.stringify(map));
    Store.pref.flushSync();
  }

  /** 清空登录态：所有用户相关字段一起清，避免串号 */
  static clearUser(): void {
    Store.seq += 1;
    Store.inflight = null;
    Store.state.user = null;
    Store.state.isAdmin = false;
    Store.state.holdings = [];
    Store.state.prices = {};
    Store.state.userCount = 0;
    Store.state.rev = 0;
    Store.state.synced = false;
    Store.state.error = '';
    Store.publish();
    Store.saveToken('');
    if (Store.pref) {
      Store.pref.deleteSync(Keys.CACHE);
      Store.pref.flushSync();
    }
  }

  static async logout(): Promise<void> {
    try {
      await Api.post<Object>('/api/auth/logout');
    } catch (e) {
      // 服务端不可达也要把本地登录态清掉
    }
    Store.clearUser();
  }
}
