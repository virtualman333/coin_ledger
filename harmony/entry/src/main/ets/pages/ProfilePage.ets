import { promptAction } from '@kit.ArkUI';
import { Api } from '../utils/api';
import { ImagePicker } from '../utils/image';
import { Nav, RouteParam, Routes } from '../utils/router';
import { Store } from '../utils/store';
import { Theme } from '../utils/theme';
import { User } from '../model/types';

class ProfileBody {
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
    this.joinedText = u.createdAt ? String(u.createdAt).slice(0, 10).replace(/-/g, '/') : '';
    this.avatarUrl = u.avatar ? Api.imgUrl(u.avatar) : '';
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
      tasks.push(Api.post<SimpleOk>('/api/me/profile', new ProfileBody(nick, this.avatarData)).then((): void => {
      }));
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
      .backgroundColor(Theme.card)
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
                  .backgroundColor(Theme.gold)
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
            .backgroundColor(Theme.card)

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
            }
            .width('100%')
            .padding(14)
            .borderRadius(14)
            .backgroundColor(Theme.card)

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
        .scrollBar(BarState.Off)
        .layoutWeight(1)
      }
      .width('100%')
      .height('100%')
      .backgroundColor(Theme.bg)

      if (this.pwdOpen) {
        this.pwdSheet()
      }
    }
    .width('100%')
    .height('100%')
  }
}
