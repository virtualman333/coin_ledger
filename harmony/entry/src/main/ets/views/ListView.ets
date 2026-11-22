import { Api } from '../utils/api';
import { Catalog } from '../utils/catalog';
import { money } from '../utils/format';
import { Nav, RouteParam, Routes } from '../utils/router';
import { Store } from '../utils/store';
import { Theme } from '../utils/theme';
import { Coin, PmItemRaw, PmListResponse, PmSeriesItem, PmSeriesResponse, SeriesItem } from '../model/types';
import { EmptyTip } from '../components/Common';

class Chip {
  code: string = '';
  name: string = '';
  count: number = 0;

  constructor(code: string, name: string, count: number) {
    this.code = code;
    this.name = name;
    this.count = count;
  }
}

class ListRow {
  id: number = 0;
  name: string = '';
  year: number = 0;
  imgUrl: string = '';
  owned: boolean = false;
  metaText: string = '';
  mintageLabel: string = '';
  setLabel: string = '';
  priceText: string = '';
}

class SeriesCardView {
  code: string = '';
  name: string = '';
  cat: string = '';
  count: number = 0;
  own: number = 0;
  pct: number = 0;
  imgUrl: string = '';
  thumb: string = '';
  yearText: string = '';
  matText: string = '';
  unit: string = '枚';
}

class PmSeriesTab {
  code: string = '';
  name: string = '';
  count: number = 0;
  yearFrom: string = '';
  yearTo: string = '';
  materials: string[] = [];
  thumb: string = '';
}

class PmCard {
  code: string = '';
  thumb: string = '';
  name: string = '';
  year: number = 0;
  projectName: string = '';
  metaText: string = '';
  faceText: string = '';
  fineness: string = '';
  metalClass: string = '';
  metalChar: string = '';
}

class FilterSnap {
  yearIdx: number = 0;
  faceIdx: number = 0;
  matIdx: number = 0;
  yearFilter: string = '';
  faceFilter: string = '';
  matFilter: string = '';
  onlyOwn: boolean = false;
}

@Component
export struct ListView {
  // NavPathStack 是框架原生对象：@Prop 会尝试深拷贝，运行时会 Cpp Crash
  stack: NavPathStack = new NavPathStack();
  onSwitchTab: (index: number) => void = (index: number): void => {
  };

  @StorageProp('cl_dataRev') @Watch('onStoreChange') dataRev: number = 0;
  @State keyword: string = '';
  @State code: string = '';
  @State desc: boolean = true;
  @State onlyOwn: boolean = false;
  @State category: string = 'coin';
  @State viewMode: string = 'list';
  @State tabs: Chip[] = [];
  @State rows: ListRow[] = [];
  @State rowLimit: number = 40;
  @State count: number = 0;
  @State ownedCount: number = 0;
  @State filterOpen: boolean = false;
  @State extraCount: number = 0;
  @State yearIdx: number = 0;
  @State faceIdx: number = 0;
  @State matIdx: number = 0;
  @State yearFilter: string = '';
  @State faceFilter: string = '';
  @State matFilter: string = '';
  @State yearOpts: string[] = ['全部年份'];
  @State faceOpts: string[] = ['全部面额'];
  @State matOpts: string[] = ['全部材质'];
  @State seriesCoin: SeriesCardView[] = [];
  @State seriesNote: SeriesCardView[] = [];
  @State seriesPm: SeriesCardView[] = [];
  @State pmCards: PmCard[] = [];
  @State pmPage: number = 0;
  @State pmPages: number = 0;
  @State pmTotal: number = 0;
  @State pmLoading: boolean = false;
  @State pmLoaded: boolean = false;
  @State pmError: string = '';
  @State pmOwnedCount: number = 0;

  private pmTabs: PmSeriesTab[] = [];
  private pmSeq: number = 0;
  private searchTimer: number = -1;
  private snapshots: Record<string, FilterSnap> = {};
  private pmYearOpts: string[] = [];
  private pmFaceOpts: string[] = [];
  private pmMatOpts: string[] = [];

  aboutToAppear(): void {
    this.applyFilterOpts('coin');
    this.tabs = this.tabsForCategory('coin');
    this.loadPmSeries();
    this.renderRows();
  }

  onStoreChange(): void {
    if (this.category === 'pm') {
      this.pmOwnedCount = Store.getState().holdings.filter((h): boolean => h.category === 'pm').length;
      return;
    }
    this.renderRows();
    if (this.viewMode === 'series') this.buildSeriesView();
  }

  private coinsOf(category: string): Coin[] {
    return Catalog.coinsOf(category);
  }

  private tabsForCategory(category: string): Chip[] {
    const items = this.coinsOf(category);
    const counts: Record<string, number> = {};
    for (let i = 0; i < items.length; i++) {
      const keys = items[i].seriesKeys.length > 0 ? items[i].seriesKeys : [items[i].series];
      for (let k = 0; k < keys.length; k++) {
        if (!keys[k]) continue;
        counts[keys[k]] = (counts[keys[k]] || 0) + 1;
      }
    }
    const out: Chip[] = [new Chip('', '全部', items.length)];
    const list = Catalog.seriesList.slice()
      .sort((a: SeriesItem, b: SeriesItem): number => (a.sort || 0) - (b.sort || 0));
    for (let i = 0; i < list.length; i++) {
      const s = list[i];
      const n = counts[s.code] || 0;
      if (n > 0) out.push(new Chip(s.code, s.name, n));
    }
    return out;
  }

