import { common } from '@kit.AbilityKit';
import { picker } from '@kit.CoreFileKit';
import { fileIo } from '@kit.CoreFileKit';
import { util } from '@kit.ArkTS';
import { promptAction } from '@kit.ArkUI';
import { holdingsCsv, parseImport } from '../utils/backup';
import { Clip } from '../utils/clip';
import { Nav, RouteParam, Routes } from '../utils/router';
import { Store } from '../utils/store';
import { Theme } from '../utils/theme';
import { Holding } from '../model/types';

class ImportResultView {
  ok: boolean = false;
  added: number = 0;
  total: number = 0;
  error: string = '';
}

@Component
export struct BackupPage {
  // NavPathStack 是框架原生对象：@Prop 会尝试深拷贝，运行时会 Cpp Crash
  stack: NavPathStack = new NavPathStack();
  @StorageProp('cl_dataRev') @Watch('onStoreChange') dataRev: number = 0;

  @State loggedIn: boolean = false;
  @State count: number = 0;
  @State busy: boolean = false;
  @State pasteOpen: boolean = false;
  @State pasteText: string = '';

  aboutToAppear(): void {
    this.render();
  }

  onStoreChange(): void {
    this.render();
  }

  private render(): void {
    const s = Store.getState();
    this.loggedIn = s.user !== null;
    this.count = s.holdings.length;
  }

  private needLogin(): boolean {
    if (this.loggedIn) return false;
    promptAction.showToast({ message: '登录后才能备份收藏', duration: 1500 });
    setTimeout((): void => {
      Nav.push(this.stack, Routes.ACCOUNT, new RouteParam());
    }, 500);
    return true;
  }

  private fileName(): string {
    const d = new Date();
    const day = String(d.getFullYear()) + String(d.getMonth() + 1).padStart(2, '0')
      + String(d.getDate()).padStart(2, '0');
    return '藏币录-收藏-' + day + '.csv';
  }

  /** 导出：调系统「保存到文件」，用户自己选位置（下载目录 / 网盘） */
  private async exportFile(): Promise<void> {
    if (this.needLogin() || this.busy) return;
    if (this.count === 0) {
      promptAction.showToast({ message: '账本还是空的', duration: 1500 });
      return;
    }
    this.busy = true;
    try {
      const csv = holdingsCsv(Store.getState().holdings);
      const ctx = getContext(this) as common.UIAbilityContext;
      const p = new picker.DocumentViewPicker(ctx);
      const uris = await p.save({ newFileNames: [this.fileName()] });
      if (!uris || uris.length === 0) {
        this.busy = false;
        return;
      }
      const file = fileIo.openSync(uris[0],
        fileIo.OpenMode.READ_WRITE | fileIo.OpenMode.CREATE | fileIo.OpenMode.TRUNC);
      // BOM 不能省：Excel 双击打开 CSV 时不认 BOM 会把中文按 GBK 解成乱码
      fileIo.writeSync(file.fd, '\uFEFF' + csv);
      fileIo.closeSync(file);
      this.busy = false;
      promptAction.showToast({ message: '已导出，可在文件管理里找到', duration: 2000 });
    } catch (e) {
      this.busy = false;
      promptAction.showToast({ message: '导出失败，请重试', duration: 1800 });
    }
  }

  private copyCsv(): void {
    if (this.needLogin()) return;
    if (this.count === 0) {
      promptAction.showToast({ message: '账本还是空的', duration: 1500 });
      return;
    }
    Clip.copy(holdingsCsv(Store.getState().holdings), 'CSV 已复制，可粘贴到表格');
  }

  private async importFile(): Promise<void> {
    if (this.needLogin() || this.busy) return;
    this.busy = true;
    try {
      const ctx = getContext(this) as common.UIAbilityContext;
      const p = new picker.DocumentViewPicker(ctx);
      const uris = await p.select({
        maxSelectNumber: 1,
        fileSuffixFilters: ['.csv', '.txt', '.json']
      });
      if (!uris || uris.length === 0) {
        this.busy = false;
        return;
      }
      const file = fileIo.openSync(uris[0], fileIo.OpenMode.READ_ONLY);
      const stat = fileIo.statSync(file.fd);
      const buf = new ArrayBuffer(stat.size);
      fileIo.readSync(file.fd, buf);
      fileIo.closeSync(file);
      const text = util.TextDecoder.create('utf-8').decodeToString(new Uint8Array(buf));
      this.busy = false;
      this.applyImport(text);
    } catch (e) {
      this.busy = false;
      promptAction.showToast({ message: '读取失败，换一个文件试试', duration: 1800 });
    }
  }

  private applyImport(text: string): void {
    const parsed = parseImport(text);
    if (!parsed.ok) {
      AlertDialog.show({
        title: '导入失败',
        message: parsed.error,
        confirm: {
          value: '知道了',
          action: (): void => {
          }
        }
      });
      return;
    }
    AlertDialog.show({
      title: '确认导入',
      message: '识别到 ' + parsed.items.length + ' 条收藏'
        + (parsed.dropped > 0 ? '（另有 ' + parsed.dropped + ' 条无法识别，将跳过）' : '')
        + '。导入会与现有账本按品种去重合并。',
      primaryButton: {
        value: '取消',
        action: (): void => {
        }
      },
      secondaryButton: {
        value: '合并导入',
        action: (): void => {
          this.runImport(parsed.items);
        }
      }
    });
  }

