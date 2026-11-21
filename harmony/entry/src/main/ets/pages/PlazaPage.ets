import { promptAction } from '@kit.ArkUI';
import { Api } from '../utils/api';
import { agoText } from '../utils/format';
import { Nav, RouteParam, Routes } from '../utils/router';
import { Store } from '../utils/store';
import { Theme } from '../utils/theme';
import { ShareItem, ShareTag, SharesResponse } from '../model/types';

class ShareView {
  id: string = '';
  author: string = '';
  avatar: string = '';
  holdingName: string = '';
  serialsText: string = '';
  tagsText: string = '';
  images: string[] = [];
  note: string = '';
  likes: number = 0;
  liked: boolean = false;
  comments: number = 0;
  timeText: string = '';
}

class LikeResult {
  ok: boolean = false;
  liked: boolean = false;
  error: string = '';
}

class CommentItem {
  id: string = '';
  author: string = '';
  text: string = '';
  timeText: string = '';
}

class CommentsResponse {
  ok: boolean = false;
  items: CommentItem[] = [];
}

class CommentBody {
  text: string = '';

  constructor(text: string) {
    this.text = text;
  }
}

@Component
export struct PlazaPage {
  @Prop stack: NavPathStack;
  @State items: ShareView[] = [];
  @State sort: string = 'new';
  @State loading: boolean = true;
  @State err: string = '';
  @State page: number = 1;
  @State hasMore: boolean = false;
  @State commentOpen: boolean = false;
  @State commentTarget: string = '';
  @State comments: CommentItem[] = [];
  @State commentText: string = '';
  @State commentBusy: boolean = false;

  aboutToAppear(): void {
    this.load(1, false);
  }

  private load(page: number, append: boolean): void {
    this.loading = true;
    this.err = '';
    const offset = (page - 1) * 20;
    Api.get<SharesResponse>('/api/shares?sort=' + this.sort + '&limit=20&offset=' + offset)
      .then((res: SharesResponse): void => {
        if (!res || !res.ok || !Array.isArray(res.items)) {
          this.loading = false;
          this.err = '加载失败，点此重试';
          return;
        }
        const out: ShareView[] = [];
        for (let i = 0; i < res.items.length; i++) {
          out.push(this.toView(res.items[i]));
        }
        this.items = append ? this.items.concat(out) : out;
        this.page = page;
        // 服务端按 offset 分页且不返回 total：返回满 20 条就当作还有下一页
        this.hasMore = out.length >= 20;
        this.loading = false;
      }).catch((): void => {
        this.loading = false;
        this.err = '加载失败，点此重试';
      });
  }

  private toView(s: ShareItem): ShareView {
    const v = new ShareView();
    v.id = String(s.id);
    v.author = s.author || '藏友';
    v.avatar = s.avatar ? Api.imgUrl(s.avatar) : '';
    v.holdingName = s.holdingName || '';
    v.serialsText = s.serials && s.serials.length > 0 ? s.serials[0] : '';
    const tags: string[] = [];
    if (s.tags) {
      for (let i = 0; i < s.tags.length; i++) {
        const t = s.tags[i];
        tags.push(typeof t === 'string' ? t : (t.name || ''));
      }
    }
    v.tagsText = tags.filter((x: string): boolean => x !== '').join(' · ');
    v.images = (s.images || []).map((x: string): string => Api.imgUrl(x));
    v.note = s.caption || '';
    v.likes = s.likes || 0;
    v.liked = !!s.liked;
    v.comments = s.comments || 0;
    v.timeText = agoText(s.createdAt);
    return v;
  }

  private toggleLike(item: ShareView): void {
    if (!Store.isLogin()) {
      promptAction.showToast({ message: '登录后才能点赞', duration: 1500 });
      Nav.push(this.stack, Routes.ACCOUNT, new RouteParam());
      return;
    }
    Api.post<LikeResult>('/api/shares/' + item.id + '/like').then((res: LikeResult): void => {
      const next: ShareView[] = [];
      for (let i = 0; i < this.items.length; i++) {
        const v = this.items[i];
        if (v.id === item.id) {
          const before = v.liked;
          v.liked = res.liked;
          // 接口只回 liked 状态，数量在本地按状态变化增减
          if (res.liked && !before) v.likes = (v.likes || 0) + 1;
          if (!res.liked && before) v.likes = Math.max(0, (v.likes || 0) - 1);
        }
        next.push(v);
      }
      this.items = next;
    }).catch((e: Error): void => {
      promptAction.showToast({ message: e.message || '点赞失败', duration: 1600 });
    });
  }

  private openComments(item: ShareView): void {
    this.commentTarget = item.id;
    this.commentOpen = true;
    this.comments = [];
    this.commentText = '';
    Api.get<CommentsResponse>('/api/shares/' + item.id + '/comments').then((res: CommentsResponse): void => {
      this.comments = res.items || [];
    }).catch((): void => {
    });
  }

