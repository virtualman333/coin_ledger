import { common } from '@kit.AbilityKit';
import { Clip } from '../utils/clip';
import { Config } from '../utils/config';
import { Links } from '../utils/link';
import { Nav } from '../utils/router';
import { Theme } from '../utils/theme';

class Section {
  title: string = '';
  body: string = '';
}

@Component
export struct PrivacyPage {
  @Prop stack: NavPathStack;
  @State sections: Section[] = [];

  aboutToAppear(): void {
    this.sections = this.buildSections();
  }

  private sec(title: string, body: string): Section {
    const s = new Section();
    s.title = title;
    s.body = body;
    return s;
  }

  private buildSections(): Section[] {
    return [
      this.sec('一、我们收集哪些信息',
        '1. 账号信息：用户名、密码（仅保存加密后的结果）、昵称、头像。用于登录与区分账号。\n'
          + '2. 收藏记录：你主动添加的品种、数量、成本、市值、冠号、藏品照片。用于生成账本与统计。\n'
          + '3. 设备与日志：网络请求时间、接口路径、错误码、设备型号与系统版本。用于排障、防刷与安全审计。\n'
          + '4. 反馈内容：你提交的意见与截图。用于跟进问题。\n'
          + '我们不会收集你的位置、通讯录、短信、通话记录、剪贴板内容与应用列表。'),
      this.sec('二、信息如何使用',
        '上述信息只用于提供藏币录的核心功能：登录、记录与展示藏品、计算面值与参考估值、展示发行计划、'
          + '处理反馈与保障服务安全。不会用于广告定向投放，不会出售或出租给任何第三方。'),
      this.sec('三、权限与设备能力',
        '· 网络权限（ohos.permission.INTERNET）：加载图鉴、同步账本与发行计划，是唯一常驻权限。\n'
          + '· 相册/文件：只有你主动点「选择图片」「导出备份」「导入备份」时，才会通过系统选择器读取你指定的那一张图片或文件，'
          + '应用不会在后台扫描相册与文件。\n'
          + '· 拍照：只有你主动点「拍照数币」并选择相机时才会调用。'),
      this.sec('四、第三方共享',
        '本应用不接入第三方广告、统计或画像 SDK。以下情形会涉及第三方：\n'
          + '· 华为应用市场：下载与更新分发，按华为的隐私政策处理。\n'
          + '· 系统分享/剪贴板：只有你主动点「复制链接」或系统分享时，内容才离开本应用。\n'
          + '贵金属图片来自中国金币集团公开 CDN，仅加载图片，不传递你的账号信息。'),
      this.sec('五、存储与保护',
        '账号与账本存放在位于中国境内的服务器，通过 HTTPS 传输；口令使用加盐哈希存储，会话使用签名令牌。'
          + '本机只缓存最近一次同步结果，用于秒开；退出登录会清除本机缓存与令牌。'),
      this.sec('六、你的权利',
        '你可以随时：查看与修改账号资料；导出全部收藏为 CSV；删除单条藏品或整个账号；撤回隐私同意并退出应用。'
          + '如需注销账号或导出全部个人数据，可通过「意见反馈」提交，我们会在 15 个工作日内处理。'),
      this.sec('七、未成年人',
        '本应用面向收藏爱好者，不针对未成年人设计。若你是未满 14 周岁的未成年人，请在监护人陪同下阅读本政策并使用。'),
      this.sec('八、政策更新与联系',
        '政策发生重大变化时，会在应用内弹窗提示并重新征得同意。\n'
          + '开发者：virtualman\n联系方式：微信号 virtualman2001\n'
          + '备案号：鲁ICP备2020034737号'),
      this.sec('附：用户协议要点',
        '1. 藏币录提供图鉴、记账与发行计划参考，价格与估值为公开参数推算，不构成投资建议，也不对交易结果负责。\n'
          + '2. 账号仅限本人使用，禁止利用本服务批量抓取数据、发布违法或侵权内容。\n'
          + '3. 你在广场发布的晒单内容需保证真实、合法，不含他人隐私；违规内容可被下架。\n'
          + '4. 因不可抗力、网络故障导致的服务中断，我们会尽力恢复，但不承担由此产生的间接损失。')
    ];
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
      Text('隐私政策与用户协议')
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
        Column({ space: 10 }) {
          Column({ space: 4 }) {
            Text('藏币录隐私政策')
              .fontSize(21)
              .fontWeight(FontWeight.Bold)
              .fontColor(Theme.text)
            Text('生效日期：2026 年 1 月 1 日 · 版本 v1')
              .fontSize(10)
              .fontColor(Theme.faint)
            Text('我们只收集提供服务所必需的信息。未同意本政策前，应用不会联网、不会读取账号与账本缓存。')
              .fontSize(11)
              .fontColor(Theme.muted)
              .lineHeight(19)
              .margin({ top: 6 })
          }
          .width('100%')
          .alignItems(HorizontalAlign.Start)

          ForEach(this.sections, (s: Section) => {
            Column({ space: 6 }) {
              Text(s.title)
                .fontSize(13)
                .fontWeight(FontWeight.Medium)
                .fontColor(Theme.text)
              Text(s.body)
                .fontSize(11)
                .fontColor('#5A5A5A')
                .lineHeight(20)
            }
            .width('100%')
            .padding(14)
            .borderRadius(12)
            .backgroundColor(Theme.card)
            .alignItems(HorizontalAlign.Start)
          }, (s: Section) => s.title)

          Row({ space: 10 }) {
            Text('查看网页版')
              .fontSize(12)
              .fontColor(Theme.gold)
              .textAlign(TextAlign.Center)
              .layoutWeight(1)
              .height(40)
              .borderRadius(8)
              .backgroundColor(Theme.goldBg)
              .onClick((): void => {
                const ctx = getContext(this) as common.UIAbilityContext;
                Links.open(ctx, Config.WEB_URL + '/legal.html');
              })
            Text('复制联系微信')
              .fontSize(12)
              .fontColor(Theme.muted)
              .textAlign(TextAlign.Center)
              .layoutWeight(1)
              .height(40)
              .borderRadius(8)
              .backgroundColor(Theme.card)
              .onClick((): void => {
                Clip.copy('virtualman2001', '微信号已复制');
              })
          }
          .width('100%')

          Column().height(30)
        }
        .width('100%')
        .padding({ left: 16, right: 16, top: 8 })
      }
      .scrollBar(BarState.Off)
      .layoutWeight(1)
    }
    .width('100%')
    .height('100%')
    .backgroundColor(Theme.bg)
  }
}
