import { promptAction } from '@kit.ArkUI';
import { Api } from '../utils/api';
import { Catalog } from '../utils/catalog';
import { Nav, RouteParam, Routes } from '../utils/router';
import { Theme } from '../utils/theme';

class SeriesRow {
  key: string = '';
  name: string = '';
  count: number = 0;
  img: string = '';
}

/**
 * 系列管理：列出现有系列与品种数，支持删除（服务端会校验成员）。
 * 数据用内置 Catalog（随包更新），删除走 /api/admin/series/:key。
 */
@Component
export struct AdminSeriesPage {
  @Prop stack: NavPathStack;
  @State rows: SeriesRow[] = [];
  @State err: string = '';

  aboutToAppear(): void {
    this.load();
  }

  private load(): void {
    const out: SeriesRow[] = [];
    const keys = Object.keys(Catalog.sets);
    for (let i = 0; i < keys.length; i++) {
      const k = keys[i];
      const meta = Catalog.sets[k];
      if (!meta) continue;
      const r = new SeriesRow();
      r.key = k;
      r.name = meta.name || k;
      r.count = Catalog.coins.filter((c): boolean => c.set === k).length;
      out.push(r);
    }
    out.sort((a: SeriesRow, b: SeriesRow): number => b.count - a.count);
    this.rows = out;
    this.err = '';
  }

  private remove(row: SeriesRow): void {
    AlertDialog.show({
      title: '删除系列',
      message: '将删除「' + row.name + '」。若系列下还有品种，服务端会拒绝。',
      primaryButton: {
        value: '取消',
        action: (): void => {
        }
      },
      secondaryButton: {
        value: '删除',
        fontColor: Theme.up,
        action: (): void => {
          Api.del<Object>('/api/admin/series/' + encodeURIComponent(row.key)).then((): void => {
            promptAction.showToast({ message: '已删除', duration: 1400 });
            this.load();
          }).catch((e: Error): void => {
            promptAction.showToast({ message: e.message || '删除失败', duration: 1800 });
          });
        }
      }
    });
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
        Text('系列管理')
          .fontSize(15)
          .fontWeight(FontWeight.Medium)
          .fontColor(Theme.text)
        Blank()
        Text('刷新')
          .fontSize(13)
          .fontColor(Theme.goldDeep)
          .onClick((): void => {
            this.load();
          })
      }
      .width('100%')
      .height(44)
      .padding({ left: 8, right: 14 })

      Scroll() {
        Column({ space: 4 }) {
          Text('共 ' + this.rows.length + ' 个系列 · 按品种数排序')
            .fontSize(12)
            .fontColor(Theme.muted)
            .width('100%')
            .padding({ left: 4, top: 4, bottom: 6 })

          Column() {
            ForEach(this.rows, (r: SeriesRow) => {
              Row({ space: 12 }) {
                if (r.img.length > 0) {
                  Image(r.img)
                    .width(44)
                    .height(44)
                    .borderRadius(10)
                    .objectFit(ImageFit.Cover)
                    .backgroundColor('#F5F5F6')
                } else {
                  Text(r.name.slice(0, 1))
                    .width(44)
                    .height(44)
                    .borderRadius(10)
                    .textAlign(TextAlign.Center)
                    .fontSize(16)
                    .fontColor(Theme.goldDeep)
                    .backgroundColor(Theme.goldBg)
                }
                Column({ space: 2 }) {
                  Text(r.name)
                    .fontSize(14)
                    .fontColor(Theme.textStrong)
                    .maxLines(1)
                    .textOverflow({ overflow: TextOverflow.Ellipsis })
                  Text(r.count + ' 个品种 · ' + r.key)
                    .fontSize(11)
                    .fontColor(Theme.faint)
                    .maxLines(1)
                }
                .layoutWeight(1)
                .alignItems(HorizontalAlign.Start)

                Text('删除')
                  .fontSize(12)
                  .fontColor(Theme.up)
                  .padding({ left: 10, right: 10, top: 6, bottom: 6 })
                  .borderRadius(8)
                  .backgroundColor('#FDF0EE')
                  .onClick((): void => {
                    this.remove(r);
                  })
              }
              .width('100%')
              .padding({ top: 10, bottom: 10 })
            }, (r: SeriesRow) => r.key)
          }
          .width('100%')
          .padding({ left: 14, right: 14 })
          .borderRadius(Theme.radiusM)
          .backgroundColor(Theme.card)
          .border({ width: 1, color: Theme.lineSoft })

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
}
