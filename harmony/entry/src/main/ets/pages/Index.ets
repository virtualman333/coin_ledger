import { common } from '@kit.AbilityKit';
import { promptAction, SymbolGlyphModifier } from '@kit.ArkUI';
import { AppTabBar } from '../components/TabBar';
import { HomeView } from '../views/HomeView';
import { PlanView } from '../views/PlanView';
import { ListView } from '../views/ListView';
import { MineView } from '../views/MineView';
import { DetailPage } from './DetailPage';
import { AccountPage } from './AccountPage';
import { HoldingsPage } from './HoldingsPage';
import { SeriesPage } from './SeriesPage';
import { SeriesDetailPage } from './SeriesDetailPage';
import { PmDetailPage } from './PmDetailPage';
import { PrivacyPage } from './PrivacyPage';
import { AboutPage } from './AboutPage';
import { MoreToolsPage } from './MoreToolsPage';
import { FeedbackPage } from './FeedbackPage';
import { MyFeedbackPage } from './MyFeedbackPage';
import { BackupPage } from './BackupPage';
import { CountPage } from './CountPage';
import { ProfilePage } from './ProfilePage';
import { PlazaPage } from './PlazaPage';
import { AdminPage } from './AdminPage';
import { Privacy } from '../utils/privacy';
import { Routes } from '../utils/router';
import { Store } from '../utils/store';
import { Theme } from '../utils/theme';

@Entry
@Component
struct Index {
  @State currentTab: number = 0;
  @State agreed: boolean = false;
  @State privacySheet: boolean = false;
  /** 其他页面请求切 tab（例如「去挑藏品」） */
  @StorageProp('cl_activeTab') @Watch('onTabSignal') tabSignal: number = 0;
  private stack: NavPathStack = new NavPathStack();

  aboutToAppear(): void {
    this.agreed = Privacy.agreed;
    if (this.agreed) {
      this.bootstrap();
    } else {
      this.privacySheet = true;
    }
  }

  /** 同意隐私政策后才初始化账号态、读缓存、联网同步 */
  private bootstrap(): void {
    const ctx = getContext(this) as common.UIAbilityContext;
    Store.init(ctx);
    Store.refresh().catch((): void => {
    });
  }

  onTabSignal(): void {
    if (this.tabSignal >= 0 && this.tabSignal <= 3) {
      this.currentTab = this.tabSignal;
    }
  }

  private switchTab(index: number): void {
    if (index < 0 || index > 3) return;
    this.currentTab = index;
  }

  private openLegal(): void {
    const ctx = getContext(this) as common.UIAbilityContext;
    ctx.openLink('https://coin.virtualman.top/legal.html').catch((): void => {
      promptAction.showToast({ message: '暂时无法打开，可在「我的 - 更多功能」查看', duration: 2000 });
    });
  }

