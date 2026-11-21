import { Api } from '../utils/api';
import { Catalog } from '../utils/catalog';
import { Clip } from '../utils/clip';
import { Config } from '../utils/config';
import { agoText, fmtPrice, hhmm, money, signed } from '../utils/format';
import { Nav, RouteParam, Routes } from '../utils/router';
import { Store } from '../utils/store';
import { Theme } from '../utils/theme';
import { Coin, Holding, ShareItem, SharesResponse } from '../model/types';
import { SectionHead } from '../components/Common';

interface LatestCard {
  id: number;
  name: string;
  year: number;
  imgUrl: string;
  faceText: string;
  priceText: string;
}

interface SeriesCard {
  code: string;
  name: string;
  cat: string;
  count: number;
  own: number;
  pct: number;
  label: string;
}

interface MetalInfo {
  gold: string;
  silver: string;
  timeText: string;
  stale: boolean;
}

interface FeedCard {
  id: string;
  author: string;
  holdingName: string;
  serialText: string;
  tag: string;
  pic: string;
  timeText: string;
}

interface QuotesResponse {
  ok: boolean;
  stale?: boolean;
  fetchedAt?: string;
  quotes?: QuotesBody;
}

interface QuotesBody {
  XAU?: MetalQuote;
  XAG?: MetalQuote;
}

interface MetalQuote {
  cnyPerGram?: number;
}

@Component
export struct HomeView {
  @Prop stack: NavPathStack;
  onSwitchTab: (index: number) => void = (index: number): void => {
  };

  @StorageProp('cl_dataRev') @Watch('onStoreChange') dataRev: number = 0;
  @State refreshing: boolean = false;
  @State totalCoins: number = 0;
  @State seriesCount: number = 0;
  @State loggedIn: boolean = false;
  @State heroImg: string = '';
  @State latest: LatestCard[] = [];
  @State seriesTop: SeriesCard[] = [];
  @State metal: MetalInfo | null = null;
  @State feed: FeedCard[] = [];
  @State syncTip: string = '';
  @State faceText: string = '0';
  @State costText: string = '0';
  @State marketText: string = '0';
  @State profitText: string = '0';
  @State profitUp: boolean = true;
  @State kinds: number = 0;
  @State rolls: number = 0;
  @State owned: number = 0;
  @State pct: number = 0;

  aboutToAppear(): void {
    this.render();
    this.loadMetal();
    this.loadFeed();
    if (Store.isLogin()) {
      Store.refresh().catch((e: Error): void => {
        this.syncTip = e.message || '同步失败';
      });
    }
  }

  onStoreChange(): void {
    this.render();
  }

  private render(): void {
    const st = Store.stats();
    const ownedMap = Store.ownedNames();
    const ownedList = Catalog.coins.filter((c: Coin) => ownedMap[c.name] && !!c.imgUrl);
    const state = Store.getState();
    this.totalCoins = Catalog.total();
    this.seriesCount = Catalog.seriesList.length;
    this.loggedIn = state.user !== null;
    this.heroImg = ownedList.length > 0 ? (ownedList[0].thumbUrl || ownedList[0].imgUrl) : '';
    this.faceText = money(st.face);
    this.costText = money(st.cost);
    this.marketText = money(st.market);
    this.profitText = signed(st.profit);
    this.profitUp = st.profit >= 0;
    this.kinds = st.kinds;
    this.rolls = st.rolls;
    this.owned = Object.keys(ownedMap).length;
    this.pct = Catalog.total() > 0 ? Math.round((this.owned / Catalog.total()) * 1000) / 10 : 0;
    this.syncTip = state.synced ? '' : (state.error || '');

    const sorted = Catalog.coins.slice().sort((a: Coin, b: Coin): number => {
      const d = b.year - a.year;
      return d !== 0 ? d : b.id - a.id;
    });
    const latest: LatestCard[] = [];
    for (let i = 0; i < sorted.length && i < 3; i++) {
      const c = sorted[i];
      latest.push({
        id: c.id,
        name: c.name,
        year: c.year,
        imgUrl: c.smallUrl || c.thumbUrl || c.imgUrl,
        faceText: c.faceText,
        priceText: '推理价 ¥' + money(Catalog.aiPriceOf(c) * c.setSizeCalc)
      });
    }
    this.latest = latest;

    const cards: SeriesCard[] = [];
    for (let i = 0; i < Catalog.seriesList.length; i++) {
      const s = Catalog.seriesList[i];
      const members = Catalog.coins.filter((c: Coin) => (c.seriesKeys.length > 0 ? c.seriesKeys : [c.series]).indexOf(s.code) >= 0);
      let own = 0;
      let noteN = 0;
      for (let j = 0; j < members.length; j++) {
        if (ownedMap[members[j].name]) own += 1;
        if (members[j].kind === 'note') noteN += 1;
      }
      cards.push({
        code: s.code,
        name: s.name,
        cat: noteN > members.length / 2 ? 'note' : 'coin',
        count: members.length,
        own: own,
        pct: members.length > 0 ? Math.round((own / members.length) * 100) : 0,
        label: own > 0 ? own + ' / ' + members.length : members.length + ' 个品种'
      });
    }
    cards.sort((a: SeriesCard, b: SeriesCard): number => {
      const d = (b.own / Math.max(1, b.count)) - (a.own / Math.max(1, a.count));
      return d !== 0 ? d : b.count - a.count;
    });
    this.seriesTop = cards.slice(0, 6);
  }

