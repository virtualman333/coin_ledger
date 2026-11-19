# 藏币录 · 视觉风格体系（Phase 1 视觉方向）

> 版本 v1.1 ｜ 适用范围：微信小程序 `miniprogram/` + 网站端 `public/` ｜ 设计稿基准：750rpx 宽
> 基线来源：`app.wxss`、`pages/index/index.wxss`、`pages/detail/detail.wxss`、`app.json`、`public/app.css`
> 说明：本文档只定义**视觉**，不含交互流程与信息架构（见 Phase 2）。所有数值可直接落地为设计令牌（见第 7 节）。
> v1.1 更新：新增 §0.1 双端色彩策略明确结论、§2.5 升级为浅/深双模式完整映射总表、§7.3 网站端双值落地。

---

## 0. 结论摘要（先看这里）

1. **方向**：不推倒重来。延续「暖白纸底 + 金棕烫金 + 深棕封面」的收藏册气质，把它**系统化**为一套双皮肤（浅/深）令牌体系——网站端已有的深色 token 直接作为小程序深色模式的映射基准，两端从此同源。
2. **最关键的三处升级**：① 把散落的十几种金棕色值收敛成 **10 级品牌金阶梯**；② 消除涨跌色的重复冲突，统一为 **涨红 `#c0392b` / 跌绿 `#1e8e5a`**；③ 把零散的「参考估值」提示（pb-tip / ai-tip / foot-warn）升级为**强制标注机制**——价格主体一律用中性权威金，红绿只用于「较上次的估值变化」，从根上避免伪装成交易行情。
3. **母题**：方孔圆钱从「Hero 角落的 CSS 装饰」升级为**可复用的 SVG 符号系统**（线稿/实心两态、currentColor 自适应深浅），贯穿空态、占位、水印、品牌标识。
4. **克制原则**：金色只做**点睛**（≤ 画面 10%），大面积留给纸白与炭字；宁可"素雅可信"，不要"赌场金"。
5. **落地口径**：rpx 设计稿 750 宽，基准机型 375pt 下 **1rpx ≈ 0.5px**；字号/间距/圆角用 8rpx 网格；数字统一 `tabular-nums`。

### 0.1 双端色彩策略 · 明确结论（回应双端差异硬要求）

> **🔒 拍板：采用方案 A ——「统一为一套跨端色板（浅/深双模式映射）」。**
> **不采用**方案 B（各端保留各自基调、仅共享令牌名）。

| 维度 | 结论 |
|---|---|
| 令牌 | 唯一一套语义令牌 `--cl-*`，两端同名同义 |
| 色值 | 每个令牌有**浅色 / 深色两个确定值**，汇成一张表（§2.5），两端都从这张表取色 |
| 默认模式 | **差异只在这里**：小程序默认浅色（暖白纸感）、网站默认深色（暖黑烫金）——尊重现状认知，不强行统一外观 |
| 切换能力 | 两端**都具备**浅↔深双模式能力；切到另一模式时取值仍是同一张表，不另立色值 |
| 差异来源 | 网站现有深色 token（`#0a0c10`/`#141a22`/`#e8c877`/`#ff6b5a`/`#3ddc97`…）即"深色列"标准值；小程序现有暖白 token（`#f6f4ef`/`#9a6b1f`…）即"浅色列"标准值 |

**为什么不是方案 B**：若同一 `--cl-brand` 在小程序指向 `#9a6b1f`、在网站指向 `#e8c877`，"共享语义"只剩空壳——跨端一致性无法验证、深色值缺乏统一依据、组件无法跨端复用。方案 A 把两套值都固定下来，既保留两端现状观感，又让"一致"有据可查、可测试。

---

## 1. 设计定位与情绪板

### 1.1 一句话定位

> **一本可随身携带的、可信的中国纪念币收藏册——纸的温度、烫金的克制、档案的严谨。**

### 1.2 三个关键词

| 关键词 | 含义 | 视觉落点 |
|---|---|---|
| **可信（Credible）** | 数据来源清晰、估值不越界、不制造行情幻觉 | 纸张底色、档案式分栏、参考估值强制标注、tabular-nums 对齐数字 |
| **雅致（Refined）** | 收藏册/邮册的审美，而非金融 App 的冰冷或电商的喧闹 | 宋体标题、烫金渐变、暖棕阴影、留白充足 |
| **有收藏感（Collectible）** | 方孔圆钱母题、系列成套感、"集齐"的仪式感 | 钱币符号系统、系列进度条、勋章式品牌标记 |

### 1.3 情绪板（文字描述）

- **材质**：米白宣纸的温润哑光（非纯白高光）、旧书页边缘的微黄、烫金压印在纸上的浅浮雕感、 cards 如卡纸輕微浮起。
- **色彩氛围**：主体是安静的暖白与炭灰文字；金色像书脊上的烫字，只在标题、关键数字、进度、强调处闪现；深棕封面只在首页 Hero 与品牌区出现，像翻开收藏册的第一页。
- **光影**：极轻的暖棕投影（不用纯黑硬阴影），像纸张离开桌面的自然阴影；深色模式下改为炭黑阴影 + 极淡金色微光。
- **节奏**：大留白、宽行距、分区清晰；信息像目录一样有序，不拥挤、不闪烁。
- **反面参照（避免）**：股票软件的红绿数字瀑布、币圈的霓虹渐变、赌场的饱和金 + 黑、电商的满屏角标与大促销字。

---

## 2. 色彩系统

### 2.1 品牌金阶梯（Brand Gold Ramp）

沿用现有主色 `#9a6b1f`，向两端扩展为 10 级。**`--cl-brand-600` 为核心主色**。

