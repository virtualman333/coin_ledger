import router from '@ohos.router';
import { Theme } from '../utils/theme';

/**
 * 启动页：暖白渐变 + 中心柔光 + 印章 + 品牌名，
 * 约 700ms 后淡出进入主界面。
 * 注意：Stack 子组件定位靠外层 alignContent，不能用 .align()（那是内容对齐）。
 */
@Entry
@Component
struct Splash {
  @State opacityValue: number = 1;

  aboutToAppear(): void {
    setTimeout((): void => {
      animateTo({ duration: 260, curve: Curve.EaseOut }, (): void => {
        this.opacityValue = 0;
      });
      setTimeout((): void => {
        router.replaceUrl({ url: 'pages/Index' });
      }, 280);
    }, 620);
  }

  build() {
    Stack() {
      // 底色
      Column()
        .width('100%')
        .height('100%')
        .linearGradient({
          angle: 165,
          colors: [[Theme.skyTop, 0], [Theme.skyMid, 0.52], [Theme.skyBottom, 1]]
        })

      // 中心柔光（克制一点，别糊成一团奶油）
      Column()
        .width(260)
        .height(260)
        .borderRadius(130)
        .backgroundColor('#F7E9CE')
        .opacity(0.24)
        .blur(96)

      // 主内容：居中
      Stack({ alignContent: Alignment.Center }) {
        Column({ space: 14 }) {
          Image($r('app.media.logo_seal'))
            .width(76)
            .height(76)
            .borderRadius(20)
            .border({ width: 3, color: '#FFFFFFE6' })
            .shadow({ radius: 20, color: 'rgba(120,90,40,0.16)', offsetY: 8 })

          Column({ space: 6 }) {
            Text('藏币录')
              .fontSize(30)
              .fontWeight(FontWeight.Bold)
              .fontColor(Theme.goldDeep)
              .letterSpacing(4)
            Text('中国纪念币图鉴 · 收藏账本')
              .fontSize(13)
              .fontColor(Theme.muted)
              .letterSpacing(1)
          }
          .alignItems(HorizontalAlign.Center)
          .margin({ top: 4 })

          Column()
            .width(34)
            .height(3)
            .borderRadius(2)
            .linearGradient({ angle: 90, colors: [['#C79A4B', 0], ['#9A6B1F', 1]] })
            .margin({ top: 8 })
        }
        .alignItems(HorizontalAlign.Center)
        .translate({ y: -24 })
      }
      .width('100%')
      .height('100%')

      // 底部免责说明：贴底单独一层
      Stack({ alignContent: Alignment.Bottom }) {
        Column({ space: 5 }) {
          Text('中国人民银行发行 · 价格均为参考估算')
            .fontSize(12)
            .fontColor(Theme.faint)
          Text('不构成投资建议')
            .fontSize(12)
            .fontColor(Theme.faint)
        }
        .width('100%')
        .alignItems(HorizontalAlign.Center)
        .padding({ bottom: 44 })
      }
      .width('100%')
      .height('100%')
    }
    .width('100%')
    .height('100%')
    .opacity(this.opacityValue)
    .backgroundColor(Theme.bg)
  }
}
