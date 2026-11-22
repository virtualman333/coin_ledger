import { promptAction } from '@kit.ArkUI';
import { Api } from '../utils/api';
import { Nav, RouteParam, Routes } from '../utils/router';
import { Theme } from '../utils/theme';

class PmRow {
  no: number = 0;
  code: string = '';
  name: string = '';
  year: number = 0;
  status: string = '';
  thumb: string = '';
}

class PmStatusBody {
  status: string = '';
}

class PmListResp {
  ok: boolean = false;
  items: PmRow[] = [];
  total: number = 0;
}

/** 贵金属管理：列表 / 搜索 / 上架与下架切换 */
@Component
export struct AdminPmPage {
  @Prop stack: NavPathStack;
  @State all: PmRow[] = [];
  @State kw: string = '';
  @State loading: boolean = false;
  @State err: string = '';
  @State busyNo: number = 0;

  aboutToAppear(): void {
    this.load();
  }

  private load(): void {
    this.loading = true;
    Api.get<PmListResp>('/api/admin/pm').then((res: PmListResp): void => {
      this.loading = false;
      if (!res || !res.ok) {
        this.err = '读取失败';
        return;
      }
      const out: PmRow[] = [];
      for (let i = 0; i < res.items.length; i++) {
        const x = res.items[i];
        const r = new PmRow();
        r.no = Number(x.no) || 0;
        r.code = x.code || '';
        r.name = x.name || '';
        r.year = Number(x.year) || 0;
        r.status = x.status || '';
        r.thumb = x.thumb ? Api.imgUrl(x.thumb) : '';
        out.push(r);
      }
      this.all = out;
      this.err = '';
    }).catch((): void => {
      this.loading = false;
      this.err = '网络异常';
    });
  }

  private list(): PmRow[] {
    const k = this.kw.trim();
    if (k.length === 0) return this.all;
    return this.all.filter((r): boolean => r.name.indexOf(k) >= 0 || r.code.indexOf(k) >= 0);
  }

  private toggle(r: PmRow): void {
    if (this.busyNo > 0) return;
    this.busyNo = r.no;
    const next = r.status === 'published' ? 'draft' : 'published';
    const body = new PmStatusBody();
    body.status = next;
    Api.post<Object>('/api/admin/pm/' + r.no + '/status', body)
      .then((): void => {
        this.busyNo = 0;
        promptAction.showToast({ message: next === 'published' ? '已上架' : '已下架', duration: 1200 });
        this.load();
      }).catch((e: Error): void => {
        this.busyNo = 0;
        promptAction.showToast({ message: e.message || '操作失败', duration: 1600 });
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
        Text('贵金属管理')
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

      Row({ space: 8 }) {
        Text('⌕')
          .fontSize(14)
          .fontColor(Theme.faint)
        TextInput({ text: $$this.kw, placeholder: '搜名称 / 编号' })
          .layoutWeight(1)
          .height(40)
          .fontSize(13)
          .backgroundColor(Color.Transparent)
          .placeholderColor(Theme.faint)
          .onChange((v: string): void => {
            this.kw = v;
          })
      }
      .width('calc(100% - 32vp)')
      .padding({ left: 14, right: 14 })
      .margin({ left: 16, right: 16, top: 4 })
      .borderRadius(11)
      .backgroundColor(Theme.card)
      .border({ width: 1, color: Theme.lineSoft })

      Text('共 ' + this.all.length + ' 条 · 当前显示 ' + this.list().length + ' 条')
        .fontSize(12)
        .fontColor(Theme.muted)
        .width('100%')
        .padding({ left: 20, top: 8, bottom: 6 })

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

      List({ space: 0 }) {
        ForEach(this.list(), (r: PmRow) => {
          ListItem() {
            Row({ space: 12 }) {
              if (r.thumb.length > 0) {
                Image(r.thumb)
                  .width(56)
                  .height(56)
                  .borderRadius(9)
                  .objectFit(ImageFit.Contain)
                  .backgroundColor('#F5F5F6')
              } else {
                Text('¥')
                  .width(56)
                  .height(56)
                  .borderRadius(9)
                  .textAlign(TextAlign.Center)
                  .fontSize(18)
                  .fontColor(Theme.goldDeep)
                  .backgroundColor(Theme.goldBg)
              }
              Column({ space: 3 }) {
                Text(r.name)
                  .fontSize(13)
                  .fontColor(Theme.textStrong)
                  .maxLines(1)
                  .textOverflow({ overflow: TextOverflow.Ellipsis })
                Text(r.code + (r.year > 0 ? ' · ' + r.year : ''))
                  .fontSize(11)
                  .fontColor(Theme.faint)
              }
              .layoutWeight(1)
              .alignItems(HorizontalAlign.Start)

              Text(r.status === 'published' ? '下架' : '上架')
                .fontSize(12)
                .fontColor(r.status === 'published' ? Theme.muted : Theme.goldDeep)
                .padding({ left: 12, right: 12, top: 6, bottom: 6 })
                .borderRadius(8)
                .backgroundColor(r.status === 'published' ? '#F4F4F5' : Theme.goldBg)
                .onClick((): void => {
                  this.toggle(r);
                })
            }
            .width('100%')
            .padding({ left: 14, right: 14, top: 10, bottom: 10 })
          }
        }, (r: PmRow) => String(r.no))
      }
      .layoutWeight(1)
      .width('100%')
      .scrollBar(BarState.Off)
      .edgeEffect(EdgeEffect.Spring)
    }
    .width('100%')
    .height('100%')
    .linearGradient({ angle: 165, colors: [[Theme.skyTop, 0], [Theme.skyMid, 0.5], [Theme.skyBottom, 1]] })
  }
}