| Token | HEX | 状态 | 使用场景 |
|---|---|---|---|
| `--cl-brand-50`  | `#FDF7EA` | 沿用（= price-badge 底） | 价格徽章底、极浅金底 |
| `--cl-brand-100` | `#F6F1E4` | 沿用（= set-line 底） | 浅金信息条、选中行底 |
| `--cl-brand-200` | `#F3E3C0` | 沿用（= hero-mark 字） | Hero 标题字、深底上的浅金文字 |
| `--cl-brand-300` | `#E8C877` | 沿用（= 网站端 `--gold`、进度末端） | 亮金：进度条末端、高光、深色主题主金、Hero 点缀 |
| `--cl-brand-400` | `#D9B364` | 沿用（= 进度渐变） | 按钮渐变末端、进度渐变 |
| `--cl-brand-500` | `#B8934A` | 沿用（= 网站端 `--gold2`） | 中金：品牌副标、深色底辅助金、进度渐变起 |
| `--cl-brand-600` | `#9A6B1F` | **现有主色，沿用** | 主色：主按钮、链接、强调、tabBar 选中 |
| `--cl-brand-700` | `#7A541A` | 沿用（= tag/ghost 字） | 金色文字在浅金底上（标签、ghost 按钮） |
| `--cl-brand-800` | `#6B4A18` | 新增 | 深金，暗背景上的低饱和金边 |
| `--cl-brand-900` | `#4A3410` | 新增 | 最深金，印章压印暗部、深色主色底 |

> 对比度实测：`#9a6b1f` on `#ffffff` ≈ **4.6:1**（达 WCAG AA 正文线）；on `#f6f4ef` ≈ 4.3:1，故浅底上的**小号金字**建议用更深的 `--cl-brand-700 #7a541a`。

### 2.2 中性色（Neutral / 暖白纸感）

| Token | HEX | 状态 | 使用场景 |
|---|---|---|---|
| `--cl-neutral-0`   | `#FFFFFF` | 沿用 | 卡片、导航、弹窗底 |
| `--cl-neutral-50`  | `#FAF8F3` | 沿用（= 图框底） | 藏品图框底、AI 行底、极浅凹槽 |
| `--cl-neutral-100` | `#F6F4EF` | **沿用（页面底）** | 页面主背景、窗口背景 |
| `--cl-neutral-150` | `#F3EFE6` | 沿用（= 分割线） | 数字栏分割、极浅描边 |
| `--cl-neutral-200` | `#F1ECE0` | 沿用（= 进度槽） | 进度条槽、浅填充 |
| `--cl-neutral-300` | `#E8E2D5` | 沿用（= 缩略图描边） | 控件描边、卡片描边 |
| `--cl-neutral-400` | `#D8CDB8` | 新增（收敛 #e2d8c4/#cfc7b8/#ddd5c6） | 稍强描边、禁用描边 |
| `--cl-neutral-500` | `#A39C8E` | 沿用（= 浅 muted） | 弱化说明、角标、页脚 |
| `--cl-neutral-600` | `#8A8378` | **沿用（muted）** | 次要文字、未选中 tab（⚠ 见下方可读性提示） |
| `--cl-neutral-650` | `#6B6559` | 新增（= 价格键名） | 需保证可读的辅助文字（对比度 ≈ 5.7:1，过 AA） |
| `--cl-neutral-800` | `#3A352C` | 沿用（= 正文） | 正文、介绍文字 |
| `--cl-neutral-900` | `#2B2926` | 沿用（= 标题） | 标题、关键数值 |
| `--cl-neutral-950` | `#1D1D1F` | 沿用（= 全局字） | 最高优先级文字 |

> ⚠ **可读性提示**：`#8A8378` on 白底 ≈ 3.8:1，未达 AA 正文。规范：仅用于**非关键弱化信息**（角标、页脚、占位）；凡需实际阅读的辅助文字改用 `--cl-neutral-650 #6B6559`。

### 2.3 语义色（Semantic）

| 类别 | Token | HEX | 状态 | 使用场景 |
|---|---|---|---|---|
| 成功 | `--cl-success` | `#2F7A4F` | 沿用（现 `.down` 深绿） | 加入成功、已完成、校验通过 |
| 警示 | `--cl-warning` | `#A8781A` | 新增（琥珀） | 数据推定/待补充、草稿、非阻断提示 |
| 危险 | `--cl-danger` | `#B23A2E` | 沿用（现 `.act-remove`） | 删除、破坏性操作（弱化小字 + 二次确认） |
| 信息 | `--cl-info` | `#4A6B8A` | 新增（蓝灰） | 中性说明、来源链接 |

### 2.4 价格涨跌色（Price Movement，中国约定：涨红跌绿）

> **重要**：收藏工具里的价格是「参考估值」而非交易行情。红绿**只**用于"较上次估值的变化幅度"这类**带明确标注的相对值**，绝不用于渲染估值金额主体。

| Token | 浅色 HEX | 深色 HEX | 状态 | 使用场景 |
|---|---|---|---|---|
| `--cl-up`   | `#C0392B` | `#FF6B5A` | 浅色沿用全局 `.up`（统一掉 `#b23a2e`）；深色沿用网站端 `--up` | 估值上涨：变化幅度、涨跌箭头 |
| `--cl-down` | `#1E8E5A` | `#3DDC97` | 浅色沿用全局 `.down`（统一掉 `#2f7a4f`）；深色沿用网站端 `--down` | 估值下跌：变化幅度、涨跌箭头 |
| `--cl-price-main` | `#9A6B1F` | `#E8C877` | 沿用主金 | **估值金额主体一律用此中性权威金**，不用红绿 |

### 2.5 浅/深双模式完整映射总表（Light / Dark Mapping）