  private buildFilterOpts(category: string): void {
    const items = this.coinsOf(category);
    const years: number[] = [];
    const faces: number[] = [];
    const matCount: Record<string, number> = {};
    for (let i = 0; i < items.length; i++) {
      const c = items[i];
      if (years.indexOf(c.year) < 0) years.push(c.year);
      const f = Number(c.face);
      if (f > 0 && faces.indexOf(f) < 0) faces.push(f);
      if (c.material) matCount[c.material] = (matCount[c.material] || 0) + 1;
    }
    years.sort((a: number, b: number): number => b - a);
    faces.sort((a: number, b: number): number => a - b);
    const mats = Object.keys(matCount).sort((a: string, b: string): number => matCount[b] - matCount[a]);
    this.yearOpts = ['全部年份'].concat(years.map((y: number): string => String(y)));
    this.faceOpts = ['全部面额'].concat(faces.map((f: number): string => f + ' 元'));
    this.matOpts = ['全部材质'].concat(mats);
  }

  private applyFilterOpts(category: string): void {
    if (category === 'pm') {
      this.yearOpts = this.pmYearOpts.length > 0 ? this.pmYearOpts : ['全部年份'];
      this.faceOpts = this.pmFaceOpts.length > 0 ? this.pmFaceOpts : ['全部面额'];
      this.matOpts = this.pmMatOpts.length > 0 ? this.pmMatOpts : ['全部材质'];
      return;
    }
    this.buildFilterOpts(category);
  }

  private saveSnap(category: string): void {
    const s = new FilterSnap();
    s.yearIdx = this.yearIdx;
    s.faceIdx = this.faceIdx;
    s.matIdx = this.matIdx;
    s.yearFilter = this.yearFilter;
    s.faceFilter = this.faceFilter;
    s.matFilter = this.matFilter;
    s.onlyOwn = this.onlyOwn;
    this.snapshots[category] = s;
  }

  private restoreSnap(category: string): void {
    const s: FilterSnap | undefined = this.snapshots[category];
    if (s === undefined) {
      this.yearIdx = 0;
      this.faceIdx = 0;
      this.matIdx = 0;
      this.yearFilter = '';
      this.faceFilter = '';
      this.matFilter = '';
      this.onlyOwn = false;
      return;
    }
    this.yearIdx = s.yearIdx;
    this.faceIdx = s.faceIdx;
    this.matIdx = s.matIdx;
    this.yearFilter = s.yearFilter;
    this.faceFilter = s.faceFilter;
    this.matFilter = s.matFilter;
    this.onlyOwn = s.onlyOwn;
  }

  private syncExtra(): void {
    let n = 0;
    if (this.yearFilter !== '') n += 1;
    if (this.faceFilter !== '') n += 1;
    if (this.matFilter !== '') n += 1;
    if (this.onlyOwn) n += 1;
    this.extraCount = n;
  }

  private applyCategory(category: string, code: string): void {
    const prev = this.category;
    if (prev !== category) this.saveSnap(prev);
    this.category = category;
    if (category === 'pm') {
      this.keyword = '';
      this.yearFilter = '';
      this.faceFilter = '';
      this.matFilter = '';
      this.onlyOwn = false;
      this.yearIdx = 0;
      this.faceIdx = 0;
      this.matIdx = 0;
      this.extraCount = 0;
      this.filterOpen = false;
      this.code = code;
      if (this.pmTabs.length > 0) {
        this.tabs = this.pmTabs.map((t: PmSeriesTab): Chip => new Chip(t.code, t.name, t.count));
      } else {
        this.tabs = [new Chip('', '全部项目', 0)];
      }
      this.applyFilterOpts('pm');
      this.loadPmFull(1, false);
      return;
    }
    this.applyFilterOpts(category);
    this.restoreSnap(category);
    this.syncExtra();
    this.code = code;
    this.tabs = this.tabsForCategory(category);
    this.renderRows();
  }

  private renderRows(): void {
    if (this.category === 'pm') return;
    const kw = this.keyword.trim().toLowerCase();
    const owned = Store.ownedNames();
    const onlyOwn = this.onlyOwn;
    let list = this.coinsOf(this.category).filter((c: Coin): boolean => {
      const keys = c.seriesKeys.length > 0 ? c.seriesKeys : [c.series];
      if (this.code !== '' && keys.indexOf(this.code) < 0) return false;
      if (this.yearFilter !== '' && String(c.year) !== this.yearFilter) return false;
      if (this.faceFilter !== '' && Number(c.face) !== Number(this.faceFilter)) return false;
      if (this.matFilter !== '' && c.material !== this.matFilter) return false;
      if (onlyOwn && !owned[c.name]) return false;
      if (kw === '') return true;
      return c.name.toLowerCase().indexOf(kw) >= 0
        || String(c.year).indexOf(kw) >= 0
        || c.short.toLowerCase().indexOf(kw) >= 0;
    });
    list = list.sort((a: Coin, b: Coin): number => {
      const diff = (a.year - b.year) || (a.id - b.id);
      return this.desc ? -diff : diff;
    });
    const rows: ListRow[] = [];
    let ownedN = 0;
    for (let i = 0; i < list.length; i++) {
      const c = list[i];
      const r = new ListRow();
      r.id = c.id;
      r.name = c.name;
      r.year = c.year;
      r.imgUrl = c.smallUrl || c.thumbUrl || c.imgUrl;
      r.owned = !!owned[c.name];
      r.metaText = c.seriesName + ' · ' + c.faceText;
      r.mintageLabel = c.mintageText && c.mintageText !== '—'
        ? ('发行 ' + c.mintageText + (c.kind === 'note' ? '张' : '枚')) : '';
      r.setLabel = '一套 ' + c.setSizeCalc + (c.kind === 'note' ? ' 张' : ' 枚');
      r.priceText = '¥' + money(Catalog.aiPriceOf(c) * c.setSizeCalc);
      if (r.owned) ownedN += 1;
      rows.push(r);
    }
    this.rows = rows;
    this.count = rows.length;
    this.ownedCount = ownedN;
  }

