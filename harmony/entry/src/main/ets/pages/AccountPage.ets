import { promptAction } from '@kit.ArkUI';
import { common } from '@kit.AbilityKit';
import { BusinessError } from '@kit.BasicServicesKit';
import { Api } from '../utils/api';
import { Catalog } from '../utils/catalog';
import { Clip } from '../utils/clip';
import { Config } from '../utils/config';
import { Nav, RouteParam, Routes } from '../utils/router';
import { Huawei } from '../utils/huawei';
import { Privacy } from '../utils/privacy';
import { Store } from '../utils/store';
import { Theme } from '../utils/theme';
import { User } from '../model/types';

class AuthBody {
  name: string = '';
  password: string = '';

  constructor(name: string, password: string) {
    this.name = name;
    this.password = password;
  }
}

/** 华为登录只递交授权码，client_secret 与换 token 全在服务端 */
class HuaweiBody {
  code: string = '';

  constructor(code: string) {
    this.code = code;
  }
}

class AuthResponse {
  ok: boolean = false;
  token: string = '';
  user: User | null = null;
  error: string = '';
}

@Component
export struct AccountPage {
  // NavPathStack 是框架原生对象：@Prop 会尝试深拷贝，运行时会 Cpp Crash
  stack: NavPathStack = new NavPathStack();
  @StorageProp('cl_dataRev') @Watch('onStoreChange') dataRev: number = 0;

  @State mode: string = 'login';
  @State name: string = '';
  @State password: string = '';
  @State password2: string = '';
  @State agree: boolean = false;
  @State busy: boolean = false;
  @State hwBusy: boolean = false;
  @State hwBound: boolean = false;
  @State loggedIn: boolean = false;
  @State displayName: string = '';
  @State userAvatar: string = '';
  @State loginText: string = '已登录 · 藏品云端同步';
  @State holdingsCount: number = 0;
  @State userCount: number = 0;
  @State totalCoins: number = 0;
  @State seriesCount: number = 0;

  aboutToAppear(): void {
    this.agree = Privacy.agreed;
    this.render();
    Store.refresh().then((): void => {
      this.render();
    }).catch((): void => {
    });
  }

  onStoreChange(): void {
    this.render();
  }

  private render(): void {
    const state = Store.getState();
    this.loggedIn = state.user !== null;
    const u: User | null = state.user;
    this.displayName = u !== null ? (u.nickname || u.name) : '';
    // 本站上传的头像优先；没上传过就用华为账号头像（外链，可能失效 → 失败退回首字母）
    if (u !== null) {
      const own: string = u.avatar !== undefined && u.avatar !== '' ? u.avatar : '';
      const hw: string = u.hwAvatar !== undefined ? u.hwAvatar : '';
      const src: string = own !== '' ? own : hw;
      this.userAvatar = src !== '' ? Api.imgUrl(src) : '';

      const ways: string[] = [];
      if (u.hasPassword === true) ways.push('密码');
      if (u.wx === true) ways.push('微信');
      if (u.hw === true) ways.push('华为');
      this.loginText = ways.length > 0 ? '已登录 · ' + ways.join(' / ') : '已登录 · 藏品云端同步';
      this.hwBound = u.hw === true;
    } else {
      this.userAvatar = '';
      this.loginText = '已登录 · 藏品云端同步';
      this.hwBound = false;
    }
    this.holdingsCount = state.holdings.length;
    this.userCount = state.userCount;
    this.totalCoins = Catalog.total();
    this.seriesCount = Catalog.seriesList.length;
  }

  /** 未同意隐私政策时拦下；用户点「同意并继续」后执行 next */
  private requireAgree(next: () => void): boolean {
    if (this.agree) return true;
    AlertDialog.show({
      title: '先同意隐私政策',
      message: '登录需要先同意《隐私政策》与《用户协议》。我们只用账号信息同步你的收藏账本。',
      primaryButton: {
        value: '查看协议',
        action: (): void => {
          Nav.push(this.stack, Routes.PRIVACY, new RouteParam());
        }
      },
      secondaryButton: {
        value: '同意并继续',
        action: (): void => {
          Privacy.agree();
          this.agree = true;
          next();
        }
      }
    });
    return false;
  }

