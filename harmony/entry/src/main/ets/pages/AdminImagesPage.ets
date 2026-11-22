import { Api } from '../utils/api';
import { Nav, RouteParam, Routes } from '../utils/router';
import { Theme } from '../utils/theme';

class ImgCoin {
  no: number = 0;
  name: string = '';
  year: number = 0;
  imgUrl: string = '';
}

class AdminCatalogResp {
  ok: boolean = false;
  coins: ImgCoin[] = [];
}

/** 图片管理：按缺图筛选，点开看大图（替换/上传仍走网页版后台上传，鸿蒙先解决「找缺图」） */
@Component
export struct AdminImagesPage {
  @Prop stack: NavPathStack;
  @State all: ImgCoin[] = [];
  @State missingOnly: boolean = true;
  @State loading: boolean = false;
  @State err: string = '';
  @State preview: string = '';

  aboutToAppear(): void {
    this.load();
  }

  private load(): void {
    this.loading = true;
    Api.get<AdminCatalogResp>('/api/admin/coins').then((res: AdminCatalogResp): void => {
      this.loading = false;
      if (!res || !res.ok) {
        this.err = '读取失败';
        return;
      }
      const out: ImgCoin[] = [];
      for (let i = 0; i < res.coins.length; i++) {
        const c = res.coins[i];
        const it = new ImgCoin();
        it.no = Number(c.no) || 0;
        it.name = c.name || '';
        it.year = Number(c.year) || 0;
        it.imgUrl = c.imgUrl ? Api.imgUrl(c.imgUrl) : '';
        out.push(it);
      }
      this.all = out;
      this.err = '';
    }).catch((): void => {
      this.loading = false;
      this.err = '网络异常';
    });
  }

  private list(): ImgCoin[] {
    if (!this.missingOnly) return this.all;
    return this.all.filter((c): boolean => c.imgUrl.length === 0);
  }

  build() {
    Stack() {
      Column() {
        Row() {
          Text('‹')
            .fontSize(26)
            .fontColor(Theme.text)
            .width(36)
            .onClick((): void => {
              Nav.pop(this.stack);
            })
          Text('图片管理')
            .fontSize(15)
            .fontWeight(FontWeight.Medium)
            .fontColor(Theme.text)
          Blank()
          Text(this.missingOnly ? '只看缺图' : '全部')
            .fontSize(13)
            .fontColor(Theme.goldDeep)
            .padding({ left: 10, right: 10, top: 5, bottom: 5 })
            .borderRadius(9)
            .backgroundColor(Theme.goldBg)
            .onClick((): void => {
              this.missingOnly = !this.missingOnly;
            })
        }
        .width('100%')
        .height(44)
        .padding({ left: 8, right: 14 })

        Text('缺图 ' + this.all.filter((c): boolean => c.imgUrl.length === 0).length
          + ' / 共 ' + this.all.length + ' 个品种')
          .fontSize(12)
          .fontColor(Theme.muted)
          .width('100%')
          .padding({ left: 20, bottom: 8 })

        if (this.loading) {
          Text('加载中…')
            .fontSize(12)
            .fontColor(Theme.faint)
            .padding(30)
        } else if (this.err.length > 0) {
          Text(this.err + ' · 点此重试')
            .fontSize(12)
            .fontColor(Theme.up)
            .padding(30)
            .onClick((): void => {
              this.load();
            })
        }

        Grid() {
          ForEach(this.list(), (c: ImgCoin) => {
            GridItem() {
              Column({ space: 4 }) {
                if (c.imgUrl.length > 0) {
                  Image(c.imgUrl)
                    .width('100%')
                    .height(84)
                    .borderRadius(8)
                    .objectFit(ImageFit.Contain)
                    .backgroundColor('#F5F5F6')
                    .onClick((): void => {
                      this.preview = c.imgUrl;
                    })
                } else {
                  Text('缺图')
                    .width('100%')
                    .height(84)
                    .borderRadius(8)
                    .textAlign(TextAlign.Center)
                    .fontSize(12)
                    .fontColor(Theme.up)
                    .backgroundColor('#FDF0EE')
                }
                Text(c.name)
                  .fontSize(11)
                  .fontColor(Theme.textStrong)
                  .maxLines(1)
                  .textOverflow({ overflow: TextOverflow.Ellipsis })
                  .width('100%')
              }
              .width('100%')
            }
          }, (c: ImgCoin) => String(c.no))
        }
        .columnsTemplate('1fr 1fr 1fr')
        .columnsGap(8)
        .rowsGap(10)
        .padding({ left: 16, right: 16 })
        .layoutWeight(1)
        .scrollBar(BarState.Off)
        .edgeEffect(EdgeEffect.Spring)
      }
      .width('100%')
      .height('100%')
      .linearGradient({ angle: 165, colors: [[Theme.skyTop, 0], [Theme.skyMid, 0.5], [Theme.skyBottom, 1]] })

      if (this.preview.length > 0) {
        Column() {
          Image(this.preview)
            .width('92%')
            .objectFit(ImageFit.Contain)
        }
        .width('100%')
        .height('100%')
        .justifyContent(FlexAlign.Center)
        .backgroundColor('rgba(0,0,0,0.88)')
        .onClick((): void => {
          this.preview = '';
        })
      }
    }
    .width('100%')
    .height('100%')
  }
}
