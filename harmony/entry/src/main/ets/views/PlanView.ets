import { promptAction } from '@kit.ArkUI';
import { Api } from '../utils/api';
import { Catalog } from '../utils/catalog';
import { Clip } from '../utils/clip';
import { money } from '../utils/format';
import { Nav, RouteParam, Routes } from '../utils/router';
import { Store } from '../utils/store';
import { Theme } from '../utils/theme';
import { PlanItem, PlanPmDoc, PlansResponse, PlanYear } from '../model/types';
import { EmptyTip } from '../components/Common';

/** 计划行（渲染用，预计算徽标/倒计时/提醒状态） */
class PlanRow {
  key: string = '';
  name: string = '';
  short: string = '';
  kindText: string = '';
  badgeText: string = '';
  badgeCls: string = 'done';
  cdText: string = '';
  cdCls: string = '';
  dateText: string = '';
  dateFull: string = '';
  reserveText: string = '';
  exchangeText: string = '';
  limitText: string = '';
  note: string = '';
  face: number = 0;
  mintageText: string = '';
  unit: string = '';
  canRemind: boolean = false;
  isUp: boolean = false;
  coinId: number = 0;
  extra: boolean = false;
  banks: string = '';
  proxy: number = 0;
  ob: string = '';
  rev: string = '';
  sourceText: string = '';
  sourceUrl: string = '';
  specText: string = '';
  schedule: PlanSchedule[] = [];
}

class PlanSchedule {
  k: string = '';
  v: string = '';
}

class PlanGroup {
  year: number = 0;
  planCount: number = 0;
  extraCount: number = 0;
  doneCount: number = 0;
  items: PlanRow[] = [];
}

class PmGroup {
  year: number = 0;
  total: number = 0;
  pieces: number = 0;
  items: PmRowView[] = [];
}

class PmRowView {
  key: string = '';
  name: string = '';
  code: string = '';
  pieces: number = 0;
  dateText: string = '';
}

class ReminderItem {
  key: string = '';
  remindAt: string = '';
  status: string = '';
}

class RemindersResponse {
  ok: boolean = false;
  items: ReminderItem[] = [];
}

class ReminderCreated {
  ok: boolean = false;
  remindText: string = '';
}

/** 请求体（ArkTS 需要显式类型） */
class ReminderBody {
  key: string = '';

  constructor(key: string) {
    this.key = key;
  }
}

@Component
export struct PlanView {
  // NavPathStack 是框架原生对象：@Prop 会尝试深拷贝，运行时会 Cpp Crash
  stack: NavPathStack = new NavPathStack();
  onSwitchTab: (index: number) => void = (index: number): void => {
  };

  @StorageProp('cl_dataRev') @Watch('onStoreChange') dataRev: number = 0;
  @State tab: string = 'coin';
  @State groups: PlanGroup[] = [];
  @State source: string = '';
  @State nextName: string = '';
  @State nextMeta: string = '';
  @State hasNext: boolean = false;
  @State totalCoins: number = 0;
  @State plansError: string = '';
  @State pmGroups: PmGroup[] = [];
  @State pmAllCount: number = 0;
  @State detail: PlanRow | null = null;
  @State reminded: Record<string, string> = {};
  @State refreshing: boolean = false;

  private plansFromApi: PlansResponse | null = null;
  private pmAll: PmGroup[] = [];
  private ticker: number = -1;
  private pmShown: number = 2;

  aboutToAppear(): void {
    this.rebuild();
    this.loadPlans();
    this.loadReminders();
    this.startTicker();
  }

  aboutToDisappear(): void {
    this.stopTicker();
  }

  onStoreChange(): void {
    this.loadReminders();
  }

  private startTicker(): void {
    this.stopTicker();
    this.ticker = setInterval((): void => {
      this.rebuild();
      if (this.detail !== null) {
        const key = (this.detail as PlanRow).key;
        const all = this.allRows();
        const hit = all.filter((r: PlanRow): boolean => r.key === key);
        this.detail = hit.length > 0 ? hit[0] : null;
      }
    }, 60000);
  }