  private loadMetal(): void {
    Api.get<QuotesResponse>('/api/metal-price').then((r: QuotesResponse): void => {
      if (!r || !r.ok || !r.quotes || !r.quotes.XAU || !r.quotes.XAG) {
        this.metal = null;
        return;
      }
      const au = r.quotes.XAU.cnyPerGram;
      const ag = r.quotes.XAG.cnyPerGram;
      if (au === undefined || ag === undefined) {
        this.metal = null;
        return;
      }
      this.metal = {
        gold: fmtPrice(au),
        silver: fmtPrice(ag),
        timeText: hhmm(r.fetchedAt || '') + ' 更新',
        stale: !!r.stale
      };
    }).catch((): void => {
      this.metal = null;
    });
  }

  private loadFeed(): void {
    Api.get<SharesResponse>('/api/shares?sort=new&limit=3').then((r: SharesResponse): void => {
      if (!r || !r.ok || !Array.isArray(r.items)) {
        this.feed = [];
        return;
      }
      const out: FeedCard[] = [];
      for (let i = 0; i < r.items.length && i < 3; i++) {
        const s: ShareItem = r.items[i];
        let tag = '';
        if (s.tags && s.tags.length > 0) {
          const t = s.tags[0];
          tag = typeof t === 'string' ? t : (t.name || '');
        }
        out.push({
          id: String(s.id),
          author: s.author || '藏友',
          holdingName: s.holdingName || '',
          serialText: s.serials && s.serials.length > 0 ? s.serials[0] : '',
          tag: tag,
          pic: s.images && s.images.length > 0 ? Api.imgUrl(s.images[0]) : '',
          timeText: agoText(s.createdAt)
        });
      }
      this.feed = out;
    }).catch((): void => {
      this.feed = [];
    });
  }

  private doRefresh(): void {
    this.refreshing = true;
    this.loadMetal();
    this.loadFeed();
    Store.refresh(true).then((): void => {
      this.render();
      this.refreshing = false;
    }).catch((): void => {
      this.refreshing = false;
    });
  }

  private goDetail(id: number): void {
    Nav.push(this.stack, Routes.DETAIL, RouteParam.of(id));
  }

  private goSeries(code: string, cat: string, name: string): void {
    const p = new RouteParam();
    p.code = code;
    p.cat = cat;
    p.name = name;
    Nav.push(this.stack, Routes.SERIES_DETAIL, p);
  }