> **结论先行**：下表是**两端唯一取色源**。小程序默认取「浅色列」，网站默认取「深色列」，两端均可切换取另一列。深色列的值**直接采用网站端现有 token**，浅色列的值**直接采用小程序现有 token**——不发明新色，只做归一与补全。
> 小程序深色落地：`app.json` 配 `"darkmode":true` + `theme.json` 定义深色变量；tabBar 颜色用 `wx.setTabBarStyle` 动态切换（tabBar 不支持 CSS 变量）。

#### 2.5.1 表面与文字

| 语义 Token | 浅色值（小程序默认） | 深色值（网站默认） | 深色值来源 |
|---|---|---|---|
| `--cl-bg` | `#F6F4EF` | `#0A0C10` | 网站 `--bg` |
| `--cl-surface` | `#FFFFFF` | `#141A22` | 网站 `--panel` |
| `--cl-surface-2` | `#FAF8F3` | `#1A212B` | 网站 `--panel2` |
| `--cl-sunken`（凹槽/进度槽） | `#F1ECE0` | `#0E1319` | 网站 `--surf-3` |
| `--cl-text` | `#2B2926` | `#E9EDF3` | 网站 `--text` |
| `--cl-text-muted` | `#8A8378` | `#8B94A3` | 网站 `--muted` |
| `--cl-text-dim` | `#A39C8E` | `#616B7A` | 网站 `--dim` |
| `--cl-text-strong` | `#1D1D1F` | `#FFF8E2` | 网站 `--title-1` |

#### 2.5.2 品牌金与强调

| 语义 Token | 浅色值 | 深色值 | 深色值来源 |
|---|---|---|---|
| `--cl-brand`（主色） | `#9A6B1F` | `#E8C877` | 网站 `--gold`（深色提亮保对比） |
| `--cl-brand-strong`（深一档/悬停） | `#7A541A` | `#B8934A` | 网站 `--gold2` |
| `--cl-brand-soft`（浅金底/徽章底） | `#F6F1E4` | `rgba(212,175,55,.07)` | 网站 `--gold-soft` |
| `--cl-line`（金调描边） | `#EFECE4` | `rgba(212,175,55,.16)` | 网站 `--line` |
| `--cl-line-2`（中性细描边） | `#E8E2D5` | `rgba(255,255,255,.07)` | 网站 `--line2` |
| `--cl-progress-track` | `#F1ECE0` | `#0E1319` | 网站 `--surf-3` |
| `--cl-progress-fill` | `linear-gradient(90deg,#B8934A,#E8C877)` | `linear-gradient(90deg,#B8934A,#F3E3C0)`（末端提亮） | 网站 medal 渐变 |

> 品牌金 50–900 全阶（§2.1）在**浅色列**完整使用；**深色列**以 `#B8934A`/`#E8C877`/`#F3E3C0` 为主力档，50/100 等浅底档由 `--cl-brand-soft` 的半透明金替代，避免深底上出现刺眼亮块。

#### 2.5.3 语义色与价格色（遵循中国涨红跌绿）

| 语义 Token | 浅色值 | 深色值 | 深色值来源 |
|---|---|---|---|
| `--cl-success` | `#2F7A4F` | `#3DDC97` | 网站 `--down` |
| `--cl-warning` | `#A8781A` | `#D9A441` | 网站金阶延伸（新增，保持琥珀调） |
| `--cl-danger` | `#B23A2E` | `#E88080` | 网站 `--err` |
| `--cl-info` | `#4A6B8A` | `#7FA8D0` | 新增（深色提亮） |
| `--cl-up`（涨，红） | `#C0392B` | `#FF6B5A` | 网站 `--up` |
| `--cl-down`（跌，绿） | `#1E8E5A` | `#3DDC97` | 网站 `--down` |
| `--cl-price-main`（估值主体，中性金） | `#9A6B1F` | `#E8C877` | 同 `--cl-brand`，绝不随涨跌变色 |

#### 2.5.4 表面效果与品牌场景

| 语义 Token | 浅色值 | 深色值 | 深色值来源 |
|---|---|---|---|
| `--cl-overlay`（遮罩） | `rgba(24,20,14,.45)` | `rgba(4,6,9,.72)` | 网站 `--overlay` |
| `--cl-shadow` | `0 2rpx 12rpx rgba(60,48,26,.06)` | `0 8rpx 24rpx rgba(0,0,0,.45)` | 网站 `--sh-3` |
| `--cl-hero-bg`（品牌 Hero） | `linear-gradient(135deg,#221A12,#3C2E1C,#5D4726)` | `linear-gradient(135deg,#101318,#1A1510,#2A2115)` | 网站暗调延伸，保留暖棕 |
| `--cl-tabbar-bg` | `#FFFFFF` | `#141A22` | 网站 `--panel` |
| `--cl-tabbar-text`（未选中） | `#8A8378` | `#616B7A` | 网站 `--dim` |
| `--cl-tabbar-active` | `#9A6B1F` | `#E8C877` | 网站 `--gold` |

> 深色 Hero：保留暖调但降至低亮度，金色装饰一律用 `--cl-brand`（#e8c877）维持发光感；宋体标题渐变在深色下用 `#FFF8E2 → #E8C877 → #B8934A`（对齐网站 `h1`）。

---

## 3. 字体排印

### 3.1 字体栈

```css
/* 正文：小程序用系统字体栈，无需加载外部字体 */
--cl-font-sans: -apple-system, BlinkMacSystemFont, "PingFang SC", "Helvetica Neue",
                "Microsoft YaHei", system-ui, sans-serif;

/* 品牌/标题：宋体系，呼应收藏册的活字气质（沿用现有 Hero/h1） */
--cl-font-serif: "Songti SC", "Noto Serif SC", Georgia, "Times New Roman", serif;

/* 数字：统计与价格强制等宽，保证列对齐（沿用现有 tabular-nums 用法） */
--cl-font-num: var(--cl-font-sans);
--cl-num-feature: "tnum" 1, "lnum" 1; /* font-variant-numeric: tabular-nums lining-nums */
```