  private stopTicker(): void {
    if (this.ticker >= 0) {
      clearInterval(this.ticker);
      this.ticker = -1;
    }
  }

  private allRows(): PlanRow[] {
    const out: PlanRow[] = [];
    for (let i = 0; i < this.groups.length; i++) {
      for (let j = 0; j < this.groups[i].items.length; j++) {
        out.push(this.groups[i].items[j]);
      }
    }
    return out;
  }

  private loadPlans(): void {
    Api.get<PlansResponse>('/api/plans').then((res: PlansResponse): void => {
      if (!res || !res.ok) return;
      this.plansFromApi = res;
      this.plansError = '';
      this.rebuild();
      this.buildPm();
    }).catch((): void => {
      this.plansError = '计划数据加载失败，点此重试';
    });
  }

  private doRefresh(): void {
    this.refreshing = true;
    this.plansError = '';
    Api.get<PlansResponse>('/api/plans').then((res: PlansResponse): void => {
      if (res && res.ok) {
        this.plansFromApi = res;
        this.rebuild();
        this.buildPm();
      }
      this.refreshing = false;
    }).catch((): void => {
      this.plansError = '计划数据加载失败，点此重试';
      this.refreshing = false;
    });
  }

  private reserveState(text: string): string {
    if (!/\d{1,2}:\d{2}/.test(text)) return '';
    const m = text.replace(/\s+/g, ' ').trim()
      .match(/^(\d{4}-\d{2}-\d{2})(?:\s+(\d{1,2}):(\d{2}))?\s*至\s*(?:(\d{4})-)?(\d{2})-(\d{2})(?:\s+(\d{1,2}):(\d{2}))?/);
    if (m === null) return '';
    const y = m[1].slice(0, 4);
    const start = new Date(m[1] + 'T' + (m[2] || '00') + ':' + (m[3] || '00') + ':00');
    const endY = m[4] || y;
    let end: Date;
    if (m[7] === '24') {
      end = new Date(endY + '-' + m[5] + '-' + m[6] + 'T00:00:00');
      end.setDate(end.getDate() + 1);
    } else {
      end = new Date(endY + '-' + m[5] + '-' + m[6] + 'T' + (m[7] || '23') + ':' + (m[8] || '59') + ':00');
    }
    if (isNaN(start.getTime()) || isNaN(end.getTime())) return '';
    const now = new Date();
    if (now < start) {
      const h = Math.ceil((start.getTime() - now.getTime()) / 3600000);
      return h < 24 ? ('距预约 ' + h + ' 小时') : ('距预约 ' + Math.ceil(h / 24) + ' 天');
    }
    if (now <= end) {
      return '预约中 · 剩 ' + Math.ceil((end.getTime() - now.getTime()) / 3600000) + ' 小时';
    }
    return '预约已结束';
  }

