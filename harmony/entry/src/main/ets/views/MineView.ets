import { Api } from '../utils/api';
import { Catalog } from '../utils/catalog';
import { money } from '../utils/format';
import { Nav, RouteParam, Routes } from '../utils/router';
import { Store, StoreState } from '../utils/store';
import { Theme } from '../utils/theme';
import { Coin, User } from '../model/types';

class DistItem {
  key: string = '';
  name: string = '';
  n: number = 0;
}

class QuickItem {
  key: string = '';
  name: string = '';
  icon: string = '';
}

class RecentItem {
  name: string = '';
  initial: string = '';
  img: string = '';
  qtyText: string = '';
  id: number = 0;
  pmCode: string = '';
  isPm: boolean = false;
}

@Component
export struct MineView {
  // NavPathStack 是框架原生对象：@Prop 会尝试深拷贝，运行时会 Cpp Crash
  stack: NavPathStack = new NavPathStack();
  onSwitchTab: (index: number) => void = (index: number): void => {
  };

  @StorageProp('cl_dataRev') @Watch('onStoreChange') dataRev: number = 0;
  @State loggedIn: boolean = false;
  @State displayName: string = '';
  @State avatarUrl: string = '';
  @State kinds: number = 0;
  @State rolls: number = 0;
  @State marketText: string = '0';
  @State costText: string = '0';
  @State faceText: string = '0';
  @State pnlText: string = '¥0';
  @State pnlPct: number = 0;
  @State profitUp: boolean = true;
  @State totalCoins: number = 0;
  @State progPct: number = 0;
  @State dist: DistItem[] = [];
  @State quick: QuickItem[] = [];
  @State recent: RecentItem[] = [];
  @State thumbs: string[] = [];
  @State syncTip: string = '';

  aboutToAppear(): void {
    this.render();
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
    const state: StoreState = Store.getState();
    const st = Store.stats();
    const user: User | null = state.user;
    this.loggedIn = user !== null;
    this.displayName = user !== null ? (user.nickname || user.name) : '';
    this.avatarUrl = user !== null && user.avatar ? Api.imgUrl(user.avatar) : '';
    this.kinds = st.kinds;
    this.rolls = st.rolls;
    this.marketText = money(st.market);
    this.costText = money(st.cost);
    this.faceText = money(st.face);
    this.pnlText = (st.profit >= 0 ? '+' : '-') + '¥' + money(Math.abs(st.profit));
    this.pnlPct = st.cost > 0 ? Math.round((st.profit / st.cost) * 10000) / 100 : 0;
    this.profitUp = st.profit >= 0;
    this.totalCoins = Catalog.total();
    this.syncTip = state.synced ? '' : (state.error || '');

    this.progPct = Catalog.total() > 0
      ? Math.round((st.kinds / Catalog.total()) * 1000) / 10 : 0;

    const dist: DistItem[] = [];
    const coin = new DistItem();
    coin.key = 'coin';
    coin.name = '普通纪念币';
    const note = new DistItem();
    note.key = 'note';
    note.name = '纪念钞';
    const pm = new DistItem();
    pm.key = 'pm';
    pm.name = '贵金属';
    const holdings = state.holdings || [];
    for (let i = 0; i < holdings.length; i++) {
      const h = holdings[i];
      if (h.category === 'pm') {
        pm.n += 1;
        continue;
      }
      const c: Coin | undefined = Catalog.byName[h.name];
      if (c !== undefined && c.kind === 'note') note.n += 1;
      else coin.n += 1;
    }
    dist.push(coin);
    dist.push(note);
    dist.push(pm);
    this.dist = dist;

    const quick: QuickItem[] = [];
    quick.push(this.quickItem('backup', '收藏备份', '⇅'));
    quick.push(this.quickItem('count', '拍照数币', '◎'));
    quick.push(this.quickItem('feedback', '意见反馈', '✎'));
    quick.push(this.quickItem('plaza', '藏品广场', '✧'));
    this.quick = quick;

    const rec: RecentItem[] = [];
    const start = Math.max(0, holdings.length - 6);
    for (let i = holdings.length - 1; i >= start; i--) {
      const h = holdings[i];
      const c: Coin | undefined = Catalog.byName[h.name];
      let img = '';
      if (h.category === 'pm' && h.thumb) {
        img = Api.imgUrl(h.thumb);
      } else if (c !== undefined) {
        img = c.smallUrl || c.thumbUrl || c.imgUrl;
      }
      const size = c !== undefined ? (c.setSizeBase || c.setSizeCalc) : 20;
      const qty = h.unit === 'piece' ? (Number(h.rolls) || 0) : (Number(h.rolls) || 0) * size;
      const r = new RecentItem();
      r.name = c !== undefined ? (c.short || h.name) : h.name;
      r.initial = h.name.length > 0 ? h.name.charAt(0) : '藏';
      r.img = img;
      r.qtyText = qty + ' ' + (c !== undefined && c.kind === 'note' ? '张' : '枚');
      r.id = c !== undefined ? c.id : 0;
      r.pmCode = h.category === 'pm' ? h.id : '';
      r.isPm = h.category === 'pm';
      rec.push(r);
    }
    this.recent = rec;

    const thumbs: string[] = [];
    for (let i = 0; i < holdings.length && thumbs.length < 3; i++) {
      const h = holdings[i];
      let url = '';
      if (h.category === 'pm') {
        url = h.thumb ? Api.imgUrl(h.thumb) : '';
      } else {
        const c: Coin | undefined = Catalog.byName[h.name];
        url = c !== undefined ? (c.smallUrl || c.thumbUrl || c.imgUrl) : '';
      }
      if (url !== '') thumbs.push(url);
    }
    this.thumbs = thumbs;
  }

