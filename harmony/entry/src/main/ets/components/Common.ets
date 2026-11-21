import { Theme } from '../utils/theme';

/** 分区标题：左标题 + 右「更多 ›」 */
@Component
export struct SectionHead {
  title: string = '';
  more: string = '';
  onMore: () => void = (): void => {
  };

  build() {
    Row({ space: 8 }) {
      Row()
        .width(3)
        .height(14)
        .borderRadius(2)
        .linearGradient({ angle: 180, colors: [['#C79A4B', 0], ['#9A6B1F', 1]] })
      Text(this.title)
        .fontSize(15)
        .fontWeight(FontWeight.Medium)
        .fontColor(Theme.text)
        .letterSpacing(0.3)
      Blank()
      if (this.more) {
        Text(this.more)
          .fontSize(Theme.fontSmall)
          .fontColor(Theme.gold)
          .padding({ left: 12 })
          .onClick((): void => {
            this.onMore();
          })
      }
    }
    .width('100%')
    .alignItems(VerticalAlign.Center)
    .margin({ top: 22, bottom: 10 })
    .padding({ left: 2, right: 2 })
  }
}

/** 空态文案 */
@Component
export struct EmptyTip {
  text: string = '暂无数据';

  build() {
    Text(this.text)
      .width('100%')
      .textAlign(TextAlign.Center)
      .fontSize(Theme.fontSmall)
      .fontColor(Theme.muted)
      .padding({ top: 40, bottom: 40 })
      .lineHeight(22)
  }
}

/** 主按钮 */
@Component
export struct PrimaryButton {
  label: string = '';
  onTap: () => void = (): void => {
  };
  active: boolean = true;

  build() {
    Text(this.label)
      .fontSize(15)
      .fontColor(Color.White)
      .textAlign(TextAlign.Center)
      .width('100%')
      .height(44)
      .borderRadius(Theme.radiusBtn)
      .backgroundColor(this.active ? Theme.gold : '#C9BFA9')
      .onClick((): void => {
        if (this.active) this.onTap();
      })
  }
}

/** 二级页通用容器：白底 + 标题栏 */
@Component
export struct PageShell {
  title: string = '';
  @BuilderParam content: () => void;
  onBack: () => void = (): void => {
  };

  build() {
    Column() {
      Row() {
        Text('‹')
          .fontSize(26)
          .fontColor(Theme.text)
          .width(36)
          .onClick((): void => {
            this.onBack();
          })
        Text(this.title)
          .fontSize(17)
          .fontWeight(FontWeight.Medium)
          .fontColor(Theme.text)
        Blank()
        Text('').width(36)
      }
      .width('100%')
      .height(48)
      .padding({ left: 8, right: 8 })
      .backgroundColor(Theme.bg)

      this.content()
    }
    .width('100%')
    .height('100%')
    .backgroundColor(Theme.bg)
  }
}