  private submit(): void {
    if (this.busy) return;
    if (!this.requireAgree((): void => {
      this.submit();
    })) return;
    const name = this.name.trim();
    const password = this.password;
    if (name === '') {
      promptAction.showToast({ message: '请填用户名', duration: 1500 });
      return;
    }
    if (password === '') {
      promptAction.showToast({ message: '请填密码', duration: 1500 });
      return;
    }
    if (this.mode === 'register' && password !== this.password2) {
      promptAction.showToast({ message: '两次输入的密码不一致', duration: 1600 });
      return;
    }
    this.busy = true;
    const path = this.mode === 'login' ? '/api/auth/login' : '/api/auth/register';
    Api.post<AuthResponse>(path, new AuthBody(name, password)).then((res: AuthResponse): Promise<void> => {
      Store.saveToken(res.token || '');
      this.password = '';
      this.password2 = '';
      return Store.refresh(true).then((): void => {
      });
    }).then((): void => {
      this.busy = false;
      this.render();
      const isLogin: boolean = this.mode === 'login';
      promptAction.showToast({
        message: isLogin ? '登录成功' : '注册成功',
        duration: 1500
      });
      // 账号密码登录进来、且还没绑华为：推荐一次 —— 绑完下次就能用华为账号一键登录
      const u: User | null = Store.currentUser();
      const bound: boolean = u !== null && u.hw === true;
      if (isLogin && !bound) {
        this.suggestHuaweiBind();
      } else {
        setTimeout((): void => {
          Nav.pop(this.stack);
        }, 500);
      }
    }).catch((e: Error): void => {
      this.busy = false;
      AlertDialog.show({
        title: this.mode === 'login' ? '登录失败' : '注册失败',
        message: e.message || '请稍后重试',
        confirm: {
          value: '知道了',
          action: (): void => {
          }
        }
      });
    });
  }

  /**
   * 调 Account Kit 取 authorizationCode。
   * 客户端只负责这一步 —— 换 access_token、取 OpenID、建号/绑定全在服务端完成，
   * Client Secret 不进安装包。系统没登录华为账号时会拉起系统登录页（forceLogin）。
   */
  private fetchHuaweiCode(): Promise<string> {
    return Huawei.fetchCode(getContext(this) as common.UIAbilityContext);
  }

  /** 华为相关失败提示：先把官方错误码翻译成人话 */
  private hwErrorText(e: Error): string {
    const be = e as BusinessError;
    // 1001502001：设备上没有登录华为账号（官方错误码）
    if (be.code === 1001502001) {
      return '设备还没登录华为账号，请先在系统设置里登录华为账号后再试';
    }
    return e.message !== undefined && e.message !== '' ? e.message : '请稍后重试';
  }

  /**
   * 华为账号快速登录：客户端只负责拿到 authorizationCode，
   * 换 access_token、取 OpenID、建号/登录全部在服务端完成。
   */
  private huaweiLogin(): void {
    if (this.hwBusy) return;
    if (!this.requireAgree((): void => {
      this.huaweiLogin();
    })) return;

    this.hwBusy = true;
    this.fetchHuaweiCode()
      .then((code: string): Promise<void> => {
        return Api.post<AuthResponse>('/api/auth/huawei/login', new HuaweiBody(code))
          .then((res: AuthResponse): void => {
            Store.saveToken(res.token || '');
          });
      })
      .then((): Promise<void> => {
        return Store.refresh(true).then((): void => {
        });
      })
      .then((): void => {
        this.hwBusy = false;
        this.render();
        promptAction.showToast({ message: '登录成功', duration: 1500 });
        setTimeout((): void => {
          Nav.pop(this.stack);
        }, 500);
      })
      .catch((e: Error): void => {
        this.hwBusy = false;
        AlertDialog.show({
          title: '华为账号登录失败',
          message: this.hwErrorText(e),
          confirm: {
            value: '知道了',
            action: (): void => {
            }
          }
        });
      });
  }