  private quickItem(key: string, name: string, icon: string): QuickItem {
    const q = new QuickItem();
    q.key = key;
    q.name = name;
    q.icon = icon;
    return q;
  }

  private goQuick(key: string): void {
    if (key === 'backup') {
      Nav.push(this.stack, Routes.BACKUP, new RouteParam());
      return;
    }
    if (key === 'count') {
      Nav.push(this.stack, Routes.COUNT, new RouteParam());
      return;
    }
    if (key === 'feedback') {
      Nav.push(this.stack, Routes.FEEDBACK, new RouteParam());
      return;
    }
    if (key === 'plaza') {
      Nav.push(this.stack, Routes.PLAZA, new RouteParam());
    }
  }

  @Builder
  cellRow(title: string, value: string, thumbs: string[], route: string, cat: string) {
    Row({ space: 10 }) {
      Text(title)
        .fontSize(14)
        .fontColor(Theme.textStrong)
      if (thumbs.length > 0) {
        Row({ space: 2 }) {
          ForEach(thumbs, (url: string) => {
            Image(url)
              .width(24)
              .height(24)
              .borderRadius(12)
              .objectFit(ImageFit.Cover)
          }, (url: string) => url)
        }
        .margin({ left: 4 })
      }
      Blank()
      if (value.length > 0) {
        Text(value)
          .fontSize(11)
          .fontColor(Theme.muted)
      }
      Text('›')
        .fontSize(18)
        .fontColor(Theme.faint)
    }
    .width('100%')
    .height(50)
    .padding({ left: 14, right: 12 })
    .onClick((): void => {
      const p = new RouteParam();
      p.cat = cat;
      Nav.push(this.stack, route, p);
    })
  }

  @Builder
  quickRow() {
    Row() {
      ForEach(this.quick, (item: QuickItem) => {
        Column({ space: 6 }) {
          Text(item.icon)
            .fontSize(16)
            .fontColor(Theme.goldDeep)
            .width(44)
            .height(44)
            .textAlign(TextAlign.Center)
            .borderRadius(14)
            .backgroundColor(Theme.card)
          Text(item.name)
            .fontSize(10)
            .fontColor(Theme.muted)
        }
        .layoutWeight(1)
        .onClick((): void => {
          this.goQuick(item.key);
        })
      }, (item: QuickItem) => item.key)
    }
    .width('100%')
    .margin({ top: 12 })
  }

