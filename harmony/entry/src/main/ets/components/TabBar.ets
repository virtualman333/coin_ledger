import { Theme } from '../utils/theme';

interface TabItem {
  icon: Resource;
  iconOn: Resource;
  label: string;
}

/**
 * 底部胶囊 TabBar —— 对齐小程序 components/tabbar（悬浮玻璃胶囊 + 淡金选中态）。
 * 用系统 backgroundBlurStyle 做磨砂，不手写渐变，弱光下也不会发灰。
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
        Column({ space: 2 }) {
          Image(this.current === index ? item.iconOn : item.icon)
            .width(22)
            .height(22)
            .objectFit(ImageFit.Contain)
          Text(item.label)
            .fontSize(10)
            .fontColor(this.current === index ? Theme.goldDeep : Theme.faint)
            .fontWeight(this.current === index ? FontWeight.Medium : FontWeight.Normal)
        }
        .layoutWeight(1)
        .height('100%')
        .justifyContent(FlexAlign.Center)
        .borderRadius(24)
        .backgroundColor(this.current === index ? '#F4EFE4' : Color.Transparent)
        .animation({ duration: 180, curve: Curve.EaseOut })
        .onClick((): void => {
          this.onSelect(index);
        })
      }, (item: TabItem, index: number) => index + '_' + item.label)
    }
    .width('100%')
    .height(58)
    .padding(5)
    .borderRadius(29)
    .backgroundColor('rgba(255,255,255,0.72)')
    .backgroundBlurStyle(BlurStyle.COMPONENT_THICK)
    .shadow({ radius: 22, color: 'rgba(60,48,26,0.20)', offsetY: 8 })
  }
}
