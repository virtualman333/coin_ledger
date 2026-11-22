import { promptAction } from '@kit.ArkUI';
import { common } from '@kit.AbilityKit';
import { BusinessError } from '@kit.BasicServicesKit';
import { Api } from '../utils/api';
import { Huawei } from '../utils/huawei';
import { ImagePicker } from '../utils/image';
import { Nav, RouteParam, Routes } from '../utils/router';
import { Store } from '../utils/store';
import { Theme } from '../utils/theme';
import { User } from '../model/types';

/**
 * 只改昵称的请求体：**不能带 avatar 字段**。
 * 服务端把 avatar:'' 当作「清除头像」，以前这里恒传真空串，
 * 结果点一次保存本站头像就没了。
 */
class ProfileBody {
  nickname: string = '';

  constructor(nickname: string) {
    this.nickname = nickname;
  }
}

/** 选了新头像才带 avatar（data:image/...;base64,...） */
class ProfileBodyWithAvatar {
  nickname: string = '';
  avatar: string = '';

  constructor(nickname: string, avatar: string) {
    this.nickname = nickname;
    this.avatar = avatar;
  }
}

class NameBody {
  name: string = '';

  constructor(name: string) {
    this.name = name;
  }
}

class PwdBody {
  oldPassword: string = '';
  newPassword: string = '';

  constructor(oldPassword: string, newPassword: string) {
    this.oldPassword = oldPassword;
    this.newPassword = newPassword;
  }
}

class SimpleOk {
  ok: boolean = false;
  error: string = '';
}

/** 华为绑定只递交授权码；换 token 与落库都在服务端 */
class HuaweiBody {
  code: string = '';

  constructor(code: string) {
    this.code = code;
  }
}

@Component
export struct ProfilePage {
  // NavPathStack 是框架原生对象：@Prop 会尝试深拷贝，运行时会 Cpp Crash
  stack: NavPathStack = new NavPathStack();
  @StorageProp('cl_dataRev') @Watch('onStoreChange') dataRev: number = 0;

  @State nick: string = '';
  @State name: string = '';
  @State origName: string = '';
  @State nameLocked: boolean = false;
  @State hasPassword: boolean = false;
  @State joinedText: string = '';
  @State avatarUrl: string = '';
  @State avatarData: string = '';
  @State saving: boolean = false;

  @State pwdOpen: boolean = false;
  @State oldPwd: string = '';
  @State newPwd: string = '';
  @State newPwd2: string = '';
  @State pwdBusy: boolean = false;
  @State hwBound: boolean = false;
  @State hwBusy: boolean = false;

  aboutToAppear(): void {
    this.fill();
  }

  onStoreChange(): void {
    if (!this.saving) this.fill();
  }

  private fill(): void {
    const u: User | null = Store.currentUser();
    if (u === null) return;
    this.nick = u.nickname || '';
    this.name = u.name || '';
    this.origName = u.name || '';
    this.nameLocked = !!u.nameChanged;
    this.hasPassword = !!u.hasPassword;
    this.hwBound = u.hw === true;
    this.joinedText = u.createdAt ? String(u.createdAt).slice(0, 10).replace(/-/g, '/') : '';
    // 本站上传的头像优先；没上传过就用华为账号头像（外链），与账号页保持一致
    const own: string = u.avatar !== undefined && u.avatar !== '' ? u.avatar : '';
    const hw: string = u.hwAvatar !== undefined ? u.hwAvatar : '';
    const src: string = own !== '' ? own : hw;
    this.avatarUrl = src !== '' ? Api.imgUrl(src) : '';
  }

  private pickAvatar(): void {
    ImagePicker.pick(1, 512, 80).then((urls: string[]): void => {
      if (urls.length === 0) return;
      this.avatarData = urls[0];
      this.avatarUrl = urls[0];
    }).catch((): void => {
      promptAction.showToast({ message: '选图失败，请重试', duration: 1600 });
    });
  }

