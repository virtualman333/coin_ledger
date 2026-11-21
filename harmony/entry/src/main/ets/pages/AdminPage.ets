import { promptAction } from '@kit.ArkUI';
import { Api } from '../utils/api';
import { Catalog } from '../utils/catalog';
import { Nav, RouteParam, Routes } from '../utils/router';
import { Store } from '../utils/store';
import { Theme } from '../utils/theme';

class AdminUser {
  id: string = '';
  name: string = '';
  nickname: string = '';
  role: string = '';
  disabled: boolean = false;
  isTest: boolean = false;
  createdAt: string = '';
  holdings: number = 0;
}

class AdminStats {
  total: number = 0;
  admins: number = 0;
  tests: number = 0;
  disabled: number = 0;
}

class UsersResponse {
  ok: boolean = false;
  users: AdminUser[] = [];
  total: number = 0;
  stats: AdminStats | null = null;
  error: string = '';
}

class BatchBody {
  ids: string[] = [];
  action: string = '';

  constructor(ids: string[], action: string) {
    this.ids = ids;
    this.action = action;
  }
}

class AdminFeedback {
  id: string = '';
  text: string = '';
  status: string = '';
  createdAt: string = '';
  coinName: string = '';
  userName: string = '';
  images: string[] = [];
}

class FeedbackResponse {
  ok: boolean = false;
  items: AdminFeedback[] = [];
  open: number = 0;
}

class StatusBody {
  status: string = '';

  constructor(status: string) {
    this.status = status;
  }
}

class AdminCoin {
  no: number = 0;
  name: string = '';
  year: number = 0;
  face: number = 0;
  mintage: number = 0;
  material: string = '';
}

/** /api/admin/coins 返回 legacy 形态（i 为序号，no = i + 1） */
class AdminCoinRaw {
  i: number = 0;
  name: string = '';
  year: number = 0;
  face: number = 0;
  mintage: number = 0;
  material: string = '';
}

class CoinsResponse {
  ok: boolean = false;
  coins: AdminCoinRaw[] = [];
}

class CoinPatchFields {
  name: string = '';
  year: number = 0;
  face: number = 0;
  mintage: number = 0;
}

class CoinPatchBody {
  id: number = 0;
  patch: CoinPatchFields = new CoinPatchFields();

  constructor(id: number, patch: CoinPatchFields) {
    this.id = id;
    this.patch = patch;
  }
}

@Component
export struct AdminPage {
  // NavPathStack 是框架原生对象：@Prop 会尝试深拷贝，运行时会 Cpp Crash
  stack: NavPathStack = new NavPathStack();
  @State tab: string = 'users';
  @State users: AdminUser[] = [];
  @State stats: AdminStats = new AdminStats();
  @State feedbacks: AdminFeedback[] = [];
  @State openFb: number = 0;
  @State coins: AdminCoin[] = [];
  @State keyword: string = '';
  @State loading: boolean = false;
  @State err: string = '';
  @State isAdmin: boolean = false;

  @State editOpen: boolean = false;
  @State editNo: number = 0;
  @State editName: string = '';
  @State editYear: number = 0;
  @State editFace: number = 0;
  @State editMintage: number = 0;

  aboutToAppear(): void {
    this.isAdmin = Store.getState().isAdmin;
    if (this.isAdmin) {
      this.loadUsers();
    }
  }

  private loadUsers(): void {
    this.loading = true;
    this.err = '';
    const q = this.keyword.trim();
    Api.get<UsersResponse>('/api/admin/users?page=1&size=50' + (q !== '' ? '&q=' + encodeURIComponent(q) : ''))
      .then((res: UsersResponse): void => {
        this.loading = false;
        if (!res || !res.ok) {
          this.err = '加载失败';
          return;
        }
        this.users = res.users || [];
        this.stats = res.stats || new AdminStats();
      }).catch((e: Error): void => {
        this.loading = false;
        this.err = e.message || '加载失败';
      });
  }

  private loadFeedback(): void {
    this.loading = true;
    this.err = '';
    Api.get<FeedbackResponse>('/api/admin/feedback?status=all').then((res: FeedbackResponse): void => {
      this.loading = false;
      if (!res || !res.ok) {
        this.err = '加载失败';
        return;
      }
      this.feedbacks = res.items || [];
      this.openFb = res.open || 0;
    }).catch((e: Error): void => {
      this.loading = false;
      this.err = e.message || '加载失败';
    });
  }

