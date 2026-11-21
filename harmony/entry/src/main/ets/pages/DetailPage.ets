import { promptAction } from '@kit.ArkUI';
import { Catalog } from '../utils/catalog';
import { money } from '../utils/format';
import { Nav, RouteParam, Routes } from '../utils/router';
import { Store } from '../utils/store';
import { Theme } from '../utils/theme';
import { Coin, CoinImage, Holding } from '../model/types';

class FactRow {
  k: string = '';
  v: string = '';
  wide: boolean = false;
}

class DescSeg {
  text: string = '';
  bold: boolean = false;
}

class DescBlock {
  bullet: boolean = false;
  segs: DescSeg[] = [];
}

class SameCard {
  id: number = 0;
  name: string = '';
  year: number = 0;
  imgUrl: string = '';
  faceText: string = '';
  owned: boolean = false;
}

class GalItem {
  url: string = '';
  small: string = '';
  label: string = '';
}

@Component
export struct DetailPage {
  @Prop stack: NavPathStack;
  @StorageProp('cl_dataRev') @Watch('onStoreChange') dataRev: number = 0;

  @State coin: Coin | null = null;
  @State facts: FactRow[] = [];
  @State aiPrice: string = '';
  @State formulaOpen: boolean = false;
  @State same: SameCard[] = [];
  @State gal: GalItem[] = [];
  @State mainIdx: number = 0;
  @State owned: boolean = false;
  @State holdingId: string = '';
  @State specNote: string = '';
  @State setInfoName: string = '';
  @State setInfoText: string = '';
  @State descBlocks: DescBlock[] = [];
  @State notFound: boolean = false;
  @State previewOpen: boolean = false;
  @State addSheet: boolean = false;
  @State addUnit: string = 'set';
  @State addQty: number = 1;
  @State busy: boolean = false;
  @State peek: SameCard | null = null;

  aboutToAppear(): void {
    this.render();
  }

  onStoreChange(): void {
    this.render();
  }

  private render(): void {
    const p = Nav.take(this.stack, Routes.DETAIL);
    const coin: Coin | undefined = Catalog.byId[String(p.id)];
    if (coin === undefined) {
      this.notFound = true;
      return;
    }
    this.coin = coin;
    const ownedMap = Store.ownedNames();
    const holding: Holding | null = Store.findHolding(coin.name);
    this.owned = holding !== null;
    this.holdingId = holding !== null ? holding.id : '';

    const facts: FactRow[] = [];
    facts.push(this.fact('面额', coin.faceText));
    facts.push(this.fact('材质', coin.material || '—'));
    facts.push(this.fact(coin.diaLabel || '直径', coin.diaText || '—'));
    facts.push(this.fact('发行量', coin.mintageText));
    if (coin.thickness) facts.push(this.fact(coin.specFrom ? '厚度*' : '厚度', coin.thickness));
    if (coin.weight) facts.push(this.fact(coin.specFrom ? '重量*' : '重量', coin.weight));
    if (coin.caster) facts.push(this.factWide('铸造单位', coin.caster));
    if (coin.edge) facts.push(this.factWide('边齿', coin.edge));
    facts.push(this.fact('系列', coin.seriesName));
    facts.push(this.fact('类型', coin.kind === 'note' ? '纪念钞' : '纪念币'));
    if (coin.setSizeCalc > 1) {
      facts.push(this.factWide('一套面值',
        money(coin.setFace) + ' 元 · ' + coin.setSizeCalc + (coin.kind === 'note' ? ' 张' : ' 枚')));
    }
    this.facts = facts;
    this.specNote = coin.specFrom ? '* 该品种央行公告未公布厚度与重量，这里按同系列同规格推定' : '';
    this.aiPrice = money(Catalog.aiPriceOf(coin));

    // 同系列卡片
    const same: SameCard[] = [];
    for (let i = 0; i < Catalog.coins.length && same.length < 12; i++) {
      const c = Catalog.coins[i];
      if (c.series !== coin.series || c.id === coin.id) continue;
      const card = new SameCard();
      card.id = c.id;
      card.name = c.short || c.name;
      card.year = c.year;
      card.imgUrl = c.smallUrl || c.thumbUrl || c.imgUrl;
      card.faceText = c.face ? (Number(c.face) + ' 元') : '';
      card.owned = !!ownedMap[c.name];
      same.push(card);
    }
    this.same = same;

    // 所属套系进度
    const meta = coin.set && coin.set !== 'single' ? Catalog.sets[coin.set] : undefined;
    if (meta) {
      const members = Catalog.coins.filter((c: Coin): boolean => c.set === coin.set);
      const own = members.filter((c: Coin): boolean => Store.findHolding(c.name) !== null).length;
      this.setInfoName = meta.name;
      this.setInfoText = '已收集 ' + own + ' / ' + members.length;
    } else {
      this.setInfoName = '';
      this.setInfoText = '';
    }

    const gal: GalItem[] = [];
    if (coin.imgs && coin.imgs.length > 0) {
      for (let i = 0; i < coin.imgs.length; i++) {
        const g: CoinImage = coin.imgs[i];
        const item = new GalItem();
        item.url = g.url;
        item.small = g.url === coin.imgUrl && coin.smallUrl ? coin.smallUrl : g.url;
        item.label = g.label;
        gal.push(item);
      }
    } else if (coin.imgUrl) {
      const item = new GalItem();
      item.url = coin.imgUrl;
      item.small = coin.smallUrl || coin.imgUrl;
      item.label = '主图';
      gal.push(item);
    }
    this.gal = gal;
    this.mainIdx = 0;
    this.descBlocks = this.parseDesc(coin.descMd || coin.desc || '');
  }

