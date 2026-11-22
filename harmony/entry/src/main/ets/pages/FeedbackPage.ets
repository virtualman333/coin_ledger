import { promptAction } from '@kit.ArkUI';
import { Api } from '../utils/api';
import { Catalog } from '../utils/catalog';
import { ImagePicker } from '../utils/image';
import { Nav, RouteParam, Routes } from '../utils/router';
import { Store } from '../utils/store';
import { Theme } from '../utils/theme';
import { Coin } from '../model/types';

class FeedbackBody {
  coinId: number = 0;
  text: string = '';
  images: string[] = [];

  constructor(coinId: number, text: string, images: string[]) {
    this.coinId = coinId;
    this.text = text;
    this.images = images;
  }
}

class SimpleOk {
  ok: boolean = false;
  error: string = '';
}

@Component
export struct FeedbackPage {
  // NavPathStack 是框架原生对象：@Prop 会尝试深拷贝，运行时会 Cpp Crash
  stack: NavPathStack = new NavPathStack();
  @State coinId: number = 0;
  @State coinName: string = '';
  @State text: string = '';
  @State images: string[] = [];
  @State busy: boolean = false;

  aboutToAppear(): void {
    const p = Nav.take(this.stack, Routes.FEEDBACK);
    this.coinId = p.id;
    if (p.id > 0) {
      const coin: Coin | undefined = Catalog.byId[String(p.id)];
      this.coinName = coin !== undefined ? coin.name : '';
    }
  }

  private addImage(): void {
    const left = 3 - this.images.length;
    if (left <= 0) {
      promptAction.showToast({ message: '最多 3 张', duration: 1500 });
      return;
    }
    ImagePicker.pick(left, 1400, 78).then((urls: string[]): void => {
      if (urls.length === 0) return;
      this.images = this.images.concat(urls).slice(0, 3);
    }).catch((): void => {
      promptAction.showToast({ message: '选图失败，请重试', duration: 1600 });
    });
  }

  private submit(): void {
    if (this.busy) return;
    if (!Store.isLogin()) {
      promptAction.showToast({ message: '登录后才能提交反馈', duration: 1600 });
      Nav.push(this.stack, Routes.ACCOUNT, new RouteParam());
      return;
    }
    const text = this.text.trim();
    if (text.length < 4) {
      promptAction.showToast({ message: '写清楚一点（至少 4 字）', duration: 1600 });
      return;
    }
    this.busy = true;
    Api.post<SimpleOk>('/api/feedback', new FeedbackBody(this.coinId, text, this.images)).then((): void => {
      this.busy = false;
      this.text = '';
      this.images = [];
      promptAction.showToast({ message: '已提交，感谢', duration: 1500 });
      setTimeout((): void => {
        Nav.pop(this.stack);
      }, 600);
    }).catch((e: Error): void => {
      this.busy = false;
      AlertDialog.show({
        title: '提交失败',
        message: e.message || '请稍后重试',
        confirm: {
          value: '知道了',
          action: (): void => {
          }
        }
      });
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
      Text('意见反馈')
        .fontSize(15)
        .fontWeight(FontWeight.Medium)
        .fontColor(Theme.text)
      Blank()
      Text('我的反馈')
        .fontSize(11)
        .fontColor(Theme.gold)
        .onClick((): void => {
          Nav.push(this.stack, Routes.MY_FEEDBACK, new RouteParam());
        })
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
          if (this.coinName.length > 0) {
            Row({ space: 6 }) {
              Text('关于')
                .fontSize(10)
                .fontColor(Theme.faint)
              Text(this.coinName)
                .fontSize(11)
                .fontColor(Theme.goldDeep)
                .maxLines(1)
                .textOverflow({ overflow: TextOverflow.Ellipsis })
            }
            .justifyContent(FlexAlign.Start)
            .width('100%')
            .padding(10)
            .borderRadius(8)
            .backgroundColor(Theme.goldBg)
          }

          Column({ space: 8 }) {
            Text('哪里有问题？')
              .fontSize(13)
              .fontWeight(FontWeight.Medium)
              .fontColor(Theme.text)
            TextArea({ text: $$this.text, placeholder: '例如：发行量写错了，应为 2 亿枚（附公告链接）；或希望增加筛选条件…' })
              .height(150)
              .fontSize(12)
              .backgroundColor(Theme.bg)
              .borderRadius(8)
              .padding(10)
              .maxLength(500)
            Text(this.text.length + ' / 500')
              .fontSize(9)
              .fontColor(Theme.faint)
              .width('100%')
              .textAlign(TextAlign.End)
          }
          .width('100%')
          .padding(14)
          .borderRadius(14)
          .backgroundColor(Theme.glass)
          .border({ width: 1, color: Theme.glassBorder })
          .shadow({ radius: 14, color: 'rgba(0,0,0,0.05)', offsetY: 8 })
          .alignItems(HorizontalAlign.Start)

          Column({ space: 8 }) {
            Text('截图（选填，最多 3 张）')
              .fontSize(12)
              .fontColor(Theme.muted)
            Row({ space: 8 }) {
              ForEach(this.images, (url: string, index: number) => {
                Stack({ alignContent: Alignment.TopEnd }) {
                  Image(url)
                    .width(72)
                    .height(72)
                    .borderRadius(8)
                    .objectFit(ImageFit.Cover)
                  Text('×')
                    .fontSize(12)
                    .fontColor(Color.White)
                    .width(20)
                    .height(20)
                    .textAlign(TextAlign.Center)
                    .borderRadius(10)
                    .backgroundColor('rgba(0,0,0,0.55)')
                    .onClick((): void => {
                      const next: string[] = [];
                      for (let i = 0; i < this.images.length; i++) {
                        if (i !== index) next.push(this.images[i]);
                      }
                      this.images = next;
                    })
                }
                .width(72)
                .height(72)
              }, (url: string, index: number) => String(index))
              if (this.images.length < 3) {
                Text('+')
                  .fontSize(22)
                  .fontColor(Theme.faint)
                  .width(72)
                  .height(72)
                  .textAlign(TextAlign.Center)
                  .borderRadius(8)
                  .backgroundColor(Theme.bg)
                  .onClick((): void => {
                    this.addImage();
                  })
              }
            }
            .width('100%')
          }
          .width('100%')
          .padding(14)
          .borderRadius(14)
          .backgroundColor(Theme.glass)
          .border({ width: 1, color: Theme.glassBorder })
          .shadow({ radius: 14, color: 'rgba(0,0,0,0.05)', offsetY: 8 })
          .alignItems(HorizontalAlign.Start)

          Text(this.busy ? '提交中…' : '提交反馈')
            .fontSize(14)
            .fontColor(Color.White)
            .textAlign(TextAlign.Center)
            .width('100%')
            .height(44)
            .borderRadius(8)
            .backgroundColor(this.busy ? '#C9BFA9' : Theme.gold)
            .onClick((): void => {
              this.submit();
            })

          Text('提交后可在「我的反馈」查看处理进度；涉及数据纠错请附公告链接，方便核对。')
            .fontSize(10)
            .fontColor(Theme.faint)
            .lineHeight(17)
            .width('100%')

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