  private save(): void {
    if (this.saving) return;
    const nick = this.nick.trim();
    if (nick !== '' && nick.length < 2) {
      promptAction.showToast({ message: '昵称至少 2 个字', duration: 1600 });
      return;
    }
    this.saving = true;
    const tasks: Promise<void>[] = [];
    if (nick !== '' || this.avatarData !== '') {
      // 没选新图就不带 avatar 字段，否则服务端会按「清除头像」处理
      if (this.avatarData !== '') {
        tasks.push(Api.post<SimpleOk>('/api/me/profile',
          new ProfileBodyWithAvatar(nick, this.avatarData)).then((): void => {
        }));
      } else {
        tasks.push(Api.post<SimpleOk>('/api/me/profile',
          new ProfileBody(nick)).then((): void => {
        }));
      }
    }
    if (this.name.trim() !== '' && this.name.trim() !== this.origName && !this.nameLocked) {
      tasks.push(Api.post<SimpleOk>('/api/user/name', new NameBody(this.name.trim())).then((): void => {
      }));
    }
    if (tasks.length === 0) {
      this.saving = false;
      promptAction.showToast({ message: '没有改动', duration: 1400 });
      return;
    }
    Promise.all(tasks).then((): Promise<void> => {
      return Store.refresh(true).then((): void => {
      });
    }).then((): void => {
      this.saving = false;
      this.avatarData = '';
      this.fill();
      promptAction.showToast({ message: '已保存', duration: 1400 });
    }).catch((e: Error): void => {
      this.saving = false;
      promptAction.showToast({ message: e.message || '保存失败', duration: 1800 });
    });
  }

  private submitPwd(): void {
    if (this.pwdBusy) return;
    if (this.hasPassword && this.oldPwd === '') {
      promptAction.showToast({ message: '请输入原密码', duration: 1500 });
      return;
    }
    if (this.newPwd.length < 6) {
      promptAction.showToast({ message: '新密码至少 6 位', duration: 1500 });
      return;
    }
    if (this.newPwd !== this.newPwd2) {
      promptAction.showToast({ message: '两次输入的新密码不一致', duration: 1600 });
      return;
    }
    this.pwdBusy = true;
    Api.post<SimpleOk>('/api/auth/password', new PwdBody(this.oldPwd, this.newPwd)).then((): void => {
      this.pwdBusy = false;
      this.pwdOpen = false;
      this.oldPwd = '';
      this.newPwd = '';
      this.newPwd2 = '';
      promptAction.showToast({ message: '密码已修改', duration: 1500 });
    }).catch((e: Error): void => {
      this.pwdBusy = false;
      promptAction.showToast({ message: e.message || '修改失败', duration: 1800 });
    });
  }

  /** 绑定华为账号：拉授权码 → 服务端挂到当前账号 → 刷新状态 */
  private huaweiBind(): void {
    if (this.hwBusy) return;
    this.hwBusy = true;
    Huawei.fetchCode(getContext(this) as common.UIAbilityContext)
      .then((code: string): Promise<SimpleOk> => {
        return Api.post<SimpleOk>('/api/auth/huawei/bind', new HuaweiBody(code));
      })
      .then((): Promise<void> => {
        return Store.refresh(true).then((): void => {
        });
      })
      .then((): void => {
        this.hwBusy = false;
        this.fill();
        promptAction.showToast({ message: '已绑定华为账号，下次可一键登录', duration: 1800 });
      })
      .catch((e: Error): void => {
        this.hwBusy = false;
        const be = e as BusinessError;
        // 1001502001：设备上没有登录华为账号（官方错误码）
        const msg: string = be.code === 1001502001
          ? '设备还没登录华为账号，请先在系统设置里登录'
          : (e.message !== undefined && e.message !== '' ? e.message : '绑定失败，请稍后重试');
        promptAction.showToast({ message: msg, duration: 2200 });
      });
  }