- 网站端 `public/app.css` 已用同款栈（`system-ui,-apple-system,"PingFang SC","Microsoft YaHei"` + `"Songti SC"` 标题），两端一致，无需改动。
- **禁止**为数字单独引入等宽字体（如 Menlo），会破坏中文混排；用 `font-variant-numeric: tabular-nums` 即可。

### 3.2 字号阶梯（8rpx 网格周围收敛）

> 换算基准：750rpx 设计稿 ≈ 375pt 屏宽，故 **1rpx ≈ 0.5px**；下表 px 列为基准机型值。

| Token | rpx | px(基准) | 字重 | 行高 | 用途 |
|---|---|---|---|---|---|
| `--cl-fs-2xs` | 20rpx | 10px | 400 | 1.4 | 角标、极小脚注（慎用） |
| `--cl-fs-xs`  | 22rpx | 11px | 400 | 1.5 | 次要说明、副标、年份角标 |
| `--cl-fs-sm`  | 24rpx | 12px | 400 | 1.5 | 辅助文字、标签、系列数量 |
| `--cl-fs-base`| 28rpx | 14px | 400 | 1.6 | **正文基准**（现有 page 字号） |
| `--cl-fs-md`  | 30rpx | 15px | 500 | 1.5 | 按钮文字、强调正文 |
| `--cl-fs-lg`  | 32rpx | 16px | 600 | 1.4 | 分区标题（section-title） |
| `--cl-fs-xl`  | 36rpx | 18px | 600 | 1.35 | 卡片主标题、名称 |
| `--cl-fs-2xl` | 44rpx | 22px | 600 | 1.3 | 大数值、页面主标题 |
| `--cl-fs-3xl` | 54rpx | 27px | 600 | 1.2 | Hero 品牌字（宋体，字距 +6rpx） |

### 3.3 排印规则

| 项 | 规范 |
|---|---|
| 字重 | 仅用 400/500/600 三档；**不引入 700+**（现有 `font-weight:700` 的数字降为 600，靠字号和颜色建立层级） |
| 字距 | 中文正文 0；品牌字 +6rpx；全大写英文小标 +0.34em（沿用网站端 `.brand`） |
| 行高 | 正文 1.6；标题 1.3–1.4；长段落介绍 1.9（沿用 `.desc`） |
| 数字 | 所有统计值、价格、发行量、编号：`font-variant-numeric: tabular-nums;` |
| 品牌标题 | 宋体 + 金色渐变裁切（`background-clip:text`），仅 Hero / 网站 H1 使用，正文禁用渐变字 |

---

## 4. 间距 / 圆角 / 阴影 / 描边体系

### 4.1 间距标尺（8rpx 网格）

| Token | rpx | px(基准) | 用途 |
|---|---|---|---|
| `--cl-space-1` | 8rpx | 4px | 图标与文字紧贴、极小间隙 |
| `--cl-space-2` | 16rpx | 8px | 元素内间隙、标签内距 |
| `--cl-space-3` | 24rpx | 12px | 页面左右边距、卡片内距（现有 28rpx 收敛至此档附近） |
| `--cl-space-4` | 32rpx | 16px | 卡片间距、模块内距 |
| `--cl-space-5` | 40rpx | 20px | 卡片间距上限（现有 `.card + .card` 20rpx） |
| `--cl-space-6` | 48rpx | 24px | 分区间距 |
| `--cl-space-8` | 64rpx | 32px | 大分区、Hero 内边距 |
| `--cl-space-10`| 80rpx | 40px | 空态上下留白（现有 `.empty` 80rpx） |

> 页面左右安全边距统一 **24rpx**（现有 `.page`）；分区标题上下 `36rpx/16rpx`（现有 `.section-head`）。

### 4.2 圆角

| Token | rpx | px | 用途 |
|---|---|---|---|
| `--cl-radius-xs` | 8rpx | 4px | 小徽章、AI 标签（现有 6rpx 收敛） |
| `--cl-radius-sm` | 12rpx | 6px | 缩略图、图框、小标签 |
| `--cl-radius-md` | 14rpx | 7px | **按钮**（沿用现有 button/act-btn） |
| `--cl-radius-lg` | 20rpx | 10px | **卡片**（沿用现有 `.card`/`.lcard`/`.series-item`） |
| `--cl-radius-xl` | 24rpx | 12px | 账本浮层、大卡 |
| `--cl-radius-2xl`| 28rpx | 14px | Hero、底部弹窗顶部（沿用 `.hero`/`.peek-sheet`） |
| `--cl-radius-pill`| 999rpx | — | 胶囊标签、进度条、年份角标 |

### 4.3 阴影（暖棕系，沿用现有亮点）

> 现有阴影用 `rgba(60,48,26,...)` 暖棕而非纯黑，是正确的品牌化选择，**保留并分级**。

| Token | 值 | 用途 |
|---|---|---|
| `--cl-shadow-1` | `0 2rpx 12rpx rgba(60,48,26,.06)` | 通用卡片（现有 `.card`） |
| `--cl-shadow-2` | `0 4rpx 14rpx rgba(60,48,26,.05)` | 小卡/系列卡（现有 `.lcard`） |
| `--cl-shadow-3` | `0 14rpx 36rpx rgba(60,48,26,.10)` | 账本浮层（现有 `.ledger`） |
| `--cl-shadow-4` | `0 16rpx 40rpx rgba(0,0,0,.28)` | Hero 图片悬浮（现有 `.hero-img`） |
| `--cl-shadow-focus`| `0 0 0 3rpx rgba(154,107,31,.18)` | 选中态描边光晕（现有 `.thumb-item.on`） |
| 深色阴影 | `0 8rpx 24rpx rgba(0,0,0,.45)` + 可选 `0 0 24rpx rgba(212,175,55,.10)` 金色微光 | 深色模式所有浮层 |