  /** 登录成功后推荐绑定华为账号：绑完下次就能一键登录 */
  private suggestHuaweiBind(): void {
    AlertDialog.show({
      title: '绑定华为账号？',
      message: '绑定后，下次在登录页直接点「华为账号快速登录」就能进入这本账本，不用再记密码。',
      primaryButton: {
        value: '以后再说',
        action: (): void => {
          Nav.pop(this.stack);
        }
      },
      secondaryButton: {
        value: '去绑定',
        action: (): void => {
          this.huaweiBind(true);
        }
      }
    });
  }

  /** 给当前已登录账号绑定华为账号；backAfter=true 时绑完返回上一页 */
  private huaweiBind(backAfter: boolean = false): void {
    if (this.hwBusy) return;
    this.hwBusy = true;
    this.fetchHuaweiCode()
      .then((code: string): Promise<AuthResponse> => {
        return Api.post<AuthResponse>('/api/auth/huawei/bind', new HuaweiBody(code));
      })
      .then((): Promise<void> => {
        return Store.refresh(true).then((): void => {
        });
      })
      .then((): void => {
        this.hwBusy = false;
        this.render();
        promptAction.showToast({ message: '已绑定华为账号', duration: 1600 });
        if (backAfter) {
          setTimeout((): void => {
            Nav.pop(this.stack);
          }, 600);
        }
      })
      .catch((e: Error): void => {
        this.hwBusy = false;
        AlertDialog.show({
          title: '绑定失败',
          message: this.hwErrorText(e),
          confirm: {
            value: '知道了',
            action: (): void => {
              // 登录已经成功，只是绑定没成：关掉提示后照常返回
              if (backAfter) Nav.pop(this.stack);
            }
          }
        });
      });
  }

  /** 解绑华为账号：只解除华为绑定，密码与藏品不动 */
  private huaweiUnbind(): void {
    if (this.hwBusy) return;
    AlertDialog.show({
      title: '解绑华为账号',
      message: '解绑后就不能用华为账号登录这本账本了，用户名密码登录不受影响。确定解绑？',
      primaryButton: {
        value: '取消',
        action: (): void => {
        }
      },
      secondaryButton: {
        value: '解绑',
        fontColor: Theme.up,
        action: (): void => {
          this.hwBusy = true;
          Api.post<AuthResponse>('/api/auth/huawei/unbind', new HuaweiBody(''))
            .then((): Promise<void> => {
              return Store.refresh(true).then((): void => {
              });
            })
            .then((): void => {
              this.hwBusy = false;
              this.render();
              promptAction.showToast({ message: '已解绑', duration: 1500 });
            })
            .catch((e: Error): void => {
              this.hwBusy = false;
              promptAction.showToast({ message: this.hwErrorText(e), duration: 2000 });
            });
        }
      }
    });
  }

