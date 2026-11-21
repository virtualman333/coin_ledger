import { Api } from '../utils/api';
import { Nav } from '../utils/router';
import { Theme } from '../utils/theme';

class FeedbackItem {
  id: string = '';
  text: string = '';
  status: string = '';
  createdAt: string = '';
  images: string[] = [];
  done: boolean = false;
  dateText: string = '';
}

class FeedbackList {
  ok: boolean = false;
  items: FeedbackItem[] = [];
}

@Component
export struct MyFeedbackPage {
  // NavPathStack 是框架原生对象：@Prop 会尝试深拷贝，运行时会 Cpp Crash
  stack: NavPathStack = new NavPathStack();
  @State items: FeedbackItem[] = [];
  @State loading: boolean = true;
  @State err: string = '';

  aboutToAppear(): void {
    this.load();
  }

  private load(): void {
    this.loading = true;
    this.err = '';
    Api.get<FeedbackList>('/api/feedback/mine').then((res: FeedbackList): void => {
      const out: FeedbackItem[] = [];
      const items = res.items || [];
      for (let i = 0; i < items.length; i++) {
        const it = items[i];
        const v = new FeedbackItem();
        v.id = String(it.id);
        v.text = it.text;
        v.status = it.status;
        v.done = it.status === 'done';
        v.dateText = String(it.createdAt || '').slice(0, 16).replace('T', ' ');
        v.images = (it.images || []).map((f: string): string => Api.imgUrl('/feedback/' + f));
        out.push(v);
      }
      this.items = out;
      this.loading = false;
    }).catch((): void => {
      this.loading = false;
      this.err = '加载失败，点此重试';
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
      Text('我的反馈')
        .fontSize(15)
        .fontWeight(FontWeight.Medium)
        .fontColor(Theme.text)
      Blank()
      Text('刷新')
        .fontSize(11)
        .fontColor(Theme.gold)
        .onClick((): void => {
          this.load();
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
        Column({ space: 10 }) {
          if (this.loading) {
            Text('加载中…')
              .fontSize(11)
              .fontColor(Theme.faint)
              .width('100%')
              .textAlign(TextAlign.Center)
              .padding(30)
          } else if (this.err.length > 0) {
            Text(this.err)
              .fontSize(12)
              .fontColor(Theme.up)
              .width('100%')
              .textAlign(TextAlign.Center)
              .padding(30)
              .onClick((): void => {
                this.load();
              })
          } else if (this.items.length === 0) {
            Text('还没有提交过反馈')
              .fontSize(11)
              .fontColor(Theme.faint)
              .width('100%')
              .textAlign(TextAlign.Center)
              .padding(30)
          }

          ForEach(this.items, (it: FeedbackItem) => {
            Column({ space: 8 }) {
              Row() {
                Text(it.dateText)
                  .fontSize(9)
                  .fontColor(Theme.faint)
                Blank()
                Text(it.done ? '已处理' : '处理中')
                  .fontSize(9)
                  .fontColor(it.done ? Theme.goldDeep : Theme.muted)
                  .padding({ left: 6, right: 6, top: 2, bottom: 2 })
                  .backgroundColor(it.done ? Theme.goldBg : '#F1EEE6')
                  .borderRadius(4)
              }
              .width('100%')
              Text(it.text)
                .fontSize(12)
                .fontColor(Theme.textStrong)
                .lineHeight(20)
              if (it.images.length > 0) {
                Row({ space: 6 }) {
                  ForEach(it.images, (url: string) => {
                    Image(url)
                      .width(60)
                      .height(60)
                      .borderRadius(6)
                      .objectFit(ImageFit.Cover)
                  }, (url: string) => url)
                }
              }
            }
            .width('100%')
            .padding(14)
            .borderRadius(14)
            .backgroundColor(Theme.glass)
            .backgroundBlurStyle(BlurStyle.COMPONENT_THICK)
            .border({ width: 1, color: Theme.glassBorder })
            .shadow({ radius: 24, color: 'rgba(120,90,40,0.08)', offsetY: 8 })
            .alignItems(HorizontalAlign.Start)
          }, (it: FeedbackItem) => it.id)

          Column().height(30)
        }
        .width('100%')
        .constraintSize({ minHeight: '100%' })
        .justifyContent(FlexAlign.Start)
        .padding({ left: 16, right: 16, top: 8 })
      }
      .scrollBar(BarState.Off)
      .layoutWeight(1)
    }
    .width('100%')
    .height('100%')
    .linearGradient({ angle: 165, colors: [[Theme.skyTop, 0], [Theme.skyMid, 0.5], [Theme.skyBottom, 1]] })
  }
}