  @Builder
  recentList() {
    if (this.recent.length > 0) {
      Column() {
        Row() {
          Text('最近添加')
            .fontSize(13)
            .fontWeight(FontWeight.Medium)
            .fontColor(Theme.text)
          Blank()
          Text('全部 ›')
            .fontSize(11)
            .fontColor(Theme.gold)
            .onClick((): void => {
              Nav.push(this.stack, Routes.HOLDINGS, new RouteParam());
            })
        }
        .width('100%')
        .margin({ top: 14, bottom: 8 })

        List({ space: 10 }) {
          ForEach(this.recent, (item: RecentItem) => {
            ListItem() {
              Column({ space: 4 }) {
                if (item.img.length > 0) {
                  Image(item.img)
                    .width(66)
                    .height(66)
                    .borderRadius(8)
                    .objectFit(ImageFit.Contain)
                    .backgroundColor('#F4F1E9')
                } else {
                  Text(item.initial)
                    .width(66)
                    .height(66)
                    .borderRadius(8)
                    .textAlign(TextAlign.Center)
                    .fontSize(20)
                    .fontColor(Theme.gold)
                    .backgroundColor(Theme.goldBg)
                }
                Text(item.name)
                  .fontSize(10)
                  .fontColor(Theme.textStrong)
                  .maxLines(1)
                  .textOverflow({ overflow: TextOverflow.Ellipsis })
                  .width(66)
                Text(item.qtyText)
                  .fontSize(9)
                  .fontColor(Theme.faint)
                  .width(66)
              }
              .alignItems(HorizontalAlign.Start)
              .onClick((): void => {
                if (item.isPm) {
                  if (item.pmCode !== '') {
                    const p = new RouteParam();
                    p.code = item.pmCode;
                    Nav.push(this.stack, Routes.PM_DETAIL, p);
                  }
                  return;
                }
                if (item.id > 0) Nav.push(this.stack, Routes.DETAIL, RouteParam.of(item.id));
              })
            }
          }, (item: RecentItem) => item.name + item.qtyText)
        }
        .listDirection(Axis.Horizontal)
        .height(112)
        .scrollBar(BarState.Off)
        .width('100%')
      }
      .width('100%')
      .alignItems(HorizontalAlign.Start)
    }
  }

