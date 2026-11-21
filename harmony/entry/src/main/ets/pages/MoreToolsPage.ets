import { promptAction } from '@kit.ArkUI';
import { Config } from '../utils/config';
import { Nav, RouteParam, Routes } from '../utils/router';
import { Store } from '../utils/store';
import { Theme } from '../utils/theme';

class ToolRow {
  label: string = '';
  hint: string = '';
  route: string = '';
  icon: string = '';
  symbol: Resource = $r('sys.symbol.info_circle');

  constructor(label: string, hint: string, route: string, icon: string, symbol: Resource) {
    this.label = label;
    this.hint = hint;
    this.route = route;
    this.icon = icon;
    this.symbol = symbol;
  }
}

@Component
export struct MoreToolsPage {
  // NavPathStack 是框架原生对象：@Prop 会尝试深拷贝，运行时会 Cpp Crash
  stack: NavPathStack = new NavPathStack();
  @StorageProp('cl_dataRev') @Watch('onStoreChange') dataRev: number = 0;

  @State loggedIn: boolean = false;
  @State isAdmin: boolean = false;
  @State displayName: string = '';
  @State tools: ToolRow[] = [];
  @State plaza: ToolRow[] = [];
  @State aboutRows: ToolRow[] = [];

  aboutToAppear(): void {
    this.tools = [
      new ToolRow('拍照数币', '一张照片数清多少枚', Routes.COUNT, '', $r('sys.symbol.camera')),
      new ToolRow('收藏备份', '导出 CSV / 导入恢复', Routes.BACKUP, '', $r('sys.symbol.arrow_clockwise')),
      new ToolRow('意见反馈', '数据纠错与功能建议', Routes.FEEDBACK, '', $r('sys.symbol.doc_text')),
      new ToolRow('我的反馈', '查看处理进度', Routes.MY_FEEDBACK, '', $r('sys.symbol.list_bullet'))
    ];
    this.plaza = [
      new ToolRow('按系列浏览', '20 个系列分组', Routes.SERIES, '', $r('sys.symbol.square_grid_2x2'))
    ];
    this.aboutRows = [
      new ToolRow('关于藏币录', '版本 ' + Config.APP_VERSION, Routes.ABOUT, '', $r('sys.symbol.info_circle')),
      new ToolRow('隐私政策与用户协议', '', Routes.PRIVACY, '', $r('sys.symbol.lock'))
    ];
    this.render();
  }

  onStoreChange(): void {
    this.render();
  }

  private render(): void {
    const s = Store.getState();
    this.loggedIn = s.user !== null;
    this.isAdmin = s.isAdmin;
    this.displayName = s.user !== null ? (s.user.nickname || s.user.name) : '';
  }

  private go(route: string): void {
    if (route === Routes.BACKUP && !this.loggedIn) {
      promptAction.showToast({ message: '登录后才能备份收藏', duration: 1600 });
      return;
    }
    Nav.push(this.stack, route, new RouteParam());
  }

