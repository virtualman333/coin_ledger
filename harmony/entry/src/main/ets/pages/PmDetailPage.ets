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
  metalValue: number = 0;
}

class PmDetailResponse {
  ok: boolean = false;
  item: PmDetail | null = null;
  error: string = '';
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
      // 服务端 metalValue 可能是对象（含金银拆分），统一折成数字，拿不到就 0
      it.metalValue = Number(it.metalValue) || 0;
      this.item = it;
      const facts: FactRow[] = [];
      if (it.material) facts.push(this.fact('材质', it.material));
      if (it.fineness) facts.push(this.fact('成色', it.fineness + '%'));
      if (it.weight) facts.push(this.fact('重量', it.weight));
      if (it.face) facts.push(this.fact('面额', it.face + ' 元'));
      if (it.spec) facts.push(this.fact('规格', it.spec));
      if (it.quality) facts.push(this.fact('品质', it.quality));
      if (it.craft) facts.push(this.fact('工艺', it.craft));
      if (it.circulation) facts.push(this.fact('发行量', it.circulation));
      if (it.castingUnit) facts.push(this.fact('铸造单位', it.castingUnit));
      if (it.designer) facts.push(this.fact('设计', it.designer));
      if (it.sculptor) facts.push(this.fact('雕刻', it.sculptor));
      if (it.theme) facts.push(this.fact('主题', it.theme));
      if (it.categories) facts.push(this.fact('类别', it.categories));
      this.facts = facts;
      this.checkOwned();
    }).catch((): void => {
      this.notFound = true;
    });
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
      .backgroundColor(Theme.card)
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
                  .backgroundColor(Theme.card)

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
                        .fontSize(11)
                        .fontColor(Theme.muted)
                        .lineHeight(19)
                    }
                  }
                  .width('100%')
                  .alignItems(HorizontalAlign.Start)
                  .padding(14)
                  .borderRadius(14)
                  .backgroundColor(Theme.card)
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

              Column().height(30)
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
      if ((this.item as PmDetail).metalValue > 0) {
        Row() {
          Text('材料价值')
            .fontSize(12)
            .fontColor(Theme.faint)
            .width(76)
          Text('¥' + money((this.item as PmDetail).metalValue) + ' 起')
            .fontSize(12)
            .fontColor(Theme.gold)
            .layoutWeight(1)
        }
        .width('100%')
        .padding({ top: 7, bottom: 7 })
      }
    }
    .width('100%')
    .alignItems(HorizontalAlign.Start)
  }
}