  @Builder
  hero() {
    Stack({ alignContent: Alignment.BottomEnd }) {
      Column({ space: 6 }) {
        Text('藏币录')
          .fontSize(26)
          .fontWeight(FontWeight.Bold)
          .fontColor(Theme.goldDeep)
          .letterSpacing(1)
        Text('中国纪念币图鉴')
          .fontSize(11)
          .fontColor(Theme.muted)
          .letterSpacing(1)
        Text('1984—2026 · ' + this.totalCoins + ' 个品种')
          .fontSize(11)
          .fontColor(Theme.faint)
          .margin({ top: 2 })
        Text('复制分享链接')
          .fontSize(11)
          .fontColor(Theme.goldDeep)
          .padding({ left: 12, right: 12, top: 6, bottom: 6 })
          .borderRadius(14)
          .backgroundColor('#FFFFFFB3')
          .border({ width: 1, color: Theme.goldLine })
          .margin({ top: 10 })
          .onClick((): void => {
            Clip.copy(Config.WEB_URL, '链接已复制，可粘贴分享');
          })
      }
      .alignItems(HorizontalAlign.Start)
      .padding({ left: 20, top: 22 })
      .height('100%')
      .justifyContent(FlexAlign.Start)

      if (this.heroImg.length > 0) {
        Image(this.heroImg)
          .width(112)
          .height(112)
          .objectFit(ImageFit.Contain)
          .margin({ right: 16, bottom: 26 })
          .opacity(0.95)
      } else {
        Image($r('app.media.logo_seal'))
          .width(96)
          .height(96)
          .objectFit(ImageFit.Contain)
          .margin({ right: 20, bottom: 34 })
          .opacity(0.9)
      }
    }
    .width('100%')
    .height(196)
    .borderRadius(20)
    .clip(true)
    .linearGradient({ angle: 135, colors: [['#FBF7EE', 0], ['#F2E9D6', 1]] })
  }

  @Builder
  ledger() {
    if (this.loggedIn) {
      Column({ space: 10 }) {
        Row() {
          Text('我的收藏')
            .fontSize(14)
            .fontWeight(FontWeight.Medium)
            .fontColor(Theme.text)
          Blank()
          Text(String(this.owned))
            .fontSize(18)
            .fontWeight(FontWeight.Bold)
            .fontColor(Theme.goldDeep)
          Text(' / ' + this.totalCoins)
            .fontSize(11)
            .fontColor(Theme.faint)
        }
        .width('100%')
        .alignItems(VerticalAlign.Bottom)

        // 进度条
        Stack({ alignContent: Alignment.Start }) {
          Row()
            .width('100%')
            .height(6)
            .borderRadius(3)
            .backgroundColor('#EFE8DA')
          Row()
            .width(this.pct > 0 ? Math.max(3, this.pct) + '%' : '0%')
            .height(6)
            .borderRadius(3)
            .linearGradient({ angle: 90, colors: [['#C79A4B', 0], ['#9A6B1F', 1]] })
        }
        .width('100%')
        .height(6)

        Row() {
          Text(this.kinds + ' 个品种 · ' + this.rolls + ' 套')
            .fontSize(11)
            .fontColor(Theme.muted)
          Blank()
          Text('已收 ' + this.pct + '%')
            .fontSize(11)
            .fontColor(Theme.gold)
        }
        .width('100%')

        Row() {
          this.numCell('面值', '¥' + this.faceText, Theme.text)
          this.numCell('投入', '¥' + this.costText, Theme.text)
          this.numCell('市值', '¥' + this.marketText, Theme.text)
          this.numCell('浮动', '¥' + this.profitText, this.profitUp ? Theme.up : Theme.down)
        }
        .width('100%')
        .margin({ top: 2 })
      }
      .width('100%')
      .padding(16)
      .borderRadius(16)
      .backgroundColor(Theme.card)
      .shadow({ radius: 8, color: 'rgba(60,48,26,0.06)', offsetY: 2 })
      .onClick((): void => {
        Nav.push(this.stack, Routes.HOLDINGS, new RouteParam());
      })
    } else {
      Column({ space: 6 }) {
        Text('登录后开始记你的藏品')
          .fontSize(15)
          .fontWeight(FontWeight.Medium)
          .fontColor(Theme.text)
        Text('与网页版同一账号，藏品云端同步')
          .fontSize(11)
          .fontColor(Theme.muted)
        Text('登录 / 注册')
          .fontSize(14)
          .fontColor(Color.White)
          .textAlign(TextAlign.Center)
          .width('100%')
          .height(40)
          .borderRadius(8)
          .backgroundColor(Theme.gold)
          .margin({ top: 8 })
          .onClick((): void => {
            Nav.push(this.stack, Routes.ACCOUNT, new RouteParam());
          })
      }
      .width('100%')
      .padding(16)
      .borderRadius(16)
      .backgroundColor(Theme.card)
      .shadow({ radius: 8, color: 'rgba(60,48,26,0.06)', offsetY: 2 })
    }
  }

  @Builder
  numCell(k: string, v: string, color: string) {
    Column({ space: 3 }) {
      Text(k)
        .fontSize(10)
        .fontColor(Theme.faint)
      Text(v)
        .fontSize(14)
        .fontWeight(FontWeight.Medium)
        .fontColor(color)
        .maxLines(1)
        .textOverflow({ overflow: TextOverflow.Ellipsis })
    }
    .layoutWeight(1)
    .alignItems(HorizontalAlign.Start)
  }