  private buildSeriesView(): void {
    const owned = Store.ownedNames();
    const coin: SeriesCardView[] = [];
    const note: SeriesCardView[] = [];
    for (let i = 0; i < Catalog.seriesList.length; i++) {
      const s = Catalog.seriesList[i];
      const members = Catalog.inSeries(s.code);
      let own = 0;
      let noteN = 0;
      for (let j = 0; j < members.length; j++) {
        if (owned[members[j].name]) own += 1;
        if (members[j].kind === 'note') noteN += 1;
      }
      const card = new SeriesCardView();
      card.code = s.code;
      card.name = s.name;
      card.count = members.length;
      card.own = own;
      card.pct = members.length > 0 ? Math.round((own / members.length) * 100) : 0;
      card.imgUrl = s.img ? Api.imgUrl('/' + s.img) : '';
      card.cat = noteN > members.length / 2 ? 'note' : 'coin';
      card.unit = card.cat === 'note' ? '张' : '枚';
      if (card.cat === 'note') note.push(card);
      else coin.push(card);
    }
    const pm: SeriesCardView[] = [];
    for (let i = 1; i < this.pmTabs.length; i++) {
      const t = this.pmTabs[i];
      const card = new SeriesCardView();
      card.code = t.code;
      card.name = t.name;
      card.cat = 'pm';
      card.count = t.count;
      card.unit = '枚';
      const yf = String(t.yearFrom || '');
      const yt = String(t.yearTo || '');
      card.yearText = yf !== '' && yt !== '' ? (yf === yt ? yf + ' 年' : yf + '—' + yt) : '';
      card.matText = t.materials.filter((m: string): boolean => !!m).slice(0, 4).join(' · ');
      card.thumb = t.thumb ? Api.imgUrl(t.thumb) : '';
      pm.push(card);
    }
    this.seriesCoin = coin;
    this.seriesNote = note;
    this.seriesPm = pm;
  }

  private loadPmSeries(): void {
    Api.get<PmSeriesResponse>('/api/series?category=pm').then((res: PmSeriesResponse): void => {
      if (!res || !res.ok) return;
      const list: PmSeriesTab[] = [];
      const items = res.items || [];
      for (let i = 0; i < items.length; i++) {
        const it: PmSeriesItem = items[i];
        const t = new PmSeriesTab();
        t.code = it.code;
        t.name = it.name;
        t.count = it.count;
        t.yearFrom = it.yearFrom || '';
        t.yearTo = it.yearTo || '';
        t.materials = Array.isArray(it.materials) ? it.materials : [];
        t.thumb = it.thumb || '';
        list.push(t);
      }
      this.pmTabs = list;
      if (this.category === 'pm') {
        this.tabs = list.map((t: PmSeriesTab): Chip => new Chip(t.code, t.name, t.count));
      }
      if (this.viewMode === 'series') this.buildSeriesView();
    }).catch((): void => {
    });
  }