### 4.4 描边

| Token | 值 | 用途 |
|---|---|---|
| `--cl-border-hair` | `1rpx solid #F3EFE6` | 分割线（现有 `.nums`） |
| `--cl-border-light`| `1rpx solid #EFECE4` | 通用分割（现有 `.divider`） |
| `--cl-border-base` | `1rpx solid #E2D8C4` | 描边按钮/控件（现有 `.act-btn`） |
| `--cl-border-gold` | `1rpx solid rgba(154,107,31,.30)` | Hero 描边按钮（现有 `.hero-share`） |

---

## 5. 图形语言

### 5.1 方孔圆钱母题（核心资产）

现有 Hero 用 CSS 画了「外圆 + 内圆 + 方孔」的装饰（`.hero-coin` / `.coin-hole`），网站端用实心金色渐变勋章（`.medal`）。**升级为统一的符号系统**：

| 形态 | 描述 | 使用场景 |
|---|---|---|
| **线稿钱币**（outline） | 圆环 + 中心方孔 + 可选外圈回纹/刻度；单色 `currentColor`，1.5–2rpx 描边 | 空态插图、列表占位、加载态、深色模式装饰 |
| **实心印章**（solid） | 网站端 `.medal`：金色径向渐变圆 + 方孔 + 中心字（如"藏"），虚线内圈 | 品牌 Logo、头像、启动页、网站 Hero |
| **水印**（watermark） | 线稿钱币放大到 240rpx，透明度 0.06–0.22，置于 Hero 右下/空态背景 | Hero 装饰（替代现有 CSS 圆）、大留白区 |

**现代化三原则**：① 几何简化（去繁复纹样，只留圆+方两个基本形）；② 单色自适应（用 `currentColor`，一套图形通吃深浅皮肤）；③ 可动画（载入时方孔轻微旋转或描边绘制，克制、≤ 600ms）。

> 具体：SVG viewBox `0 0 100 100`，外圆 `r=46` stroke-width=2，方孔 `20×20` 居中；回纹可选 8 段短弧。**避免**写实铜钱纹理、锈迹、 excessive 高光——那会显脏且难在深色模式复用。

### 5.2 卡片 / 进度条 / 标签 / 图标

- **卡片**：暖白 `#fff` + `radius-lg 20rpx` + `shadow-1`；浮起的账本卡用 `radius-xl 24rpx` + `shadow-3` 并上叠 Hero（`margin-top:-48rpx`，沿用）。无重描边，靠阴影分层。
- **进度条**：槽 `#F1ECE0` + 填充渐变 `#B8934A → #E8C877`（沿用，亮度从左到右递增=「积累」的隐喻）；高 `10rpx` 主进度 / `8rpx` 系列进度，pill 圆角。深色模式槽 `#0E1319`、填充渐变 `#B8934A → #E8C877` 不变。
- **标签（tag/chip）**：胶囊 `radius-pill`，浅金底 `#F4EFE4` + 金棕字 `#7A541A`（沿用现有 `.tag`）；中性标签用 `#F6F1E4` + `#6B6559`。年份角标用深底浅金 `rgba(36,28,20,.66)` + `#F0D79A`（沿用 `.lcard-year`）。
- **图标**：tabBar 图标 2 态（未选中灰 `#8A8378` / 选中金 `#9A6b1f`），**线性风格** 1.5–2px 描边、圆角端点，与方孔圆钱的几何语言一致；@2x/@3x 切图，视觉尺寸 48×48rpx。功能图标（分享、纠错、添加）同风格。

### 5.3 图片占位与切图建议

| 项 | 规范 |
|---|---|
| 藏品主图 | 正方形/固定高画框（现 `195rpx` 图框、`620rpx` 详情主图），`object-fit: contain`，浅底 `#FAF8F3`，竖钞与圆币都居中不拉伸 |
| 多图缩略图 | `132rpx` 方块，`radius-sm 12rpx`，选中态金色描边 + focus 光晕（现有 `.thumb-item.on`） |
| 占位图 | 线稿方孔圆钱水印（透明度 0.15）+ "暂无图片" 浅字 `#A39C8E`，居中；**不要**用纯色色块或 broken-image 图标 |
| 详情图 hint | 右下深色胶囊 `rgba(29,29,31,.55)` + `#F6EFDF`（沿用 `.fig-hint`） |
| 切图格式 | 藏品实拍用 WebP/JPG（尤其照片），图标/母题用 SVG 或 @3x PNG；单图建议 ≤ 200KB |
| 品牌资源 | 复用 `public/brand/logo-*.png` 与 `logo-lockup-1320.png`，小程序头像用 `logo-avatar-144.png` |

---

## 6. 核心组件视觉规范

### 6.1 品牌 Hero（首页）

沿用现有深棕封面，仅做令牌化收敛。

