import { Api } from '../utils/api';
import { Catalog } from '../utils/catalog';
import { Nav, RouteParam, Routes } from '../utils/router';
import { Store } from '../utils/store';
import { Theme } from '../utils/theme';
import { PmSeriesItem, PmSeriesResponse, SeriesItem } from '../model/types';

class SeriesCard {
  code: string = '';
  name: string = '';
  count: number = 0;
  own: number = 0;
  pct: number = 0;
  imgUrl: string = '';
  cat: string = 'coin';
  yearText: string = '';
  matText: string = '';
  thumb: string = '';
  unit: string = '枚';
}

@Component
export struct SeriesPage {
  @Prop stack: NavPathStack;
  @StorageProp('cl_dataRev') @Watch('onStoreChange') dataRev: number = 0;

  @State activeCat: string = 'coin';
  @State coinGroup: SeriesCard[] = [];
  @State noteGroup: SeriesCard[] = [];
  @State pmGroup: SeriesCard[] = [];
  @State pmLoaded: boolean = false;
  @State total: number = 0;
  @State count: number = 0;

  aboutToAppear(): void {
    this.rebuild();
    this.loadPmSeries();
  }

  onStoreChange(): void {
    this.rebuild();
  }

  private rebuild(): void {
    const owned = Store.ownedNames();
    const all: SeriesCard[] = [];
    const coin: SeriesCard[] = [];
    const note: SeriesCard[] = [];
    for (let i = 0; i < Catalog.seriesList.length; i++) {
      const s: SeriesItem = Catalog.seriesList[i];
      const members = Catalog.inSeries(s.code);
      let own = 0;
      let noteN = 0;
      for (let j = 0; j < members.length; j++) {
        if (owned[members[j].name]) own += 1;
        if (members[j].kind === 'note') noteN += 1;
      }
      const card = new SeriesCard();
      card.code = s.code;
      card.name = s.name;
      card.count = members.length;
      card.own = own;
      card.pct = members.length > 0 ? Math.round((own / members.length) * 100) : 0;
      card.imgUrl = s.img ? Api.imgUrl('/' + s.img) : '';
      card.cat = noteN > members.length / 2 ? 'note' : 'coin';
      card.unit = card.cat === 'note' ? '张' : '枚';
      all.push(card);
      if (card.cat === 'note') note.push(card);
      else coin.push(card);
    }
    this.coinGroup = coin;
    this.noteGroup = note;
    this.total = Catalog.total();
    this.count = all.length;
  }

  private loadPmSeries(): void {
    Api.get<PmSeriesResponse>('/api/series?category=pm').then((res: PmSeriesResponse): void => {
      if (!res || !res.ok || !Array.isArray(res.items)) {
        this.pmLoaded = true;
        this.pmGroup = [];
        return;
      }
      const list: SeriesCard[] = [];
      for (let i = 0; i < res.items.length; i++) {
        const it: PmSeriesItem = res.items[i];
        const card = new SeriesCard();
        card.code = it.code;
        card.name = it.name;
        card.count = it.count;
        card.cat = 'pm';
        card.unit = '枚';
        const yf = String(it.yearFrom || '');
        const yt = String(it.yearTo || '');
        card.yearText = yf !== '' && yt !== '' ? (yf === yt ? yf + ' 年' : yf + '—' + yt) : '';
        const mats = Array.isArray(it.materials) ? it.materials.filter((m: string): boolean => !!m) : [];
        card.matText = mats.slice(0, 4).join(' · ');
        card.thumb = it.thumb ? Api.imgUrl(it.thumb) : '';
        list.push(card);
      }
      this.pmGroup = list;
      this.pmLoaded = true;
    }).catch((): void => {
      this.pmLoaded = true;
      this.pmGroup = [];
    });
  }

  private go(code: string, cat: string, name: string): void {
    const p = new RouteParam();
    p.code = code;
    p.cat = cat;
    p.name = name;
    Nav.push(this.stack, Routes.SERIES_DETAIL, p);
  }