  build() {
    Scroll() {
      Column() {
        if (this.loggedIn) {
          Row({ space: 10 }) {
            if (this.avatarUrl.length > 0) {
              Image(this.avatarUrl)
                .width(46)
                .height(46)
                .borderRadius(23)
                .objectFit(ImageFit.Cover)
            } else {
              Text(this.displayName.length > 0 ? this.displayName.slice(0, 1) : '藏')
                .width(46)
                .height(46)
                .borderRadius(23)
                .textAlign(TextAlign.Center)
                .fontSize(18)
                .fontColor(Theme.goldDeep)
                .backgroundColor(Theme.goldBg)
            }
            Column({ space: 3 }) {
              Text(this.displayName)
                .fontSize(16)
                .fontWeight(FontWeight.Medium)
                .fontColor(Theme.text)
              Text(this.kinds > 0 ? (this.kinds + ' 个品种 · ' + this.rolls + ' 套') : '还没有记录')
                .fontSize(10)
                .fontColor(Theme.muted)
            }
            .layoutWeight(1)
            .alignItems(HorizontalAlign.Start)

            Text('编辑')
              .fontSize(11)
              .fontColor(Theme.goldDeep)
              .padding({ left: 12, right: 12, top: 6, bottom: 6 })
              .borderRadius(14)
              .backgroundColor(Theme.card)
              .onClick((): void => {
                Nav.push(this.stack, Routes.PROFILE, new RouteParam());
              })
          }
          .width('100%')
          .padding({ top: 18, bottom: 12 })
          .alignItems(VerticalAlign.Center)

          if (this.kinds > 0) {
            Column({ space: 8 }) {
              Text('参考市值')
                .fontSize(11)
                .fontColor(Theme.muted)
              Row({ space: 8 }) {
                Text('¥')
                  .fontSize(14)
                  .fontColor(Theme.goldDeep)
                Text(this.marketText)
                  .fontSize(30)
                  .fontWeight(FontWeight.Bold)
                  .fontColor(Theme.text)
                Text(this.pnlText + ' · ' + this.pnlPct + '%')
                  .fontSize(11)
                  .fontColor(this.profitUp ? Theme.up : Theme.down)
                  .margin({ bottom: 4 })
              }
              .alignItems(VerticalAlign.Bottom)
              Text('已投入 ¥' + this.costText + ' · 面值 ¥' + this.faceText)
                .fontSize(10)
                .fontColor(Theme.muted)

              Stack({ alignContent: Alignment.Start }) {
                Row()
                  .width('100%')
                  .height(8)
                  .borderRadius(4)
                  .backgroundColor('#EAE3D4')
                Row()
                  .width(this.progPct + '%')
                  .height(8)
                  .borderRadius(4)
                  .linearGradient({ angle: 90, colors: [['#C79A4B', 0], ['#9A6B1F', 1]] })
              }
              .width('100%')
              .height(8)
              .margin({ top: 4 })

              Row() {
                Text('收藏进度')
                  .fontSize(9)
                  .fontColor(Theme.faint)
                Blank()
                Text(this.kinds + ' / ' + this.totalCoins)
                  .fontSize(9)
                  .fontColor(Theme.gold)
              }
              .width('100%')
            }
            .width('100%')
            .padding(16)
            .borderRadius(16)
            .linearGradient({ angle: 135, colors: [['#FBF7EE', 0], ['#F3EAD7', 1]] })
            .border({ width: 1, color: '#EFE3C8' })
            .alignItems(HorizontalAlign.Start)
          } else {
            Column({ space: 6 }) {
              Text('还没有藏品')
                .fontSize(15)
                .fontWeight(FontWeight.Medium)
                .fontColor(Theme.text)
              Text('去挑第一枚，账本会自己长出来')
                .fontSize(10)
                .fontColor(Theme.muted)
              Text('去清单 ›')
                .fontSize(12)
                .fontColor(Theme.gold)
                .margin({ top: 4 })
                .onClick((): void => {
                  this.onSwitchTab(2);
                })
            }
            .width('100%')
            .padding(16)
            .borderRadius(16)
            .backgroundColor(Theme.card)
            .alignItems(HorizontalAlign.Start)
          }

          if (this.kinds > 0) {
            Row({ space: 8 }) {
              ForEach(this.dist, (d: DistItem) => {
                Column({ space: 3 }) {
                  Text(String(d.n))
                    .fontSize(17)
                    .fontWeight(FontWeight.Medium)
                    .fontColor(d.n > 0 ? Theme.goldDeep : Theme.faint)
                  Text(d.name)
                    .fontSize(9)
                    .fontColor(Theme.faint)
                }
                .layoutWeight(1)
                .padding({ top: 10, bottom: 10 })
                .borderRadius(12)
                .backgroundColor(Theme.card)
                .onClick((): void => {
                  const p = new RouteParam();
                  p.cat = d.key;
                  Nav.push(this.stack, Routes.HOLDINGS, p);
                })
              }, (d: DistItem) => d.key)
            }
            .width('100%')
            .margin({ top: 10 })
          }

          Column() {
            this.cellRow('我的藏品', this.kinds + ' 个品种', this.thumbs, Routes.HOLDINGS, '')
            Divider().color(Theme.lineSoft).margin({ left: 14, right: 14 })
            this.cellRow('更多功能', '备份 · 关于 · 条款', [], Routes.MORE_TOOLS, '')
          }
          .width('100%')
          .margin({ top: 10 })
          .borderRadius(14)
          .backgroundColor(Theme.card)

          this.quickRow()
          this.recentList()

          Column({ space: 4 }) {
            if (this.syncTip.length > 0) {
              Text(this.syncTip)
                .fontSize(10)
                .fontColor(Theme.up)
            }
            Text('价格为参考估算，不构成投资建议')
              .fontSize(10)
              .fontColor(Theme.faint)
          }
          .width('100%')
          .margin({ top: 16, bottom: 24 })
        } else {
          Column({ space: 8 }) {
            Text('登录后才有账本')
              .fontSize(18)
              .fontWeight(FontWeight.Medium)
              .fontColor(Theme.text)
            Text('藏品存在云端，换设备也能接着记')
              .fontSize(11)
              .fontColor(Theme.muted)
            Text('登录 / 注册')
              .fontSize(14)
              .fontColor(Color.White)
              .textAlign(TextAlign.Center)
              .width('100%')
              .height(42)
              .borderRadius(8)
              .backgroundColor(Theme.gold)
              .margin({ top: 10 })
              .onClick((): void => {
                Nav.push(this.stack, Routes.ACCOUNT, new RouteParam());
              })
          }
          .width('100%')
          .padding(20)
          .margin({ top: 24 })
          .borderRadius(16)
          .backgroundColor(Theme.card)
          .alignItems(HorizontalAlign.Start)

          Column() {
            this.cellRow('更多功能', '', [], Routes.MORE_TOOLS, '')
          }
          .width('100%')
          .margin({ top: 12 })
          .borderRadius(14)
          .backgroundColor(Theme.card)

          Column()
            .height(24)
        }
      }
      .width('100%')
      .padding({ left: 16, right: 16 })
    }
    .scrollBar(BarState.Off)
    .edgeEffect(EdgeEffect.Spring)
    .width('100%')
    .height('100%')
    .backgroundColor(Theme.bg)
  }
}