  private rebuild(): void {
    const apiPlan = this.plansFromApi !== null ? this.plansFromApi.plan : null;
    const plan = apiPlan !== null && apiPlan.years && apiPlan.years.length > 0 ? apiPlan : Catalog.plan;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    let next: PlanRow | null = null;
    let nextDays = 99999;
    let source = '';
    const groups: PlanGroup[] = [];

    for (let yi = 0; yi < (plan.years || []).length; yi++) {
      const y: PlanYear = plan.years[yi];
      if (y.sourceUrl && source === '') source = '中国人民银行 ' + (y.publishedAt || '') + ' 公布';
      const g = new PlanGroup();
      g.year = y.year;
      const items: PlanRow[] = [];
      for (let ii = 0; ii < (y.items || []).length; ii++) {
        const it: PlanItem = y.items[ii];
        const d = it.date ? new Date(it.date + 'T00:00:00') : null;
        const days = d !== null ? Math.round((d.getTime() - today.getTime()) / 86400000) : -1;
        const isUp = it.status === 'upcoming';
        const rs = this.reserveState(it.reserve || '');
        const reserveNow = rs.indexOf('预约中') >= 0;
        const canRemind = isUp && rs.indexOf('已结束') < 0 && days >= 0;
        let cdText = rs;
        if (cdText === '' && isUp && days >= 0) {
          cdText = days > 0 ? ('还有 ' + days + ' 天') : (days === 0 ? '今天发行' : '已过发行日');
        }
        const row = new PlanRow();
        row.key = it.key;
        row.name = it.name;
        row.short = it.short || it.name;
        row.kindText = it.kind === 'note' ? '纪念钞' : '纪念币';
        row.badgeText = reserveNow ? '预约中' : (isUp ? '待发行' : '已发行');
        row.badgeCls = reserveNow ? 'now' : (isUp ? 'up' : 'done');
        row.cdText = cdText;
        row.cdCls = rs.indexOf('预约中') >= 0 ? 'now'
          : (rs.indexOf('距预约') >= 0 ? 'soon' : (rs.indexOf('结束') >= 0 ? 'end' : ''));
        row.dateText = it.date ? it.date.slice(5).replace(/-/g, '/') : '待定';
        row.dateFull = it.date || '';
        row.reserveText = (it.reserve || '').replace(/-/g, '/');
        row.exchangeText = (it.exchange || '').replace(/-/g, '/');
        row.limitText = it.limit ? ('每人限 ' + it.limit + (it.kind === 'note' ? ' 张' : ' 枚')) : '';
        row.note = it.note || '';
        row.face = it.face || 0;
        row.mintageText = it.mintage ? money(it.mintage) + ' 万' : '';
        row.unit = it.kind === 'note' ? '张' : '枚';
        row.canRemind = canRemind;
        row.isUp = isUp;
        row.coinId = it.coinNo || 0;
        row.extra = !!it.extra;
        row.banks = it.banks || '';
        row.proxy = it.proxy || 0;
        row.ob = it.design && it.design.obverse ? it.design.obverse : '';
        row.rev = it.design && it.design.reverse ? it.design.reverse : '';
        row.sourceText = it.sourceText || '';
        row.sourceUrl = it.sourceUrl || '';
        row.specText = [
          it.face ? it.face + ' 元' : '',
          it.material || '',
          it.dia || '',
          it.mintage ? money(it.mintage) + ' 万' + row.unit : ''
        ].filter((x: string): boolean => x !== '').join(' · ');
        if (it.schedule && it.schedule.length > 0) {
          const sch: PlanSchedule[] = [];
          for (let si = 0; si < it.schedule.length; si++) {
            const s = new PlanSchedule();
            s.k = it.schedule[si].k;
            s.v = it.schedule[si].v;
            sch.push(s);
          }
          row.schedule = sch;
        }
        if (isUp && days >= 0 && days < nextDays) {
          next = row;
          nextDays = days;
        }
        items.push(row);
      }
      items.sort((a: PlanRow, b: PlanRow): number => String(b.dateFull).localeCompare(String(a.dateFull)));
      g.items = items;
      g.planCount = items.filter((r: PlanRow): boolean => !r.extra).length;
      g.extraCount = items.filter((r: PlanRow): boolean => r.extra).length;
      g.doneCount = items.filter((r: PlanRow): boolean => !r.isUp).length;
      groups.push(g);
    }

    groups.sort((a: PlanGroup, b: PlanGroup): number => b.year - a.year);
    this.groups = groups;
    this.source = source;
    this.totalCoins = Catalog.total();
    this.hasNext = next !== null;
    if (next !== null) {
      const n: PlanRow = next as PlanRow;
      this.nextName = n.short;
      this.nextMeta = n.dateText + ' 发行 · ' + n.cdText;
    }
  }

