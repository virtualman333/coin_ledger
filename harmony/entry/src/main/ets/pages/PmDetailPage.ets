import { promptAction } from '@kit.ArkUI';
import { Api } from '../utils/api';
import { money } from '../utils/format';
import { Nav, RouteParam, Routes } from '../utils/router';
import { Store } from '../utils/store';
import { Theme } from '../utils/theme';
import { Holding } from '../model/types';

class PmDetail {
  code: string = '';
  name: string = '';
  projectName: string = '';
  projectCode: string = '';
  year: number = 0;
  frontUrl: string = '';
  backUrl: string = '';
  thumbUrl: string = '';
  thumbBackUrl: string = '';
  frontDesc: string = '';
  backDesc: string = '';
  announce: string = '';
  material: string = '';
  weight: string = '';
  spec: string = '';
  face: number = 0;
  fineness: string = '';
  circulation: string = '';
  quality: string = '';
  craft: string = '';
  castingUnit: string = '';
  designer: string = '';
  sculptor: string = '';
  categories: string = '';
  theme: string = '';
  series: string = '';
  /** 服务端返回的是对象：{value, name, cnyPerGram, pureGram, grossGram, fineness} */
  metalValue: PmMetal | null = null;
}

class PmMetal {
  value: number = 0;
  name: string = '';
  cnyPerGram: number = 0;
  pureGram: number = 0;
  grossGram: number = 0;
  fineness: number = 0;
}

class SiblingItem {
  code: string = '';
  name: string = '';
  year: string = '';
  weightText: string = '';
  thumbUrl: string = '';
}

class PmDetailResponse {
  ok: boolean = false;
  item: PmDetail | null = null;
  error: string = '';
}

class SibRaw {
  code: string = '';
  name: string = '';
  year: string = '';
  weightG: number = 0;
  thumb: string = '';
  frontPicture: string = '';
}

class SibResponse {
  ok: boolean = false;
  items: SibRaw[] = [];
  total: number = 0;
}

class FactRow {
  k: string = '';
  v: string = '';
}

class PmAddBody {
  code: string = '';
  name: string = '';
  face: number = 0;
  thumb: string = '';
  rolls: number = 1;
}

@Component
export struct PmDetailPage {
  // NavPathStack 是框架原生对象：@Prop 会尝试深拷贝，运行时会 Cpp Crash
  stack: NavPathStack = new NavPathStack();
  @StorageProp('cl_dataRev') @Watch('onStoreChange') dataRev: number = 0;

  @State item: PmDetail | null = null;
  @State facts: FactRow[] = [];
  @State siblings: SiblingItem[] = [];
  @State siblingTotal: number = 0;
  @State announceOpen: boolean = false;
  @State imgIdx: number = 0;
  @State notFound: boolean = false;
  @State owned: boolean = false;
  @State addOpen: boolean = false;
  @State addQty: number = 1;
  @State busy: boolean = false;

  aboutToAppear(): void {
    this.load();
  }

  onStoreChange(): void {
    this.checkOwned();
  }

  private checkOwned(): void {
    if (this.item === null) return;
    const hit = Store.getState().holdings.filter((h: Holding): boolean =>
      h.category === 'pm' && h.id === (this.item as PmDetail).code);
    this.owned = hit.length > 0;
  }