  private loadPmFull(page: number, append: boolean): void {
    if (append && this.pmLoading) return;
    this.pmSeq += 1;
    const seq = this.pmSeq;
    this.pmLoading = true;
    const kw = this.keyword.trim();
    let path = '/api/catalog/pm?page=' + page + '&pageSize=30&sort=' + (this.desc ? 'year_desc' : 'year_asc');
    if (kw !== '') path += '&q=' + encodeURIComponent(kw);
    if (this.code !== '') path += '&project=' + encodeURIComponent(this.code);
    if (this.yearFilter !== '') path += '&year=' + encodeURIComponent(this.yearFilter);
    if (this.faceFilter !== '') path += '&face=' + encodeURIComponent(this.faceFilter);
    if (this.matFilter !== '') path += '&material=' + encodeURIComponent(this.matFilter);
    if (!append) path += '&facets=1';

    Api.get<PmListResponse>(path).then((j: PmListResponse): void => {
      if (seq !== this.pmSeq) return;
      const items = Array.isArray(j.items) ? j.items : [];
      const rows: PmCard[] = [];
      for (let i = 0; i < items.length; i++) {
        const it: PmItemRaw = items[i];
        const r = new PmCard();
        r.code = it.code;
        const thumbPath = it.thumbBack ? it.thumbBack : (it.thumb ? it.thumb : '');
        r.thumb = thumbPath !== '' ? Api.imgUrl(thumbPath) : '';
        r.name = it.name;
        r.year = it.year;
        r.projectName = it.projectName;
        r.metaText = [it.material, it.weightG ? it.weightG + '克' : '', it.quality]
          .filter((x: string): boolean => !!x).join(' · ');
        r.faceText = it.face ? it.face + ' 元' : '—';
        r.fineness = it.fineness;
        r.metalClass = /金/.test(it.material || '') ? 'gold'
          : (/银/.test(it.material || '') ? 'silver' : (/铂/.test(it.material || '') ? 'platinum' : 'other'));
        r.metalChar = /金/.test(it.material || '') ? '金'
          : (/银/.test(it.material || '') ? '银' : (/铂/.test(it.material || '') ? '铂' : '币'));
        rows.push(r);
      }
      if (!append && j.facets) {
        const years = (j.facets.years || []).map((y: number): string => String(y));
        const faces = (j.facets.faces || []).map((f: number): string => String(Number(f)));
        const mats = (j.facets.materials || []).map((m: string): string => String(m));
        this.pmYearOpts = ['全部年份'].concat(years);
        this.pmFaceOpts = ['全部面额'].concat(faces.map((f: string): string => f + ' 元'));
        this.pmMatOpts = ['全部材质'].concat(mats);
        if (this.category === 'pm') this.applyFilterOpts('pm');
      }
      this.pmCards = append ? this.pmCards.concat(rows) : rows;
      this.pmPage = Number(j.page) || page;
      this.pmPages = Number(j.pages) || 0;
      this.pmTotal = Number(j.total) || 0;
      this.pmLoading = false;
      this.pmLoaded = true;
      this.pmError = '';
      this.pmOwnedCount = Store.getState().holdings.filter((h): boolean => h.category === 'pm').length;
    }).catch((): void => {
      if (seq !== this.pmSeq) return;
      this.pmLoading = false;
      this.pmLoaded = true;
      this.pmCards = [];
      this.pmError = '贵金属目录加载失败';
    });
  }

  private onSearch(value: string): void {
    this.keyword = value;
    if (this.category === 'pm') {
      if (this.searchTimer >= 0) clearTimeout(this.searchTimer);
      this.searchTimer = setTimeout((): void => {
        this.pmCards = [];
        this.pmPage = 0;
        this.pmPages = 0;
        this.pmLoaded = false;
        this.loadPmFull(1, false);
      }, 320);
      return;
    }
    this.renderRows();
  }

  private pickYear(index: number): void {
    this.yearIdx = index;
    this.yearFilter = index > 0 ? this.yearOpts[index] : '';
    this.syncExtra();
    this.afterFilter();
  }

  private pickFace(index: number): void {
    this.faceIdx = index;
    const label = index > 0 ? this.faceOpts[index] : '';
    this.faceFilter = label !== '' ? label.replace(' 元', '') : '';
    this.syncExtra();
    this.afterFilter();
  }

  private pickMat(index: number): void {
    this.matIdx = index;
    this.matFilter = index > 0 ? this.matOpts[index] : '';
    this.syncExtra();
    this.afterFilter();
  }

  private afterFilter(): void {
    if (this.category === 'pm') {
      this.pmCards = [];
      this.pmPage = 0;
      this.pmPages = 0;
      this.pmLoaded = false;
      this.pmError = '';
      this.loadPmFull(1, false);
      return;
    }
    this.renderRows();
  }

  private clearExtra(): void {
    this.yearIdx = 0;
    this.faceIdx = 0;
    this.matIdx = 0;
    this.yearFilter = '';
    this.faceFilter = '';
    this.matFilter = '';
    this.onlyOwn = false;
    this.extraCount = 0;
    this.afterFilter();
  }

  private toggleViewMode(mode: string): void {
    if (mode === this.viewMode) return;
    this.viewMode = mode;
    if (mode === 'series') {
      this.buildSeriesView();
      return;
    }
    this.applyFilterOpts(this.category);
    if (this.category === 'pm') {
      this.tabs = this.pmTabs.length > 0
        ? this.pmTabs.map((t: PmSeriesTab): Chip => new Chip(t.code, t.name, t.count))
        : [new Chip('', '全部项目', 0)];
      if (!this.pmLoaded) this.loadPmFull(1, false);
      return;
    }
    this.tabs = this.tabsForCategory(this.category);
    this.renderRows();
  }

  private goSeriesDetail(code: string, cat: string, name: string): void {
    const p = new RouteParam();
    p.code = code;
    p.cat = cat;
    p.name = name;
    Nav.push(this.stack, Routes.SERIES_DETAIL, p);
  }

  /** 滚动到内容底部时自动续一页（按钮保留，作为触底失败的兜底） */
  private onReachBottom(): void {
    if (this.viewMode !== 'list') return;
    if (this.category === 'pm') {
      if (!this.pmLoading && this.pmLoaded && this.pmPage < this.pmPages) {
        this.loadPmFull(this.pmPage + 1, true);
      }
      return;
    }
    if (this.rows.length > this.rowLimit) {
      this.rowLimit += 40;
    }
  }