  private buildPm(): void {
    const src: PlanPmDoc | null = this.plansFromApi !== null ? this.plansFromApi.planPm : null;
    if (src === null || !Array.isArray(src.years)) return;
    const all: PmGroup[] = [];
    for (let i = 0; i < src.years.length; i++) {
      const y = src.years[i];
      const g = new PmGroup();
      g.year = y.year;
      g.total = (y.items || []).length;
      let pieces = 0;
      const rows: PmRowView[] = [];
      for (let j = 0; j < (y.items || []).length; j++) {
        const it = y.items[j];
        pieces += Number(it.pieces) || 0;
        const r = new PmRowView();
        r.key = it.key;
        r.name = it.name;
        r.code = it.code;
        r.pieces = Number(it.pieces) || 0;
        r.dateText = it.release || '';
        rows.push(r);
      }
      g.pieces = pieces;
      g.items = rows;
      all.push(g);
    }
    this.pmAll = all;
    this.pmAllCount = all.length;
    const shown = Math.min(this.pmShown, all.length);
    this.pmGroups = all.slice(0, shown);
  }

  private loadMorePm(): void {
    if (this.pmGroups.length >= this.pmAll.length) return;
    this.pmShown = Math.min(this.pmShown + 3, this.pmAll.length);
    this.pmGroups = this.pmAll.slice(0, this.pmShown);
  }

  private loadReminders(): void {
    // 本机提醒（鸿蒙端只做应用内标记）+ 其他端（微信）已在服务端设过的提醒
    const map: Record<string, string> = Store.getLocalReminders();
    this.reminded = map;
    if (!Store.isLogin()) return;
    Api.get<RemindersResponse>('/api/reminders').then((res: RemindersResponse): void => {
      const merged: Record<string, string> = Store.getLocalReminders();
      const items = res.items || [];
      for (let i = 0; i < items.length; i++) {
        const it = items[i];
        if (it.status !== 'pending') continue;
        const d = new Date(it.remindAt);
        if (isNaN(d.getTime())) continue;
        if (merged[it.key] !== undefined) continue;
        merged[it.key] = (d.getMonth() + 1) + '月' + d.getDate() + '日 ' +
          ('0' + String(d.getHours())).slice(-2) + ':' + ('0' + String(d.getMinutes())).slice(-2);
      }
      this.reminded = merged;
    }).catch((): void => {
    });
  }

  /**
   * 提醒：鸿蒙端不做微信订阅消息，也不申请受限的后台代理提醒权限，
   * 只在应用内把这一项标记出来（重装/换机不会丢在服务端的账号数据，但本机标记会清）。
   */
  private remind(row: PlanRow): void {
    if (!row.canRemind) return;
    if (!Store.isLogin()) {
      promptAction.showToast({ message: '登录后才能设置提醒', duration: 1800 });
      Nav.push(this.stack, Routes.ACCOUNT, new RouteParam());
      return;
    }
    const text = row.dateText + ' ' + (row.cdText || '');
    Store.setLocalReminder(row.key, text);
    this.loadReminders();
    promptAction.showToast({
      message: '已记录：' + row.dateText + ' 发行，可在本页查看倒计时',
      duration: 2200
    });
  }

  @Builder
  badge(text: string, cls: string) {
    Text(text)
      .fontSize(10)
      .fontColor(cls === 'now' ? Color.White : (cls === 'up' ? Theme.goldDeep : Theme.muted))
      .padding({ left: 7, right: 7, top: 2, bottom: 2 })
      .borderRadius(5)
      .backgroundColor(cls === 'now' ? Theme.gold : (cls === 'up' ? Theme.goldBg : '#F1EEE6'))
  }

