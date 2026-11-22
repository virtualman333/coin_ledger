import { Api } from '../utils/api';
import { Catalog } from '../utils/catalog';
import { agoText, fmtPrice, hhmm, money, signed } from '../utils/format';
import { Nav, RouteParam, Routes } from '../utils/router';
import { Store } from '../utils/store';
import { Theme } from '../utils/theme';
import { Coin, Holding } from '../model/types';
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
  // NavPathStack 是框架原生对象：@Prop 会尝试深拷贝，运行时会 Cpp Crash
  stack: NavPathStack = new NavPathStack();
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

  private doRefresh(): void {
    this.refreshing = true;
    this.loadMetal();
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
    // 用 Row 分栏而不是 Stack：Stack 的 .align() 只管组件内部内容，
    // 定位只能靠 alignContent，文字和图片需要不同对齐时会互相带偏
    Row() {
      Column({ space: 6 }) {
        Text('藏币录')
          .fontSize(26)
          .fontWeight(FontWeight.Bold)
          .fontColor(Theme.goldDeep)
          .letterSpacing(1.5)
        Text('中国纪念币图鉴')
          .fontSize(13)
          .fontColor(Theme.muted)
          .letterSpacing(1)
        Text('1984—2026 · ' + this.totalCoins + ' 个品种')
          .fontSize(12)
          .fontColor(Theme.faint)
          .margin({ top: 2 })
      }
      .layoutWeight(1)
      .alignItems(HorizontalAlign.Start)

      if (this.heroImg.length > 0) {
        Image(this.heroImg)
          .width(84)
          .height(84)
          .objectFit(ImageFit.Contain)
          .borderRadius(14)
          .backgroundColor('#FFFFFFCC')
          .border({ width: 2, color: '#FFFFFFE6' })
          .shadow({ radius: 10, color: 'rgba(120,90,40,0.16)', offsetY: 3 })
          .margin({ left: 8 })
      } else {
        // 未登录没有藏品图，用品牌图标占位（原来是一枚米色方孔钱装饰，显旧）
        Image($r('app.media.logo_seal'))
          .width(76)
          .height(76)
          .borderRadius(20)
          .border({ width: 3, color: '#FFFFFFE6' })
          .shadow({ radius: 16, color: 'rgba(120,90,40,0.16)', offsetY: 6 })
          .margin({ left: 8 })
      }
    }
    .width('100%')
    .height(168)
    .padding({ left: 20, right: 16, top: 16, bottom: 16 })
    .alignItems(VerticalAlign.Center)
    .justifyContent(FlexAlign.SpaceBetween)
    .borderRadius(Theme.radiusL)
    .clip(true)
    .linearGradient({ angle: 165, colors: [['#FFFFFF', 0], ['#FFFFFF', 0.7], ['#FAFAFB', 1]] })
    .shadow({ radius: 14, color: 'rgba(0,0,0,0.05)', offsetY: 8 })
  }

  @Builder
  ledger() {
    if (this.loggedIn) {
      Column({ space: 10 }) {
        Row() {
          Text('我的收藏')
            .fontSize(15)
            .fontWeight(FontWeight.Medium)
            .fontColor(Theme.text)
          Blank()
          Text(String(this.owned))
            .fontSize(20)
            .fontWeight(FontWeight.Bold)
            .fontColor(Theme.goldDeep)
          Text(' / ' + this.totalCoins)
            .fontSize(12)
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
            .fontSize(12)
            .fontColor(Theme.muted)
          Blank()
          Text('已收 ' + this.pct + '%')
            .fontSize(12)
            .fontColor(Theme.gold)
        }
        .width('100%')

        Row() {
          this.numCell('面值', '¥' + this.faceText, Theme.text)
          Divider().vertical(true).height(24).color(Theme.line)
          this.numCell('投入', '¥' + this.costText, Theme.text)
          Divider().vertical(true).height(24).color(Theme.line)
          this.numCell('市值', '¥' + this.marketText, Theme.text)
          Divider().vertical(true).height(24).color(Theme.line)
          this.numCell('浮动', '¥' + this.profitText, this.profitUp ? Theme.up : Theme.down)
        }
        .width('100%')
        .margin({ top: 4 })
      }
      .width('100%')
      .padding(18)
      .borderRadius(Theme.radiusL)
      .backgroundColor(Theme.glass)
      .border({ width: 1, color: Theme.glassBorder })
      .shadow({ radius: 14, color: 'rgba(0,0,0,0.05)', offsetY: 8 })
      .onClick((): void => {
        Nav.push(this.stack, Routes.HOLDINGS, new RouteParam());
      })
    } else {
      Column({ space: 6 }) {
        Text('登录后开始记你的收藏')
          .fontSize(16)
          .fontWeight(FontWeight.Medium)
          .fontColor(Theme.text)
        Text('与网页版同一账号，收藏云端同步')
          .fontSize(12)
          .fontColor(Theme.muted)
          .margin({ top: 2 })
        Text('登录 / 注册')
          .fontSize(15)
          .fontColor(Color.White)
          .textAlign(TextAlign.Center)
          .width('100%')
          .height(40)
          .borderRadius(8)
          .linearGradient({ angle: 135, colors: [['#C79A4B', 0], ['#9A6B1F', 1]] })
          .margin({ top: 8 })
          .onClick((): void => {
            Nav.push(this.stack, Routes.ACCOUNT, new RouteParam());
          })
      }
      .width('100%')
      .padding(18)
      .borderRadius(Theme.radiusL)
      .backgroundColor(Theme.glass)
      .border({ width: 1, color: Theme.glassBorder })
      .shadow({ radius: 14, color: 'rgba(0,0,0,0.05)', offsetY: 8 })
    }
  }

  @Builder
  numCell(k: string, v: string, color: string) {
    Column({ space: 3 }) {
      Text(k)
        .fontSize(11)
        .fontColor(Theme.faint)
      Text(v)
        .fontSize(15)
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
    // 对齐小程序：三张等分、名称单行省略、图片统一方框，避免换行导致高度参差
    Row({ space: 8 }) {
      ForEach(this.latest, (item: LatestCard) => {
        Column() {
          Stack({ alignContent: Alignment.TopStart }) {
            Image(item.imgUrl)
              .width('100%')
              .height(98)
              .borderRadius(6)
              .backgroundColor('#F5F5F6')
              .objectFit(ImageFit.Contain)
            Text(String(item.year))
              .fontSize(10)
              .fontColor('#F0D79A')
              .padding({ left: 6, right: 6, top: 1, bottom: 1 })
              .backgroundColor('rgba(36,28,20,0.66)')
              .borderRadius(10)
              .margin({ left: 6, top: 6 })
          }
          .width('100%')
          .height(98)

          Text(item.name)
            .fontSize(11)
            .fontWeight(FontWeight.Medium)
            .fontColor(Theme.textStrong)
            .maxLines(2)
            .lineHeight(15)
            .height(30)
            .textOverflow({ overflow: TextOverflow.Ellipsis })
            .width('100%')
            .margin({ top: 8 })

          Text(item.faceText)
            .fontSize(11)
            .fontColor(Theme.muted)
            .maxLines(1)
            .width('100%')
            .margin({ top: 2 })

          Text(item.priceText)
            .fontSize(11)
            .fontColor(Theme.gold)
            .maxLines(1)
            .width('100%')
            .margin({ top: 2 })
        }
        .layoutWeight(1)
        .padding(7)
        .borderRadius(Theme.radiusInner)
        .backgroundColor(Theme.card)
        .border({ width: 1, color: Theme.lineSoft })
        .shadow({ radius: 10, color: 'rgba(0,0,0,0.04)', offsetY: 4 })
        .onClick((): void => {
          this.goDetail(item.id);
        })
      }, (item: LatestCard) => String(item.id))
    }
    .width('100%')
    .alignItems(VerticalAlign.Top)
  }

  @Builder
  metalCard() {
    if (this.metal !== null) {
      Column({ space: 8 }) {
        Row() {
          Column({ space: 2 }) {
            Text('黄金')
              .fontSize(12)
              .fontColor(Theme.muted)
            Row() {
              Text('¥' + this.metal.gold)
                .fontSize(20)
                .fontWeight(FontWeight.Medium)
                .fontColor(Theme.goldDeep)
              Text(' 元/克')
                .fontSize(11)
                .fontColor(Theme.faint)
            }
            .alignItems(VerticalAlign.Bottom)
          }
          .layoutWeight(1)
          .alignItems(HorizontalAlign.Start)

          Column({ space: 2 }) {
            Text('白银')
              .fontSize(12)
              .fontColor(Theme.muted)
            Row() {
              Text('¥' + this.metal.silver)
                .fontSize(20)
                .fontWeight(FontWeight.Medium)
                .fontColor('#7C7F86')
              Text(' 元/克')
                .fontSize(11)
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
            .fontSize(11)
            .fontColor(Theme.faint)
          Blank()
          Text('仅材料价值，随行情浮动')
            .fontSize(11)
            .fontColor(Theme.faint)
        }
        .width('100%')
      }
      .width('100%')
      .padding(18)
      .borderRadius(Theme.radiusL)
      .linearGradient({ angle: 160, colors: [['#FFFFFF', 0], ['#FAFAFB', 1]] })
      .shadow({ radius: 10, color: 'rgba(0,0,0,0.04)', offsetY: 6 })
      .onClick((): void => {
        const p = new RouteParam();
        p.cat = 'pm';
        p.code = '';
        Nav.push(this.stack, Routes.HOLDINGS, p);
      })
    }
  }

  @Builder
  seriesGrid() {
    Flex({ wrap: FlexWrap.Wrap, justifyContent: FlexAlign.SpaceBetween }) {
      ForEach(this.seriesTop, (item: SeriesCard) => {
        Column({ space: 5 }) {
          Text(item.name)
            .fontSize(15)
            .fontWeight(FontWeight.Medium)
            .fontColor(Theme.textStrong)
            .maxLines(1)
            .textOverflow({ overflow: TextOverflow.Ellipsis })
          Text(item.label)
            .fontSize(11)
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
              .linearGradient({ angle: 135, colors: [['#C79A4B', 0], ['#9A6B1F', 1]] })
          }
          .width('100%')
        }
        .width('48%')
        .alignItems(HorizontalAlign.Start)
        .padding(16)
        .margin({ bottom: 12 })
        .borderRadius(Theme.radiusM)
        .backgroundColor(Theme.glass)
        .border({ width: 1, color: Theme.glassBorder })
        .shadow({ radius: 12, color: 'rgba(0,0,0,0.04)', offsetY: 5 })
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
          // hero 与卡片同宽：贴边会让圆角落在屏幕边缘，看起来像被裁掉一半
          Column() {
            this.hero()
          }
          .justifyContent(FlexAlign.Start)
          .width('100%')
          .padding({ left: Theme.pagePadding, right: Theme.pagePadding })
          .margin({ top: 10 })

          Column() {
            this.ledger()
          }
          .width('100%')
          .padding({ left: Theme.pagePadding, right: Theme.pagePadding })
          .margin({ top: 12 })

          SectionHead({ title: '最新发行', more: '全部 ›', onMore: (): void => this.onSwitchTab(1) })
            .width('100%')
            .padding({ left: Theme.pagePadding, right: Theme.pagePadding })
          Column() {
            this.latestRow()
          }
          .width('100%')
          .padding({ left: Theme.pagePadding, right: Theme.pagePadding })

          if (this.metal !== null) {
            SectionHead({ title: '今日金银价', more: '贵金属目录 ›', onMore: (): void => this.onSwitchTab(2) })
              .width('100%')
              .padding({ left: Theme.pagePadding, right: Theme.pagePadding })
            Column() {
              this.metalCard()
            }
            .width('100%')
            .padding({ left: Theme.pagePadding, right: Theme.pagePadding })
          }

          SectionHead({
            title: '按系列',
            more: '全部 ' + this.seriesCount + ' 个 ›',
            onMore: (): void => {
              Nav.push(this.stack, Routes.SERIES, new RouteParam());
            }
          })
            .width('100%')
            .padding({ left: Theme.pagePadding, right: Theme.pagePadding })
          Column() {
            this.seriesGrid()
          }
          .width('100%')
          .padding({ left: Theme.pagePadding, right: Theme.pagePadding })

          Column({ space: 4 }) {
            Text('价格均为参考估算，不构成投资建议')
              .fontSize(11)
              .fontColor(Theme.faint)
            if (this.syncTip.length > 0) {
              Text(this.syncTip)
                .fontSize(11)
                .fontColor(Theme.up)
            }
          }
          .width('100%')
          .alignItems(HorizontalAlign.Center)
          .margin({ top: 10, bottom: 88 })
        }
        .width('100%')
        .constraintSize({ minHeight: '100%' })
        .justifyContent(FlexAlign.Start)
      }
      .edgeEffect(EdgeEffect.Spring)
      .scrollBar(BarState.Off)
      .edgeEffect(EdgeEffect.Spring)
      .width('100%')
      .height('100%')
    }
    .onRefreshing((): void => {
      this.doRefresh();
    })
    .backgroundColor(Color.Transparent)
    .width('100%')
    .height('100%')
  }
}