| 属性 | 规范 |
|---|---|
| 容器 | `padding: 38rpx 34rpx 104rpx`，`radius-2xl 28rpx`，`overflow:hidden` |
| 背景 | `linear-gradient(135deg,#221A12 0%,#3C2E1C 58%,#5D4726 100%)`（沿用） |
| 品牌字 | 宋体 54rpx/600，色 `#F3E3C0`，字距 +6rpx（沿用 `.hero-mark`） |
| 副标 | 23rpx，`rgba(243,227,192,.62)`（沿用） |
| 装饰 | 方孔圆钱**线稿水印**（第 5.1 节）置于右下，替代/增强现有 CSS 圆；透明度 ≤ 0.22 |
| 分享按钮 | 胶囊描边 `1rpx rgba(243,227,192,.3)`，字 `#E8C877`，20rpx（沿用 `.hero-share`） |
| 实物图 | 196rpx 方块，`radius-lg`，旋转 -6°，金色描边 + shadow-4（沿用 `.hero-img`） |
| 底部渐隐线 | `linear-gradient(90deg,rgba(232,200,119,.4),transparent)`（沿用 `.hero-line`） |

### 6.2 数据账本卡（首页藏品进度）

| 属性 | 规范 |
|---|---|
| 容器 | `margin:-48rpx 10rpx 0`，`radius-xl 24rpx`，白底 + shadow-3（沿用 `.ledger`） |
| 标题 | 26rpx/600 `#2B2926`；数量 22rpx `#8A8378`；关键数 34rpx/600 `--cl-brand`（沿用） |
| 进度条 | 槽 `--cl-neutral-200`，填充金渐变，高 10rpx（沿用） |
| 数字栏 | 三等分，分割 `--cl-border-hair`，键 20rpx `#A39C8E`，值 27rpx/600 `--cl-neutral-900` + tabular-nums（沿用） |
| 涨跌值 | 值带 `.up/.down` 时**必须**同时显示"较上次"标注；用 `--cl-up/--cl-down`，且仅作用于变化幅度（第 2.4 节） |

### 6.3 藏品卡（系列网格 / 最新发行）

沿用现有 `.lcard` / `.series-item`：白底 + `radius-lg` + shadow-2；图框浅底；名称单行省略；系列卡带进度条与"已藏 X/共 Y"金棕强调。**勿**增加边框或角标堆叠。

### 6.4 进度条

见第 5.2 节。补充：进度数值文字用 tabular-nums；达到 100% 时填充末端加一个极小的方孔圆钱印记（可选，仪式感）。

### 6.5 价格徽章（含参考估值标注）—— 重点组件

> **设计红线**：价格是参考估值，不是售价/行情。视觉上必须"有来源、弱刺激、强标注"。

| 元素 | 规范 |
|---|---|
| 徽章容器 | 浅金底 `--cl-brand-50 #FDF7EA`，`radius-md 14rpx`，`padding 12rpx 18rpx`（沿用 `.price-badge`） |
| 金额主体 | 中性权威金 `--cl-price-main`（`#9A6B1F` / 深 `#E8C877`），`font-2xl 44rpx/600`，tabular-nums —— **绝不用红绿** |
| 单位/币种 | 20rpx `--cl-brand-400`，弱于金额（沿用 `.pb-unit`） |
| **参考标注** | 金额下方固定一行：`参考估值 · 非实际成交价`，19rpx `--cl-text-dim`（沿用 `.pb-tip` 位置，但**文案强制**、不可省略） |
| 涨跌变化 | 仅当展示"较上次变化"时用 `--cl-up/--cl-down` + 箭头 + 数值，并置于标注行内，如 `↑2.3% 较上次估值` |
| AI 推理价 | 独立于金额徽章：`#FAF8F3` 底卡 + `AI 推理` 深色徽章（`bg #2B2926` / 字 `#F6E7C6`，沿用 `.ai-badge`）+ 估值 + `仅供参考` 说明（沿用 `.ai-tip`）；与官方估值视觉分层，不并列混淆 |
| 来源标注 | 每条估值附近可用信息图标（ⓘ）悬停/点击查看来源；**无数据来源的字段留空**，不填推定值 |

**反例（禁止）**：红色大号金额 + 绿色箭头占满卡片、去掉"参考"二字、把 AI 价与官方价用同样式并排放、用 K 线图/分时图隐喻。

### 6.6 标签

见第 5.2 节。补充状态：默认/选中（金底金字）/禁用（灰底灰字 `#A39C8E`，透明度 0.6）。

### 6.7 按钮

| 类型 | 规范 | 状态 |
|---|---|---|
| 主按钮 `.btn-primary` | 高 88rpx，`--cl-brand #9A6B1F`，白字，30rpx，`radius-md`（沿用） | hover 加深至 `--cl-brand-700`；disabled `#D8CDB8` 底 / 白字，禁用点击 |
| 次按钮 `.btn-ghost` | 高 80rpx，浅金底 `#F4EFE4`，金棕字 `#7A541A`（沿用） | hover 底 `--cl-brand-100` |
| 描边按钮 `.act-btn` | 高 76rpx，白底 + `border-base`，金棕字（沿用） | hover 底 `--cl-brand-50` |
| 金色渐变按钮 | 仅弹窗主操作（`.peek-btn.primary`）：`#B8934A→#D9B364`，白字/600（沿用） | hover 提亮 |
| 危险操作 | 弱化小字 23rpx `--cl-danger`（沿用 `.act-remove`），**必须二次确认** | — |

> 微信 button 默认行高导致居中偏移——沿用现有修复：flex 居中 + `line-height:1` + `button::after{border:none}`（app.wxss 已处理，保留）。

### 6.8 弹窗（底部弹层）

沿用 `.peek-mask` / `.peek-sheet`：遮罩 `rgba(24,20,14,.45)`，弹层 `radius-2xl 28rpx` 仅上方圆角，`max-height:86vh`，底部 `env(safe-area-inset-bottom)`（沿用）。深色模式遮罩用 `--cl-overlay`。图、元信息、描述、双按钮结构沿用。

### 6.9 空态