  @Builder
  coinItem(row: PlanRow) {
    Row({ space: 10 }) {
      Column({ space: 4 }) {
        Text(row.name)
          .fontSize(13)
          .fontColor(Theme.textStrong)
          .maxLines(2)
          .textOverflow({ overflow: TextOverflow.Ellipsis })
        Row({ space: 6 }) {
          Text(row.kindText)
            .fontSize(9)
            .fontColor(Theme.goldDeep)
            .padding({ left: 5, right: 5, top: 1, bottom: 1 })
            .backgroundColor(Theme.goldBg)
            .borderRadius(4)
          if (row.extra) {
            Text('增发')
              .fontSize(9)
              .fontColor(Theme.up)
          }
          Text(row.face + ' 元')
            .fontSize(10)
            .fontColor(Theme.muted)
          if (row.mintageText.length > 0) {
            Text(row.mintageText + row.unit)
              .fontSize(10)
              .fontColor(Theme.muted)
          }
        }
        if (row.note.length > 0) {
          Text(row.note)
            .fontSize(10)
            .fontColor(Theme.faint)
            .maxLines(1)
            .textOverflow({ overflow: TextOverflow.Ellipsis })
        }
        if (row.reserveText.length > 0 || row.exchangeText.length > 0) {
          Text((row.reserveText.length > 0 ? row.reserveText + ' 预约' : '')
            + (row.reserveText.length > 0 && row.exchangeText.length > 0 ? ' · ' : '')
            + (row.exchangeText.length > 0 ? row.exchangeText + ' 兑换' : ''))
            .fontSize(9)
            .fontColor(Theme.faint)
        }
      }
      .layoutWeight(1)
      .alignItems(HorizontalAlign.Start)

      Column({ space: 4 }) {
        this.badge(row.badgeText, row.badgeCls)
        Text(row.dateText + ' 发行')
          .fontSize(9)
          .fontColor(Theme.faint)
        if (row.cdText.length > 0) {
          Text(row.cdText)
            .fontSize(10)
            .fontColor(row.cdCls === 'now' ? Theme.up : (row.cdCls === 'end' ? Theme.faint : Theme.goldDeep))
        }
        if (row.canRemind) {
          Text(this.reminded[row.key] !== undefined ? '已设提醒' : '提醒我')
            .fontSize(10)
            .fontColor(this.reminded[row.key] !== undefined ? Theme.goldDeep : Theme.gold)
            .padding({ left: 8, right: 8, top: 3, bottom: 3 })
            .borderRadius(10)
            .backgroundColor(this.reminded[row.key] !== undefined ? Theme.goldBg : '#FBF6EA')
            .border({ width: 1, color: Theme.goldLine })
            .onClick((): void => {
              this.remind(row);
            })
        }
        if (this.reminded[row.key] !== undefined) {
          Text(this.reminded[row.key])
            .fontSize(9)
            .fontColor(Theme.faint)
        }
      }
      .alignItems(HorizontalAlign.End)
    }
    .width('100%')
    .padding({ top: 11, bottom: 11 })
    .alignItems(VerticalAlign.Top)
    .onClick((): void => {
      if (row.coinId > 0) {
        Nav.push(this.stack, Routes.DETAIL, RouteParam.of(row.coinId));
        return;
      }
      this.detail = row;
    })
  }

