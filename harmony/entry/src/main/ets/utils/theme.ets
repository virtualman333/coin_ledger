/**
 * 设计 token —— 与网页 / 小程序的 app.wxss 对齐（暖白底 + 金棕主色）。
 * 单位换算：小程序 750rpx 宽 ≈ 鸿蒙 360vp，1rpx ≈ 0.5vp。
 */
export class Theme {
  // 底色与卡片
  static readonly bg: string = '#F6F4EF';
  static readonly bgDeep: string = '#F2EEE4';
  static readonly card: string = '#FFFFFF';
  static readonly cardSoft: string = '#FBF8F1';

  // 文本
  static readonly text: string = '#1D1D1F';
  static readonly textStrong: string = '#2B2926';
  static readonly muted: string = '#6B6559';
  static readonly faint: string = '#8A8378';

  // 金棕主色
  static readonly gold: string = '#9A6B1F';
  static readonly goldDeep: string = '#7A541A';
  static readonly goldBg: string = '#F4EFE4';
  static readonly goldBgSoft: string = '#F6EFE0';
  static readonly goldLine: string = '#E7DCC4';

  // 涨跌（国内习惯：涨红跌绿）
  static readonly up: string = '#C0392B';
  static readonly down: string = '#17724A';

  // 线条
  static readonly line: string = '#EFECE4';
  static readonly lineSoft: string = '#F6F3EC';

  // 尺寸
  static readonly pagePadding: number = 12;
  static readonly cardPadding: number = 14;
  static readonly radiusCard: number = 10;
  static readonly radiusBtn: number = 7;
  static readonly radiusThumb: number = 7;
  static readonly fontBody: number = 14;
  static readonly fontSmall: number = 12;
  static readonly fontTiny: number = 11;
  static readonly fontTitle: number = 16;
  static readonly fontH1: number = 20;
  static readonly fontHuge: number = 28;

  // 阴影
  static readonly shadowCard: string = '0 1vp 6vp rgba(60,48,26,0.06)';
  static readonly shadowFloat: string = '0 11vp 24vp rgba(60,48,26,0.22)';
}

