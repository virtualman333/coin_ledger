import { promptAction } from '@kit.ArkUI';
import { Api } from '../utils/api';
import { ImagePicker } from '../utils/image';
import { Nav, RouteParam, Routes } from '../utils/router';
import { Store } from '../utils/store';
import { Theme } from '../utils/theme';

class CountBody {
  image: string = '';

  constructor(image: string) {
    this.image = image;
  }
}

class CountResult {
  ok: boolean = false;
  count: number = 0;
  marked: string = '';
  width: number = 0;
  height: number = 0;
  ms: number = 0;
  error: string = '';
}

@Component
export struct CountPage {
  // NavPathStack 是框架原生对象：@Prop 会尝试深拷贝，运行时会 Cpp Crash
  stack: NavPathStack = new NavPathStack();
  @State image: string = '';
  @State marked: string = '';
  @State count: number = 0;
  @State busy: boolean = false;
  @State err: string = '';
  @State ms: number = 0;
  @State logged: boolean = false;

  aboutToAppear(): void {
    this.logged = Store.isLogin();
  }

  private pick(): void {
    if (!Store.isLogin()) {
      promptAction.showToast({ message: '登录后才能使用拍照数币', duration: 1600 });
      Nav.push(this.stack, Routes.ACCOUNT, new RouteParam());
      return;
    }
    if (this.busy) return;
    ImagePicker.pick(1, 1600, 85).then((urls: string[]): void => {
      if (urls.length === 0) return;
      this.image = urls[0];
      this.run(urls[0]);
    }).catch((): void => {
      promptAction.showToast({ message: '选图失败，请重试', duration: 1600 });
    });
  }

  private run(dataUrl: string): void {
    this.busy = true;
    this.err = '';
    this.marked = '';
    Api.post<CountResult>('/api/coin-count', new CountBody(dataUrl)).then((res: CountResult): void => {
      this.busy = false;
      if (!res || !res.ok) {
        this.err = res && res.error ? res.error : '识别失败，换一张清晰的照片';
        return;
      }
      this.count = res.count;
      this.ms = res.ms;
      this.marked = res.marked ? Api.imgUrl(res.marked) : '';
    }).catch((e: Error): void => {
      this.busy = false;
      this.err = e.message || '识别失败，请稍后重试';
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
      Text('拍照数币')
        .fontSize(15)
        .fontWeight(FontWeight.Medium)
        .fontColor(Theme.text)
      Blank()
    }
    .width('100%')
    .height(44)
    .padding({ left: 8, right: 14 })
  }

  build() {
    Column() {
      this.header()
      Scroll() {
        Column({ space: 12 }) {
          Column({ space: 6 }) {
            Text('一桌硬币，拍一张就数清')
              .fontSize(20)
              .fontWeight(FontWeight.Bold)
              .fontColor(Theme.text)
            Text('纯本地图像算法只数圆形亮斑的个数，不识别币种、不上传人脸；照片仅用于本次计数与标注图生成。')
              .fontSize(11)
              .fontColor(Theme.muted)
              .lineHeight(19)
          }
          .justifyContent(FlexAlign.Start)
          .width('100%')
          .alignItems(HorizontalAlign.Start)

          if (this.image.length > 0) {
            Image(this.marked.length > 0 ? this.marked : this.image)
              .width('100%')
              .height(280)
              .objectFit(ImageFit.Contain)
              .borderRadius(12)
              .backgroundColor('#F4F4F5')
          } else {
            Column({ space: 8 }) {
              Text('◎')
                .fontSize(40)
                .fontColor(Theme.gold)
              Text('点下面按钮选择一张硬币照片')
                .fontSize(11)
                .fontColor(Theme.faint)
            }
            .width('100%')
            .height(240)
            .justifyContent(FlexAlign.Center)
            .borderRadius(12)
            .backgroundColor(Theme.card)
            .border({ width: 1, color: Theme.lineSoft })
          }

          if (this.busy) {
            Text('识别中…')
              .fontSize(12)
              .fontColor(Theme.gold)
              .width('100%')
              .textAlign(TextAlign.Center)
          } else if (this.err.length > 0) {
            Text(this.err)
              .fontSize(11)
              .fontColor(Theme.up)
              .width('100%')
              .textAlign(TextAlign.Center)
              .onClick((): void => {
                if (this.image.length > 0) this.run(this.image);
              })
          } else if (this.count > 0) {
            Column({ space: 4 }) {
              Text('一共数出')
                .fontSize(11)
                .fontColor(Theme.muted)
              Row() {
                Text(String(this.count))
                  .fontSize(40)
                  .fontWeight(FontWeight.Bold)
                  .fontColor(Theme.goldDeep)
                Text(' 枚')
                  .fontSize(13)
                  .fontColor(Theme.muted)
                  .margin({ bottom: 8 })
              }
              .alignItems(VerticalAlign.Bottom)
              Text('用时 ' + this.ms + ' ms · 圈选结果见上图，可点「重新选图」再数一次')
                .fontSize(9)
                .fontColor(Theme.faint)
            }
            .width('100%')
            .padding(16)
            .borderRadius(14)
            .backgroundColor(Theme.goldBg)
          }

          Text(this.image.length > 0 ? '重新选图' : '选择硬币照片')
            .fontSize(14)
            .fontColor(Color.White)
            .textAlign(TextAlign.Center)
            .width('100%')
            .height(46)
            .borderRadius(8)
            .backgroundColor(this.busy ? '#C9BFA9' : Theme.gold)
            .onClick((): void => {
              this.pick();
            })

          Column({ space: 5 }) {
            Text('拍摄建议')
              .fontSize(12)
              .fontWeight(FontWeight.Medium)
              .fontColor(Theme.text)
            Text('· 硬币平铺、互不重叠，浅色桌面对比更明显；\n'
              + '· 光线均匀，避免强反光与长阴影；\n'
              + '· 一次不超过 200 枚，太多会粘连漏数。')
              .fontSize(10)
              .fontColor(Theme.muted)
              .lineHeight(19)
          }
          .width('100%')
          .padding(14)
          .borderRadius(12)
          .backgroundColor(Theme.glass)
          .border({ width: 1, color: Theme.glassBorder })
          .shadow({ radius: 14, color: 'rgba(0,0,0,0.05)', offsetY: 8 })
          .alignItems(HorizontalAlign.Start)

          Column().height(30)
        }
        .width('100%')
        .constraintSize({ minHeight: '100%' })
        .justifyContent(FlexAlign.Start)
        .padding({ left: 16, right: 16, top: 8 })
      }
      .edgeEffect(EdgeEffect.Spring)
      .scrollBar(BarState.Off)
      .layoutWeight(1)
    }
    .width('100%')
    .height('100%')
    .linearGradient({ angle: 165, colors: [[Theme.skyTop, 0], [Theme.skyMid, 0.5], [Theme.skyBottom, 1]] })
  }
}