  @Builder
  privacyDialog() {
    Stack() {
      // 遮罩：阻断下方所有交互
      Column()
        .width('100%')
        .height('100%')
        .backgroundColor('rgba(20,16,10,0.45)')
        .onClick((): void => {
        })

      Column({ space: 12 }) {
        Text('隐私政策与用户协议')
          .fontSize(18)
          .fontWeight(FontWeight.Bold)
          .fontColor(Theme.text)

        Text('欢迎使用藏币录。为了向你提供收藏记账、发行计划与图鉴服务，我们会在你同意本政策后处理以下信息：')
          .fontSize(13)
          .fontColor(Theme.muted)
          .lineHeight(21)

        Column({ space: 6 }) {
          Text('· 账号信息：用户名、昵称、头像（仅在你注册或登录时）')
            .fontSize(12)
            .fontColor(Theme.textStrong)
            .lineHeight(19)
          Text('· 收藏记录：你添加的品种、数量、成本、号码与照片')
            .fontSize(12)
            .fontColor(Theme.textStrong)
            .lineHeight(19)
          Text('· 设备与日志：网络请求记录、崩溃信息，用于保障服务与安全')
            .fontSize(12)
            .fontColor(Theme.textStrong)
            .lineHeight(19)
        }
        .alignItems(HorizontalAlign.Start)
        .width('100%')
        .padding(10)
        .borderRadius(8)
        .backgroundColor(Theme.bg)

        Text('我们不会收集你的位置、通讯录、短信与通话记录，也不会将上述信息出售给第三方。你可以随时在「我的 - 更多功能」中导出或清除你的数据。')
          .fontSize(12)
          .fontColor(Theme.muted)
          .lineHeight(19)

        Text('查看完整《隐私政策》《用户协议》')
          .fontSize(12)
          .fontColor(Theme.gold)
          .decoration({ type: TextDecorationType.Underline, color: Theme.gold })
          .onClick((): void => {
            this.openLegal();
          })

        Row({ space: 10 }) {
          Text('不同意并退出')
            .fontSize(14)
            .fontColor(Theme.muted)
            .textAlign(TextAlign.Center)
            .layoutWeight(1)
            .height(42)
            .borderRadius(8)
            .backgroundColor(Theme.bg)
            .onClick((): void => {
              const ctx = getContext(this) as common.UIAbilityContext;
              ctx.terminateSelf();
            })
          Text('同意并继续')
            .fontSize(14)
            .fontColor(Color.White)
            .textAlign(TextAlign.Center)
            .layoutWeight(1)
            .height(42)
            .borderRadius(8)
            .backgroundColor(Theme.gold)
            .onClick((): void => {
              Privacy.agree();
              this.agreed = true;
              this.privacySheet = false;
              this.bootstrap();
            })
        }
        .width('100%')
        .margin({ top: 4 })
      }
      .width('88%')
      .padding(22)
      .borderRadius(Theme.radiusL)
      .backgroundColor(Theme.card)
      .border({ width: 1, color: Theme.glassBorder })
      .shadow({ radius: 24, color: 'rgba(120,90,40,0.08)', offsetY: 8 })
      .shadow({ radius: 30, color: 'rgba(0,0,0,0.25)', offsetY: 10 })
    }
    .width('100%')
    .height('100%')
    .alignContent(Alignment.Center)
  }

  /** 官方 BottomTabBarStyle + 系统符号：图标与文字一起跟随系统选中色 */
  private tabStyle(normal: Resource, selected: Resource, text: string): BottomTabBarStyle {
    const sym: TabBarSymbol = {
      normal: new SymbolGlyphModifier(normal),
      selected: new SymbolGlyphModifier(selected)
    };
    return new BottomTabBarStyle(sym, text);
  }

  @Builder
  pageMap(name: string) {
    NavDestination() {
      if (name === Routes.DETAIL) {
        DetailPage({ stack: this.stack })
      } else if (name === Routes.ACCOUNT) {
        AccountPage({ stack: this.stack })
      } else if (name === Routes.HOLDINGS) {
        HoldingsPage({
          stack: this.stack,
          onSwitchTab: (index: number): void => this.switchTab(index)
        })
      } else if (name === Routes.SERIES) {
        SeriesPage({ stack: this.stack })
      } else if (name === Routes.SERIES_DETAIL) {
        SeriesDetailPage({ stack: this.stack })
      } else if (name === Routes.PM_DETAIL) {
        PmDetailPage({ stack: this.stack })
      } else if (name === Routes.PRIVACY) {
        PrivacyPage({ stack: this.stack })
      } else if (name === Routes.ABOUT) {
        AboutPage({ stack: this.stack })
      } else if (name === Routes.MORE_TOOLS) {
        MoreToolsPage({ stack: this.stack })
      } else if (name === Routes.FEEDBACK) {
        FeedbackPage({ stack: this.stack })
      } else if (name === Routes.MY_FEEDBACK) {
        MyFeedbackPage({ stack: this.stack })
      } else if (name === Routes.BACKUP) {
        BackupPage({ stack: this.stack })
      } else if (name === Routes.COUNT) {
        CountPage({ stack: this.stack })
      } else if (name === Routes.PROFILE) {
        ProfilePage({ stack: this.stack })
      } else if (name === Routes.PLAZA) {
        PlazaPage({ stack: this.stack })
      } else if (name === Routes.ADMIN) {
        AdminPage({ stack: this.stack })
      } else {
        Text('页面加载中')
          .fontSize(14)
          .fontColor(Theme.muted)
          .width('100%')
          .height('100%')
          .textAlign(TextAlign.Center)
      }
    }
    .hideTitleBar(true)
    .backgroundColor(Color.Transparent)
    // 不写尺寸时 NavDestination 会按内容自适应，出现「页面比屏幕窄、左侧露出下页」的残影
    .width('100%')
    .height('100%')
  }

