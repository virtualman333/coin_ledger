import { promptAction } from '@kit.ArkUI';
import { Api } from '../utils/api';
import { Catalog } from '../utils/catalog';
import { money, round2 } from '../utils/format';
import { Nav, RouteParam, Routes } from '../utils/router';
import { Store, StoreState } from '../utils/store';
import { Theme } from '../utils/theme';
import { Coin, Holding } from '../model/types';

class HoldItem {
  id: string = '';
  coinId: number = 0;
  isPm: boolean = false;
  pmCode: string = '';
  name: string = '';
  imgUrl: string = '';
  rolls: number = 0;
  unit: string = 'set';
  qtyText: string = '';
  faceText: string = '';
  aiText: string = '';
  costText: string = '';
  marketText: string = '';
  pnlText: string = '';
  pnlUp: boolean = true;
  serialsText: string = '';
  unitWord: string = '套';
  note: string = '';
}

class HoldGroup {
  name: string = '';
  code: string = '';
  isPm: boolean = false;
  aiText: string = '';
  progLabel: string = '';
  pct: number = 0;
  open: boolean = true;
  items: HoldItem[] = [];
}

@Component
export struct HoldingsPage {
  // NavPathStack 是框架原生对象：@Prop 会尝试深拷贝，运行时会 Cpp Crash
  stack: NavPathStack = new NavPathStack();
  onSwitchTab: (index: number) => void = (index: number): void => {
  };
  @StorageProp('cl_dataRev') @Watch('onStoreChange') dataRev: number = 0;

  @State loggedIn: boolean = false;
  @State cat: string = 'all';
  @State groups: HoldGroup[] = [];
  @State empty: boolean = false;
  @State catEmpty: boolean = false;
  @State syncTip: string = '';
  @State marketText: string = '0';
  @State aiText: string = '0';
  @State costText: string = '0';
  @State faceText: string = '0';
  @State kinds: number = 0;
  @State rolls: number = 0;
  @State pmKinds: number = 0;
  @State pmRolls: number = 0;

  // 编辑面板
  @State sheetOpen: boolean = false;
  @State editId: string = '';
  @State editName: string = '';
  @State editImg: string = '';
  @State editRolls: number = 1;
  @State editCost: number = 0;
  @State editUnit: string = 'set';
  @State editSerials: string = '';
  @State editIsPm: boolean = false;
  @State editSetSize: number = 20;
  @State editNote: string = '';
  @State busy: boolean = false;