  @Builder
  detailSheet(row: PlanRow) {
    Stack() {
      Column()
        .width('100%')
        .height('100%')
        .backgroundColor('rgba(20,16,10,0.45)')
        .onClick((): void => {
          this.detail = null;
        })

      Column() {
        Row() {
          Text(row.name)
            .fontSize(16)
            .fontWeight(FontWeight.Medium)
            .fontColor(Theme.text)
            .layoutWeight(1)
          Text('✕')
            .fontSize(16)
            .fontColor(Theme.muted)
            .onClick((): void => {
              this.detail = null;
            })
        }
        .width('100%')
        .padding({ bottom: 10 })

        Scroll() {
          Column({ space: 10 }) {
            Text(row.isUp ? ('待发行 · ' + (row.cdText || row.dateFull)) : '已发行')
              .fontSize(12)
              .fontColor(row.isUp ? Theme.goldDeep : Theme.muted)
              .padding({ left: 8, right: 8, top: 3, bottom: 3 })
              .backgroundColor(row.isUp ? Theme.goldBg : '#F1EEE6')
              .borderRadius(6)

            Column({ space: 8 }) {
              if (row.schedule.length > 0) {
                ForEach(row.schedule, (s: PlanSchedule) => {
                  Row() {
                    Text(s.k)
                      .fontSize(12)
                      .fontColor(Theme.faint)
                      .width(72)
                    Text(s.v)
                      .fontSize(12)
                      .fontColor(Theme.textStrong)
                      .layoutWeight(1)
                  }
                  .width('100%')
                  .alignItems(VerticalAlign.Top)
                }, (s: PlanSchedule) => s.k)
              } else {
                Row() {
                  Text('发行日').fontSize(12).fontColor(Theme.faint).width(72)
                  Text(row.dateFull || '待定').fontSize(12).fontColor(Theme.textStrong).layoutWeight(1)
                }
                if (row.reserveText.length > 0) {
                  Row() {
                    Text('预约').fontSize(12).fontColor(Theme.faint).width(72)
                    Text(row.reserveText).fontSize(12).fontColor(Theme.textStrong).layoutWeight(1)
                  }
                }
                if (row.exchangeText.length > 0) {
                  Row() {
                    Text('兑换').fontSize(12).fontColor(Theme.faint).width(72)
                    Text(row.exchangeText).fontSize(12).fontColor(Theme.textStrong).layoutWeight(1)
                  }
                }
              }
            }
            .width('100%')
            .padding(12)
            .borderRadius(8)
            .backgroundColor(Theme.bg)
            .alignItems(HorizontalAlign.Start)

            if (row.specText.length > 0) {
              Text(row.specText).fontSize(11).fontColor(Theme.muted)
            }

            if (row.banks.length > 0) {
              Column({ space: 4 }) {
                Text('承办银行').fontSize(12).fontColor(Theme.text).fontWeight(FontWeight.Medium)
                Text(row.banks).fontSize(11).fontColor(Theme.muted).lineHeight(18)
              }
              .width('100%')
              .alignItems(HorizontalAlign.Start)
            }

            if (row.limitText.length > 0) {
              Column({ space: 4 }) {
                Text('限额').fontSize(12).fontColor(Theme.text).fontWeight(FontWeight.Medium)
                Text(row.limitText + (row.proxy > 0 ? ('，最多代 ' + row.proxy + ' 人办理') : ''))
                  .fontSize(11)
                  .fontColor(Theme.muted)
                  .lineHeight(18)
              }
              .width('100%')
              .alignItems(HorizontalAlign.Start)
            }

            if (row.ob.length > 0) {
              Column({ space: 4 }) {
                Text('正面图案').fontSize(12).fontColor(Theme.text).fontWeight(FontWeight.Medium)
                Text(row.ob).fontSize(11).fontColor(Theme.muted).lineHeight(18)
              }
              .width('100%')
              .alignItems(HorizontalAlign.Start)
            }
            if (row.rev.length > 0) {
              Column({ space: 4 }) {
                Text('背面图案').fontSize(12).fontColor(Theme.text).fontWeight(FontWeight.Medium)
                Text(row.rev).fontSize(11).fontColor(Theme.muted).lineHeight(18)
              }
              .width('100%')
              .alignItems(HorizontalAlign.Start)
            }

            if (row.sourceText.length > 0) {
              Text(row.sourceText).fontSize(10).fontColor(Theme.faint)
            }
          }
          .width('100%')
          .alignItems(HorizontalAlign.Start)
        }
        .constraintSize({ maxHeight: 420 })
        .scrollBar(BarState.Off)

        if (row.sourceUrl.length > 0) {
          Text('复制公告链接')
            .fontSize(14)
            .fontColor(Color.White)
            .textAlign(TextAlign.Center)
            .width('100%')
            .height(42)
            .borderRadius(8)
            .backgroundColor(Theme.gold)
            .margin({ top: 12 })
            .onClick((): void => {
              Clip.copy(row.sourceUrl, '公告链接已复制');
            })
        }
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

  @Builder
  tabButton(label: string, key: string) {
    Text(label)
      .fontSize(12)
      .fontColor(this.tab === key ? Color.White : Theme.muted)
      .textAlign(TextAlign.Center)
      .layoutWeight(1)
      .height(34)
      .borderRadius(17)
      .backgroundColor(this.tab === key ? Theme.gold : Theme.card)
      .onClick((): void => {
        this.tab = key;
      })
  }

  build() {
    Stack() {
      Refresh({ refreshing: $$this.refreshing }) {
        Scroll() {
          Column() {
            Column({ space: 4 }) {
              Row() {
                Text('发行计划')
                  .fontSize(22)
                  .fontWeight(FontWeight.Bold)
                  .fontColor(Theme.text)
                Blank()
              }
              .width('100%')
              if (this.source.length > 0) {
                Text(this.source)
                  .fontSize(10)
                  .fontColor(Theme.faint)
              }
            }
            .width('100%')
            .alignItems(HorizontalAlign.Start)
            .padding({ left: 16, right: 16, top: 16, bottom: 10 })

            if (this.hasNext) {
              Row({ space: 8 }) {
                Text('下一枚')
                  .fontSize(10)
                  .fontColor(Theme.goldDeep)
                  .padding({ left: 6, right: 6, top: 2, bottom: 2 })
                  .backgroundColor('#FFFFFFCC')
                  .borderRadius(5)
                Text(this.nextName)
                  .fontSize(13)
                  .fontWeight(FontWeight.Medium)
                  .fontColor(Theme.goldDeep)
                Blank()
                Text(this.nextMeta)
                  .fontSize(11)
                  .fontColor(Theme.muted)
              }
              .width('100%')
              .padding(12)
              .borderRadius(12)
              .backgroundColor('#F6EFE0')
              .margin({ left: 16, right: 16, bottom: 12 })
            }

            Row({ space: 8 }) {
              this.tabButton('普通纪念币（钞）', 'coin')
              this.tabButton('贵金属纪念币', 'pm')
            }
            .width('100%')
            .padding({ left: 16, right: 16, bottom: 10 })

            if (this.plansError.length > 0) {
              Text(this.plansError)
                .fontSize(12)
                .fontColor(Theme.up)
                .padding(12)
                .onClick((): void => {
                  this.plansError = '';
                  this.loadPlans();
                })
            }

            if (this.tab === 'pm') {
              if (this.pmGroups.length === 0 && this.plansError.length === 0) {
                EmptyTip({ text: '贵金属发行计划暂不可用，下拉刷新重试' })
              }
              ForEach(this.pmGroups, (g: PmGroup) => {
                Column() {
                  Row() {
                    Text(String(g.year) + ' 年')
                      .fontSize(14)
                      .fontWeight(FontWeight.Medium)
                      .fontColor(Theme.text)
                    Blank()
                    Text(g.total + ' 个项目 · ' + g.pieces + ' 枚')
                      .fontSize(10)
                      .fontColor(Theme.faint)
                  }
                  .width('100%')
                  .padding({ top: 10, bottom: 6 })

                  Column() {
                    ForEach(g.items, (it: PmRowView) => {
                      Row({ space: 8 }) {
                        Column({ space: 3 }) {
                          Text(it.name)
                            .fontSize(13)
                            .fontColor(Theme.textStrong)
                            .maxLines(1)
                            .textOverflow({ overflow: TextOverflow.Ellipsis })
                          Row({ space: 8 }) {
                            Text(it.code)
                              .fontSize(9)
                              .fontColor(Theme.goldDeep)
                            Text(it.pieces + ' 枚')
                              .fontSize(9)
                              .fontColor(Theme.muted)
                            if (it.dateText.length > 0) {
                              Text(it.dateText + ' 发行')
                                .fontSize(9)
                                .fontColor(Theme.faint)
                            }
                          }
                        }
                        .layoutWeight(1)
                        .alignItems(HorizontalAlign.Start)

                        Text('已发行')
                          .fontSize(9)
                          .fontColor(Theme.muted)
                          .padding({ left: 6, right: 6, top: 2, bottom: 2 })
                          .backgroundColor('#F1EEE6')
                          .borderRadius(4)
                      }
                      .width('100%')
                      .padding({ top: 10, bottom: 10 })
                      .border({ width: { bottom: 1 }, color: Theme.lineSoft })
                    }, (it: PmRowView) => it.key)
                  }
                  .width('100%')
                  .padding({ left: 12, right: 12 })
                  .borderRadius(12)
                  .backgroundColor(Theme.card)
                }
                .width('100%')
                .padding({ left: 16, right: 16 })
              }, (g: PmGroup) => String(g.year))

              if (this.pmGroups.length < this.pmAllCount) {
                Text('上拉加载更多')
                  .fontSize(11)
                  .fontColor(Theme.gold)
                  .width('100%')
                  .textAlign(TextAlign.Center)
                  .padding(14)
                  .onClick((): void => {
                    this.loadMorePm();
                  })
              } else if (this.pmGroups.length > 0) {
                Text('已经到底了')
                  .fontSize(10)
                  .fontColor(Theme.faint)
                  .width('100%')
                  .textAlign(TextAlign.Center)
                  .padding(14)
              }
            } else {
              if (this.groups.length === 0) {
                EmptyTip({ text: '暂无可用的发行计划数据' })
              }
              ForEach(this.groups, (g: PlanGroup) => {
                Column() {
                  Row() {
                    Text(String(g.year) + ' 年')
                      .fontSize(14)
                      .fontWeight(FontWeight.Medium)
                      .fontColor(Theme.text)
                    Blank()
                    Text(g.planCount + ' 项' + (g.extraCount > 0 ? ' · 增发 ' + g.extraCount : '')
                      + ' · 已发 ' + g.doneCount)
                      .fontSize(10)
                      .fontColor(Theme.faint)
                  }
                  .width('100%')
                  .padding({ top: 10, bottom: 6 })

                  Column() {
                    ForEach(g.items, (row: PlanRow) => {
                      Column() {
                        this.coinItem(row)
                        Divider().color(Theme.lineSoft)
                      }
                    }, (row: PlanRow) => row.key)
                  }
                  .width('100%')
                  .padding({ left: 12, right: 12 })
                  .borderRadius(12)
                  .backgroundColor(Theme.card)
                }
                .width('100%')
                .padding({ left: 16, right: 16 })
              }, (g: PlanGroup) => String(g.year))

              Column({ space: 10 }) {
                Text('来源：中国人民银行年度公告，以发行前公告为准')
                  .fontSize(10)
                  .fontColor(Theme.faint)
                Text('去看已发行的 ' + this.totalCoins + ' 个品种 ›')
                  .fontSize(12)
                  .fontColor(Theme.gold)
                  .onClick((): void => {
                    this.onSwitchTab(2);
                  })
              }
              .width('100%')
              .padding({ top: 18, bottom: 24 })
            }
          }
          .width('100%')
        }
        .scrollBar(BarState.Off)
        .edgeEffect(EdgeEffect.Spring)
      }
      .onRefreshing((): void => {
        this.doRefresh();
      })

      if (this.detail !== null) {
        this.detailSheet(this.detail as PlanRow)
      }
    }
    .width('100%')
    .height('100%')
    .backgroundColor(Theme.bg)
  }
}