  private load(): void {
    const p = Nav.take(this.stack, Routes.PM_DETAIL);
    if (p.code === '') {
      this.notFound = true;
      return;
    }
    Api.get<PmDetailResponse>('/api/catalog/pm/' + encodeURIComponent(p.code)).then((res: PmDetailResponse): void => {
      if (!res || !res.ok || !res.item) {
        this.notFound = true;
        return;
      }
      const it = res.item;
      it.frontUrl = Api.imgUrl(it.frontUrl);
      it.backUrl = Api.imgUrl(it.backUrl);
      // metalValue 是对象；此前用 Number() 折成 NaN 再兜 0，导致材料价值永远不显示
      if (it.metalValue === undefined) {
        it.metalValue = null;
      }
      this.item = it;
      const facts: FactRow[] = [];
      const materialText = this.txt(it.material as Object);
      const weightText = this.txt(it.weight as Object);
      const craftText = this.txt(it.craft as Object);
      if (materialText !== '') facts.push(this.fact('材质', materialText));
      if (it.fineness) facts.push(this.fact('成色', it.fineness + '%'));
      if (weightText !== '') facts.push(this.fact('重量', weightText + (weightText.indexOf('克') >= 0 ? '' : ' 克')));
      if (it.face) facts.push(this.fact('面额', it.face + ' 元'));
      if (it.spec) facts.push(this.fact('规格', it.spec));
      if (it.quality) facts.push(this.fact('品质', it.quality));
      if (craftText !== '') facts.push(this.fact('工艺', craftText));
      if (it.circulation) facts.push(this.fact('发行量', this.txt(it.circulation as Object) + ' 枚'));
      if (it.castingUnit) facts.push(this.fact('铸造单位', it.castingUnit));
      if (it.designer) facts.push(this.fact('设计', it.designer));
      if (it.sculptor) facts.push(this.fact('雕刻', it.sculptor));
      if (it.theme) facts.push(this.fact('主题', it.theme));
      if (it.categories) facts.push(this.fact('类别', it.categories));
      this.facts = facts;
      this.loadSiblings(it.projectCode, it.code);
      this.checkOwned();
    }).catch((): void => {
      this.notFound = true;
    });
  }

  /** 同系列 = 同一发行项目下的其他币 */
  private loadSiblings(projectCode: string, code: string): void {
    if (projectCode === '') return;
    Api.get<SibResponse>('/api/series/detail?category=pm&code=' + encodeURIComponent(projectCode)
      + '&page=1&size=24').then((res: SibResponse): void => {
      if (!res || !res.ok || !Array.isArray(res.items)) return;
      const out: SiblingItem[] = [];
      for (let i = 0; i < res.items.length; i++) {
        const x = res.items[i];
        if (!x || x.code === code) continue;
        const it = new SiblingItem();
        it.code = x.code;
        it.name = x.name;
        it.year = x.year || '';
        it.weightText = x.weightG ? (x.weightG + ' 克') : '';
        it.thumbUrl = x.thumb ? Api.imgUrl(x.thumb) : (x.frontPicture ? Api.imgUrl(x.frontPicture) : '');
        out.push(it);
      }
      this.siblings = out;
      this.siblingTotal = Math.max(0, Number(res.total) || 0);
    }).catch((): void => {
    });
  }

  /** 服务端 material/weight/craft 是数组，直接拼字符串会变成空 */
  private txt(v: Object): string {
    if (v === null || v === undefined) return '';
    if (Array.isArray(v)) {
      const arr = v as Object[];
      const parts: string[] = [];
      for (let i = 0; i < arr.length; i++) {
        const one = String(arr[i]);
        if (one !== '') parts.push(one);
      }
      return parts.join(' · ');
    }
    return String(v);
  }

  private fact(k: string, v: string): FactRow {
    const f = new FactRow();
    f.k = k;
    f.v = v;
    return f;
  }

  private startAdd(): void {
    if (!Store.isLogin()) {
      Nav.push(this.stack, Routes.ACCOUNT, new RouteParam());
      return;
    }
    this.addQty = 1;
    this.addOpen = true;
  }