  private fact(k: string, v: string): FactRow {
    const f = new FactRow();
    f.k = k;
    f.v = v;
    return f;
  }

  private factWide(k: string, v: string): FactRow {
    const f = new FactRow();
    f.k = k;
    f.v = v;
    f.wide = true;
    return f;
  }

  /** 轻量 Markdown：空行分段、`- ` 列表、`**粗体**` */
  private parseDesc(md: string): DescBlock[] {
    const text = md.trim();
    if (text === '') return [];
    const out: DescBlock[] = [];
    const blocks = text.split(/\n{2,}/);
    for (let i = 0; i < blocks.length; i++) {
      const raw = blocks[i].trim();
      if (raw === '') continue;
      if (/^-\s/.test(raw)) {
        const lines = raw.split(/\n/);
        for (let j = 0; j < lines.length; j++) {
          const t = lines[j].replace(/^-\s*/, '').trim();
          if (t === '') continue;
          const b = new DescBlock();
          b.bullet = true;
          b.segs = this.splitBold('· ' + t);
          out.push(b);
        }
        continue;
      }
      const b = new DescBlock();
      b.bullet = false;
      b.segs = this.splitBold(raw.replace(/\n/g, ' '));
      out.push(b);
    }
    return out;
  }

  private splitBold(text: string): DescSeg[] {
    const segs: DescSeg[] = [];
    const parts = text.split(/(\*\*[^*]+\*\*)/);
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      if (part === '') continue;
      const s = new DescSeg();
      if (/^\*\*[^*]+\*\*$/.test(part)) {
        s.text = part.slice(2, part.length - 2);
        s.bold = true;
      } else {
        s.text = part;
        s.bold = false;
      }
      segs.push(s);
    }
    return segs;
  }

  private startAdd(): void {
    const coin = this.coin;
    if (coin === null) return;
    if (!Store.isLogin()) {
      AlertDialog.show({
        title: '还没登录',
        message: '登录后藏品会存到你的账号里，和网页版、小程序同步。',
        confirm: {
          value: '去登录',
          action: (): void => {
            Nav.push(this.stack, Routes.ACCOUNT, new RouteParam());
          }
        },
        cancel: (): void => {
        }
      });
      return;
    }
    this.addUnit = 'set';
    this.addQty = 1;
    this.addSheet = true;
  }

  private doAdd(): void {
    const coin = this.coin;
    if (coin === null || this.busy) return;
    this.busy = true;
    Store.addCoin(coin, this.addUnit, this.addQty).then((): Promise<void> => {
      return Store.refresh(true).then((): void => {
      });
    }).then((): void => {
      this.busy = false;
      this.addSheet = false;
      this.render();
      promptAction.showToast({ message: '已加入我的藏品', duration: 1600 });
    }).catch((e: Error): void => {
      this.busy = false;
      this.addSheet = false;
      promptAction.showToast({ message: e.message || '保存失败', duration: 1800 });
    });
  }

  private removeCoin(): void {
    if (this.holdingId === '') return;
    const name = this.coin !== null ? (this.coin as Coin).name : '';
    AlertDialog.show({
      title: '移出藏品',
      message: '把「' + name + '」从我的藏品里移出？',
      primaryButton: {
        value: '取消',
        action: (): void => {
        }
      },
      secondaryButton: {
        value: '移出',
        fontColor: Theme.up,
        action: (): void => {
          Store.removeHolding(this.holdingId).then((): Promise<void> => {
            return Store.refresh(true).then((): void => {
            });
          }).then((): void => {
            this.render();
            promptAction.showToast({ message: '已移出', duration: 1500 });
          }).catch((e: Error): void => {
            promptAction.showToast({ message: e.message || '操作失败', duration: 1800 });
          });
        }
      }
    });
  }

  private goFeedback(): void {
    const coin = this.coin;
    if (coin === null) return;
    if (!this.owned && !Store.isLogin()) {
      Nav.push(this.stack, Routes.ACCOUNT, new RouteParam());
      return;
    }
    const p = new RouteParam();
    p.id = coin.id;
    Nav.push(this.stack, Routes.FEEDBACK, p);
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
      Text(this.coin !== null ? (this.coin as Coin).name : '品种详情')
        .fontSize(15)
        .fontWeight(FontWeight.Medium)
        .fontColor(Theme.text)
        .maxLines(1)
        .textOverflow({ overflow: TextOverflow.Ellipsis })
        .layoutWeight(1)
      Text('纠错')
        .fontSize(11)
        .fontColor(Theme.gold)
        .onClick((): void => {
          this.goFeedback();
        })
    }
    .width('100%')
    .height(44)
    .padding({ left: 8, right: 14 })
    .backgroundColor('rgba(246,244,239,0.96)')
  }

  @Builder
  bigImage() {
    Stack({ alignContent: Alignment.Center }) {
      if (this.gal.length > 0) {
        Swiper() {
          ForEach(this.gal, (g: GalItem) => {
            Image(g.url)
              .width('100%')
              .height(300)
              .objectFit(ImageFit.Contain)
          }, (g: GalItem) => g.url)
        }
        .index(this.mainIdx)
        .indicator(false)
        .loop(false)
        .onChange((index: number): void => {
          this.mainIdx = index;
        })
        .width('100%')
        .height(300)
        .onClick((): void => {
          this.previewOpen = true;
        })
      } else {
        Text('暂无图片')
          .fontSize(12)
          .fontColor(Theme.faint)
          .height(300)
      }
      Text(this.gal.length > 0 ? this.gal[this.mainIdx].label : '')
        .fontSize(9)
        .fontColor(Theme.goldDeep)
        .padding({ left: 8, right: 8, top: 3, bottom: 3 })
        .backgroundColor('#FFFFFFD9')
        .borderRadius(6)
        .position({ x: 12, y: 12 })
    }
    .width('100%')
    .height(300)
    .backgroundColor('#FBF8F1')
  }

  @Builder
  thumbs() {
    if (this.gal.length > 1) {
      Scroll() {
        Row({ space: 8 }) {
          ForEach(this.gal, (g: GalItem, index: number) => {
            Image(g.small)
              .width(48)
              .height(48)
              .borderRadius(6)
              .objectFit(ImageFit.Contain)
              .backgroundColor('#FFFFFF')
              .border({ width: this.mainIdx === index ? 1.5 : 0, color: Theme.gold })
              .onClick((): void => {
                this.mainIdx = index;
              })
          }, (g: GalItem) => g.url)
        }
        .padding({ left: 14, right: 14, top: 8, bottom: 8 })
      }
      .scrollable(ScrollDirection.Horizontal)
      .scrollBar(BarState.Off)
      .width('100%')
    }
  }

  @Builder
  priceBlock() {
    Column({ space: 6 }) {
      Row() {
        Text('AI 推理价')
          .fontSize(11)
          .fontColor(Theme.muted)
        Text('?')
          .fontSize(9)
          .fontColor(Theme.gold)
          .width(14)
          .height(14)
          .textAlign(TextAlign.Center)
          .borderRadius(7)
          .backgroundColor(Theme.goldBg)
          .margin({ left: 4 })
          .onClick((): void => {
            this.formulaOpen = !this.formulaOpen;
          })
        Blank()
        Text('币面参考，不构成投资建议')
          .fontSize(9)
          .fontColor(Theme.faint)
      }
      .width('100%')

      Row() {
        Text('¥')
          .fontSize(13)
          .fontColor(Theme.goldDeep)
        Text(this.aiPrice)
          .fontSize(26)
          .fontWeight(FontWeight.Bold)
          .fontColor(Theme.goldDeep)
        Blank()
        if (this.owned) {
          Text('已收藏')
            .fontSize(11)
            .fontColor(Theme.goldDeep)
            .padding({ left: 10, right: 10, top: 5, bottom: 5 })
            .borderRadius(12)
            .backgroundColor(Theme.goldBg)
        }
      }
      .width('100%')
      .alignItems(VerticalAlign.Bottom)

      if (this.formulaOpen) {
        Text('按发行量、材质、年代与面额做的对数回归估算（R²≈0.83，中位误差约 5 元），只衡量公开参数能解释的那部分价值；题材溢价、龙头地位不在模型里，所以与市场价的差额本身也是信号。通胀只作为下限保护，不重复叠加。')
          .fontSize(10)
          .fontColor(Theme.muted)
          .lineHeight(17)
          .padding(10)
          .borderRadius(8)
          .backgroundColor(Theme.bg)
      }
    }
    .width('100%')
    .padding(14)
    .borderRadius(14)
    .backgroundColor(Theme.card)
    .alignItems(HorizontalAlign.Start)
  }

  @Builder
  factsGrid() {
    Column({ space: 0 }) {
      ForEach(this.facts, (f: FactRow) => {
        Row() {
          Text(f.k)
            .fontSize(12)
            .fontColor(Theme.faint)
            .width(76)
          Text(f.v)
            .fontSize(12)
            .fontColor(Theme.textStrong)
            .layoutWeight(1)
        }
        .width('100%')
        .padding({ top: 8, bottom: 8 })
        .alignItems(VerticalAlign.Top)
      }, (f: FactRow) => f.k + f.v)
      if (this.specNote.length > 0) {
        Text(this.specNote)
          .fontSize(9)
          .fontColor(Theme.faint)
          .lineHeight(15)
          .margin({ top: 4 })
      }
    }
    .width('100%')
    .padding(14)
    .borderRadius(14)
    .backgroundColor(Theme.card)
  }

  @Builder
  descSection() {
    if (this.descBlocks.length > 0) {
      Column({ space: 10 }) {
        Text('发行信息')
          .fontSize(14)
          .fontWeight(FontWeight.Medium)
          .fontColor(Theme.text)
        ForEach(this.descBlocks, (b: DescBlock) => {
          Text() {
            ForEach(b.segs, (s: DescSeg) => {
              Span(s.text)
                .fontWeight(s.bold ? FontWeight.Medium : FontWeight.Normal)
                .fontColor(s.bold ? Theme.gold : '#5A5A5A')
            }, (s: DescSeg, i: number) => String(i) + s.text)
          }
          .fontSize(13)
          .lineHeight(23)
          .width('100%')
        }, (b: DescBlock, i: number) => String(i))
      }
      .width('100%')
      .padding(14)
      .borderRadius(14)
      .backgroundColor(Theme.card)
      .alignItems(HorizontalAlign.Start)
    }
  }

  @Builder
  designSection() {
    if (this.coin !== null) {
      Column({ space: 8 }) {
        if ((this.coin as Coin).obverse) {
          Column({ space: 3 }) {
            Text('正面图案')
              .fontSize(12)
              .fontColor(Theme.gold)
            Text((this.coin as Coin).obverse)
              .fontSize(12)
              .fontColor('#5A5A5A')
              .lineHeight(20)
          }
          .width('100%')
          .alignItems(HorizontalAlign.Start)
        }
        if ((this.coin as Coin).reverse) {
          Column({ space: 3 }) {
            Text('背面图案')
              .fontSize(12)
              .fontColor(Theme.gold)
            Text((this.coin as Coin).reverse)
              .fontSize(12)
              .fontColor('#5A5A5A')
              .lineHeight(20)
          }
          .width('100%')
          .alignItems(HorizontalAlign.Start)
        }
      }
      .width('100%')
      .padding(14)
      .borderRadius(14)
      .backgroundColor(Theme.card)
      .alignItems(HorizontalAlign.Start)
    }
  }

  @Builder
  sameSection() {
    if (this.same.length > 0) {
      Column({ space: 8 }) {
        Row() {
          Text('同系列')
            .fontSize(14)
            .fontWeight(FontWeight.Medium)
            .fontColor(Theme.text)
          Blank()
          if (this.setInfoName.length > 0) {
            Text(this.setInfoName + ' · ' + this.setInfoText)
              .fontSize(9)
              .fontColor(Theme.faint)
          }
        }
        .width('100%')

        List({ space: 8 }) {
          ForEach(this.same, (c: SameCard) => {
            ListItem() {
              Column({ space: 3 }) {
                if (c.imgUrl.length > 0) {
                  Image(c.imgUrl)
                    .width(72)
                    .height(72)
                    .borderRadius(6)
                    .objectFit(ImageFit.Contain)
                    .backgroundColor('#F7F4EC')
                } else {
                  Text(c.name.slice(0, 2))
                    .width(72)
                    .height(72)
                    .borderRadius(6)
                    .textAlign(TextAlign.Center)
                    .fontSize(11)
                    .fontColor(Theme.goldDeep)
                    .backgroundColor(Theme.goldBg)
                }
                Text(c.name)
                  .fontSize(10)
                  .fontColor(Theme.textStrong)
                  .maxLines(1)
                  .textOverflow({ overflow: TextOverflow.Ellipsis })
                  .width(72)
                Row({ space: 3 }) {
                  Text(String(c.year))
                    .fontSize(8)
                    .fontColor(Theme.faint)
                  if (c.owned) {
                    Text('已收')
                      .fontSize(8)
                      .fontColor(Theme.gold)
                  }
                }
                .width(72)
              }
              .alignItems(HorizontalAlign.Start)
              .onClick((): void => {
                this.peek = c;
              })
            }
          }, (c: SameCard) => String(c.id))
        }
        .listDirection(Axis.Horizontal)
        .height(116)
        .scrollBar(BarState.Off)
        .width('100%')
      }
      .width('100%')
      .padding(14)
      .borderRadius(14)
      .backgroundColor(Theme.card)
      .alignItems(HorizontalAlign.Start)
    }
  }

  @Builder
  addSheetView() {
    Stack() {
      Column()
        .width('100%')
        .height('100%')
        .backgroundColor('rgba(20,16,10,0.42)')
        .onClick((): void => {
          this.addSheet = false;
        })

      Column({ space: 12 }) {
        Text('加入我的藏品')
          .fontSize(16)
          .fontWeight(FontWeight.Medium)
          .fontColor(Theme.text)
        if (this.coin !== null) {
          Text((this.coin as Coin).name)
            .fontSize(11)
            .fontColor(Theme.muted)
            .maxLines(2)
            .textOverflow({ overflow: TextOverflow.Ellipsis })
        }
        if (this.coin !== null && (this.coin as Coin).setSizeCalc > 1) {
          Row({ space: 8 }) {
            Text('按套记（1 套 = ' + (this.coin as Coin).setSizeCalc + ' '
              + ((this.coin as Coin).kind === 'note' ? '张' : '枚') + '）')
              .fontSize(11)
              .fontColor(this.addUnit === 'set' ? Color.White : Theme.muted)
              .textAlign(TextAlign.Center)
              .layoutWeight(1)
              .height(38)
              .borderRadius(8)
              .backgroundColor(this.addUnit === 'set' ? Theme.gold : Theme.bg)
              .onClick((): void => {
                this.addUnit = 'set';
              })
            Text('按单' + ((this.coin as Coin).kind === 'note' ? '张' : '枚') + '记')
              .fontSize(11)
              .fontColor(this.addUnit === 'piece' ? Color.White : Theme.muted)
              .textAlign(TextAlign.Center)
              .layoutWeight(1)
              .height(38)
              .borderRadius(8)
              .backgroundColor(this.addUnit === 'piece' ? Theme.gold : Theme.bg)
              .onClick((): void => {
                this.addUnit = 'piece';
              })
          }
          .width('100%')
        }
        Row({ space: 12 }) {
          Text('数量')
            .fontSize(12)
            .fontColor(Theme.muted)
          Text('−')
            .fontSize(18)
            .fontColor(Theme.text)
            .width(36)
            .height(36)
            .textAlign(TextAlign.Center)
            .borderRadius(8)
            .backgroundColor(Theme.bg)
            .onClick((): void => {
              this.addQty = Math.max(1, this.addQty - 1);
            })
          Text(String(this.addQty))
            .fontSize(16)
            .fontWeight(FontWeight.Medium)
            .fontColor(Theme.text)
            .width(48)
            .textAlign(TextAlign.Center)
          Text('+')
            .fontSize(18)
            .fontColor(Theme.text)
            .width(36)
            .height(36)
            .textAlign(TextAlign.Center)
            .borderRadius(8)
            .backgroundColor(Theme.bg)
            .onClick((): void => {
              this.addQty = Math.min(9999, this.addQty + 1);
            })
          Blank()
        }
        .width('100%')

        Text(this.busy ? '保存中…' : '确认加入')
          .fontSize(14)
          .fontColor(Color.White)
          .textAlign(TextAlign.Center)
          .width('100%')
          .height(44)
          .borderRadius(8)
          .backgroundColor(this.busy ? '#C9BFA9' : Theme.gold)
          .onClick((): void => {
            if (!this.busy) this.doAdd();
          })
      }
      .width('90%')
      .padding(18)
      .borderRadius(16)
      .backgroundColor(Theme.card)
    }
    .width('100%')
    .height('100%')
    .alignContent(Alignment.Bottom)
  }

  @Builder
  previewView() {
    Stack({ alignContent: Alignment.TopStart }) {
      Column()
        .width('100%')
        .height('100%')
        .backgroundColor('#111111')
      Swiper() {
        ForEach(this.gal, (g: GalItem) => {
          Image(g.url)
            .width('100%')
            .height('80%')
            .objectFit(ImageFit.Contain)
        }, (g: GalItem) => g.url)
      }
      .index(this.mainIdx)
      .indicator(true)
      .loop(false)
      .width('100%')
      .height('100%')
      .onChange((index: number): void => {
        this.mainIdx = index;
      })

      Text('✕')
        .fontSize(20)
        .fontColor(Color.White)
        .width(44)
        .height(44)
        .textAlign(TextAlign.Center)
        .margin({ left: 8, top: 8 })
        .onClick((): void => {
          this.previewOpen = false;
        })
    }
    .width('100%')
    .height('100%')
  }

  @Builder
  peekDialog() {
    Stack() {
      Column()
        .width('100%')
        .height('100%')
        .backgroundColor('rgba(20,16,10,0.42)')
        .onClick((): void => {
          this.peek = null;
        })
      Column({ space: 10 }) {
        Row() {
          Text(this.peek !== null ? (this.peek as SameCard).name : '')
            .fontSize(15)
            .fontWeight(FontWeight.Medium)
            .fontColor(Theme.text)
            .layoutWeight(1)
          Text('✕')
            .fontSize(15)
            .fontColor(Theme.muted)
            .onClick((): void => {
              this.peek = null;
            })
        }
        .width('100%')
        if (this.peek !== null) {
          Text(String((this.peek as SameCard).year) + ' 年 · ' + (this.peek as SameCard).faceText)
            .fontSize(11)
            .fontColor(Theme.muted)
          Text('查看详情 ›')
            .fontSize(13)
            .fontColor(Theme.gold)
            .onClick((): void => {
              const id = (this.peek as SameCard).id;
              this.peek = null;
              Nav.push(this.stack, Routes.DETAIL, RouteParam.of(id));
            })
        }
      }
      .width('86%')
      .padding(18)
      .borderRadius(14)
      .backgroundColor(Theme.card)
    }
    .width('100%')
    .height('100%')
    .alignContent(Alignment.Center)
  }

  build() {
    Stack() {
      Column() {
        this.header()
        if (this.notFound) {
          Text('没有找到这个品种')
            .fontSize(13)
            .fontColor(Theme.muted)
            .width('100%')
            .height('80%')
            .textAlign(TextAlign.Center)
        } else if (this.coin !== null) {
          Scroll() {
            Column({ space: 10 }) {
              this.bigImage()
              this.thumbs()

              Column({ space: 4 }) {
                Text((this.coin as Coin).name)
                  .fontSize(18)
                  .fontWeight(FontWeight.Medium)
                  .fontColor(Theme.text)
                Text((this.coin as Coin).year + ' 年 · ' + (this.coin as Coin).seriesName
                  + ' · ' + ((this.coin as Coin).kind === 'note' ? '纪念钞' : '纪念币'))
                  .fontSize(10)
                  .fontColor(Theme.muted)
              }
              .width('100%')
              .alignItems(HorizontalAlign.Start)
              .padding({ left: 14, right: 14 })

              Column() {
                this.priceBlock()
              }
              .padding({ left: 12, right: 12 })

              Column() {
                this.factsGrid()
              }
              .padding({ left: 12, right: 12 })

              Column({ space: 10 }) {
                if (this.owned) {
                  Row({ space: 10 }) {
                    Text('已在我的藏品')
                      .fontSize(14)
                      .fontColor(Theme.goldDeep)
                      .textAlign(TextAlign.Center)
                      .layoutWeight(1)
                      .height(44)
                      .borderRadius(8)
                      .backgroundColor(Theme.goldBg)
                      .onClick((): void => {
                        Nav.push(this.stack, Routes.HOLDINGS, new RouteParam());
                      })
                    Text('移出')
                      .fontSize(13)
                      .fontColor(Theme.up)
                      .textAlign(TextAlign.Center)
                      .width(88)
                      .height(44)
                      .borderRadius(8)
                      .backgroundColor('#FBEEEC')
                      .onClick((): void => {
                        this.removeCoin();
                      })
                  }
                  .width('100%')
                } else {
                  Text('加入我的藏品')
                    .fontSize(14)
                    .fontColor(Color.White)
                    .textAlign(TextAlign.Center)
                    .width('100%')
                    .height(44)
                    .borderRadius(8)
                    .backgroundColor(Theme.gold)
                    .onClick((): void => {
                      this.startAdd();
                    })
                }
              }
              .padding({ left: 12, right: 12 })

              Column() {
                this.descSection()
              }
              .padding({ left: 12, right: 12 })

              Column() {
                this.designSection()
              }
              .padding({ left: 12, right: 12 })

              Column() {
                this.sameSection()
              }
              .padding({ left: 12, right: 12 })

              Column()
                .height(40)
            }
            .width('100%')
          }
          .scrollBar(BarState.Off)
          .edgeEffect(EdgeEffect.Spring)
          .width('100%')
          .layoutWeight(1)
        }
      }
      .width('100%')
      .height('100%')
      .backgroundColor(Theme.bg)

      if (this.addSheet) {
        this.addSheetView()
      }
      if (this.peek !== null) {
        this.peekDialog()
      }
      if (this.previewOpen) {
        this.previewView()
      }
    }
    .width('100%')
    .height('100%')
  }
}