  private logout(): void {
    AlertDialog.show({
      title: '退出登录',
      message: '退出后本机不再显示你的藏品，数据仍在云端，下次登录还能看到。',
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
      Text(this.loggedIn ? '账号' : (this.mode === 'login' ? '登录' : '注册'))
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
  loginForm() {
    Column({ space: 12 }) {
      Row() {
        this.modeTab('登录', 'login')
        this.modeTab('注册', 'register')
      }
      .width('100%')
      .padding(4)
      .borderRadius(18)
      .backgroundColor('#EFEAE0')

      Column({ space: 10 }) {
        TextInput({ text: $$this.name, placeholder: '用户名' })
          .height(44)
          .fontSize(13)
          .backgroundColor(Theme.bg)
          .borderRadius(8)
          .padding({ left: 12, right: 12 })
        TextInput({ text: $$this.password, placeholder: '密码' })
          .type(InputType.Password)
          .height(44)
          .fontSize(13)
          .backgroundColor(Theme.bg)
          .borderRadius(8)
          .padding({ left: 12, right: 12 })
        if (this.mode === 'register') {
          TextInput({ text: $$this.password2, placeholder: '再输入一次密码' })
            .type(InputType.Password)
            .height(44)
            .fontSize(13)
            .backgroundColor(Theme.bg)
            .borderRadius(8)
            .padding({ left: 12, right: 12 })
        }
      }
      .width('100%')

      Row({ space: 6 }) {
        Text(this.agree ? '☑' : '☐')
          .fontSize(14)
          .fontColor(this.agree ? Theme.gold : Theme.faint)
          .onClick((): void => {
            this.agree = !this.agree;
            if (this.agree) Privacy.agree();
          })
        Text('我已阅读并同意')
          .fontSize(11)
          .fontColor(Theme.muted)
        Text('《隐私政策》《用户协议》')
          .fontSize(11)
          .fontColor(Theme.gold)
          .onClick((): void => {
            Nav.push(this.stack, Routes.PRIVACY, new RouteParam());
          })
      }
      .width('100%')
      .margin({ top: 2 })

      Text(this.busy ? '处理中…' : (this.mode === 'login' ? '登录' : '注册并登录'))
        .fontSize(15)
        .fontColor(Color.White)
        .textAlign(TextAlign.Center)
        .width('100%')
        .height(44)
        .borderRadius(8)
        .backgroundColor(this.busy ? '#C9BFA9' : Theme.gold)
        .onClick((): void => {
          this.submit();
        })

      Row() {
        Divider().layoutWeight(1).strokeWidth(1).color(Theme.line)
        Text('或')
          .fontSize(10)
          .fontColor(Theme.faint)
          .margin({ left: 8, right: 8 })
        Divider().layoutWeight(1).strokeWidth(1).color(Theme.line)
      }
      .width('100%')
      .margin({ top: 2 })

      Text(this.hwBusy ? '正在唤起华为账号…' : '华为账号快速登录')
        .fontSize(14)
        .fontColor(Theme.up)
        .textAlign(TextAlign.Center)
        .width('100%')
        .height(44)
        .borderRadius(8)
        .border({ width: 1, color: Theme.up })
        .backgroundColor(this.hwBusy ? Theme.goldBg : Color.Transparent)
        .onClick((): void => {
          this.huaweiLogin();
        })

      Text('账号与网页版、小程序互通，藏品存在云端')
        .fontSize(10)
        .fontColor(Theme.faint)
        .width('100%')
        .textAlign(TextAlign.Center)
        .margin({ top: 4 })
    }
    .width('100%')
    .padding(16)
    .borderRadius(16)
    .backgroundColor(Theme.glass)
    .backgroundBlurStyle(BlurStyle.COMPONENT_THICK)
    .border({ width: 1, color: Theme.glassBorder })
    .shadow({ radius: 24, color: 'rgba(120,90,40,0.08)', offsetY: 8 })
  }

  @Builder
  modeTab(label: string, key: string) {
    Text(label)
      .fontSize(13)
      .fontColor(this.mode === key ? Color.White : Theme.muted)
      .textAlign(TextAlign.Center)
      .layoutWeight(1)
      .height(32)
      .borderRadius(16)
      .backgroundColor(this.mode === key ? Theme.gold : Color.Transparent)
      .onClick((): void => {
        this.mode = key;
        this.password = '';
        this.password2 = '';
      })
  }

  @Builder
  userCard() {
    Column({ space: 14 }) {
      Row({ space: 12 }) {
        if (this.userAvatar.length > 0) {
          Image(this.userAvatar)
            .width(54)
            .height(54)
            .borderRadius(27)
            .objectFit(ImageFit.Cover)
        } else {
          Text(this.displayName.length > 0 ? this.displayName.slice(0, 1) : '藏')
            .width(54)
            .height(54)
            .borderRadius(27)
            .textAlign(TextAlign.Center)
            .fontSize(20)
            .fontColor(Theme.goldDeep)
            .backgroundColor(Theme.goldBg)
        }
        Column({ space: 3 }) {
          Text(this.displayName)
            .fontSize(17)
            .fontWeight(FontWeight.Medium)
            .fontColor(Theme.text)
          Text(this.loginText)
            .fontSize(10)
            .fontColor(Theme.muted)
        }
        .layoutWeight(1)
        .alignItems(HorizontalAlign.Start)
      }
      .width('100%')

      Row() {
        this.statCell(String(this.holdingsCount), '在册藏品')
        this.statCell(String(this.totalCoins), '品种总数')
        this.statCell(String(this.seriesCount), '系列')
        this.statCell(String(this.userCount), '藏友')
      }
      .width('100%')
      .padding({ top: 10, bottom: 10 })
      .borderRadius(12)
      .backgroundColor(Theme.bg)

      Column({ space: 0 }) {
        this.row('编辑资料', (): void => {
          Nav.push(this.stack, Routes.PROFILE, new RouteParam());
        })
        Divider().color(Theme.lineSoft)
        this.row('我的藏品', (): void => {
          Nav.push(this.stack, Routes.HOLDINGS, new RouteParam());
        })
        Divider().color(Theme.lineSoft)
        this.row('隐私政策与用户协议', (): void => {
          Nav.push(this.stack, Routes.PRIVACY, new RouteParam());
        })
        Divider().color(Theme.lineSoft)
        if (this.hwBound) {
          this.row('解绑华为账号', (): void => {
            this.huaweiUnbind();
          })
        } else {
          this.row('绑定华为账号', (): void => {
            this.huaweiBind();
          })
        }
      }
      .width('100%')

      Text('退出登录')
        .fontSize(14)
        .fontColor(Theme.up)
        .textAlign(TextAlign.Center)
        .width('100%')
        .height(42)
        .borderRadius(8)
        .backgroundColor('#FBEEEC')
        .onClick((): void => {
          this.logout();
        })
    }
    .width('100%')
    .padding(16)
    .borderRadius(16)
    .backgroundColor(Theme.glass)
    .backgroundBlurStyle(BlurStyle.COMPONENT_THICK)
    .border({ width: 1, color: Theme.glassBorder })
    .shadow({ radius: 24, color: 'rgba(120,90,40,0.08)', offsetY: 8 })
  }

  @Builder
  statCell(v: string, k: string) {
    Column({ space: 3 }) {
      Text(v)
        .fontSize(15)
        .fontWeight(FontWeight.Medium)
        .fontColor(Theme.goldDeep)
      Text(k)
        .fontSize(9)
        .fontColor(Theme.faint)
    }
    .layoutWeight(1)
  }

  @Builder
  row(label: string, onTap: () => void) {
    Row() {
      Text(label)
        .fontSize(13)
        .fontColor(Theme.textStrong)
      Blank()
      Text('›')
        .fontSize(17)
        .fontColor(Theme.faint)
    }
    .width('100%')
    .height(44)
    .onClick((): void => {
      onTap();
    })
  }

  build() {
    Column() {
      this.header()
      Scroll() {
        Column({ space: 12 }) {
          if (this.loggedIn) {
            this.userCard()
          } else {
            this.loginForm()
          }

          Column({ space: 6 }) {
            Text('为什么需要账号')
              .fontSize(12)
              .fontWeight(FontWeight.Medium)
              .fontColor(Theme.text)
            Text('藏品、数量、成本与号码都存在你的账号里，换手机、用网页版或小程序都能接着记。我们不读取通讯录、位置与相册，除非你主动选择图片上传。')
              .fontSize(11)
              .fontColor(Theme.muted)
              .lineHeight(19)
            Text('查看完整隐私政策 ›')
              .fontSize(11)
              .fontColor(Theme.gold)
              .margin({ top: 4 })
              .onClick((): void => {
                Nav.push(this.stack, Routes.PRIVACY, new RouteParam());
              })
            Text('复制官网链接')
              .fontSize(11)
              .fontColor(Theme.faint)
              .margin({ top: 2 })
              .onClick((): void => {
                Clip.copy(Config.WEB_URL, '官网链接已复制');
              })
          }
          .width('100%')
          .padding(16)
          .borderRadius(16)
          .backgroundColor(Theme.glass)
          .backgroundBlurStyle(BlurStyle.COMPONENT_THICK)
          .border({ width: 1, color: Theme.glassBorder })
          .shadow({ radius: 24, color: 'rgba(120,90,40,0.08)', offsetY: 8 })
          .alignItems(HorizontalAlign.Start)

          Column().height(30)
        }
        .width('100%')
        .constraintSize({ minHeight: '100%' })
        .justifyContent(FlexAlign.Start)
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