沿用 `.empty`：`padding 80rpx 24rpx`，居中，26rpx `--cl-text-dim`，行高 1.8。**升级**：上方放线稿方孔圆钱水印（120rpx，透明度 0.2），下方文案 + 可选主按钮（如"去添加第一枚"）。深色模式水印用 `--cl-brand` 低透明度。

---

## 7. 设计令牌表（工程落地）

### 7.1 命名规范

统一前缀 `--cl-`（coinledger），两端共用**同一套语义变量名**，只在 `:root` / `page` 里赋不同值（浅/深）。这样组件样式无需关心皮肤。

### 7.2 WXSS（小程序，`app.wxss` 的 `page{}` 内定义浅色值，`theme.json` / 深色类覆盖）

```css
page {
  /* 色彩 · 品牌 */
  --cl-brand-50:#FDF7EA; --cl-brand-100:#F6F1E4; --cl-brand-200:#F3E3C0;
  --cl-brand-300:#E8C877; --cl-brand-400:#D9B364; --cl-brand-500:#B8934A;
  --cl-brand:#9A6B1F;     --cl-brand-700:#7A541A; --cl-brand-800:#6B4A18; --cl-brand-900:#4A3410;
  /* 色彩 · 中性 */
  --cl-bg:#F6F4EF; --cl-surface:#FFFFFF; --cl-surface-2:#FAF8F3; --cl-sunken:#F1ECE0;
  --cl-text:#2B2926; --cl-text-muted:#8A8378; --cl-text-dim:#A39C8E; --cl-text-strong:#1D1D1F;
  --cl-line:#EFECE4; --cl-line-2:#E8E2D5;
  /* 色彩 · 语义 / 价格 */
  --cl-success:#2F7A4F; --cl-warning:#A8781A; --cl-danger:#B23A2E; --cl-info:#4A6B8A;
  --cl-up:#C0392B; --cl-down:#1E8E5A; --cl-price-main:var(--cl-brand);
  /* 字体 */
  --cl-font-sans:-apple-system,BlinkMacSystemFont,"PingFang SC","Helvetica Neue",sans-serif;
  --cl-font-serif:"Songti SC","Noto Serif SC",serif;
  --cl-fs-xs:22rpx; --cl-fs-sm:24rpx; --cl-fs-base:28rpx; --cl-fs-md:30rpx;
  --cl-fs-lg:32rpx; --cl-fs-xl:36rpx; --cl-fs-2xl:44rpx; --cl-fs-3xl:54rpx;
  /* 间距 */
  --cl-space-1:8rpx; --cl-space-2:16rpx; --cl-space-3:24rpx; --cl-space-4:32rpx;
  --cl-space-5:40rpx; --cl-space-6:48rpx; --cl-space-8:64rpx; --cl-space-10:80rpx;
  /* 圆角 */
  --cl-radius-sm:12rpx; --cl-radius-md:14rpx; --cl-radius-lg:20rpx;
  --cl-radius-xl:24rpx; --cl-radius-2xl:28rpx; --cl-radius-pill:999rpx;
  /* 阴影 / 描边 */
  --cl-shadow-1:0 2rpx 12rpx rgba(60,48,26,.06);
  --cl-shadow-3:0 14rpx 36rpx rgba(60,48,26,.10);
  --cl-shadow-focus:0 0 0 3rpx rgba(154,107,31,.18);
  --cl-overlay:rgba(24,20,14,.45);
}
```

### 7.3 CSS（网站端，`public/app.css`）—— 与小程序同源的双值落地

网站端现有变量（`--gold`,`--bg`,`--panel`…）**保持不删**（避免破坏现有样式）。落地分两步：

**第一步：默认深色（现状），加语义别名映射到 `--cl-*`：**

```css
:root{
  color-scheme: dark;
  /* 深色 = 映射表「深色列」，直接复用现有变量 */
  --cl-bg:var(--bg);              /* #0a0c10 */
  --cl-surface:var(--panel);      /* #141a22 */
  --cl-surface-2:var(--panel2);   /* #1a212b */
  --cl-brand:var(--gold);         /* #e8c877 */
  --cl-brand-strong:var(--gold2); /* #b8934a */
  --cl-text:var(--text);          /* #e9edf3 */
  --cl-text-muted:var(--muted); --cl-text-dim:var(--dim);
  --cl-up:var(--up); --cl-down:var(--down); --cl-danger:var(--err);
  --cl-line:var(--line); --cl-line-2:var(--line2); --cl-overlay:var(--overlay);
  --cl-fs-base:14px; --cl-radius-lg:14px; --cl-space-4:16px; /* 网站端用 px */
}
```

**第二步：浅色模式（新增能力），用属性选择器覆盖同名令牌，值取映射表「浅色列」：**

```css
:root[data-theme="light"]{
  color-scheme: light;
  --cl-bg:#F6F4EF; --cl-surface:#FFFFFF; --cl-surface-2:#FAF8F3;
  --cl-brand:#9A6B1F; --cl-brand-strong:#7A541A; --cl-brand-soft:#F6F1E4;
  --cl-text:#2B2926; --cl-text-muted:#8A8378; --cl-text-dim:#A39C8E;
  --cl-up:#C0392B; --cl-down:#1E8E5A; --cl-danger:#B23A2E;
  --cl-line:#EFECE4; --cl-line-2:#E8E2D5; --cl-overlay:rgba(24,20,14,.45);
}
/* 可选：跟随系统 —— @media (prefers-color-scheme: light){ :root:not([data-theme]){ ...同上浅色值 } } */
```

> 切换机制：网站用 `<html data-theme="light|dark">` 切换（与小程序 `theme.json` 对齐同一套语义）；组件样式只写 `var(--cl-*)`，**永不写死 HEX**，因此两端、两模式共用一份组件逻辑。