  private loadCoins(): void {
    this.loading = true;
    this.err = '';
    Api.get<CoinsResponse>('/api/admin/coins').then((res: CoinsResponse): void => {
      this.loading = false;
      if (!res || !res.ok) {
        this.err = '加载失败';
        return;
      }
      const kw = this.keyword.trim().toLowerCase();
      const list: AdminCoin[] = [];
      const raws = res.coins || [];
      for (let i = 0; i < raws.length; i++) {
        const r = raws[i];
        if (kw !== '') {
          const hay = (r.name + ' ' + r.year + ' ' + r.material).toLowerCase();
          if (hay.indexOf(kw) < 0) continue;
        }
        if (list.length >= 60) break;
        const c = new AdminCoin();
        c.no = Number(r.i) + 1;
        c.name = r.name;
        c.year = Number(r.year) || 0;
        c.face = Number(r.face) || 0;
        c.mintage = Number(r.mintage) || 0;
        c.material = r.material || '';
        list.push(c);
      }
      this.coins = list;
    }).catch((e: Error): void => {
      this.loading = false;
      this.err = e.message || '加载失败';
    });
  }

  private switchTab(key: string): void {
    this.tab = key;
    this.keyword = '';
    if (key === 'users') this.loadUsers();
    else if (key === 'feedback') this.loadFeedback();
    else this.loadCoins();
  }

  private batch(action: string, id: string): void {
    Api.post<UsersResponse>('/api/admin/users/batch', new BatchBody([id], action)).then((): void => {
      this.loadUsers();
    }).catch((e: Error): void => {
      promptAction.showToast({ message: e.message || '操作失败', duration: 1600 });
    });
  }

  private markFeedback(item: AdminFeedback, status: string): void {
    Api.patch<StatusBody>('/api/admin/feedback/' + item.id, new StatusBody(status)).then((): void => {
      this.loadFeedback();
      promptAction.showToast({ message: status === 'done' ? '已标记处理' : '已重新打开', duration: 1400 });
    }).catch((e: Error): void => {
      promptAction.showToast({ message: e.message || '操作失败', duration: 1600 });
    });
  }

  private openEdit(c: AdminCoin): void {
    this.editNo = c.no;
    this.editName = c.name;
    this.editYear = c.year;
    this.editFace = c.face;
    this.editMintage = c.mintage;
    this.editOpen = true;
  }

