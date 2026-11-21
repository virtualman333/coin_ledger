import { Api } from '../utils/api';
import { Catalog } from '../utils/catalog';
import { money } from '../utils/format';
import { Nav, RouteParam, Routes } from '../utils/router';
import { Store } from '../utils/store';
import { Theme } from '../utils/theme';
import { Coin, SeriesItem } from '../model/types';

class RowView {
  id: number = 0;
  code: string = '';
  name: string = '';
  year: number = 0;
  imgUrl: string = '';
  meta: string = '';
  owned: boolean = false;
  isPm: boolean = false;
  priceText: string = '';
}

class PmDetailItem {
  code: string = '';
  name: string = '';
  year: number = 0;
  material: string = '';
  weightG: number = 0;
  face: number = 0;
  fineness: string = '';
  quality: string = '';
  thumb: string = '';
  thumbBack: string = '';
}

class PmDetailResponse {
  ok: boolean = false;
  category: string = '';
  series: PmSeriesMeta | null = null;
  total: number = 0;
  page: number = 1;
  size: number = 30;
  pages: number = 0;
  items: PmDetailItem[] = [];
}

class PmSeriesMeta {
  code: string = '';
  name: string = '';
  count: number = 0;
  yearFrom: string = '';
  yearTo: string = '';
  materials: string[] = [];
  thumb: string = '';
}

@Component
export struct SeriesDetailPage {
  // NavPathStack 是框架原生对象：@Prop 会尝试深拷贝，运行时会 Cpp Crash
  stack: NavPathStack = new NavPathStack();
  @StorageProp('cl_dataRev') @Watch('onStoreChange') dataRev: number = 0;

  @State title: string = '';
  @State desc: string = '';
  @State cat: string = 'coin';
  @State code: string = '';
  @State rows: RowView[] = [];
  @State desc2: string = '';
  @State pmLoading: boolean = false;
  @State pmPage: number = 1;
  @State pmPages: number = 1;
  @State pmTotal: number = 0;
  @State pmError: string = '';
  @State sortDesc: boolean = true;

  aboutToAppear(): void {
    const p = Nav.take(this.stack, Routes.SERIES_DETAIL);
    this.cat = p.cat !== '' ? p.cat : 'coin';
    this.code = p.code;
    this.title = p.name;
    this.rebuild();
    if (this.cat === 'pm') this.loadPm(1, false);
  }

  onStoreChange(): void {
    if (this.cat !== 'pm') this.rebuild();
  }

  private rebuild(): void {
    const owned = Store.ownedNames();
    if (this.cat === 'pm') return;
    const members = Catalog.inSeries(this.code).filter((c: Coin): boolean => {
      if (this.cat === 'note') return c.kind === 'note';
      return c.kind !== 'note';
    });
    const sorted = members.slice().sort((a: Coin, b: Coin): number => {
      const d = (a.year - b.year) || (a.id - b.id);
      return this.sortDesc ? -d : d;
    });
    const rows: RowView[] = [];
    for (let i = 0; i < sorted.length; i++) {
      const c = sorted[i];
      const r = new RowView();
      r.id = c.id;
      r.name = c.name;
      r.year = c.year;
      r.imgUrl = c.smallUrl || c.thumbUrl || c.imgUrl;
      r.meta = c.faceText + ' · ' + c.material;
      r.owned = !!owned[c.name];
      r.priceText = '¥' + money(Catalog.aiPriceOf(c) * c.setSizeCalc);
      rows.push(r);
    }
    this.rows = rows;
    const meta = Catalog.seriesList.filter((s: SeriesItem): boolean => s.code === this.code);
    if (meta.length > 0 && this.title === '') this.title = meta[0].name;
    if (meta.length > 0) this.desc = meta[0].desc;
    if (this.title === '') this.title = Catalog.seriesName(this.code) || '系列';
    this.desc2 = members.length + ' 个品种';
  }

  private loadPm(page: number, append: boolean): void {
    if (this.pmLoading) return;
    this.pmLoading = true;
    const path = '/api/series/detail?category=pm&code=' + encodeURIComponent(this.code)
      + '&page=' + page + '&size=30&sort=' + (this.sortDesc ? 'year_desc' : 'year_asc');
    Api.get<PmDetailResponse>(path).then((res: PmDetailResponse): void => {
      this.pmLoading = false;
      if (!res || !res.ok) {
        this.pmError = '加载失败，点此重试';
        return;
      }
      if (res.series !== null) {
        if (res.series !== null && this.title === '') this.title = res.series.name;
        if (res.series !== null) this.desc2 = res.series.count + ' 枚';
      }
      this.pmTotal = res.total || 0;
      this.pmPage = res.page || page;
      this.pmPages = res.pages || 1;
      const rows: RowView[] = [];
      const items = res.items || [];
      for (let i = 0; i < items.length; i++) {
        const it = items[i];
        const r = new RowView();
        r.code = it.code;
        r.name = it.name;
        r.year = it.year;
        r.isPm = true;
        r.imgUrl = it.thumbBack ? Api.imgUrl(it.thumbBack) : (it.thumb ? Api.imgUrl(it.thumb) : '');
        r.meta = [it.material, it.weightG ? it.weightG + ' 克' : '', it.quality,
          it.face ? it.face + ' 元' : ''].filter((x: string): boolean => !!x).join(' · ');
        rows.push(r);
      }
      this.rows = append ? this.rows.concat(rows) : rows;
      this.pmError = '';
    }).catch((): void => {
      this.pmLoading = false;
      this.pmError = '加载失败，点此重试';
    });
  }