  private doAdd(): void {
    const it = this.item;
    if (it === null || this.busy) return;
    this.busy = true;
    Store.addPm(it.code, it.name, it.face, it.thumbUrl, this.addQty).then((): Promise<void> => {
      return Store.refresh(true).then((): void => {
      });
    }).then((): void => {
      this.busy = false;
      this.addOpen = false;
      this.checkOwned();
      promptAction.showToast({ message: '已加入我的藏品', duration: 1500 });
    }).catch((e: Error): void => {
      this.busy = false;
      this.addOpen = false;
      promptAction.showToast({ message: e.message || '保存失败', duration: 1800 });
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
      Text('贵金属纪念币')
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
  addSheet() {
    Stack() {
      Column()
        .width('100%')
        .height('100%')
        .backgroundColor('rgba(20,16,10,0.42)')
        .onClick((): void => {
          this.addOpen = false;
        })
      Column({ space: 12 }) {
        Text('加入我的藏品')
          .fontSize(16)
          .fontWeight(FontWeight.Medium)
          .fontColor(Theme.text)
        if (this.item !== null) {
          Text((this.item as PmDetail).name)
            .fontSize(11)
            .fontColor(Theme.muted)
            .maxLines(2)
            .textOverflow({ overflow: TextOverflow.Ellipsis })
        }
        Text('贵金属按枚记账，成本默认按面额计，加入后可改成本')
          .fontSize(10)
          .fontColor(Theme.faint)
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
              this.addQty = Math.min(999, this.addQty + 1);
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
      .backgroundColor(Theme.glass)
      .backgroundBlurStyle(BlurStyle.COMPONENT_THICK)
      .border({ width: 1, color: Theme.glassBorder })
      .shadow({ radius: 24, color: 'rgba(120,90,40,0.08)', offsetY: 8 })
    }
    .width('100%')
    .height('100%')
    .alignContent(Alignment.Bottom)
  }

  build() {
    Stack() {
      Column() {
        this.header()
        if (this.notFound) {
          Text('没有找到这枚贵金属币')
            .fontSize(13)
            .fontColor(Theme.muted)
            .width('100%')
            .height('80%')
            .textAlign(TextAlign.Center)
        } else if (this.item !== null) {
          Scroll() {
            Column({ space: 10 }) {
              if (this.imgIdx === 0 && (this.item as PmDetail).frontUrl !== '') {
                Image((this.item as PmDetail).frontUrl)
                  .width('100%')
                  .height(300)
                  .objectFit(ImageFit.Contain)
                  .backgroundColor('#FBF8F1')
              } else if (this.imgIdx === 1 && (this.item as PmDetail).backUrl !== '') {
                Image((this.item as PmDetail).backUrl)
                  .width('100%')
                  .height(300)
                  .objectFit(ImageFit.Contain)
                  .backgroundColor('#FBF8F1')
              } else {
                Text('暂无图片')
                  .fontSize(12)
                  .fontColor(Theme.faint)
                  .width('100%')
                  .height(300)
                  .textAlign(TextAlign.Center)
                  .backgroundColor('#FBF8F1')
              }

              Row({ space: 8 }) {
                this.imgTab('正面', 0)
                if ((this.item as PmDetail).backUrl !== '') this.imgTab('背面', 1)
                Blank()
              }
              .padding({ left: 14, right: 14 })

              Column({ space: 4 }) {
                Text((this.item as PmDetail).name)
                  .fontSize(18)
                  .fontWeight(FontWeight.Medium)
                  .fontColor(Theme.text)
                Text((this.item as PmDetail).projectName + ' · ' + (this.item as PmDetail).year + ' 年')
                  .fontSize(10)
                  .fontColor(Theme.muted)
              }
              .width('100%')
              .alignItems(HorizontalAlign.Start)
              .padding({ left: 14, right: 14 })

              Column() {
                Column({ space: 10 }) {
                  Column() {
                    this.factsTable()
                  }
                  .width('100%')
                  .padding(14)
                  .borderRadius(14)
                  .backgroundColor(Theme.glass)
                  .backgroundBlurStyle(BlurStyle.COMPONENT_THICK)
                  .border({ width: 1, color: Theme.glassBorder })
                  .shadow({ radius: 24, color: 'rgba(120,90,40,0.08)', offsetY: 8 })

                  if ((this.item as PmDetail).metalValue !== null) {
                    this.metalCard()
                  }

                  Column({ space: 8 }) {
                    if ((this.item as PmDetail).frontDesc) {
                      Text('正面图案')
                        .fontSize(12)
                        .fontColor(Theme.gold)
                      Text((this.item as PmDetail).frontDesc)
                        .fontSize(12)
                        .fontColor('#5A5A5A')
                        .lineHeight(20)
                    }
                    if ((this.item as PmDetail).backDesc) {
                      Text('背面图案')
                        .fontSize(12)
                        .fontColor(Theme.gold)
                        .margin({ top: 4 })
                      Text((this.item as PmDetail).backDesc)
                        .fontSize(12)
                        .fontColor('#5A5A5A')
                        .lineHeight(20)
                    }
                    if ((this.item as PmDetail).announce) {
                      Text('发行公告')
                        .fontSize(12)
                        .fontColor(Theme.gold)
                        .margin({ top: 4 })
                      Text((this.item as PmDetail).announce)
                        .fontSize(12)
                        .fontColor(Theme.muted)
                        .lineHeight(21)
                        .maxLines(this.announceOpen ? 400 : 6)
                        .textOverflow({ overflow: TextOverflow.Ellipsis })
                        .width('100%')
                      Text(this.announceOpen ? '收起' : '展开全文 ›')
                        .fontSize(12)
                        .fontColor(Theme.gold)
                        .margin({ top: 2 })
                        .onClick((): void => {
                          this.announceOpen = !this.announceOpen;
                        })
                    }
                  }
                  .width('100%')
                  .alignItems(HorizontalAlign.Start)
                  .padding(14)
                  .borderRadius(14)
                  .backgroundColor(Theme.glass)
                  .backgroundBlurStyle(BlurStyle.COMPONENT_THICK)
                  .border({ width: 1, color: Theme.glassBorder })
                  .shadow({ radius: 24, color: 'rgba(120,90,40,0.08)', offsetY: 8 })
                }
                .width('100%')
              }
              .padding({ left: 12, right: 12 })

              Column() {
                if (this.owned) {
                  Text('已在我的藏品')
                    .fontSize(14)
                    .fontColor(Theme.goldDeep)
                    .textAlign(TextAlign.Center)
                    .width('100%')
                    .height(44)
                    .borderRadius(8)
                    .backgroundColor(Theme.goldBg)
                    .onClick((): void => {
                      Nav.push(this.stack, Routes.HOLDINGS, new RouteParam());
                    })
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
                this.siblingsCard()
              }
              .padding({ left: 12, right: 12 })

              Column({ space: 4 }) {
                Text('资料来源：中国人民银行发行公告 · 中国金币集团')
                  .fontSize(11)
                  .fontColor(Theme.faint)
                Text('贵金属纪念币无稳定二级市场报价，本站不提供市场估值。')
                  .fontSize(11)
                  .fontColor(Theme.faint)
              }
              .width('100%')
              .alignItems(HorizontalAlign.Start)
              .padding({ left: 16, right: 16, top: 6 })

              Column().height(30)
            }
            .width('100%')
            .constraintSize({ minHeight: '100%' })
            .justifyContent(FlexAlign.Start)
          }
          .scrollBar(BarState.Off)
          .edgeEffect(EdgeEffect.Spring)
          .width('100%')
          .layoutWeight(1)
        }
      }
      .width('100%')
      .height('100%')
      .linearGradient({ angle: 165, colors: [[Theme.skyTop, 0], [Theme.skyMid, 0.5], [Theme.skyBottom, 1]] })

      if (this.addOpen) {
        this.addSheet()
      }
    }
    .width('100%')
    .height('100%')
  }

  @Builder
  imgTab(label: string, idx: number) {
    Text(label)
      .fontSize(11)
      .fontColor(this.imgIdx === idx ? Color.White : Theme.muted)
      .padding({ left: 14, right: 14, top: 5, bottom: 5 })
      .borderRadius(12)
      .backgroundColor(this.imgIdx === idx ? Theme.gold : Theme.card)
      .onClick((): void => {
        this.imgIdx = idx;
      })
  }

  @Builder
  metalCard() {
    if (this.item !== null && (this.item as PmDetail).metalValue !== null
      && (this.item as PmDetail).metalValue !== undefined) {
      Column({ space: 8 }) {
        Text('克重价')
          .fontSize(12)
          .fontColor(Theme.faint)
        Row() {
          Text('≈ ¥' + money((this.item as PmDetail).metalValue!.value))
            .fontSize(24)
            .fontWeight(FontWeight.Bold)
            .fontColor(Theme.gold)
          Blank()
          Text((this.item as PmDetail).metalValue!.name + ' ¥'
            + (this.item as PmDetail).metalValue!.cnyPerGram + '/克')
            .fontSize(11)
            .fontColor(Theme.faint)
        }
        .width('100%')
        .alignItems(VerticalAlign.Bottom)
        Text('按今日' + (this.item as PmDetail).metalValue!.name + '价 × 净重 '
          + (this.item as PmDetail).metalValue!.pureGram + ' 克（'
          + (this.item as PmDetail).metalValue!.grossGram + ' 克 × 成色 '
          + (this.item as PmDetail).metalValue!.fineness + '%）估算。仅材料价值，不含铸造成本与纪念溢价。')
          .fontSize(11)
          .lineHeight(18)
          .fontColor(Theme.faint)
          .width('100%')
      }
      .width('100%')
      .alignItems(HorizontalAlign.Start)
      .padding(16)
      .borderRadius(Theme.radiusM)
      .backgroundColor(Theme.card)
      .border({ width: 1, color: Theme.lineSoft })
      .shadow({ radius: 16, color: 'rgba(0,0,0,0.05)', offsetY: 5 })
    }
  }

  @Builder
  siblingsCard() {
    if (this.siblings.length > 0) {
      Column({ space: 10 }) {
        Row() {
          Text('同系列')
            .fontSize(14)
            .fontWeight(FontWeight.Medium)
            .fontColor(Theme.text)
          Blank()
          if (this.item !== null) {
            Text((this.item as PmDetail).projectName + ' · ' + this.siblingTotal + ' 枚 ›')
              .fontSize(11)
              .fontColor(Theme.gold)
              .onClick((): void => {
                const p = new RouteParam();
                p.cat = 'pm';
                p.code = (this.item as PmDetail).projectCode;
                Nav.push(this.stack, Routes.SERIES_DETAIL, p);
              })
          }
        }
        .width('100%')

        List({ space: 10 }) {
          ForEach(this.siblings, (it: SiblingItem) => {
            ListItem() {
              Column({ space: 4 }) {
                if (it.thumbUrl.length > 0) {
                  Image(it.thumbUrl)
                    .width(84)
                    .height(84)
                    .borderRadius(Theme.radiusThumb)
                    .backgroundColor('#FBF9F4')
                    .objectFit(ImageFit.Contain)
                } else {
                  Text('暂无图')
                    .width(84)
                    .height(84)
                    .borderRadius(Theme.radiusThumb)
                    .textAlign(TextAlign.Center)
                    .fontSize(11)
                    .fontColor(Theme.faint)
                    .backgroundColor('#FBF9F4')
                }
                Text(it.name)
                  .fontSize(11)
                  .fontColor(Theme.textStrong)
                  .maxLines(1)
                  .textOverflow({ overflow: TextOverflow.Ellipsis })
                  .width(84)
                Text(it.year + (it.weightText ? ' · ' + it.weightText : ''))
                  .fontSize(10)
                  .fontColor(Theme.faint)
                  .maxLines(1)
                  .width(84)
              }
              .alignItems(HorizontalAlign.Start)
              .onClick((): void => {
                const p = new RouteParam();
                p.code = it.code;
                // 替换当前页，避免同系列之间来回点把详情栈堆满
                Nav.replace(this.stack, Routes.PM_DETAIL, p);
              })
            }
          }, (it: SiblingItem) => it.code)
        }
        .listDirection(Axis.Horizontal)
        .height(136)
        .scrollBar(BarState.Off)
        .width('100%')
      }
      .width('100%')
      .alignItems(HorizontalAlign.Start)
      .padding(14)
      .borderRadius(Theme.radiusM)
      .backgroundColor(Theme.card)
      .border({ width: 1, color: Theme.lineSoft })
      .shadow({ radius: 16, color: 'rgba(0,0,0,0.05)', offsetY: 5 })
    }
  }

  @Builder
  factsTable() {
    Column({ space: 0 }) {
      if (this.facts.length === 0) {
        Text('暂无规格信息')
          .fontSize(11)
          .fontColor(Theme.faint)
      }
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
        .padding({ top: 7, bottom: 7 })
      }, (f: FactRow) => f.k)
    }
    .width('100%')
    .alignItems(HorizontalAlign.Start)
  }
}