  private runImport(items: Holding[]): void {
    Store.importHoldings(items, false).then((): Promise<void> => {
      return Store.refresh(true).then((): void => {
      });
    }).then((): void => {
      this.render();
      promptAction.showToast({ message: '已导入，现有 ' + this.count + ' 条', duration: 1800 });
    }).catch((e: Error): void => {
      promptAction.showToast({ message: e.message || '导入失败', duration: 1800 });
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
      Text('收藏备份')
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
  action(label: string, hint: string, primary: boolean, onTap: () => void) {
    Row() {
      Column({ space: 3 }) {
        Text(label)
          .fontSize(14)
          .fontColor(primary ? Color.White : Theme.textStrong)
        if (hint.length > 0) {
          Text(hint)
            .fontSize(9)
            .fontColor(primary ? '#F6EEDF' : Theme.faint)
        }
      }
      .alignItems(HorizontalAlign.Start)
      Blank()
      Text('›')
        .fontSize(17)
        .fontColor(primary ? '#F6EEDF' : Theme.faint)
    }
    .width('100%')
    .padding({ left: 14, right: 14, top: 12, bottom: 12 })
    .borderRadius(12)
    .backgroundColor(primary ? Theme.gold : Theme.card)
    .onClick((): void => {
      onTap();
    })
  }

  @Builder
  pasteSheet() {
    Stack() {
      Column()
        .width('100%')
        .height('100%')
        .backgroundColor('rgba(20,16,10,0.42)')
        .onClick((): void => {
          this.pasteOpen = false;
        })
      Column({ space: 10 }) {
        Row() {
          Text('粘贴 CSV / JSON')
            .fontSize(15)
            .fontWeight(FontWeight.Medium)
            .fontColor(Theme.text)
          Blank()
          Text('✕')
            .fontSize(15)
            .fontColor(Theme.muted)
            .onClick((): void => {
              this.pasteOpen = false;
            })
        }
        .width('100%')
        Text('把表头为「名称,数量,成本合计…」的表格内容粘贴进来，逗号或制表符都行。')
          .fontSize(10)
          .fontColor(Theme.muted)
          .lineHeight(17)
        TextArea({ text: $$this.pasteText, placeholder: '名称,数量,成本合计\n2024 年贺岁纪念币,1,120' })
          .height(160)
          .fontSize(11)
          .backgroundColor(Theme.bg)
          .borderRadius(8)
          .padding(8)
        Text('解析并导入')
          .fontSize(14)
          .fontColor(Color.White)
          .textAlign(TextAlign.Center)
          .width('100%')
          .height(42)
          .borderRadius(8)
          .linearGradient({ angle: 135, colors: [['#C79A4B', 0], ['#9A6B1F', 1]] })
          .onClick((): void => {
            const text = this.pasteText;
            this.pasteOpen = false;
            this.applyImport(text);
          })
      }
      .width('90%')
      .padding(16)
      .borderRadius(16)
      .backgroundColor(Theme.card)
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
            Column({ space: 6 }) {
              Text('你的收藏，随时能带走')
                .fontSize(18)
                .fontWeight(FontWeight.Bold)
                .fontColor(Theme.text)
              Text('导出为 CSV 表格，Excel / Numbers / WPS 都能直接打开；导入时按「品种」去重合并，不会覆盖已有记录。')
                .fontSize(11)
                .fontColor(Theme.muted)
                .lineHeight(19)
              Text(this.loggedIn ? ('当前账本 ' + this.count + ' 条记录') : '登录后才能备份')
                .fontSize(10)
                .fontColor(this.loggedIn ? Theme.gold : Theme.up)
                .margin({ top: 4 })
            }
            .justifyContent(FlexAlign.Start)
            .width('100%')
            .alignItems(HorizontalAlign.Start)

            Column({ space: 8 }) {
              Text('导出')
                .fontSize(11)
                .fontColor(Theme.faint)
              this.action(this.busy ? '处理中…' : '导出 CSV 文件', '保存到「文件」或网盘，电脑上可直接打开', true, (): void => {
                this.exportFile();
              })
              this.action('复制 CSV 文本', '粘贴到微信 / 备忘录 / 表格', false, (): void => {
                this.copyCsv();
              })
            }
            .width('100%')
            .alignItems(HorizontalAlign.Start)

            Column({ space: 8 }) {
              Text('导入')
                .fontSize(11)
                .fontColor(Theme.faint)
              this.action('选择文件导入', '支持 .csv / .txt / 旧版 .json 备份', false, (): void => {
                this.importFile();
              })
              this.action('粘贴内容导入', '从表格里直接复制粘贴', false, (): void => {
                if (this.needLogin()) return;
                this.pasteOpen = true;
              })
            }
            .width('100%')
            .alignItems(HorizontalAlign.Start)

            Column({ space: 6 }) {
              Text('注意事项')
                .fontSize(12)
                .fontWeight(FontWeight.Medium)
                .fontColor(Theme.text)
              Text('· 导出包含：名称、类别、编号、单位、数量、成本、市值、分组、冠号、形态、图片字段。\n'
                + '· 图片只导出服务器路径，不含图片文件本身。\n'
                + '· 合并导入以「贵金属编号」或「品类 + 名称」判重，重复条目会跳过。\n'
                + '· 数据同时存在云端，换设备登录即可恢复，备份是额外保险。')
                .fontSize(10)
                .fontColor(Theme.muted)
                .lineHeight(19)
            }
            .width('100%')
            .padding(14)
            .borderRadius(12)
            .backgroundColor(Theme.card)
            .border({ width: 1, color: Theme.glassBorder })
            .shadow({ radius: 14, color: 'rgba(0,0,0,0.05)', offsetY: 8 })
            .alignItems(HorizontalAlign.Start)

            Column().height(30)
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

      if (this.pasteOpen) {
        this.pasteSheet()
      }
    }
    .width('100%')
    .height('100%')
  }
}