  @Builder
  latestRow() {
    List({ space: 10 }) {
      ForEach(this.latest, (item: LatestCard) => {
        ListItem() {
          Column({ space: 4 }) {
            Stack({ alignContent: Alignment.TopStart }) {
              Image(item.imgUrl)
                .width(104)
                .height(104)
                .borderRadius(10)
                .backgroundColor('#F4F1E9')
                .objectFit(ImageFit.Cover)
              Text(String(item.year))
                .fontSize(9)
                .fontColor(Theme.goldDeep)
                .padding({ left: 5, right: 5, top: 2, bottom: 2 })
                .backgroundColor('#FFFFFFD9')
                .borderRadius(6)
                .margin({ left: 5, top: 5 })
            }
            .width(104)
            .height(104)

            Text(item.name)
              .fontSize(12)
              .fontColor(Theme.textStrong)
              .maxLines(2)
              .textOverflow({ overflow: TextOverflow.Ellipsis })
              .height(34)
              .width(104)
            Text(item.faceText)
              .fontSize(10)
              .fontColor(Theme.muted)
              .width(104)
            Text(item.priceText)
              .fontSize(10)
              .fontColor(Theme.gold)
              .width(104)
          }
          .alignItems(HorizontalAlign.Start)
          .onClick((): void => {
            this.goDetail(item.id);
          })
        }
      }, (item: LatestCard) => String(item.id))
    }
    .listDirection(Axis.Horizontal)
    .height(184)
    .scrollBar(BarState.Off)
    .width('100%')
  }

  @Builder
  metalCard() {
    if (this.metal !== null) {
      Column({ space: 8 }) {
        Row() {
          Column({ space: 2 }) {
            Text('黄金')
              .fontSize(11)
              .fontColor(Theme.muted)
            Row() {
              Text('¥' + this.metal.gold)
                .fontSize(20)
                .fontWeight(FontWeight.Medium)
                .fontColor(Theme.goldDeep)
              Text(' 元/克')
                .fontSize(9)
                .fontColor(Theme.faint)
            }
            .alignItems(VerticalAlign.Bottom)
          }
          .layoutWeight(1)
          .alignItems(HorizontalAlign.Start)

          Column({ space: 2 }) {
            Text('白银')
              .fontSize(11)
              .fontColor(Theme.muted)
            Row() {
              Text('¥' + this.metal.silver)
                .fontSize(20)
                .fontWeight(FontWeight.Medium)
                .fontColor('#7C7F86')
              Text(' 元/克')
                .fontSize(9)
                .fontColor(Theme.faint)
            }
            .alignItems(VerticalAlign.Bottom)
          }
          .layoutWeight(1)
          .alignItems(HorizontalAlign.Start)
        }
        .width('100%')

        Row() {
          Text((this.metal.stale ? '延时行情 · ' : '') + this.metal.timeText)
            .fontSize(10)
            .fontColor(Theme.faint)
          Blank()
          Text('仅材料价值，随行情浮动')
            .fontSize(10)
            .fontColor(Theme.faint)
        }
        .width('100%')
      }
      .width('100%')
      .padding(16)
      .borderRadius(16)
      .linearGradient({ angle: 120, colors: [['#FBF6EA', 0], ['#F3EAD7', 1]] })
      .border({ width: 1, color: '#EFE3C8' })
      .onClick((): void => {
        const p = new RouteParam();
        p.cat = 'pm';
        p.code = '';
        Nav.push(this.stack, Routes.HOLDINGS, p);
      })
    }
  }