  private logout(): void {
    AlertDialog.show({
      title: '退出登录',
      message: '退出后需要重新登录才能查看藏品。',
      primaryButton: {
        value: '取消',
        action: (): void => {
        }
      },
      secondaryButton: {
        value: '退出',
        fontColor: Theme.up,
        action: (): void => {
          Store.logout().then((): void => {
            this.render();
            promptAction.showToast({ message: '已退出', duration: 1400 });
          });
        }
      }
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
      Text('更多功能')
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
  row(item: ToolRow) {
    Row({ space: 10 }) {
      SymbolGlyph(item.symbol)
        .fontSize(16)
        .fontColor([Theme.goldDeep])
        .width(32)
        .height(32)
        .borderRadius(10)
        .backgroundColor(Theme.goldBg)
      Column({ space: 2 }) {
        Text(item.label)
          .fontSize(13)
          .fontColor(Theme.textStrong)
        if (item.hint.length > 0) {
          Text(item.hint)
            .fontSize(9)
            .fontColor(Theme.faint)
        }
      }
      .layoutWeight(1)
      .alignItems(HorizontalAlign.Start)
      Text('›')
        .fontSize(17)
        .fontColor(Theme.faint)
    }
    .width('100%')
    .height(52)
    .onClick((): void => {
      this.go(item.route);
    })
  }

  @Builder
  group(rows: ToolRow[]) {
    Column() {
      ForEach(rows, (item: ToolRow, index: number) => {
        Column() {
          this.row(item)
          if (index < rows.length - 1) {
            Divider().color(Theme.lineSoft).margin({ left: 42 })
          }
        }
      }, (item: ToolRow) => item.route)
    }
    .width('100%')
    .padding({ left: 12, right: 12 })
    .borderRadius(14)
    .backgroundColor(Theme.glass)
    .backgroundBlurStyle(BlurStyle.COMPONENT_THICK)
    .border({ width: 1, color: Theme.glassBorder })
    .shadow({ radius: 24, color: 'rgba(120,90,40,0.08)', offsetY: 8 })
  }

  build() {
    Column() {
      this.header()
      Scroll() {
        Column({ space: 12 }) {
          Row({ space: 10 }) {
            Text(this.loggedIn ? (this.displayName.length > 0 ? this.displayName.slice(0, 1) : '藏') : '未')
              .fontSize(17)
              .fontColor(Theme.goldDeep)
              .width(44)
              .height(44)
              .textAlign(TextAlign.Center)
              .borderRadius(22)
              .backgroundColor(Theme.goldBg)
            Column({ space: 3 }) {
              Text(this.loggedIn ? this.displayName : '未登录')
                .fontSize(15)
                .fontWeight(FontWeight.Medium)
                .fontColor(Theme.text)
              Text(this.loggedIn ? (this.isAdmin ? '管理员账号' : '已登录 · 藏品云端同步') : '登录后可备份与同步藏品')
                .fontSize(10)
                .fontColor(Theme.muted)
            }
            .layoutWeight(1)
            .alignItems(HorizontalAlign.Start)
            if (!this.loggedIn) {
              Text('登录')
                .fontSize(12)
                .fontColor(Color.White)
                .padding({ left: 14, right: 14, top: 6, bottom: 6 })
                .borderRadius(14)
                .backgroundColor(Theme.gold)
                .onClick((): void => {
                  Nav.push(this.stack, Routes.ACCOUNT, new RouteParam());
                })
            }
          }
          .justifyContent(FlexAlign.Start)
          .width('100%')
          .padding(14)
          .borderRadius(14)
          .backgroundColor(Theme.glass)
          .backgroundBlurStyle(BlurStyle.COMPONENT_THICK)
          .border({ width: 1, color: Theme.glassBorder })
          .shadow({ radius: 24, color: 'rgba(120,90,40,0.08)', offsetY: 8 })
          .alignItems(VerticalAlign.Center)

          this.group(this.tools)
          this.group(this.plaza)
          this.group(this.aboutRows)

          if (this.isAdmin) {
            Row({ space: 10 }) {
              Text('管')
                .fontSize(14)
                .fontColor(Color.White)
                .width(32)
                .height(32)
                .textAlign(TextAlign.Center)
                .borderRadius(10)
                .backgroundColor(Theme.gold)
              Column({ space: 2 }) {
                Text('管理后台')
                  .fontSize(13)
                  .fontColor(Theme.textStrong)
                Text('品种 / 计划 / 系列 / 用户')
                  .fontSize(9)
                  .fontColor(Theme.faint)
              }
              .layoutWeight(1)
              .alignItems(HorizontalAlign.Start)
              Text('›')
                .fontSize(17)
                .fontColor(Theme.faint)
            }
            .width('100%')
            .height(56)
            .padding({ left: 12, right: 12 })
            .borderRadius(14)
            .backgroundColor(Theme.glass)
            .backgroundBlurStyle(BlurStyle.COMPONENT_THICK)
            .border({ width: 1, color: Theme.glassBorder })
            .shadow({ radius: 24, color: 'rgba(120,90,40,0.08)', offsetY: 8 })
            .onClick((): void => {
              Nav.push(this.stack, Routes.ADMIN, new RouteParam());
            })
          }

          if (this.loggedIn) {
            Text('退出登录')
              .fontSize(13)
              .fontColor(Theme.up)
              .textAlign(TextAlign.Center)
              .width('100%')
              .height(44)
              .borderRadius(12)
              .backgroundColor(Theme.card)
              .onClick((): void => {
                this.logout();
              })
          }

          Text('藏币录 ' + Config.APP_VERSION + ' · 鲁ICP备2020034737号')
            .fontSize(9)
            .fontColor(Theme.faint)
            .width('100%')
            .textAlign(TextAlign.Center)
            .margin({ top: 6, bottom: 30 })
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