  private toOptions(list: string[]): SelectOption[] {
    const out: SelectOption[] = [];
    for (let i = 0; i < list.length; i++) {
      const item: SelectOption = { value: list[i] };
      out.push(item);
    }
    return out;
  }

  @Builder
  viewSwitch() {
    Row({ space: 8 }) {
      Text('顺序清单')
        .fontSize(13)
        .fontColor(this.viewMode === 'list' ? Theme.goldDeep : Theme.muted)
        .fontWeight(this.viewMode === 'list' ? FontWeight.Medium : FontWeight.Normal)
        .textAlign(TextAlign.Center)
        .layoutWeight(1)
        .height(36)
        .borderRadius(Theme.radiusS)
        .backgroundColor(this.viewMode === 'list' ? Theme.goldBg : Theme.card)
        .border({ width: 1, color: this.viewMode === 'list' ? Theme.goldLine : Color.Transparent })
        .onClick((): void => {
          this.toggleViewMode('list');
        })
      Text('按系列')
        .fontSize(13)
        .fontColor(this.viewMode === 'series' ? Theme.goldDeep : Theme.muted)
        .fontWeight(this.viewMode === 'series' ? FontWeight.Medium : FontWeight.Normal)
        .textAlign(TextAlign.Center)
        .layoutWeight(1)
        .height(36)
        .borderRadius(Theme.radiusS)
        .backgroundColor(this.viewMode === 'series' ? Theme.goldBg : Theme.card)
        .border({ width: 1, color: this.viewMode === 'series' ? Theme.goldLine : Color.Transparent })
        .onClick((): void => {
          this.toggleViewMode('series');
        })
    }
    .width('100%')
    .padding(4)
    .borderRadius(Theme.radiusM)
    .backgroundColor(Theme.bgDeep)
  }

  @Builder
  categoryTabs() {
    Row({ space: 6 }) {
      this.catChip('普通纪念币', 'coin')
      this.catChip('纪念钞', 'note')
      this.catChip('贵金属', 'pm')
    }
    .width('100%')
    .margin({ top: 10 })
  }

  @Builder
  catChip(label: string, key: string) {
    Text(label)
      .fontSize(13)
      .fontColor(this.category === key ? Theme.goldDeep : Theme.muted)
      .padding({ left: 14, right: 14, top: 8, bottom: 8 })
      .borderRadius(Theme.radiusS)
      .backgroundColor(this.category === key ? Theme.goldBg : Theme.card)
      .border({ width: 1, color: this.category === key ? Theme.goldLine : Color.Transparent })
      .onClick((): void => {
        if (this.viewMode === 'series') {
          this.category = key;
          this.buildSeriesView();
          return;
        }
        this.applyCategory(key, '');
      })
  }

  @Builder
  listRow(row: ListRow) {
    Row({ space: 10 }) {
      if (row.imgUrl.length > 0) {
        Image(row.imgUrl)
          .width(64)
          .height(64)
          .borderRadius(Theme.radiusThumb)
          .objectFit(ImageFit.Contain)
          .backgroundColor('#F4F1E9')
      } else {
        Text('无图')
          .width(64)
          .height(64)
          .borderRadius(Theme.radiusThumb)
          .textAlign(TextAlign.Center)
          .fontSize(9)
          .fontColor(Theme.faint)
          .backgroundColor('#F4F1E9')
      }
      Column({ space: 4 }) {
        Text(row.name)
          .fontSize(14)
          .fontWeight(FontWeight.Medium)
          .fontColor(Theme.textStrong)
          .maxLines(1)
          .textOverflow({ overflow: TextOverflow.Ellipsis })
          .width('100%')

        Text(row.metaText)
          .fontSize(12)
          .fontColor(Theme.muted)
          .maxLines(1)
          .textOverflow({ overflow: TextOverflow.Ellipsis })
        Row({ space: 4 }) {
          if (row.mintageLabel.length > 0) {
            Text(row.mintageLabel)
              .fontSize(11)
              .fontColor(Theme.faint)
            Text('·')
              .fontSize(11)
              .fontColor(Theme.faint)
          }
          Text(row.setLabel)
            .fontSize(11)
            .fontColor(Theme.faint)
        }
      }
      .layoutWeight(1)
      .alignItems(HorizontalAlign.Start)

      Column({ space: 4 }) {
        Text(String(row.year))
          .fontSize(12)
          .fontColor(Theme.muted)
        Text(row.priceText)
          .fontSize(12)
          .fontWeight(FontWeight.Medium)
          .fontColor(Theme.gold)
      }
      .alignItems(HorizontalAlign.End)
    }
    .width('100%')
    .padding({ top: 12, bottom: 12 })
    .alignItems(VerticalAlign.Center)
    .onClick((): void => {
      Nav.push(this.stack, Routes.DETAIL, RouteParam.of(row.id));
    })
  }