  private toggleSort(): void {
    this.sortDesc = !this.sortDesc;
    if (this.cat === 'pm') {
      this.rows = [];
      this.loadPm(1, false);
      return;
    }
    this.rebuild();
  }

  @Builder
  row(item: RowView) {
    Row({ space: 10 }) {
      if (item.imgUrl.length > 0) {
        Image(item.imgUrl)
          .width(60)
          .height(60)
          .borderRadius(7)
          .objectFit(ImageFit.Contain)
          .backgroundColor('#F7F4EC')
      } else {
        Text(item.name.slice(0, 1))
          .width(60)
          .height(60)
          .borderRadius(7)
          .textAlign(TextAlign.Center)
          .fontSize(16)
          .fontColor(Theme.goldDeep)
          .backgroundColor(Theme.goldBg)
      }
      Column({ space: 4 }) {
        Row({ space: 6 }) {
          Text(item.name)
            .fontSize(13)
            .fontColor(Theme.textStrong)
            .maxLines(1)
            .textOverflow({ overflow: TextOverflow.Ellipsis })
            .layoutWeight(1)
          if (item.owned) {
            Text('已收')
              .fontSize(9)
              .fontColor(Theme.goldDeep)
              .padding({ left: 5, right: 5, top: 1, bottom: 1 })
              .backgroundColor(Theme.goldBg)
              .borderRadius(4)
          }
        }
        .width('100%')
        Text(item.meta)
          .fontSize(9)
          .fontColor(Theme.muted)
          .maxLines(1)
          .textOverflow({ overflow: TextOverflow.Ellipsis })
      }
      .layoutWeight(1)
      .alignItems(HorizontalAlign.Start)

      Column({ space: 3 }) {
        Text(String(item.year))
          .fontSize(10)
          .fontColor(Theme.faint)
        if (item.priceText.length > 0) {
          Text(item.priceText)
            .fontSize(10)
            .fontColor(Theme.gold)
        }
      }
      .alignItems(HorizontalAlign.End)
    }
    .width('100%')
    .padding({ top: 10, bottom: 10 })
    .alignItems(VerticalAlign.Center)
    .onClick((): void => {
      if (item.isPm) {
        const p = new RouteParam();
        p.code = item.code;
        Nav.push(this.stack, Routes.PM_DETAIL, p);
      } else if (item.id > 0) {
        Nav.push(this.stack, Routes.DETAIL, RouteParam.of(item.id));
      }
    })
  }

  build() {
    Column() {
      Row() {
        Text('‹')
          .fontSize(26)
          .fontColor(Theme.text)
          .width(36)
          .onClick((): void => {
            Nav.pop(this.stack);
          })
        Text(this.title)
          .fontSize(15)
          .fontWeight(FontWeight.Medium)
          .fontColor(Theme.text)
          .maxLines(1)
          .textOverflow({ overflow: TextOverflow.Ellipsis })
          .layoutWeight(1)
        Text('年份 ' + (this.sortDesc ? '↓' : '↑'))
          .fontSize(11)
          .fontColor(Theme.gold)
          .onClick((): void => {
            this.toggleSort();
          })
      }
      .width('100%')
      .height(44)
      .padding({ left: 8, right: 14 })

      Scroll() {
        Column({ space: 10 }) {
          Column({ space: 4 }) {
            Text(this.title)
              .fontSize(22)
              .fontWeight(FontWeight.Bold)
              .fontColor(Theme.text)
            Text(this.desc2 + (this.cat === 'pm' && this.pmTotal > 0 ? ' · 共 ' + this.pmTotal + ' 条' : ''))
              .fontSize(10)
              .fontColor(Theme.muted)
            if (this.desc.length > 0) {
              Text(this.desc)
                .fontSize(11)
                .fontColor(Theme.muted)
                .lineHeight(18)
                .margin({ top: 4 })
            }
          }
          .width('100%')
          .alignItems(HorizontalAlign.Start)

          Column() {
            if (this.rows.length === 0 && !this.pmLoading) {
              Text('这个系列下暂时没有品种')
                .fontSize(11)
                .fontColor(Theme.faint)
                .width('100%')
                .textAlign(TextAlign.Center)
                .padding(30)
            }
            ForEach(this.rows, (item: RowView) => {
              Column() {
                this.row(item)
                Divider().color(Theme.lineSoft)
              }
            }, (item: RowView) => item.isPm ? item.code : String(item.id))
          }
          .width('100%')
          .padding({ left: 12, right: 12 })
          .borderRadius(12)
          .backgroundColor(Theme.card)

          if (this.pmError.length > 0) {
            Text(this.pmError)
              .fontSize(11)
              .fontColor(Theme.up)
              .width('100%')
              .textAlign(TextAlign.Center)
              .padding(12)
              .onClick((): void => {
                this.pmError = '';
                this.loadPm(1, false);
              })
          }
          if (this.cat === 'pm' && this.rows.length > 0 && this.pmPage < this.pmPages) {
            Text(this.pmLoading ? '加载中…' : '加载更多（' + this.pmPage + '/' + this.pmPages + '）')
              .fontSize(12)
              .fontColor(Theme.gold)
              .width('100%')
              .textAlign(TextAlign.Center)
              .padding(12)
              .onClick((): void => {
                if (!this.pmLoading) this.loadPm(this.pmPage + 1, true);
              })
          }

          Column().height(30)
        }
        .width('100%')
        .padding({ left: 16, right: 16, top: 8 })
      }
      .scrollBar(BarState.Off)
      .layoutWeight(1)
    }
    .width('100%')
    .height('100%')
    .backgroundColor(Theme.bg)
  }
}