  build() {
    Stack() {
      // 远景：暖白 → 米金 的三段渐变
      Column()
        .width('100%')
        .height('100%')
        .linearGradient({
          angle: 165,
          colors: [[Theme.skyTop, 0], [Theme.skyMid, 0.52], [Theme.skyBottom, 1]]
        })

      // 左上方主光源（暖金光斑，大半径模糊）
      Column()
        .width(320)
        .height(320)
        .borderRadius(160)
        .backgroundColor(Theme.glowWarm)
        .opacity(0.5)
        .blur(72)
        .position({ x: -110, y: -90 })

      // 右侧辅助光（更淡，形成景深）
      Column()
        .width(240)
        .height(240)
        .borderRadius(120)
        .backgroundColor(Theme.glowLight)
        .opacity(0.45)
        .blur(64)
        .position({ x: 250, y: 120 })

      if (this.agreed) {
        Navigation(this.stack) {
          Stack({ alignContent: Alignment.Bottom }) {
          Tabs({ barPosition: BarPosition.End, index: this.currentTab }) {
            TabContent() {
              HomeView({
                stack: this.stack,
                onSwitchTab: (index: number): void => this.switchTab(index)
              })
            }
            .tabBar(this.tabStyle($r('sys.symbol.house'), $r('sys.symbol.house_fill'), '首页'))

            TabContent() {
              PlanView({
                stack: this.stack,
                onSwitchTab: (index: number): void => this.switchTab(index)
              })
            }
            .tabBar(this.tabStyle($r('sys.symbol.calendar'), $r('sys.symbol.calendar_fill'), '计划'))

            TabContent() {
              ListView({
                stack: this.stack,
                onSwitchTab: (index: number): void => this.switchTab(index)
              })
            }
            .tabBar(this.tabStyle($r('sys.symbol.list_square'), $r('sys.symbol.list_square'), '清单'))

            TabContent() {
              MineView({
                stack: this.stack,
                onSwitchTab: (index: number): void => this.switchTab(index)
              })
            }
            .tabBar(this.tabStyle($r('sys.symbol.person'), $r('sys.symbol.person_fill'), '我的'))
          }
          .width('100%')
          .height('100%')
          // 隐藏系统 bar，改由浮动玻璃胶囊承担导航
          .barHeight(0)
          .scrollable(false)
          .animationDuration(220)
          .onChange((index: number): void => {
            this.currentTab = index;
          })

          Column() {
            AppTabBar({
              current: this.currentTab,
              onSelect: (index: number): void => this.switchTab(index)
            })
              .width('100%')
          }
          .width('100%')
          .padding({ left: 20, right: 20, bottom: 10 })
          .zIndex(2)
          }
          .width('100%')
          .height('100%')
        }
      .hideTitleBar(true)
      .mode(NavigationMode.Stack)
        .navDestination(this.pageMap)
        .width('100%')
        .height('100%')
      } else {
        Column()
          .width('100%')
          .height('100%')
          .backgroundColor(Color.Transparent)
      }

      if (this.privacySheet) {
        this.privacyDialog()
      }
    }
    .width('100%')
    .height('100%')
  }
}
