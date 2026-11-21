import { common } from '@kit.AbilityKit';
import { Catalog } from '../utils/catalog';
import { Clip } from '../utils/clip';
import { Config } from '../utils/config';
import { Links } from '../utils/link';
import { Nav, RouteParam, Routes } from '../utils/router';
import { Store } from '../utils/store';
import { Theme } from '../utils/theme';

@Component
export struct AboutPage {
  @Prop stack: NavPathStack;
  @StorageProp('cl_dataRev') @Watch('onStoreChange') dataRev: number = 0;

  @State totalCoins: number = 0;
  @State seriesCount: number = 0;
  @State descCount: number = 0;
  @State isAdmin: boolean = false;

  aboutToAppear(): void {
    this.render();
  }

  onStoreChange(): void {
    this.render();
  }

  private render(): void {
    this.totalCoins = Catalog.total();
    this.seriesCount = Catalog.seriesList.length;
    this.descCount = Catalog.coins.filter((c): boolean => !!c.desc).length;
    this.isAdmin = Store.getState().isAdmin;
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
      Text('关于藏币录')
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
  row(label: string, value: string, onTap: () => void) {
    Row() {
      Text(label)
        .fontSize(13)
        .fontColor(Theme.textStrong)
      Blank()
      if (value.length > 0) {
        Text(value)
          .fontSize(11)
          .fontColor(Theme.muted)
      }
      Text('›')
        .fontSize(17)
        .fontColor(Theme.faint)
        .margin({ left: 6 })
    }
    .width('100%')
    .height(46)
    .onClick((): void => {
      onTap();
    })
  }

  build() {
    Column() {
      this.header()
      Scroll() {
        Column({ space: 12 }) {
          Column({ space: 6 }) {
            Image($r('app.media.logo_seal'))
              .width(72)
              .height(72)
              .objectFit(ImageFit.Contain)
            Text('藏币录')
              .fontSize(22)
              .fontWeight(FontWeight.Bold)
              .fontColor(Theme.goldDeep)
            Text('中国纪念币图鉴与收藏账本')
              .fontSize(11)
              .fontColor(Theme.muted)
            Text('版本 ' + Config.APP_VERSION)
              .fontSize(10)
              .fontColor(Theme.faint)
          }
          .width('100%')
          .padding({ top: 20, bottom: 16 })
          .alignItems(HorizontalAlign.Center)

          Row() {
            this.stat(String(this.totalCoins), '个品种')
            this.stat(String(this.seriesCount), '个系列')
            this.stat(String(this.descCount), '份发行资料')
          }
          .width('100%')
          .padding({ top: 12, bottom: 12 })
          .borderRadius(14)
          .backgroundColor(Theme.card)

          Column({ space: 0 }) {
            this.row('隐私政策与用户协议', '', (): void => {
              Nav.push(this.stack, Routes.PRIVACY, new RouteParam());
            })
            Divider().color(Theme.lineSoft)
            this.row('查看网页版', Config.WEB_URL.replace('https://', ''), (): void => {
              const ctx = getContext(this) as common.UIAbilityContext;
              Links.open(ctx, Config.WEB_URL);
            })
            Divider().color(Theme.lineSoft)
            this.row('备案信息', '鲁ICP备2020034737号', (): void => {
              const ctx = getContext(this) as common.UIAbilityContext;
              Links.open(ctx, 'https://beian.miit.gov.cn/');
            })
            Divider().color(Theme.lineSoft)
            this.row('联系开发者', '微信号 virtualman2001', (): void => {
              Clip.copy('virtualman2001', '微信号已复制');
            })
          }
          .width('100%')
          .padding({ left: 14, right: 14 })
          .borderRadius(14)
          .backgroundColor(Theme.card)

          Column({ space: 8 }) {
            Text('数据说明')
              .fontSize(13)
              .fontWeight(FontWeight.Medium)
              .fontColor(Theme.text)
            Text('发行量、面额、图案取自中国人民银行公告与中国金币网；参考价与 AI 推理价均为公开参数估算，'
              + '只用于收藏管理参考，不是市场成交价，也不构成投资建议。')
              .fontSize(11)
              .fontColor(Theme.muted)
              .lineHeight(20)
            Text('贵金属纪念币目录来自中国金币集团公开数据，图片版权归原权利人所有，仅作展示。')
              .fontSize(11)
              .fontColor(Theme.muted)
              .lineHeight(20)
            Text('如发现数据错误，欢迎在「意见反馈」中指出，附上公告链接即可。')
              .fontSize(11)
              .fontColor(Theme.muted)
              .lineHeight(20)
          }
          .width('100%')
          .padding(14)
          .borderRadius(14)
          .backgroundColor(Theme.card)
          .alignItems(HorizontalAlign.Start)

          Text('Made for collectors · 2024—2026')
            .fontSize(10)
            .fontColor(Theme.faint)
            .width('100%')
            .textAlign(TextAlign.Center)
            .margin({ top: 6, bottom: 30 })
        }
        .width('100%')
        .padding({ left: 16, right: 16 })
      }
      .scrollBar(BarState.Off)
      .layoutWeight(1)
    }
    .width('100%')
    .height('100%')
    .backgroundColor(Theme.bg)
  }

  @Builder
  stat(v: string, k: string) {
    Column({ space: 3 }) {
      Text(v)
        .fontSize(16)
        .fontWeight(FontWeight.Medium)
        .fontColor(Theme.goldDeep)
      Text(k)
        .fontSize(9)
        .fontColor(Theme.faint)
    }
    .layoutWeight(1)
  }
}