  /** 解绑华为账号：只解除华为绑定，密码与收藏不动 */
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
          Api.post<SimpleOk>('/api/auth/huawei/unbind', new HuaweiBody(''))
            .then((): Promise<void> => {
              return Store.refresh(true).then((): void => {
              });
            })
            .then((): void => {
              this.hwBusy = false;
              this.fill();
              promptAction.showToast({ message: '已解绑', duration: 1500 });
            })
            .catch((e: Error): void => {
              this.hwBusy = false;
              promptAction.showToast({ message: e.message || '解绑失败', duration: 2000 });
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
      Text('编辑资料')
        .fontSize(15)
        .fontWeight(FontWeight.Medium)
        .fontColor(Theme.text)
      Blank()
      Text(this.saving ? '保存中…' : '保存')
        .fontSize(12)
        .fontColor(this.saving ? Theme.faint : Theme.gold)
        .onClick((): void => {
          this.save();
        })
    }
    .width('100%')
    .height(44)
    .padding({ left: 8, right: 14 })
  }

  @Builder
  pwdSheet() {
    Stack() {
      Column()
        .width('100%')
        .height('100%')
        .backgroundColor('rgba(20,16,10,0.42)')
        .onClick((): void => {
          if (!this.pwdBusy) this.pwdOpen = false;
        })
      Column({ space: 10 }) {
        Row() {
          Text('修改密码')
            .fontSize(16)
            .fontWeight(FontWeight.Medium)
            .fontColor(Theme.text)
          Blank()
          Text('✕')
            .fontSize(15)
            .fontColor(Theme.muted)
            .onClick((): void => {
              if (!this.pwdBusy) this.pwdOpen = false;
            })
        }
        .width('100%')
        if (this.hasPassword) {
          TextInput({ text: $$this.oldPwd, placeholder: '原密码' })
            .type(InputType.Password)
            .height(42)
            .fontSize(13)
            .backgroundColor(Theme.bg)
            .borderRadius(8)
            .padding({ left: 10, right: 10 })
        }
        TextInput({ text: $$this.newPwd, placeholder: '新密码（至少 6 位）' })
          .type(InputType.Password)
          .height(42)
          .fontSize(13)
          .backgroundColor(Theme.bg)
          .borderRadius(8)
          .padding({ left: 10, right: 10 })
        TextInput({ text: $$this.newPwd2, placeholder: '再输一次新密码' })
          .type(InputType.Password)
          .height(42)
          .fontSize(13)
          .backgroundColor(Theme.bg)
          .borderRadius(8)
          .padding({ left: 10, right: 10 })
        Text(this.pwdBusy ? '提交中…' : '确认修改')
          .fontSize(14)
          .fontColor(Color.White)
          .textAlign(TextAlign.Center)
          .width('100%')
          .height(42)
          .borderRadius(8)
          .backgroundColor(this.pwdBusy ? '#C9BFA9' : Theme.gold)
          .onClick((): void => {
            this.submitPwd();
          })
      }
      .width('90%')
      .padding(18)
      .borderRadius(16)
      .backgroundColor(Theme.glass)
      .border({ width: 1, color: Theme.glassBorder })
      .shadow({ radius: 14, color: 'rgba(0,0,0,0.05)', offsetY: 8 })
    }
    .width('100%')
    .height('100%')
    .alignContent(Alignment.Center)
  }