  @Builder
  card(item: SeriesCard) {
    Row({ space: 10 }) {
      if (item.imgUrl.length > 0 || item.thumb.length > 0) {
        Image(item.imgUrl.length > 0 ? item.imgUrl : item.thumb)
          .width(64)
          .height(64)
          .borderRadius(8)
          .objectFit(ImageFit.Contain)
          .backgroundColor('#F7F4EC')
      } else {
        Text(item.name.slice(0, 4))
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
          Text(item.name)
            .fontSize(13)
            .fontColor(Theme.textStrong)
            .maxLines(1)
            .textOverflow({ overflow: TextOverflow.Ellipsis })
            .layoutWeight(1)
          Text(item.count + ' ' + item.unit)
            .fontSize(9)
            .fontColor(Theme.faint)
        }
        .width('100%')
        if (item.yearText.length > 0 || item.matText.length > 0) {
          Text([item.yearText, item.matText].filter((x: string): boolean => x !== '').join(' · '))
            .fontSize(9)
            .fontColor(Theme.faint)
            .maxLines(1)
            .textOverflow({ overflow: TextOverflow.Ellipsis })
        }
        Row() {
          Text(item.cat === 'pm' ? '查看目录' : (item.own > 0 ? ('已藏 ' + item.own) : '还没收藏'))
            .fontSize(10)
            .fontColor(item.own > 0 ? Theme.gold : Theme.faint)
          Blank()
          Text('›')
            .fontSize(16)
            .fontColor(Theme.faint)
        }
        .width('100%')
        if (item.cat !== 'pm') {
          Stack({ alignContent: Alignment.Start }) {
            Row()
              .width('100%')
              .height(3)
              .borderRadius(2)
              .backgroundColor('#EFE8DA')
            Row()
              .width(item.pct + '%')
              .height(3)
              .borderRadius(2)
              .backgroundColor(Theme.gold)
          }
          .width('100%')
        }
      }
      .layoutWeight(1)
      .alignItems(HorizontalAlign.Start)
    }
    .width('100%')
    .padding(12)
    .margin({ bottom: 8 })
    .borderRadius(12)
    .backgroundColor(Theme.card)
    .onClick((): void => {
      this.go(item.code, item.cat, item.name);
    })
  }

  @Builder
  catTab(label: string, n: string, key: string) {
    Column({ space: 2 }) {
      Text(label)
        .fontSize(11)
        .fontColor(this.activeCat === key ? Theme.goldDeep : Theme.muted)
      Text(n)
        .fontSize(9)
        .fontColor(Theme.faint)
    }
    .layoutWeight(1)
    .padding({ top: 8, bottom: 8 })
    .borderRadius(10)
    .backgroundColor(this.activeCat === key ? Theme.goldBg : Theme.card)
    .onClick((): void => {
      this.activeCat = key;
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
        Text('按系列')
          .fontSize(15)
          .fontWeight(FontWeight.Medium)
          .fontColor(Theme.text)
        Blank()
      }
      .width('100%')
      .height(44)
      .padding({ left: 8, right: 14 })

      Scroll() {
        Column({ space: 10 }) {
          Column({ space: 3 }) {
            Text('按系列')
              .fontSize(22)
              .fontWeight(FontWeight.Bold)
              .fontColor(Theme.text)
            Text(this.total + ' 个品种，分成 ' + this.count + ' 个系列')
              .fontSize(10)
              .fontColor(Theme.muted)
          }
          .width('100%')
          .alignItems(HorizontalAlign.Start)

          Row() {
            Column({ space: 3 }) {
              Text('全部品种')
                .fontSize(14)
                .fontWeight(FontWeight.Medium)
                .fontColor(Theme.text)
              Text(this.total + ' 个 · 按年份倒序')
                .fontSize(10)
                .fontColor(Theme.muted)
            }
            .alignItems(HorizontalAlign.Start)
            Blank()
            Text('›')
              .fontSize(18)
              .fontColor(Theme.faint)
          }
          .width('100%')
          .padding(14)
          .borderRadius(14)
          .backgroundColor(Theme.card)
          .onClick((): void => {
            this.stack.pop();
          })

          Row({ space: 6 }) {
            this.catTab('普通纪念币', String(this.coinGroup.length), 'coin')
            this.catTab('纪念钞', String(this.noteGroup.length), 'note')
            this.catTab('贵金属', this.pmLoaded ? String(this.pmGroup.length) : '…', 'pm')
          }
          .width('100%')

          if (this.activeCat === 'coin') {
            if (this.coinGroup.length === 0) {
              Text('暂无普通纪念币系列')
                .fontSize(11)
                .fontColor(Theme.faint)
                .width('100%')
                .textAlign(TextAlign.Center)
                .padding(30)
            }
            ForEach(this.coinGroup, (item: SeriesCard) => {
              this.card(item)
            }, (item: SeriesCard) => item.code)
          } else if (this.activeCat === 'note') {
            if (this.noteGroup.length === 0) {
              Text('暂无纪念钞系列')
                .fontSize(11)
                .fontColor(Theme.faint)
                .width('100%')
                .textAlign(TextAlign.Center)
                .padding(30)
            }
            ForEach(this.noteGroup, (item: SeriesCard) => {
              this.card(item)
            }, (item: SeriesCard) => item.code)
          } else {
            if (!this.pmLoaded) {
              Text('贵金属项目加载中…')
                .fontSize(11)
                .fontColor(Theme.faint)
                .width('100%')
                .textAlign(TextAlign.Center)
                .padding(30)
            } else if (this.pmGroup.length === 0) {
              Text('暂无贵金属项目')
                .fontSize(11)
                .fontColor(Theme.faint)
                .width('100%')
                .textAlign(TextAlign.Center)
                .padding(30)
            }
            ForEach(this.pmGroup, (item: SeriesCard) => {
              this.card(item)
            }, (item: SeriesCard) => item.code)
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