  aboutToAppear(): void {
    const p = Nav.take(this.stack, Routes.HOLDINGS);
    if (p.cat !== '') this.cat = p.cat;
    this.render();
    if (Store.isLogin()) {
      Store.refresh().then((): void => {
        this.render();
      }).catch((e: Error): void => {
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
    this.loggedIn = state.user !== null;
    this.empty = state.holdings.length === 0;
    this.syncTip = state.synced ? '' : (state.error || '');
    this.kinds = st.kinds;
    this.rolls = st.rolls;
    this.pmKinds = st.pmKinds;
    this.pmRolls = st.pmRolls;
    this.faceText = money(st.face);
    this.costText = money(st.cost);
    this.marketText = money(st.market);

    const filtered = state.holdings.filter((h: Holding): boolean => {
      if (this.cat === 'all') return true;
      if (this.cat === 'pm') return h.category === 'pm';
      if (h.category === 'pm') return false;
      const c: Coin | undefined = Catalog.byName[h.name];
      return this.cat === 'note' ? (c !== undefined && c.kind === 'note')
        : !(c !== undefined && c.kind === 'note');
    });
    this.catEmpty = state.holdings.length > 0 && filtered.length === 0;

    const groups: HoldGroup[] = [];
    const index: Record<string, number> = {};
    let aiAll = 0;
    for (let i = 0; i < filtered.length; i++) {
      const h = filtered[i];
      const coin: Coin | undefined = Catalog.byName[h.name];
      const rawGroup = coin !== undefined ? coin.seriesName : (h.group || '单品收藏');
      const groupName = rawGroup === '贵金属' ? '贵金属纪念币' : rawGroup;
      let gi = index[groupName];
      if (gi === undefined) {
        const g = new HoldGroup();
        g.name = groupName;
        g.code = coin !== undefined ? coin.series : '';
        gi = groups.length;
        index[groupName] = gi;
        groups.push(g);
      }
      const g = groups[gi];
      const rolls = Number(h.rolls) || 0;
      const size = coin !== undefined ? (coin.setSizeBase || coin.setSizeCalc) : 20;
      const isPiece = h.unit === 'piece';
      const qty = isPiece ? rolls : rolls * size;
      const isNote = coin !== undefined && coin.kind === 'note';
      const unitWord = isNote ? '张' : '枚';
      const aiUnit = coin !== undefined ? Catalog.aiPriceOf(coin) : 0;
      const aiTotal = round2(aiUnit * qty);
      aiAll += aiTotal;

      const item = new HoldItem();
      item.id = h.id;
      item.coinId = coin !== undefined ? coin.id : 0;
      item.isPm = h.category === 'pm';
      item.pmCode = h.category === 'pm' ? h.id : '';
      item.name = h.name;
      item.imgUrl = h.category === 'pm' && h.thumb ? Api.imgUrl(h.thumb)
        : (coin !== undefined ? (coin.smallUrl || coin.thumbUrl || coin.imgUrl) : '');
      item.rolls = rolls;
      item.unit = isPiece ? 'piece' : 'set';
      item.unitWord = isPiece ? unitWord : '套';
      item.qtyText = isPiece ? (rolls + ' ' + unitWord) : (rolls + ' 套 · ' + qty + ' ' + unitWord);
      item.faceText = coin !== undefined ? money((coin.setFaceBase || coin.setFace) * rolls) : '';
      item.costText = money(h.cost);
      item.marketText = money(h.market);
      item.pnlText = (Number(h.market) - Number(h.cost) >= 0 ? '+' : '-')
        + '¥' + money(Math.abs(Number(h.market) - Number(h.cost)));
      item.pnlUp = Number(h.market) - Number(h.cost) >= 0;
      item.serialsText = Array.isArray(h.serials) && h.serials.length > 0 ? h.serials.join('、') : '';
      item.note = isNote ? '纪念钞' : '';
      g.items.push(item);
    }

    const singlesTotal = Catalog.coins.filter((c: Coin): boolean => !c.set || c.set === 'single').length;
    for (let i = 0; i < groups.length; i++) {
      const g = groups[i];
      g.isPm = g.items.length > 0 && g.items.every((it: HoldItem): boolean => it.isPm);
      if (g.isPm) {
        g.aiText = '';
        g.progLabel = g.items.length + ' 枚';
        g.pct = 0;
        continue;
      }
      let sum = 0;
      for (let j = 0; j < g.items.length; j++) {
        const coin: Coin | undefined = Catalog.byName[g.items[j].name];
        if (coin === undefined) continue;
        const h = g.items[j];
        const size = coin.setSizeBase || coin.setSizeCalc;
        const qty = h.unit === 'piece' ? h.rolls : h.rolls * size;
        sum += Catalog.aiPriceOf(coin) * qty;
      }
      g.aiText = money(round2(sum));
      const total = g.code !== '' ? Catalog.inSeries(g.code).length : singlesTotal;
      g.pct = total > 0 ? Math.min(100, Math.round((g.items.length / total) * 100)) : 0;
      g.progLabel = g.items.length + ' / ' + total;
    }
    const rest = groups.filter((g: HoldGroup): boolean => g.name !== '单品收藏');
    const solo = groups.filter((g: HoldGroup): boolean => g.name === '单品收藏');
    this.groups = rest.concat(solo);
    this.aiText = money(round2(aiAll));
  }

  private toggleGroup(name: string): void {
    const next: HoldGroup[] = [];
    for (let i = 0; i < this.groups.length; i++) {
      const g = this.groups[i];
      if (g.name === name) g.open = !g.open;
      next.push(g);
    }
    this.groups = next;
  }

  private openSheet(item: HoldItem): void {
    const state = Store.getState();
    const hit = state.holdings.filter((h: Holding): boolean => h.id === item.id);
    if (hit.length === 0) return;
    const h = hit[0];
    const coin: Coin | undefined = Catalog.byName[h.name];
    this.editId = h.id;
    this.editName = h.name;
    this.editImg = item.imgUrl;
    this.editIsPm = h.category === 'pm';
    this.editRolls = Number(h.rolls) || 1;
    this.editUnit = h.unit === 'piece' ? 'piece' : 'set';
    this.editSetSize = coin !== undefined ? (coin.setSizeBase || coin.setSizeCalc) : 1;
    this.editCost = Math.round(((Number(h.cost) || 0) / (Number(h.rolls) || 1)) * 100) / 100;
    this.editSerials = Array.isArray(h.serials) ? h.serials.join(' ') : '';
    this.editNote = coin !== undefined && coin.kind === 'note' ? '张' : '枚';
    this.sheetOpen = true;
  }

  private saveSheet(): void {
    if (this.busy) return;
    this.busy = true;
    const totalCost = round2(this.editCost * this.editRolls);
    const serials = this.editSerials.split(/[\s,，、;；|]+/)
      .map((s: string): string => s.trim())
      .filter((s: string): boolean => s.length > 0);
    Store.setUnitForm(this.editId, this.editUnit, this.editRolls, totalCost).then((): Promise<void> => {
      return Store.patchHolding(this.editId, serials, null, this.editUnit, null).then((): void => {
      });
    }).then((): Promise<void> => {
      return Store.refresh(true).then((): void => {
      });
    }).then((): void => {
      this.busy = false;
      this.sheetOpen = false;
      this.render();
      promptAction.showToast({ message: '已保存', duration: 1400 });
    }).catch((e: Error): void => {
      this.busy = false;
      promptAction.showToast({ message: e.message || '保存失败', duration: 1800 });
    });
  }

  private removeItem(): void {
    const name = this.editName;
    AlertDialog.show({
      title: '移出收藏',
      message: '把「' + name + '」从我的收藏里移出？',
      primaryButton: {
        value: '取消',
        action: (): void => {
        }
      },
      secondaryButton: {
        value: '移出',
        fontColor: Theme.up,
        action: (): void => {
          Store.removeHolding(this.editId).then((): Promise<void> => {
            return Store.refresh(true).then((): void => {
            });
          }).then((): void => {
            this.sheetOpen = false;
            this.render();
            promptAction.showToast({ message: '已移出', duration: 1400 });
          }).catch((e: Error): void => {
            promptAction.showToast({ message: e.message || '操作失败', duration: 1800 });
          });
        }
      }
    });
  }

  @Builder
  header() {
    Row() {
      Text('‹')
        .fontSize(26)
        .fontColor(Theme.text)
        .width(36)
        .onClick((): void => {
          Nav.pop(this.stack);
        })
      Text('我的收藏')
        .fontSize(15)
        .fontWeight(FontWeight.Medium)
        .fontColor(Theme.text)
      Blank()
    }
    .width('100%')
    .height(44)
    .padding({ left: 8, right: 14 })
  }

  @Builder
  catChips() {
    Row({ space: 6 }) {
      this.catChip('全部', 'all')
      this.catChip('普通纪念币', 'coin')
      this.catChip('纪念钞', 'note')
      this.catChip('贵金属', 'pm')
    }
    .width('100%')
    .margin({ top: 4, bottom: 8 })
  }

  @Builder
  catChip(label: string, key: string) {
    Text(label)
      .fontSize(11)
      .fontColor(this.cat === key ? Color.White : Theme.muted)
      .padding({ left: 10, right: 10, top: 5, bottom: 5 })
      .borderRadius(12)
      .backgroundColor(this.cat === key ? Theme.gold : Theme.card)
      .onClick((): void => {
        this.cat = key;
        this.render();
      })
  }

  @Builder
  summaryCard() {
    Column({ space: 8 }) {
      Row() {
        Column({ space: 3 }) {
          Text('持仓市值')
            .fontSize(10)
            .fontColor(Theme.muted)
          Row() {
            Text('¥')
              .fontSize(12)
              .fontColor(Theme.goldDeep)
            Text(this.marketText)
              .fontSize(24)
              .fontWeight(FontWeight.Bold)
              .fontColor(Theme.text)
          }
          .alignItems(VerticalAlign.Bottom)
        }
        .alignItems(HorizontalAlign.Start)
        .layoutWeight(1)

        Column({ space: 3 }) {
          Text('投入')
            .fontSize(9)
            .fontColor(Theme.faint)
          Text('¥' + this.costText)
            .fontSize(13)
            .fontColor(Theme.textStrong)
          Text('推理价 ¥' + this.aiText)
            .fontSize(9)
            .fontColor(Theme.gold)
        }
        .alignItems(HorizontalAlign.End)
      }
      .width('100%')

      Row() {
        Text(this.kinds + ' 个品种 · ' + this.rolls + ' 套')
          .fontSize(10)
          .fontColor(Theme.muted)
        Blank()
        Text('面值 ¥' + this.faceText)
          .fontSize(10)
          .fontColor(Theme.faint)
      }
      .width('100%')
    }
    .width('100%')
    .padding(14)
    .borderRadius(14)
    .linearGradient({ angle: 135, colors: [['#FBF7EE', 0], ['#F3EAD7', 1]] })
    .border({ width: 1, color: '#EFE3C8' })
  }

  @Builder
  itemCard(item: HoldItem) {
    Row({ space: 10 }) {
      if (item.imgUrl.length > 0) {
        Image(item.imgUrl)
          .width(58)
          .height(58)
          .borderRadius(7)
          .objectFit(ImageFit.Contain)
          .backgroundColor('#F4F4F5')
          .onClick((): void => {
            if (item.isPm) {
              const p = new RouteParam();
              p.code = item.pmCode;
              Nav.push(this.stack, Routes.PM_DETAIL, p);
            } else if (item.coinId > 0) {
              Nav.push(this.stack, Routes.DETAIL, RouteParam.of(item.coinId));
            }
          })
      } else {
        Text(item.name.slice(0, 1))
          .width(58)
          .height(58)
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
          if (item.note.length > 0) {
            Text(item.note)
              .fontSize(8)
              .fontColor(Theme.goldDeep)
              .padding({ left: 4, right: 4, top: 1, bottom: 1 })
              .backgroundColor(Theme.goldBg)
              .borderRadius(3)
          }
        }
        .width('100%')

        Text(item.qtyText + (item.faceText !== '' ? ' · 面值 ¥' + item.faceText : ''))
          .fontSize(9)
          .fontColor(Theme.muted)
          .maxLines(1)
          .textOverflow({ overflow: TextOverflow.Ellipsis })
        Row({ space: 8 }) {
          Text('投入 ¥' + item.costText)
            .fontSize(9)
            .fontColor(Theme.faint)
          if (item.aiText.length > 0) {
            Text('推理 ¥' + item.aiText)
              .fontSize(9)
              .fontColor(Theme.gold)
          }
          if (item.marketText !== '0') {
            Text(item.pnlText)
              .fontSize(9)
              .fontColor(item.pnlUp ? Theme.up : Theme.down)
          }
        }
        if (item.serialsText.length > 0) {
          Text('号码 ' + item.serialsText)
            .fontSize(9)
            .fontColor(Theme.faint)
            .maxLines(1)
            .textOverflow({ overflow: TextOverflow.Ellipsis })
        }
      }
      .layoutWeight(1)
      .alignItems(HorizontalAlign.Start)

      Text('⋯')
        .fontSize(18)
        .fontColor(Theme.faint)
        .width(34)
        .height(34)
        .textAlign(TextAlign.Center)
        .onClick((): void => {
          this.openSheet(item);
        })
    }
    .width('100%')
    .padding({ top: 9, bottom: 9 })
    .alignItems(VerticalAlign.Center)
  }

  @Builder
  editSheet() {
    Stack() {
      Column()
        .width('100%')
        .height('100%')
        .backgroundColor('rgba(20,16,10,0.42)')
        .onClick((): void => {
          this.sheetOpen = false;
        })

      Column({ space: 12 }) {
        Row({ space: 10 }) {
          if (this.editImg.length > 0) {
            Image(this.editImg)
              .width(48)
              .height(48)
              .borderRadius(6)
              .objectFit(ImageFit.Contain)
              .backgroundColor('#F4F4F5')
          }
          Column({ space: 3 }) {
            Text(this.editName)
              .fontSize(14)
              .fontWeight(FontWeight.Medium)
              .fontColor(Theme.text)
              .maxLines(2)
              .textOverflow({ overflow: TextOverflow.Ellipsis })
            Text(this.editIsPm ? '贵金属纪念币 · 按枚记'
              : ('按' + (this.editUnit === 'piece' ? this.editNote : '套') + '记'))
              .fontSize(10)
              .fontColor(Theme.muted)
          }
          .layoutWeight(1)
          .alignItems(HorizontalAlign.Start)

          Text('✕')
            .fontSize(16)
            .fontColor(Theme.muted)
            .onClick((): void => {
              this.sheetOpen = false;
            })
        }
        .width('100%')

        if (!this.editIsPm && this.editSetSize > 1) {
          Row({ space: 8 }) {
            Text('整套')
              .fontSize(11)
              .fontColor(this.editUnit === 'set' ? Color.White : Theme.muted)
              .textAlign(TextAlign.Center)
              .layoutWeight(1)
              .height(34)
              .borderRadius(8)
              .backgroundColor(this.editUnit === 'set' ? Theme.gold : Theme.bg)
              .onClick((): void => {
                this.editUnit = 'set';
              })
            Text('单个')
              .fontSize(11)
              .fontColor(this.editUnit === 'piece' ? Color.White : Theme.muted)
              .textAlign(TextAlign.Center)
              .layoutWeight(1)
              .height(34)
              .borderRadius(8)
              .backgroundColor(this.editUnit === 'piece' ? Theme.gold : Theme.bg)
              .onClick((): void => {
                this.editUnit = 'piece';
              })
          }
          .width('100%')
        }

        Row({ space: 10 }) {
          Text('数量')
            .fontSize(12)
            .fontColor(Theme.muted)
            .width(48)
          Text('−')
            .fontSize(18)
            .fontColor(Theme.text)
            .width(34)
            .height(34)
            .textAlign(TextAlign.Center)
            .borderRadius(8)
            .backgroundColor(Theme.bg)
            .onClick((): void => {
              this.editRolls = Math.max(1, this.editRolls - 1);
            })
          Text(String(this.editRolls))
            .fontSize(15)
            .fontWeight(FontWeight.Medium)
            .fontColor(Theme.text)
            .width(52)
            .textAlign(TextAlign.Center)
          Text('+')
            .fontSize(18)
            .fontColor(Theme.text)
            .width(34)
            .height(34)
            .textAlign(TextAlign.Center)
            .borderRadius(8)
            .backgroundColor(Theme.bg)
            .onClick((): void => {
              this.editRolls = Math.min(999, this.editRolls + 1);
            })
          Blank()
          Text(this.editUnit === 'piece' ? this.editNote : '套')
            .fontSize(11)
            .fontColor(Theme.faint)
        }
        .width('100%')

        Row({ space: 10 }) {
          Text('单价成本')
            .fontSize(12)
            .fontColor(Theme.muted)
            .width(60)
          TextInput({ text: String(this.editCost), placeholder: '0' })
            .type(InputType.Number)
            .layoutWeight(1)
            .height(38)
            .fontSize(13)
            .backgroundColor(Theme.bg)
            .borderRadius(8)
            .padding({ left: 10, right: 10 })
            .onChange((value: string): void => {
              const n = Number(value.replace(/[^0-9.]/g, ''));
              this.editCost = isFinite(n) ? n : 0;
            })
          Text('元 / ' + (this.editUnit === 'piece' ? this.editNote : '套'))
            .fontSize(10)
            .fontColor(Theme.faint)
        }
        .width('100%')

        Row({ space: 10 }) {
          Text('冠号')
            .fontSize(12)
            .fontColor(Theme.muted)
            .width(48)
          TextInput({ text: $$this.editSerials, placeholder: '多个号码用空格分隔（可留空）' })
            .layoutWeight(1)
            .height(38)
            .fontSize(12)
            .backgroundColor(Theme.bg)
            .borderRadius(8)
            .padding({ left: 10, right: 10 })
        }
        .width('100%')

        Row({ space: 10 }) {
          Text('移出账本')
            .fontSize(13)
            .fontColor(Theme.up)
            .textAlign(TextAlign.Center)
            .layoutWeight(1)
            .height(42)
            .borderRadius(8)
            .backgroundColor('#FBEEEC')
            .onClick((): void => {
              this.removeItem();
            })
          Text(this.busy ? '保存中…' : '保存')
            .fontSize(13)
            .fontColor(Color.White)
            .textAlign(TextAlign.Center)
            .layoutWeight(1)
            .height(42)
            .borderRadius(8)
            .backgroundColor(this.busy ? '#C9BFA9' : Theme.gold)
            .onClick((): void => {
              if (!this.busy) this.saveSheet();
            })
        }
        .width('100%')
      }
      .width('100%')
      .padding(18)
      .borderRadius({ topLeft: 18, topRight: 18 })
      .backgroundColor(Theme.card)
      .border({ width: 1, color: Theme.lineSoft })
    }
    .width('100%')
    .height('100%')
    .alignContent(Alignment.Bottom)
  }

  build() {
    Stack() {
      Column() {
        this.header()
        if (!this.loggedIn) {
          Column({ space: 10 }) {
            Text('登录后查看你的收藏')
              .fontSize(16)
              .fontWeight(FontWeight.Medium)
              .fontColor(Theme.text)
            Text('收藏存在云端，网页版、小程序、鸿蒙端同源')
              .fontSize(11)
              .fontColor(Theme.muted)
            Text('登录 / 注册')
              .fontSize(14)
              .fontColor(Color.White)
              .textAlign(TextAlign.Center)
              .width('100%')
              .height(42)
              .borderRadius(8)
              .linearGradient({ angle: 135, colors: [['#C79A4B', 0], ['#9A6B1F', 1]] })
              .onClick((): void => {
                Nav.push(this.stack, Routes.ACCOUNT, new RouteParam());
              })
          }
          .width('100%')
          .padding(20)
          .borderRadius(16)
          .backgroundColor(Theme.card)
          .border({ width: 1, color: Theme.glassBorder })
          .shadow({ radius: 14, color: 'rgba(0,0,0,0.05)', offsetY: 8 })
          .alignItems(HorizontalAlign.Start)
          .margin({ top: 12 })
        } else {
          Scroll() {
            Column({ space: 10 }) {
              this.catChips()
              if (!this.empty) {
                this.summaryCard()
              }

              if (this.empty) {
                Column({ space: 10 }) {
                  Text('账本还是空的')
                    .fontSize(15)
                    .fontWeight(FontWeight.Medium)
                    .fontColor(Theme.text)
                  Text('去清单挑第一枚，加进来就会自动算面值与推理价')
                    .fontSize(11)
                    .fontColor(Theme.muted)
                  Text('去挑品种 ›')
                    .fontSize(13)
                    .fontColor(Theme.gold)
                    .onClick((): void => {
                      this.onSwitchTab(2);
                      this.stack.pop();
                    })
                }
                .justifyContent(FlexAlign.Start)
                .width('100%')
                .padding(18)
                .borderRadius(14)
                .backgroundColor(Theme.card)
                .border({ width: 1, color: Theme.glassBorder })
                .shadow({ radius: 14, color: 'rgba(0,0,0,0.05)', offsetY: 8 })
                .alignItems(HorizontalAlign.Start)
              } else if (this.catEmpty) {
                Text('这个分类下还没有收藏，换个分类看看')
                  .fontSize(12)
                  .fontColor(Theme.muted)
                  .width('100%')
                  .textAlign(TextAlign.Center)
                  .padding(30)
              }

              ForEach(this.groups, (g: HoldGroup) => {
                Column() {
                  Row({ space: 8 }) {
                    Text(g.name)
                      .fontSize(13)
                      .fontWeight(FontWeight.Medium)
                      .fontColor(Theme.text)
                      .maxLines(1)
                      .textOverflow({ overflow: TextOverflow.Ellipsis })
                      .layoutWeight(1)
                    if (g.aiText.length > 0) {
                      Text('推理价 ¥' + g.aiText)
                        .fontSize(9)
                        .fontColor(Theme.gold)
                    }
                    if (!g.isPm) {
                      Text(g.progLabel)
                        .fontSize(9)
                        .fontColor(Theme.faint)
                    }
                    Text(g.open ? '⌃' : '⌄')
                      .fontSize(12)
                      .fontColor(Theme.faint)
                      .margin({ left: 2 })
                  }
                  .width('100%')
                  .padding({ top: 10, bottom: 6 })
                  .onClick((): void => {
                    this.toggleGroup(g.name);
                  })

                  if (!g.isPm) {
                    Stack({ alignContent: Alignment.Start }) {
                      Row()
                        .width('100%')
                        .height(3)
                        .borderRadius(2)
                        .backgroundColor('#EDEDEF')
                      Row()
                        .width(g.pct + '%')
                        .height(3)
                        .borderRadius(2)
                        .linearGradient({ angle: 135, colors: [['#C79A4B', 0], ['#9A6B1F', 1]] })
                    }
                    .width('100%')
                    .margin({ bottom: 4 })
                  }

                  if (g.open) {
                    ForEach(g.items, (item: HoldItem) => {
                      Column() {
                        this.itemCard(item)
                        Divider().color(Theme.lineSoft)
                      }
                    }, (item: HoldItem) => item.id)
                  }
                }
                .width('100%')
                .padding({ left: 12, right: 12 })
                .borderRadius(12)
                .backgroundColor(Theme.card)
                .border({ width: 1, color: Theme.glassBorder })
                .shadow({ radius: 14, color: 'rgba(0,0,0,0.05)', offsetY: 8 })
              }, (g: HoldGroup) => g.name)

              Column({ space: 4 }) {
                Text('点右侧 ⋯ 可以改数量、改成本、记号码或移出账本')
                  .fontSize(10)
                  .fontColor(Theme.faint)
                if (this.syncTip.length > 0) {
                  Text(this.syncTip)
                    .fontSize(10)
                    .fontColor(Theme.up)
                }
              }
              .width('100%')
              .margin({ top: 6, bottom: 40 })
            }
            .width('100%')
            .constraintSize({ minHeight: '100%' })
            .justifyContent(FlexAlign.Start)
          }
          .edgeEffect(EdgeEffect.Spring)
          .scrollBar(BarState.Off)
          .edgeEffect(EdgeEffect.Spring)
          .layoutWeight(1)
        }
      }
      .width('100%')
      .height('100%')
      .padding({ left: 12, right: 12 })
      .backgroundColor(Theme.bg)

      if (this.sheetOpen) {
        this.editSheet()
      }
    }
    .width('100%')
    .height('100%')
  }
}
