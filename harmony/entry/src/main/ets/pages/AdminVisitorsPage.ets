import { Api } from '../utils/api';
import { Nav, RouteParam, Routes } from '../utils/router';
import { Theme } from '../utils/theme';

class VisitorResp {
  ok: boolean = false;
  total: number = 0;
  today: number = 0;
  uniq: number = 0;
  labels: string[] = [];
  values: number[] = [];
}

/**
 * 访问统计：总量 / 今日 / 独立访客 + 近 7 天柱状。
 * 服务端字段随版本变化，这里全部做 Number 兜底，缺字段就显示 0 不报错。
 */
@Component
export struct AdminVisitorsPage {
  @Prop stack: NavPathStack;
  @State total: number = 0;
  @State today: number = 0;
  @State uniq: number = 0;
  @State labels: string[] = [];
  @State values: number[] = [];
  @State range: string = '7';
  @State loading: boolean = false;
  @State err: string = '';

  aboutToAppear(): void {
    this.load();
  }

  private load(): void {
    this.loading = true;
    Api.get<VisitorResp>('/api/admin/visitors?range=' + this.range).then((res: VisitorResp): void => {
      this.loading = false;
      if (!res || !res.ok) {
        this.err = '读取失败';
        return;
      }
      this.total = Number(res.total) || 0;
      this.today = Number(res.today) || 0;
      this.uniq = Number(res.uniq) || 0;
      this.labels = Array.isArray(res.labels) ? res.labels : [];
      this.values = Array.isArray(res.values) ? res.values : [];
      this.err = '';
    }).catch((): void => {
      this.loading = false;
      this.err = '网络异常';
    });
  }

  private maxValue(): number {
    let m = 1;
    for (let i = 0; i < this.values.length; i++) {
      const v = Number(this.values[i]) || 0;
      if (v > m) m = v;
    }
    return m;
  }

  build() {
    Column() {
      Row() {
        Text('‹')
          .fontSize(26)
          .fontColor(Theme.text)
          .width(36)
          .onClick((): void => {
            Nav.pop(this.stack);
          })
        Text('访问统计')
          .fontSize(15)
          .fontWeight(FontWeight.Medium)
          .fontColor(Theme.text)
        Blank()
        Text(this.range === '7' ? '近 7 天' : '近 30 天')
          .fontSize(13)
          .fontColor(Theme.goldDeep)
          .padding({ left: 10, right: 10, top: 5, bottom: 5 })
          .borderRadius(9)
          .backgroundColor(Theme.goldBg)
          .onClick((): void => {
            this.range = this.range === '7' ? '30' : '7';
            this.load();
          })
      }
      .width('100%')
      .height(44)
      .padding({ left: 8, right: 14 })

      Scroll() {
        Column({ space: 10 }) {
          Row({ space: 8 }) {
            this.statCard(String(this.total), '总访问')
            this.statCard(String(this.today), '今日')
            this.statCard(String(this.uniq), '独立访客')
          }
          .width('100%')

          Column({ space: 10 }) {
            Row() {
              Text('每日访问')
                .fontSize(14)
                .fontWeight(FontWeight.Medium)
                .fontColor(Theme.text)
              Blank()
              Text(this.labels.length > 0 ? this.labels[this.labels.length - 1] : '')
                .fontSize(11)
                .fontColor(Theme.faint)
            }
            .width('100%')

            if (this.values.length === 0) {
              Text('暂无趋势数据')
                .fontSize(12)
                .fontColor(Theme.faint)
                .width('100%')
                .textAlign(TextAlign.Center)
                .padding({ top: 20, bottom: 20 })
            } else {
              Row({ space: 4 }) {
                ForEach(this.values, (v: number, idx: number) => {
                  Column({ space: 3 }) {
                    Column()
                      .width('100%')
                      .height(Math.max(3, Math.round((Number(v) || 0) / this.maxValue() * 96)))
                      .borderRadius({ topLeft: 4, topRight: 4 })
                      .linearGradient({ angle: 180, colors: [['#C79A4B', 0], ['#E3C68C', 1]] })
                    Text(String(v))
                      .fontSize(9)
                      .fontColor(Theme.faint)
                  }
                  .layoutWeight(1)
                  .justifyContent(FlexAlign.End)
                  .height(120)
                  .alignItems(HorizontalAlign.Center)
                }, (v: number, idx: number) => String(idx))
              }
              .width('100%')
              .alignItems(VerticalAlign.Bottom)
            }
          }
          .width('100%')
          .alignItems(HorizontalAlign.Start)
          .padding(14)
          .borderRadius(Theme.radiusM)
          .backgroundColor(Theme.card)
          .border({ width: 1, color: Theme.lineSoft })

          if (this.loading) {
            Text('加载中…')
              .fontSize(12)
              .fontColor(Theme.faint)
              .width('100%')
              .textAlign(TextAlign.Center)
              .padding(12)
          }
          if (this.err.length > 0) {
            Text(this.err + ' · 点此重试')
              .fontSize(12)
              .fontColor(Theme.up)
              .width('100%')
              .textAlign(TextAlign.Center)
              .padding(12)
              .onClick((): void => {
                this.load();
              })
          }
          if (this.values.length === 0 && this.err.length === 0 && !this.loading) {
            Text('统计接口版本较旧时会缺少趋势字段，总量与今日仍以服务端返回为准。')
              .fontSize(11)
              .fontColor(Theme.faint)
              .lineHeight(17)
              .width('100%')
          }

          Column().height(30)
        }
        .width('100%')
        .padding({ left: 16, right: 16, top: 6 })
      }
      .edgeEffect(EdgeEffect.Spring)
      .scrollBar(BarState.Off)
      .layoutWeight(1)
    }
    .width('100%')
    .height('100%')
    .linearGradient({ angle: 165, colors: [[Theme.skyTop, 0], [Theme.skyMid, 0.5], [Theme.skyBottom, 1]] })
  }

  @Builder
  statCard(v: string, k: string) {
    Column({ space: 4 }) {
      Text(v)
        .fontSize(24)
        .fontWeight(FontWeight.Bold)
        .fontColor(Theme.goldDeep)
      Text(k)
        .fontSize(12)
        .fontColor(Theme.muted)
    }
    .layoutWeight(1)
    .height(88)
    .justifyContent(FlexAlign.Center)
    .borderRadius(Theme.radiusM)
    .backgroundColor(Theme.card)
    .border({ width: 1, color: Theme.lineSoft })
  }
}