  build() {
    Stack() {
      Column() {
        this.header()
        Scroll() {
          Column({ space: 12 }) {
            Column({ space: 10 }) {
              Stack({ alignContent: Alignment.BottomEnd }) {
                if (this.avatarUrl.length > 0) {
                  Image(this.avatarUrl)
                    .width(76)
                    .height(76)
                    .borderRadius(38)
                    .objectFit(ImageFit.Cover)
                } else {
                  Text(this.nick.length > 0 ? this.nick.slice(0, 1) : '藏')
                    .width(76)
                    .height(76)
                    .borderRadius(38)
                    .textAlign(TextAlign.Center)
                    .fontSize(26)
                    .fontColor(Theme.goldDeep)
                    .backgroundColor(Theme.goldBg)
                }
                Text('改')
                  .fontSize(9)
                  .fontColor(Color.White)
                  .width(24)
                  .height(24)
                  .textAlign(TextAlign.Center)
                  .borderRadius(12)
                  .linearGradient({ angle: 135, colors: [['#C79A4B', 0], ['#9A6B1F', 1]] })
                  .onClick((): void => {
                    this.pickAvatar();
                  })
              }
              .width(76)
              .height(76)

              Text(this.origName)
                .fontSize(12)
                .fontColor(Theme.muted)
              if (this.joinedText.length > 0) {
                Text('加入于 ' + this.joinedText)
                  .fontSize(10)
                  .fontColor(Theme.faint)
              }
            }
            .justifyContent(FlexAlign.Start)
            .width('100%')
            .padding(18)
            .borderRadius(14)
            .backgroundColor(Theme.glass)
            .border({ width: 1, color: Theme.glassBorder })
            .shadow({ radius: 14, color: 'rgba(0,0,0,0.05)', offsetY: 8 })

            Column({ space: 12 }) {
              Column({ space: 5 }) {
                Text('昵称')
                  .fontSize(11)
                  .fontColor(Theme.muted)
                TextInput({ text: $$this.nick, placeholder: '2–16 个字' })
                  .height(42)
                  .fontSize(13)
                  .backgroundColor(Theme.bg)
                  .borderRadius(8)
                  .padding({ left: 10, right: 10 })
                  .maxLength(16)
              }
              .alignItems(HorizontalAlign.Start)

              Column({ space: 5 }) {
                Text(this.nameLocked ? '用户名（已改过一次，不可再改）' : '用户名（只能改一次）')
                  .fontSize(11)
                  .fontColor(Theme.muted)
                TextInput({ text: $$this.name, placeholder: '登录名' })
                  .height(42)
                  .fontSize(13)
                  .backgroundColor(this.nameLocked ? '#F1EEE6' : Theme.bg)
                  .borderRadius(8)
                  .padding({ left: 10, right: 10 })
                  .enabled(!this.nameLocked)
              }
              .alignItems(HorizontalAlign.Start)

              Row() {
                Text(this.hasPassword ? '修改密码' : '设置密码')
                  .fontSize(13)
                  .fontColor(Theme.textStrong)
                Blank()
                Text('›')
                  .fontSize(17)
                  .fontColor(Theme.faint)
              }
              .width('100%')
              .height(40)
              .onClick((): void => {
                this.pwdOpen = true;
              })

              Divider().color(Theme.lineSoft)

              // 个人资料页的华为账号入口：绑定后下次可直接用华为账号一键登录
              Row() {
                Text('华为账号')
                  .fontSize(13)
                  .fontColor(Theme.textStrong)
                Blank()
                Text(this.hwBound ? '已绑定 · 点此解绑'
                  : (this.hwBusy ? '处理中…' : '未绑定 · 去绑定'))
                  .fontSize(12)
                  .fontColor(this.hwBound ? Theme.muted : Theme.gold)
              }
              .width('100%')
              .height(40)
              .onClick((): void => {
                if (this.hwBusy) return;
                if (this.hwBound) {
                  this.huaweiUnbind();
                } else {
                  this.huaweiBind();
                }
              })
            }
            .width('100%')
            .padding(14)
            .borderRadius(14)
            .backgroundColor(Theme.glass)
            .border({ width: 1, color: Theme.glassBorder })
            .shadow({ radius: 14, color: 'rgba(0,0,0,0.05)', offsetY: 8 })

            Text('昵称与头像会显示在广场晒单里；用户名只用于登录。')
              .fontSize(10)
              .fontColor(Theme.faint)
              .lineHeight(17)
              .width('100%')

            Column().height(20)
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

      if (this.pwdOpen) {
        this.pwdSheet()
      }
    }
    .width('100%')
    .height('100%')
  }
}