  @Builder
  seriesCard(card: SeriesCardView) {
    Row({ space: 10 }) {
      if (card.imgUrl.length > 0 || card.thumb.length > 0) {
        Image(card.imgUrl.length > 0 ? card.imgUrl : card.thumb)
          .width(64)
          .height(64)
          .borderRadius(8)
          .objectFit(ImageFit.Contain)
          .backgroundColor('#F4F1E9')
      } else {
        Text(card.name.slice(0, 4))
          .width(64)
          .height(64)
          .borderRadius(8)
          .textAlign(TextAlign.Center)
          .fontSize(10)
          .fontColor(Theme.goldDeep)
          .backgroundColor(Theme.goldBg)
      }
      Column({ space: 5 }) {
        Row() {
          Text(card.name)
            .fontSize(15)
            .fontWeight(FontWeight.Medium)
            .fontColor(Theme.textStrong)
            .maxLines(1)
            .textOverflow({ overflow: TextOverflow.Ellipsis })
            .layoutWeight(1)
          Text(card.count + ' ' + card.unit)
            .fontSize(11)
            .fontColor(Theme.faint)
        }
        .width('100%')

        if (card.yearText.length > 0 || card.matText.length > 0) {
          Text([card.yearText, card.matText].filter((x: string): boolean => x !== '').join(' · '))
            .fontSize(11)
            .fontColor(Theme.faint)
            .maxLines(1)
            .textOverflow({ overflow: TextOverflow.Ellipsis })
        }
        Row() {
          Text(card.cat === 'pm' ? '查看目录'
            : (card.own > 0 ? ('已藏 ' + card.own + ' / ' + card.count) : '还没收藏'))
            .fontSize(12)
            .fontColor(card.own > 0 ? Theme.gold : Theme.faint)
          Blank()
          Text('›')
            .fontSize(15)
            .fontColor(Theme.faint)
        }
        .width('100%')

        if (card.cat !== 'pm') {
          Stack({ alignContent: Alignment.Start }) {
            Row()
              .width('100%')
              .height(3)
              .borderRadius(2)
              .backgroundColor('#EFE8DA')
            Row()
              .width(card.pct + '%')
              .height(3)
              .borderRadius(2)
              .linearGradient({ angle: 135, colors: [['#C79A4B', 0], ['#9A6B1F', 1]] })
          }
          .width('100%')
        }
      }
      .layoutWeight(1)
      .alignItems(HorizontalAlign.Start)
    }
    .width('100%')
    .padding(14)
    .margin({ bottom: 10 })
    .borderRadius(Theme.radiusM)
    .backgroundColor(Theme.glass)
    .border({ width: 1, color: Theme.glassBorder })
    .shadow({ radius: 18, color: 'rgba(120,90,40,0.07)', offsetY: 6 })
    .onClick((): void => {
      this.goSeriesDetail(card.code, card.cat, card.name);
    })
  }

  @Builder
  pmCard(row: PmCard) {
    Column({ space: 0 }) {
      if (row.thumb.length > 0) {
        Image(row.thumb)
          .width('100%')
          .height(92)
          .borderRadius(Theme.radiusThumb)
          .objectFit(ImageFit.Contain)
          .backgroundColor('#FBF9F4')
      } else {
        Text(row.metalChar)
          .width('100%')
          .height(92)
          .borderRadius(Theme.radiusThumb)
          .textAlign(TextAlign.Center)
          .fontSize(20)
          .fontColor(row.metalClass === 'gold' ? '#B08A3E'
            : (row.metalClass === 'silver' ? '#8A9099' : '#9A8F7A'))
          .backgroundColor('#FBF9F4')
      }

      Text(row.name)
        .fontSize(13)
        .fontWeight(FontWeight.Medium)
        .fontColor(Theme.textStrong)
        .maxLines(1)
        .textOverflow({ overflow: TextOverflow.Ellipsis })
        .width('100%')
        .margin({ top: 8 })

      Text(row.metaText)
        .fontSize(11)
        .fontColor(Theme.muted)
        .maxLines(1)
        .textOverflow({ overflow: TextOverflow.Ellipsis })
        .width('100%')
        .margin({ top: 3 })

      Row() {
        Text(row.faceText)
          .fontSize(11)
          .fontColor(Theme.faint)
        Blank()
        Text((row.fineness || '—') + '%')
          .fontSize(11)
          .fontColor(Theme.faint)
      }
      .width('100%')
      .margin({ top: 3 })
    }
    .width('48%')
    .alignItems(HorizontalAlign.Start)
    .padding(10)
    .margin({ bottom: 10 })
    .borderRadius(Theme.radiusM)
    .backgroundColor(Theme.card)
    .border({ width: 1, color: Theme.lineSoft })
    .onClick((): void => {
      const p = new RouteParam();
      p.code = row.code;
      Nav.push(this.stack, Routes.PM_DETAIL, p);
    })
  }