  private saveCoin(): void {
    const patch = new CoinPatchFields();
    patch.name = this.editName;
    patch.year = this.editYear;
    patch.face = this.editFace;
    patch.mintage = this.editMintage;
    Api.patch<CoinsResponse>('/api/admin/coin', new CoinPatchBody(this.editNo, patch))
      .then((): void => {
        this.editOpen = false;
        this.loadCoins();
        promptAction.showToast({ message: '已保存', duration: 1400 });
      }).catch((e: Error): void => {
        promptAction.showToast({ message: e.message || '保存失败', duration: 1800 });
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
      Text('管理后台')
        .fontSize(15)
        .fontWeight(FontWeight.Medium)
        .fontColor(Theme.text)
      Blank()
      Text('刷新')
        .fontSize(11)
        .fontColor(Theme.gold)
        .onClick((): void => {
          this.switchTab(this.tab);
        })
    }
    .width('100%')
    .height(44)
    .padding({ left: 8, right: 14 })
  }

  @Builder
  tabs() {
    Row({ space: 8 }) {
      this.tabBtn('用户', 'users')
      this.tabBtn('反馈' + (this.openFb > 0 ? ' ' + this.openFb : ''), 'feedback')
      this.tabBtn('品种', 'coins')
    }
    .width('100%')
    .padding(4)
    .borderRadius(18)
    .backgroundColor('#EFEAE0')
  }

  @Builder
  tabBtn(label: string, key: string) {
    Text(label)
      .fontSize(12)
      .fontColor(this.tab === key ? Color.White : Theme.muted)
      .textAlign(TextAlign.Center)
      .layoutWeight(1)
      .height(32)
      .borderRadius(16)
      .backgroundColor(this.tab === key ? Theme.gold : Color.Transparent)
      .onClick((): void => {
        if (this.tab !== key) this.switchTab(key);
      })
  }

  @Builder
  searchRow(hint: string) {
    Row({ space: 8 }) {
      TextInput({ text: $$this.keyword, placeholder: hint })
        .layoutWeight(1)
        .height(36)
        .fontSize(12)
        .backgroundColor(Theme.card)
        .borderRadius(18)
        .padding({ left: 12, right: 12 })
      Text('搜索')
        .fontSize(12)
        .fontColor(Theme.gold)
        .padding({ left: 12, right: 12, top: 8, bottom: 8 })
        .borderRadius(16)
        .backgroundColor(Theme.goldBg)
        .onClick((): void => {
          this.switchTab(this.tab);
        })
    }
    .width('100%')
    .margin({ top: 8, bottom: 4 })
  }

  @Builder
  userRow(u: AdminUser) {
    Row({ space: 8 }) {
      Text(u.name.slice(0, 1))
        .width(32)
        .height(32)
        .borderRadius(16)
        .textAlign(TextAlign.Center)
        .fontSize(13)
        .fontColor(Theme.goldDeep)
        .backgroundColor(Theme.goldBg)
      Column({ space: 2 }) {
        Row({ space: 6 }) {
          Text(u.nickname || u.name)
            .fontSize(12)
            .fontColor(Theme.textStrong)
          if (u.role === 'admin') {
            Text('管理员')
              .fontSize(8)
              .fontColor(Color.White)
              .padding({ left: 4, right: 4, top: 1, bottom: 1 })
              .backgroundColor(Theme.gold)
              .borderRadius(3)
          }
          if (u.disabled) {
            Text('已封禁')
              .fontSize(8)
              .fontColor(Theme.up)
              .padding({ left: 4, right: 4, top: 1, bottom: 1 })
              .backgroundColor('#FBEEEC')
              .borderRadius(3)
          }
        }
        Text('@' + u.name + ' · ' + (u.holdings || 0) + ' 件藏品')
          .fontSize(9)
          .fontColor(Theme.faint)
      }
      .layoutWeight(1)
      .alignItems(HorizontalAlign.Start)
      if (u.role !== 'admin') {
        Text(u.disabled ? '解封' : '封禁')
          .fontSize(10)
          .fontColor(u.disabled ? Theme.down : Theme.up)
          .padding({ left: 10, right: 10, top: 5, bottom: 5 })
          .borderRadius(10)
          .backgroundColor(Theme.bg)
          .onClick((): void => {
            this.batch(u.disabled ? 'enable' : 'disable', u.id);
          })
      }
    }
    .width('100%')
    .padding({ top: 10, bottom: 10 })
  }

  @Builder
  feedbackRow(it: AdminFeedback) {
    Column({ space: 6 }) {
      Row() {
        Text(it.userName.length > 0 ? it.userName : '藏友')
          .fontSize(11)
          .fontColor(Theme.goldDeep)
        if (it.coinName) {
          Text(' · ' + it.coinName)
            .fontSize(9)
            .fontColor(Theme.faint)
        }
        Blank()
        Text(it.status === 'done' ? '已处理' : '待处理')
          .fontSize(9)
          .fontColor(it.status === 'done' ? Theme.down : Theme.up)
      }
      .width('100%')
      Text(it.text)
        .fontSize(11)
        .fontColor(Theme.textStrong)
        .lineHeight(18)
      Row({ space: 8 }) {
        Text(it.createdAt ? String(it.createdAt).slice(0, 16).replace('T', ' ') : '')
          .fontSize(9)
          .fontColor(Theme.faint)
        Blank()
        Text(it.status === 'done' ? '重新打开' : '标记已处理')
          .fontSize(10)
          .fontColor(it.status === 'done' ? Theme.muted : Theme.gold)
          .padding({ left: 8, right: 8, top: 4, bottom: 4 })
          .borderRadius(8)
          .backgroundColor(Theme.bg)
          .onClick((): void => {
            this.markFeedback(it, it.status === 'done' ? 'open' : 'done');
          })
      }
      .width('100%')
    }
    .width('100%')
    .padding({ top: 10, bottom: 10 })
    .alignItems(HorizontalAlign.Start)
  }

  @Builder
  coinRow(c: AdminCoin) {
    Row({ space: 8 }) {
      Column({ space: 2 }) {
        Text(c.no + '. ' + c.name)
          .fontSize(11)
          .fontColor(Theme.textStrong)
          .maxLines(1)
          .textOverflow({ overflow: TextOverflow.Ellipsis })
        Text(c.year + ' 年 · ' + c.face + ' 元 · 发行 ' + c.mintage + ' 万')
          .fontSize(9)
          .fontColor(Theme.faint)
      }
      .layoutWeight(1)
      .alignItems(HorizontalAlign.Start)
      Text('编辑')
        .fontSize(10)
        .fontColor(Theme.gold)
        .padding({ left: 10, right: 10, top: 5, bottom: 5 })
        .borderRadius(10)
        .backgroundColor(Theme.goldBg)
        .onClick((): void => {
          this.openEdit(c);
        })
    }
    .width('100%')
    .padding({ top: 9, bottom: 9 })
  }

  @Builder
  editSheet() {
    Stack() {
      Column()
        .width('100%')
        .height('100%')
        .backgroundColor('rgba(20,16,10,0.42)')
        .onClick((): void => {
          this.editOpen = false;
        })
      Column({ space: 10 }) {
        Row() {
          Text('编辑品种 #' + this.editNo)
            .fontSize(15)
            .fontWeight(FontWeight.Medium)
            .fontColor(Theme.text)
          Blank()
          Text('✕')
            .fontSize(15)
            .fontColor(Theme.muted)
            .onClick((): void => {
              this.editOpen = false;
            })
        }
        .width('100%')
        TextInput({ text: $$this.editName, placeholder: '名称' })
          .height(40)
          .fontSize(12)
          .backgroundColor(Theme.bg)
          .borderRadius(8)
          .padding({ left: 10, right: 10 })
        Row({ space: 8 }) {
          TextInput({ text: String(this.editYear), placeholder: '年份' })
            .type(InputType.Number)
            .layoutWeight(1)
            .height(40)
            .fontSize(12)
            .backgroundColor(Theme.bg)
            .borderRadius(8)
            .padding({ left: 10, right: 10 })
            .onChange((v: string): void => {
              this.editYear = Math.floor(Number(v)) || 0;
            })
          TextInput({ text: String(this.editFace), placeholder: '面额' })
            .type(InputType.Number)
            .layoutWeight(1)
            .height(40)
            .fontSize(12)
            .backgroundColor(Theme.bg)
            .borderRadius(8)
            .padding({ left: 10, right: 10 })
            .onChange((v: string): void => {
              this.editFace = Number(v) || 0;
            })
        }
        .width('100%')
        TextInput({ text: String(this.editMintage), placeholder: '发行量（万）' })
          .type(InputType.Number)
          .height(40)
          .fontSize(12)
          .backgroundColor(Theme.bg)
          .borderRadius(8)
          .padding({ left: 10, right: 10 })
          .onChange((v: string): void => {
            this.editMintage = Number(v) || 0;
          })
        Text('保存')
          .fontSize(14)
          .fontColor(Color.White)
          .textAlign(TextAlign.Center)
          .width('100%')
          .height(42)
          .borderRadius(8)
          .backgroundColor(Theme.gold)
          .onClick((): void => {
            this.saveCoin();
          })
      }
      .width('90%')
      .padding(16)
      .borderRadius(16)
      .backgroundColor(Theme.glass)
      .backgroundBlurStyle(BlurStyle.COMPONENT_THICK)
      .border({ width: 1, color: Theme.glassBorder })
      .shadow({ radius: 24, color: 'rgba(120,90,40,0.08)', offsetY: 8 })
    }
    .width('100%')
    .height('100%')
    .alignContent(Alignment.Center)
  }

  build() {
    Stack() {
      Column() {
        this.header()
        if (!this.isAdmin) {
          Column({ space: 8 }) {
            Text('需要管理员账号')
              .fontSize(15)
              .fontWeight(FontWeight.Medium)
              .fontColor(Theme.text)
            Text('当前账号没有管理权限。请用管理员账号登录后再进入。')
              .fontSize(11)
              .fontColor(Theme.muted)
            Text('去登录')
              .fontSize(13)
              .fontColor(Theme.gold)
              .margin({ top: 4 })
              .onClick((): void => {
                Nav.push(this.stack, Routes.ACCOUNT, new RouteParam());
              })
          }
          .width('100%')
          .padding(20)
          .borderRadius(16)
          .backgroundColor(Theme.glass)
          .backgroundBlurStyle(BlurStyle.COMPONENT_THICK)
          .border({ width: 1, color: Theme.glassBorder })
          .shadow({ radius: 24, color: 'rgba(120,90,40,0.08)', offsetY: 8 })
          .alignItems(HorizontalAlign.Start)
          .margin({ left: 16, right: 16, top: 12 })
        } else {
          Scroll() {
            Column({ space: 10 }) {
              this.tabs()

              if (this.tab === 'users') {
                Row({ space: 14 }) {
                  this.stat(String(this.stats.total), '用户')
                  this.stat(String(this.stats.admins), '管理员')
                  this.stat(String(this.stats.tests), '测试号')
                  this.stat(String(this.stats.disabled), '已封禁')
                }
                .justifyContent(FlexAlign.Start)
                .width('100%')
                .padding(12)
                .borderRadius(12)
                .backgroundColor(Theme.glass)
                .backgroundBlurStyle(BlurStyle.COMPONENT_THICK)
                .border({ width: 1, color: Theme.glassBorder })
                .shadow({ radius: 24, color: 'rgba(120,90,40,0.08)', offsetY: 8 })
                this.searchRow('搜用户名 / 昵称 / ID')
              } else if (this.tab === 'feedback') {
                this.searchRow('反馈不在这里搜，直接翻列表')
              } else {
                this.searchRow('搜品种名 / 年份')
              }

              if (this.loading) {
                Text('加载中…')
                  .fontSize(11)
                  .fontColor(Theme.faint)
                  .width('100%')
                  .textAlign(TextAlign.Center)
                  .padding(24)
              } else if (this.err.length > 0) {
                Text(this.err + ' · 点此重试')
                  .fontSize(11)
                  .fontColor(Theme.up)
                  .width('100%')
                  .textAlign(TextAlign.Center)
                  .padding(24)
                  .onClick((): void => {
                    this.switchTab(this.tab);
                  })
              }

              Column() {
                if (this.tab === 'users') {
                  ForEach(this.users, (u: AdminUser) => {
                    Column() {
                      this.userRow(u)
                      Divider().color(Theme.lineSoft)
                    }
                  }, (u: AdminUser) => u.id)
                } else if (this.tab === 'feedback') {
                  ForEach(this.feedbacks, (it: AdminFeedback) => {
                    Column() {
                      this.feedbackRow(it)
                      Divider().color(Theme.lineSoft)
                    }
                  }, (it: AdminFeedback) => it.id)
                } else {
                  ForEach(this.coins, (c: AdminCoin) => {
                    Column() {
                      this.coinRow(c)
                      Divider().color(Theme.lineSoft)
                    }
                  }, (c: AdminCoin) => String(c.no))
                }
              }
              .width('100%')
              .padding({ left: 12, right: 12 })
              .borderRadius(12)
              .backgroundColor(Theme.glass)
              .backgroundBlurStyle(BlurStyle.COMPONENT_THICK)
              .border({ width: 1, color: Theme.glassBorder })
              .shadow({ radius: 24, color: 'rgba(120,90,40,0.08)', offsetY: 8 })

              Text('管理端说明：用户封禁/解封、反馈处理、品种基础字段编辑已支持；发行计划、贵金属、系列与图片管理请在网页版后台操作。')
                .fontSize(9)
                .fontColor(Theme.faint)
                .lineHeight(16)
                .width('100%')
                .padding({ top: 6 })

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
      }
      .width('100%')
      .height('100%')
      .backgroundColor(Color.Transparent)

      if (this.editOpen) {
        this.editSheet()
      }
    }
    .width('100%')
    .height('100%')
  }

  @Builder
  stat(v: string, k: string) {
    Column({ space: 2 }) {
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
}
