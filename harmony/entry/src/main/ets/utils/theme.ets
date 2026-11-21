/**
 * 设计 token —— 按 HarmonyOS Design 规范落地：
 * 8vp 栅格、字阶 24/20/16/14/12、圆角 8/16/24、低透明度阴影、正文不小于 12vp。
 * 配色保留「藏币录」的暖金收藏气质，中性色改用暖灰层级而不是纯黑。
 */
export class Theme {
  // 底色与卡片（暖中性，避免纯白刺眼）
  static readonly bg: string = '#F5F3EE';
  static readonly bgDeep: string = '#EFEBE2';
  static readonly card: string = '#FFFFFF';
  static readonly cardSoft: string = '#FAF8F3';

  // 文本层级（主 → 次 → 辅助 → 占位）
  static readonly text: string = '#1A1918';
  static readonly textStrong: string = '#2B2926';
  static readonly muted: string = '#6E6A63';
  static readonly faint: string = '#9C978E';

  // 品牌金
  static readonly gold: string = '#9A6B1F';
  static readonly goldDeep: string = '#7A541A';
  static readonly goldBg: string = '#F5EFE1';
  static readonly goldBgSoft: string = '#FAF5EA';
  static readonly goldLine: string = '#E8DCC2';

  // 涨跌（国内习惯：涨红跌绿）
  static readonly up: string = '#C0392B';
  static readonly down: string = '#17724A';

  // 线条
  static readonly line: string = '#EAE5DA';
  static readonly lineSoft: string = '#F3EFE7';

  // 间距：8vp 栅格
  static readonly gapXs: number = 4;
  static readonly gapS: number = 8;
  static readonly gapM: number = 12;
  static readonly gapL: number = 16;
  static readonly gapXl: number = 24;
  static readonly gapXxl: number = 32;

  // 页面与卡片内边距
  static readonly pagePadding: number = 16;
  static readonly cardPadding: number = 16;

  // 圆角三档
  static readonly radiusS: number = 8;
  static readonly radiusM: number = 16;
  static readonly radiusL: number = 24;
  /** 兼容旧引用 */
  static readonly radiusCard: number = 16;
  static readonly radiusInner: number = 12;
  static readonly radiusChip: number = 15;
  static readonly radiusBtn: number = 8;
  static readonly radiusThumb: number = 8;

  // 字阶：24 页面标题 / 20 模块标题 / 16 列表标题与正文 / 14 辅助 / 12 角标
  static readonly fontDisplay: number = 28;
  static readonly fontH1: number = 24;
  static readonly fontH2: number = 20;
  static readonly fontH3: number = 16;
  static readonly fontBody: number = 16;
  static readonly fontBody2: number = 14;
  static readonly fontCaption: number = 12;
  /** 兼容旧引用（等同 caption） */
  static readonly fontSmall: number = 12;
  static readonly fontTiny: number = 12;
  static readonly fontTitle: number = 16;
  static readonly fontHuge: number = 28;

  // 阴影：低透明度、柔和
  static readonly shadowCard: string = '0 2vp 8vp rgba(60,48,26,0.04)';
  static readonly shadowSoft: string = '0 1vp 4vp rgba(60,48,26,0.03)';
  static readonly shadowFloat: string = '0 8vp 24vp rgba(60,48,26,0.12)';

  // 触控热区
  static readonly touch: number = 44;

  /* ---------- 空间感 / 沉浸光感 ---------- */
  // 玻璃材质：半透明白 + 背景模糊 + 1px 高光边
  static readonly glass: string = '#FFFFFFB8';
  static readonly glassStrong: string = '#FFFFFFD9';
  static readonly glassSoft: string = '#FFFFFF8C';
  static readonly glassBorder: string = '#FFFFFFD9';

  // 光晕（暖金），配合 blur 做柔和光斑
  static readonly glowWarm: string = '#F2D7A0';
  static readonly glowLight: string = '#FBEBCB';
  static readonly glowCool: string = '#E9DCC4';

  // 层次阴影：近景更实、背景最虚
  static readonly shadowGlass: string = '0 10vp 30vp rgba(120,90,40,0.10)';

  // 背景三段渐变
  static readonly skyTop: string = '#FEFBF4';
  static readonly skyMid: string = '#F6F0E2';
  static readonly skyBottom: string = '#EDE5D3';
}