  @Builder
  feedList() {
    Column({ space: 8 }) {
      ForEach(this.feed, (item: FeedCard) => {
        Row({ space: 10 }) {
          if (item.pic.length > 0) {
            Image(item.pic)
              .width(48)
              .height(48)
              .borderRadius(8)
              .objectFit(ImageFit.Cover)
          } else {
            Text('藏')
              .width(48)
              .height(48)
              .borderRadius(8)
              .textAlign(TextAlign.Center)
              .fontSize(16)
              .fontColor(Theme.gold)
              .backgroundColor(Theme.goldBg)
          }
          Column({ space: 3 }) {
            Row({ space: 6 }) {
              Text(item.holdingName)
                .fontSize(13)
                .fontColor(Theme.textStrong)
                .maxLines(1)
                .textOverflow({ overflow: TextOverflow.Ellipsis })
              if (item.tag.length > 0) {
                Text(item.tag)
                  .fontSize(9)
                  .fontColor(Theme.goldDeep)
                  .padding({ left: 5, right: 5, top: 1, bottom: 1 })
                  .backgroundColor(Theme.goldBg)
                  .borderRadius(4)
              }
            }
            if (item.serialText.length > 0) {
              Text('号码 ' + item.serialText)
                .fontSize(10)
                .fontColor(Theme.muted)
            }
            Text(item.author + ' · ' + item.timeText)
              .fontSize(10)
              .fontColor(Theme.faint)
          }
          .layoutWeight(1)
          .alignItems(HorizontalAlign.Start)

          Text('›')
            .fontSize(18)
            .fontColor(Theme.faint)
        }
        .width('100%')
        .padding(12)
        .borderRadius(12)
        .backgroundColor(Theme.card)
        .onClick((): void => {
          Nav.push(this.stack, Routes.PLAZA, new RouteParam());
        })
      }, (item: FeedCard) => item.id)
    }
  }

  @Builder
  seriesGrid() {
    Flex({ wrap: FlexWrap.Wrap, justifyContent: FlexAlign.SpaceBetween }) {
      ForEach(this.seriesTop, (item: SeriesCard) => {
        Column({ space: 5 }) {
          Text(item.name)
            .fontSize(13)
            .fontWeight(FontWeight.Medium)
            .fontColor(Theme.textStrong)
            .maxLines(1)
            .textOverflow({ overflow: TextOverflow.Ellipsis })
          Text(item.label)
            .fontSize(10)
            .fontColor(item.own > 0 ? Theme.gold : Theme.faint)
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
        .width('48%')
        .alignItems(HorizontalAlign.Start)
        .padding(12)
        .margin({ bottom: 10 })
        .borderRadius(12)
        .backgroundColor(Theme.card)
        .onClick((): void => {
          this.goSeries(item.code, item.cat, item.name);
        })
      }, (item: SeriesCard) => item.code)
    }
  }

  build() {
    Refresh({ refreshing: $$this.refreshing }) {
      Scroll() {
        Column() {
          this.hero()

          Column() {
            this.ledger()
          }
          .margin({ top: -28, left: 12, right: 12 })

          SectionHead({ title: '最新发行', more: '全部 ›', onMore: (): void => this.onSwitchTab(1) })
            .padding({ left: 12, right: 12 })
          Column() {
            this.latestRow()
          }
          .padding({ left: 12, right: 12 })

          if (this.metal !== null) {
            SectionHead({ title: '今日金银价', more: '贵金属目录 ›', onMore: (): void => this.onSwitchTab(2) })
              .padding({ left: 12, right: 12 })
            Column() {
              this.metalCard()
            }
            .padding({ left: 12, right: 12 })
          }

          if (this.feed.length > 0) {
            SectionHead({ title: '藏友晒单', more: '去广场 ›', onMore: (): void => {
              Nav.push(this.stack, Routes.PLAZA, new RouteParam());
            } })
              .padding({ left: 12, right: 12 })
            Column() {
              this.feedList()
            }
            .padding({ left: 12, right: 12 })
          }

          SectionHead({
            title: '按系列',
            more: '全部 ' + this.seriesCount + ' 个 ›',
            onMore: (): void => {
              Nav.push(this.stack, Routes.SERIES, new RouteParam());
            }
          })
            .padding({ left: 12, right: 12 })
          Column() {
            this.seriesGrid()
          }
          .padding({ left: 12, right: 12 })

          Column({ space: 4 }) {
            Text('价格均为参考估算，不构成投资建议')
              .fontSize(10)
              .fontColor(Theme.faint)
            if (this.syncTip.length > 0) {
              Text(this.syncTip)
                .fontSize(10)
                .fontColor(Theme.up)
            }
          }
          .margin({ top: 10, bottom: 96 })
        }
        .width('100%')
      }
      .scrollBar(BarState.Off)
      .edgeEffect(EdgeEffect.Spring)
      .width('100%')
      .height('100%')
    }
    .onRefreshing((): void => {
      this.doRefresh();
    })
    .width('100%')
    .height('100%')
    .backgroundColor(Theme.bg)
  }
}