  private sendComment(): void {
    if (this.commentBusy) return;
    if (!Store.isLogin()) {
      promptAction.showToast({ message: '登录后才能评论', duration: 1500 });
      return;
    }
    const text = this.commentText.trim();
    if (text === '') {
      promptAction.showToast({ message: '说点什么吧', duration: 1400 });
      return;
    }
    this.commentBusy = true;
    Api.post<CommentsResponse>('/api/shares/' + this.commentTarget + '/comments', new CommentBody(text))
      .then((): void => {
        this.commentBusy = false;
        this.commentText = '';
        Api.get<CommentsResponse>('/api/shares/' + this.commentTarget + '/comments')
          .then((res: CommentsResponse): void => {
            this.comments = res.items || [];
          }).catch((): void => {
          });
        // 评论数 +1
        const next: ShareView[] = [];
        for (let i = 0; i < this.items.length; i++) {
          const v = this.items[i];
          if (v.id === this.commentTarget) v.comments = (v.comments || 0) + 1;
          next.push(v);
        }
        this.items = next;
      }).catch((e: Error): void => {
        this.commentBusy = false;
        promptAction.showToast({ message: e.message || '发送失败', duration: 1600 });
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
      Text('藏品广场')
        .fontSize(15)
        .fontWeight(FontWeight.Medium)
        .fontColor(Theme.text)
      Blank()
      Text('最新')
        .fontSize(11)
        .fontColor(this.sort === 'new' ? Theme.gold : Theme.faint)
        .onClick((): void => {
          if (this.sort === 'new') return;
          this.sort = 'new';
          this.load(1, false);
        })
      Text('最热')
        .fontSize(11)
        .fontColor(this.sort === 'hot' ? Theme.gold : Theme.faint)
        .margin({ left: 12 })
        .onClick((): void => {
          if (this.sort === 'hot') return;
          this.sort = 'hot';
          this.load(1, false);
        })
    }
    .width('100%')
    .height(44)
    .padding({ left: 8, right: 14 })
  }

  @Builder
  commentSheet() {
    Stack() {
      Column()
        .width('100%')
        .height('100%')
        .backgroundColor('rgba(20,16,10,0.42)')
        .onClick((): void => {
          this.commentOpen = false;
        })
      Column({ space: 10 }) {
        Row() {
          Text('评论 (' + this.comments.length + ')')
            .fontSize(15)
            .fontWeight(FontWeight.Medium)
            .fontColor(Theme.text)
          Blank()
          Text('✕')
            .fontSize(15)
            .fontColor(Theme.muted)
            .onClick((): void => {
              this.commentOpen = false;
            })
        }
        .width('100%')

        Column() {
          if (this.comments.length === 0) {
            Text('还没有评论，来说第一句')
              .fontSize(11)
              .fontColor(Theme.faint)
              .width('100%')
              .textAlign(TextAlign.Center)
              .padding(24)
          }
          List({ space: 8 }) {
            ForEach(this.comments, (c: CommentItem) => {
              ListItem() {
                Column({ space: 3 }) {
                  Row() {
                    Text(c.author)
                      .fontSize(11)
                      .fontColor(Theme.goldDeep)
                    Blank()
                    Text(c.timeText)
                      .fontSize(9)
                      .fontColor(Theme.faint)
                  }
                  .width('100%')
                  Text(c.text)
                    .fontSize(12)
                    .fontColor(Theme.textStrong)
                    .lineHeight(19)
                }
                .width('100%')
                .padding({ top: 6, bottom: 6 })
                .alignItems(HorizontalAlign.Start)
              }
            }, (c: CommentItem) => c.id)
          }
          .height(280)
          .scrollBar(BarState.Off)
        }
        .width('100%')

        Row({ space: 8 }) {
          TextInput({ text: $$this.commentText, placeholder: '友善评论，不晒他人号码' })
            .layoutWeight(1)
            .height(40)
            .fontSize(12)
            .backgroundColor(Theme.bg)
            .borderRadius(8)
            .padding({ left: 10, right: 10 })
          Text(this.commentBusy ? '…' : '发送')
            .fontSize(12)
            .fontColor(Color.White)
            .textAlign(TextAlign.Center)
            .width(64)
            .height(40)
            .borderRadius(8)
            .backgroundColor(this.commentBusy ? '#C9BFA9' : Theme.gold)
            .onClick((): void => {
              this.sendComment();
            })
        }
        .width('100%')
      }
      .width('90%')
      .padding(16)
      .borderRadius(16)
      .backgroundColor(Theme.card)
    }
    .width('100%')
    .height('100%')
    .alignContent(Alignment.Center)
  }

  @Builder
  card(item: ShareView) {
    Column({ space: 8 }) {
      Row({ space: 8 }) {
        if (item.avatar.length > 0) {
          Image(item.avatar)
            .width(32)
            .height(32)
            .borderRadius(16)
            .objectFit(ImageFit.Cover)
        } else {
          Text(item.author.slice(0, 1))
            .width(32)
            .height(32)
            .borderRadius(16)
            .textAlign(TextAlign.Center)
            .fontSize(13)
            .fontColor(Theme.goldDeep)
            .backgroundColor(Theme.goldBg)
        }
        Column({ space: 2 }) {
          Text(item.author)
            .fontSize(12)
            .fontColor(Theme.textStrong)
          Text(item.timeText)
            .fontSize(9)
            .fontColor(Theme.faint)
        }
        .layoutWeight(1)
        .alignItems(HorizontalAlign.Start)
      }
      .width('100%')

      Text(item.holdingName)
        .fontSize(13)
        .fontWeight(FontWeight.Medium)
        .fontColor(Theme.text)
      if (item.serialsText.length > 0) {
        Text('号码 ' + item.serialsText)
          .fontSize(10)
          .fontColor(Theme.gold)
      }
      if (item.images.length > 0) {
        Row({ space: 6 }) {
          ForEach(item.images.slice(0, 3), (url: string) => {
            Image(url)
              .width('32%')
              .height(96)
              .borderRadius(8)
              .objectFit(ImageFit.Cover)
          }, (url: string) => url)
        }
        .width('100%')
      }
      if (item.note.length > 0) {
        Text(item.note)
          .fontSize(11)
          .fontColor(Theme.muted)
          .lineHeight(19)
          .maxLines(3)
          .textOverflow({ overflow: TextOverflow.Ellipsis })
      }
      if (item.tagsText.length > 0) {
        Text('#' + item.tagsText.replace(/ · /g, ' #'))
          .fontSize(10)
          .fontColor(Theme.goldDeep)
      }
      Row({ space: 16 }) {
        Row({ space: 4 }) {
          Text(item.liked ? '♥' : '♡')
            .fontSize(14)
            .fontColor(item.liked ? Theme.up : Theme.faint)
          Text(item.likes > 0 ? String(item.likes) : '赞')
            .fontSize(10)
            .fontColor(Theme.faint)
        }
        .onClick((): void => {
          this.toggleLike(item);
        })
        Row({ space: 4 }) {
          Text('💬')
            .fontSize(12)
          Text(item.comments > 0 ? String(item.comments) : '评论')
            .fontSize(10)
            .fontColor(Theme.faint)
        }
        .onClick((): void => {
          this.openComments(item);
        })
        Blank()
      }
      .width('100%')
    }
    .width('100%')
    .padding(14)
    .borderRadius(14)
    .backgroundColor(Theme.card)
    .alignItems(HorizontalAlign.Start)
  }

  build() {
    Stack() {
      Column() {
        this.header()
        Scroll() {
          Column({ space: 10 }) {
            Column({ space: 4 }) {
              Text('藏友晒单')
                .fontSize(22)
                .fontWeight(FontWeight.Bold)
                .fontColor(Theme.text)
              Text('真实号码、真实藏品。发布入口在「我的藏品」里勾选后分享。')
                .fontSize(10)
                .fontColor(Theme.muted)
            }
            .width('100%')
            .alignItems(HorizontalAlign.Start)

            if (this.loading && this.items.length === 0) {
              Text('加载中…')
                .fontSize(11)
                .fontColor(Theme.faint)
                .width('100%')
                .textAlign(TextAlign.Center)
                .padding(30)
            } else if (this.err.length > 0) {
              Text(this.err)
                .fontSize(12)
                .fontColor(Theme.up)
                .width('100%')
                .textAlign(TextAlign.Center)
                .padding(30)
                .onClick((): void => {
                  this.load(1, false);
                })
            } else if (this.items.length === 0) {
              Text('还没有人晒单，去收藏页分享第一件吧')
                .fontSize(11)
                .fontColor(Theme.faint)
                .width('100%')
                .textAlign(TextAlign.Center)
                .padding(30)
            }

            ForEach(this.items, (item: ShareView) => {
              this.card(item)
            }, (item: ShareView) => item.id)

            if (this.items.length > 0 && this.hasMore) {
              Text(this.loading ? '加载中…' : '加载更多')
                .fontSize(12)
                .fontColor(Theme.gold)
                .width('100%')
                .textAlign(TextAlign.Center)
                .padding(14)
                .onClick((): void => {
                  if (!this.loading) this.load(this.page + 1, true);
                })
            }

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

      if (this.commentOpen) {
        this.commentSheet()
      }
    }
    .width('100%')
    .height('100%')
  }
}
