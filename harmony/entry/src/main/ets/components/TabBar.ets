import { Theme } from '../utils/theme';

interface TabItem {
  icon: Resource;
  iconOn: Resource;
  label: string;
}

/**
 * 悬浮胶囊底部导航（鸿蒙 7 那种）：
 * 玻璃胶囊浮在内容之上，选中项是一枚淡金实心胶囊，带轻微投影。
 */
@Component
export struct AppTabBar {
  @Prop current: number;
  onSelect: (index: number) => void = (index: number): void => {
  };
  private items: TabItem[] = [
    { icon: $r('app.media.tab_home'), iconOn: $r('app.media.tab_home_on'), label: '首页' },
    { icon: $r('app.media.tab_plan'), iconOn: $r('app.media.tab_plan_on'), label: '计划' },
    { icon: $r('app.media.tab_list'), iconOn: $r('app.media.tab_list_on'), label: '清单' },
    { icon: $r('app.media.tab_mine'), iconOn: $r('app.media.tab_mine_on'), label: '我的' }
  ];

  build() {
    Row() {
      ForEach(this.items, (item: TabItem, index: number) => {
        Stack({ alignContent: Alignment.Center }) {
          if (this.current === index) {
            Row()
              .width('100%')
              .height(44)
              .borderRadius(22)
              .backgroundColor('#F3E7CBE6')
              .border({ width: 1, color: '#FFFFFFB3' })
              .shadow({ radius: 12, color: 'rgba(150,110,50,0.18)', offsetY: 4 })
          }
          Column({ space: 3 }) {
            Image(this.current === index ? item.iconOn : item.icon)
              .width(22)
              .height(22)
              .objectFit(ImageFit.Contain)
            Text(item.label)
              .fontSize(10)
              .fontColor(this.current === index ? Theme.goldDeep : Theme.faint)
              .fontWeight(this.current === index ? FontWeight.Medium : FontWeight.Normal)
          }
        }
        .layoutWeight(1)
        .height('100%')
        .onClick((): void => {
          this.onSelect(index);
        })
      }, (item: TabItem, index: number) => index + '_' + item.label)
    }
    .width('100%')
    .height(56)
    .padding(5)
    .borderRadius(28)
    .backgroundColor('#FFFFFFC7')
    .backgroundBlurStyle(BlurStyle.COMPONENT_ULTRA_THICK)
    .border({ width: 1, color: '#FFFFFFE6' })
    .shadow({ radius: 28, color: 'rgba(120,90,40,0.18)', offsetY: 10 })
  }
}