---

### 7.4 换算与适配说明

| 项 | 说明 |
|---|---|
| rpx→px | 750rpx 设计稿 = 屏宽；基准机型 375pt：**1rpx ≈ 0.5px**。换算：`px = rpx ÷ 2`、`rpx = px × 2`。全面屏/大屏机型 rpx 自动缩放，勿写死 px。 |
| 安全区 | 页面底部 `padding-bottom: calc(48rpx + env(safe-area-inset-bottom))`；底部弹层同理；tabBar 为原生，无需重复处理。 |
| 全面屏 | 顶部自定义导航时避让胶囊按钮；Hero 顶部 padding 已含 38rpx，勿贴状态栏。 |
| 深色模式 | `app.json` 加 `"darkmode":true` + `theme.json` 定义变量；tabBar 用 `wx.setTabBarStyle` 切换（浅色 `#ffffff`/金 `#9a6b1f`，深色 `#141a22`/金 `#e8c877`）；监听 `wx.onThemeChange`。 |
| 网站端 | 默认深色（`color-scheme:dark`），按 §7.3 新增 `data-theme="light"` 浅色覆盖，与小程序共用同一套 `--cl-*` 语义令牌；默认模式差异仅此一处，色值全部来自 §2.5 同一张映射表。 |

---

## 8. 与现有风格的差异清单

### ✅ 保留（不动，已是正确决策）

| 项 | 现有值 |
|---|---|
| 暖白页面底 | `#f6f4ef` |
| 金棕主色 | `#9a6b1f` |
| 深棕 Hero 渐变 | `#221a12 → #3c2e1c → #5d4726` |
| 暖棕阴影 | `rgba(60,48,26,...)`（非纯黑） |
| 方孔圆钱装饰母题 | Hero `.hero-coin` / 网站 `.medal` |
| 卡片 20rpx 圆角、按钮 14rpx | `.card` / `button` |
| 宋体品牌字 | `"Songti SC"` Hero / H1 |
| tabular-nums 数字 | `.num-v` / `.kpi .v` |
| 中国涨红跌绿约定 | `.up` / `.down` |
| tabBar 配色 | 灰 `#8a8378` / 金 `#9a6b1f` |
| 微信 button 居中修复 | flex + `line-height:1` + `::after{border:none}` |

### 🔧 调整（收敛/统一，不改观感）

| 项 | 现状 | 调整为 |
|---|---|---|
| 涨跌色重复 | 红 `#c0392b` 与 `#b23a2e`、绿 `#1e8e5a` 与 `#2f7a4f` 并存 | 统一 `--cl-up:#C0392B` / `--cl-down:#1E8E5A` |
| 金棕色值散乱 | 10+ 个近似金棕硬编码 | 收敛为 10 级 `--cl-brand-*` 阶梯 |
| 中性色散乱 | 十几个 HEX 无命名 | 建立 `--cl-neutral-*` / `--cl-text-*` 语义令牌 |
| 字号零散 | 18/19/20/21/22/23/24/26/27/28/30/32/34/38/54rpx | 收敛为 9 级 `--cl-fs-*` 阶梯 |
| 价格提示零散 | pb-tip / ai-tip / fig-note / foot-warn 各自为政 | 统一"参考估值"强制标注机制（第 6.5 节） |
| muted 可读性 | `#8a8378` 对比度 3.8:1 | 需阅读的辅助字改用 `#6b6559`（5.7:1）；`#8a8378` 仅弱化信息 |
| 数字字重 | 多处 `700` | 降为 600，靠字号/颜色分层 |
| 圆角/阴影命名 | 硬编码 | 建立 `--cl-radius-*` / `--cl-shadow-*` 分级令牌 |

### 🆕 新增（此前没有）

| 项 | 说明 |
|---|---|
| 完整深色模式映射 | 复用网站端深色 token，两端同源；含 Hero 深色渐变、tabBar 切换 |
| 方孔圆钱 SVG 符号系统 | 线稿/实心/水印三态，currentColor 自适应 |
| 品牌金 10 级阶梯 + 语义别名层 | 网站端加 `--cl-*` 别名逐步迁移，不破坏现有 |
| 8rpx 间距标尺 | `--cl-space-*` |
| 语义色 | success / warning / danger / info |
| 价格徽章"参考估值"标准组件 | 金额中性金 + 强制标注 + 涨跌分离 + AI 价分层 |
| 图片占位规范 | 方孔圆钱水印占位、切图格式与尺寸建议 |
| 无障碍对比度标准 | 关键文字 ≥ 4.5:1；金字浅底优先 `--cl-brand-700` |
| 安全区/全面屏/深色适配说明 | 第 7.4 节 |

---

## 9. 避免清单（降低返工）

1. **不要**在主色之外大面积使用金色——金色占比 ≤ 10%，其余交给纸白与炭字。
2. **不要**用红绿渲染估值金额主体；红绿只用于带"较上次"标注的变化幅度。
3. **不要**出现 K 线、分时图、交易所风格的视觉隐喻。
4. **不要**编造发行量/面额/价格数据；无来源字段留空或用"—"，并在规范中保持数据源标注位。
5. **不要**为数字引入外部等宽字体，统一 `tabular-nums`。
6. **不要**在深色模式沿用浅色的硬编码 HEX；一律走 `--cl-*` 语义令牌。
7. **不要**用写实铜钱纹理/锈迹作装饰；母题保持几何简化。
8. **不要**堆叠角标、重描边、高饱和渐变按钮——克制是本品牌的第一气质。

---

> 交付边界：本文档为 Phase 1 视觉方向。信息架构、页面流程、交互状态流转等见 Phase 2（体验规范）；可视化预览与令牌落地见 Phase 3。