  build() {
    Scroll() {
      Column() {
        Column()
          .width('100%')
          .height(10)

        Column() {
          this.viewSwitch()
          this.categoryTabs()

          if (this.viewMode === 'list') {
            Row({ space: 8 }) {
              Row({ space: 6 }) {
                Text('⌕')
                  .fontSize(13)
                  .fontColor(Theme.faint)
                TextInput({ text: $$this.keyword, placeholder: '搜品种 / 年份' })
                  .layoutWeight(1)
                  .height(40)
                  .fontSize(13)
                  .backgroundColor(Color.Transparent)
                  .placeholderColor(Theme.faint)
                  .onChange((value: string): void => {
                    this.onSearch(value);
                  })
                if (this.keyword.length > 0) {
                  Text('✕')
                    .fontSize(11)
                    .fontColor(Theme.faint)
                    .onClick((): void => {
                      this.keyword = '';
                      this.onSearch('');
                    })
                }
              }
              .layoutWeight(1)
              .height(44)
              .padding({ left: 12, right: 12 })
              .borderRadius(Theme.radiusM)
              .backgroundColor(Theme.card)
              .border({ width: 1, color: Theme.lineSoft })

              Text(this.extraCount > 0 ? '筛选 ' + this.extraCount : '筛选')
                .fontSize(12)
                .fontColor(this.filterOpen || this.extraCount > 0 ? Theme.goldDeep : Theme.muted)
                .padding({ left: 14, right: 14, top: 12, bottom: 12 })
                .borderRadius(Theme.radiusS)
                .backgroundColor(this.filterOpen || this.extraCount > 0 ? Theme.goldBg : Theme.card)
                .onClick((): void => {
                  this.filterOpen = !this.filterOpen;
                })
            }
            .width('100%')
            .margin({ top: 8 })

            if (this.filterOpen) {
              Column({ space: 8 }) {
                Row({ space: 8 }) {
                  Select(this.toOptions(this.yearOpts))
                    .selected(this.yearIdx)
                    .value(this.yearFilter !== '' ? this.yearFilter : '年份')
                    .font({ size: 11 })
                    .layoutWeight(1)
                    .onSelect((index: number): void => {
                      this.pickYear(index);
                    })
                  Select(this.toOptions(this.faceOpts))
                    .selected(this.faceIdx)
                    .value(this.faceFilter !== '' ? this.faceFilter + ' 元' : '面额')
                    .font({ size: 11 })
                    .layoutWeight(1)
                    .onSelect((index: number): void => {
                      this.pickFace(index);
                    })
                  Select(this.toOptions(this.matOpts))
                    .selected(this.matIdx)
                    .value(this.matFilter !== '' ? this.matFilter : '材质')
                    .font({ size: 11 })
                    .layoutWeight(1)
                    .onSelect((index: number): void => {
                      this.pickMat(index);
                    })
                }
                .width('100%')

                Row({ space: 8 }) {
                  if (this.category !== 'pm') {
                    Text(this.onlyOwn ? '只看已收 ✓' : '只看已收')
                      .fontSize(10)
                      .fontColor(this.onlyOwn ? Color.White : Theme.muted)
                      .padding({ left: 10, right: 10, top: 5, bottom: 5 })
                      .borderRadius(12)
                      .backgroundColor(this.onlyOwn ? Theme.gold : Theme.card)
                      .onClick((): void => {
                        this.onlyOwn = !this.onlyOwn;
                        this.syncExtra();
                        this.renderRows();
                      })
                  }
                  if (this.extraCount > 0) {
                    Text('清除')
                      .fontSize(10)
                      .fontColor(Theme.muted)
                      .padding({ left: 10, right: 10, top: 5, bottom: 5 })
                      .onClick((): void => {
                        this.clearExtra();
                      })
                  }
                  Blank()
                }
                .width('100%')
              }
              .width('100%')
              .padding(10)
              .borderRadius(10)
              .backgroundColor('#FBF8F1')
              .margin({ top: 8 })
            }

            Scroll() {
              Row({ space: 6 }) {
                ForEach(this.tabs, (t: Chip) => {
                  Text(t.name)
                    .fontSize(12)
                    .fontColor(this.code === t.code ? Theme.goldDeep : Theme.muted)
                    .padding({ left: 12, right: 12, top: 7, bottom: 7 })
                    .borderRadius(Theme.radiusS)
                    .backgroundColor(this.code === t.code ? Theme.goldBg : Color.Transparent)
                    .border({ width: 1, color: this.code === t.code ? Theme.goldLine : Color.Transparent })
                    .onClick((): void => {
                      this.code = t.code;
                      if (this.category === 'pm') this.loadPmFull(1, false);
                      else this.renderRows();
                    })
                }, (t: Chip) => t.code + '_' + t.name)
              }
              .padding({ top: 8, bottom: 4 })
            }
            .scrollable(ScrollDirection.Horizontal)
            .edgeEffect(EdgeEffect.Spring)
            .scrollBar(BarState.Off)
            .width('100%')

            if (this.category !== 'pm') {
              Row() {
                Text(this.count + ' 个品种 · 已收 ' + this.ownedCount)
                  .fontSize(11)
                  .fontColor(Theme.faint)
                Blank()
                Text('年份 ' + (this.desc ? '↓' : '↑'))
                  .fontSize(11)
                  .fontColor(Theme.gold)
                  .padding({ left: 8, right: 8, top: 3, bottom: 3 })
                  .borderRadius(10)
                  .backgroundColor(Theme.goldBg)
                  .onClick((): void => {
                    this.desc = !this.desc;
                    this.renderRows();
                  })
              }
              .width('100%')
              .margin({ top: 4, bottom: 4 })
            }
          }
        }
        .width('100%')
        .padding({ left: 16, right: 16 })

        Column() {
          if (this.viewMode === 'series') {
            Text(this.category === 'coin' ? '普通纪念币'
              : (this.category === 'note' ? '纪念钞' : '贵金属纪念币'))
              .fontSize(11)
              .fontColor(Theme.muted)
              .width('100%')
              .margin({ top: 8, bottom: 8 })
            if (this.category === 'coin') {
              if (this.seriesCoin.length === 0) {
                EmptyTip({ text: '普通纪念币系列加载中…' })
              }
              ForEach(this.seriesCoin, (card: SeriesCardView) => {
                this.seriesCard(card)
              }, (card: SeriesCardView) => card.code)
            } else if (this.category === 'note') {
              if (this.seriesNote.length === 0) {
                EmptyTip({ text: '纪念钞系列加载中…' })
              }
              ForEach(this.seriesNote, (card: SeriesCardView) => {
                this.seriesCard(card)
              }, (card: SeriesCardView) => card.code)
            } else {
              if (this.seriesPm.length === 0) {
                EmptyTip({ text: '贵金属项目加载中…' })
              }
              ForEach(this.seriesPm, (card: SeriesCardView) => {
                this.seriesCard(card)
              }, (card: SeriesCardView) => card.code)
            }
          } else if (this.category === 'pm') {
            Row() {
              Text('贵金属纪念币 · 共 ' + (this.pmTotal > 0 ? this.pmTotal : '…') + ' 条 · 已收 ' + this.pmOwnedCount)
                .fontSize(10)
                .fontColor(Theme.faint)
              Blank()
              Text('年份 ' + (this.desc ? '↓' : '↑'))
                .fontSize(10)
                .fontColor(Theme.gold)
                .onClick((): void => {
                  this.desc = !this.desc;
                  this.pmCards = [];
                  this.pmPage = 0;
                  this.pmLoaded = false;
                  this.loadPmFull(1, false);
                })
            }
            .width('100%')
            .margin({ top: 8, bottom: 8 })

            Flex({ wrap: FlexWrap.Wrap, justifyContent: FlexAlign.SpaceBetween }) {
              ForEach(this.pmCards, (row: PmCard) => {
                this.pmCard(row)
              }, (row: PmCard) => row.code)
            }

            if (this.pmLoading) {
              Text('加载中…')
                .fontSize(11)
                .fontColor(Theme.faint)
                .width('100%')
                .textAlign(TextAlign.Center)
                .padding(12)
            } else if (this.pmError !== '') {
              Text(this.pmError + ' · 点此重试')
                .fontSize(11)
                .fontColor(Theme.up)
                .width('100%')
                .textAlign(TextAlign.Center)
                .padding(12)
                .onClick((): void => {
                  this.pmError = '';
                  this.pmLoaded = false;
                  this.loadPmFull(1, false);
                })
            } else if (this.pmLoaded && this.pmCards.length === 0) {
              EmptyTip({ text: '没有匹配的贵金属品种，换个关键词或放宽筛选条件' })
            } else if (this.pmLoaded && this.pmPage < this.pmPages) {
              Text('加载更多（' + this.pmPage + '/' + this.pmPages + '）')
                .fontSize(11)
                .fontColor(Theme.gold)
                .width('100%')
                .textAlign(TextAlign.Center)
                .padding(12)
                .onClick((): void => {
                  this.loadPmFull(this.pmPage + 1, true);
                })
            } else if (this.pmLoaded && this.pmCards.length > 0) {
              Text('已显示全部 ' + this.pmTotal + ' 条')
                .fontSize(10)
                .fontColor(Theme.faint)
                .width('100%')
                .textAlign(TextAlign.Center)
                .padding(12)
            }
          } else {
            Column() {
              ForEach(this.rows.slice(0, this.rowLimit), (row: ListRow) => {
                Column() {
                  this.listRow(row)
                  Divider().color(Theme.lineSoft)
                }
              }, (row: ListRow) => String(row.id))
            }
            .width('100%')
            .padding({ left: 14, right: 14 })
            .borderRadius(Theme.radiusM)
            .backgroundColor(Theme.glass)
            .border({ width: 1, color: Theme.glassBorder })
            .shadow({ radius: 14, color: 'rgba(0,0,0,0.05)', offsetY: 8 })

            if (this.count === 0) {
              EmptyTip({
                text: this.onlyOwn ? '还没有收藏到符合条件的东西，先取消「只看已收」试试' : '没有匹配的品种，换个关键词试试'
              })
            } else if (this.rows.length > this.rowLimit) {
              Text('加载更多（' + this.rowLimit + '/' + this.rows.length + '）')
                .fontSize(13)
                .fontColor(Theme.gold)
                .width('100%')
                .textAlign(TextAlign.Center)
                .padding(14)
                .onClick((): void => {
                  this.rowLimit += 40;
                })
            } else {
              Text('已显示全部 ' + this.count + ' 项')
                .fontSize(11)
                .fontColor(Theme.faint)
                .width('100%')
                .textAlign(TextAlign.Center)
                .padding(14)
            }
          }
        }
        .width('100%')
        .padding({ left: 16, right: 16, bottom: 88 })
        .margin({ top: 4 })
      }
      .width('100%')
      .constraintSize({ minHeight: '100%' })
      .justifyContent(FlexAlign.Start)
    }
    .edgeEffect(EdgeEffect.Spring)
    .scrollBar(BarState.Off)
    .edgeEffect(EdgeEffect.Spring)
    .onScrollEdge((side: Edge): void => {
      if (side === Edge.Bottom) this.onReachBottom();
    })
    .width('100%')
    .height('100%')
    .backgroundColor(Color.Transparent)
  }
}
