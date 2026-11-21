# 藏币录 · HarmonyOS 原生客户端

与网页版、微信小程序**同一套账号与后端**（`https://coin.virtualman.top`），数据同源。
Stage 模型 + ArkTS，API 20（HarmonyOS 6.0），单 HAP、单 Ability、Navigation 页面栈。

- 应用名：藏币录
- 包名：`com.virtualman.coinledger`
- 版本：1.0.0（versionCode 1000000）
- 设备：phone / tablet
- 权限：仅 `ohos.permission.INTERNET`

## 1. 目录

```
harmony/
├─ AppScope/                     应用级配置与图标（app.json5 / app_icon.png 1024）
├─ build-profile.json5           API 20、debug/release 两套构建模式
├─ hvigor/hvigor-config.json5    hvigor 6.0.6
├─ entry/
│  └─ src/main/
│     ├─ module.json5            入口 Ability + 权限声明
│     ├─ ets/
│     │  ├─ entryability/        EntryAbility：初始化目录/隐私/缓存，设置状态栏
│     │  ├─ pages/Index.ets      主壳：隐私弹窗 + 四个 tab + Navigation 路由表
│     │  ├─ views/               HomeView / PlanView / ListView / MineView
│     │  ├─ pages/               二级页（详情、登录、藏品、系列、广场…）
│     │  ├─ components/          TabBar（玻璃胶囊）、通用块
│     │  ├─ utils/               catalog / api / store / format / backup / image …
│     │  └─ model/types.ets      与后端一致的数据模型
│     └─ resources/rawfile/catalog.json   内置品种目录（与小程序同源生成）
└─ build.sh                      命令行构建脚本
```

## 2. 与小程序的功能对照

| 能力 | 小程序 | 鸿蒙 | 说明 |
|---|---|---|---|
| 首页（账本、最新发行、金银价、系列） | ✅ | ✅ | 布局按 ArkUI 重建，口径一致；按需求去掉了「藏友晒单」模块 |
| 发行计划（普通币/贵金属、倒计时、公告详情） | ✅ | ✅ | 数据同 `/api/plans` |
| 全套清单（搜索、筛选、排序、贵金属分页、按系列） | ✅ | ✅ | 一套件数/推理价口径一致 |
| 品种详情（多图、参数、发行信息、同系列） | ✅ | ✅ | Markdown 粗体/分段自行解析 |
| 贵金属详情（正反面、规格、公告） | ✅ | ✅ | `/api/catalog/pm/:code` |
| 登录/注册/改昵称/改密码 | ✅ | ✅ | 用户名密码；鸿蒙不做微信登录 |
| 我的藏品（分组、改数量/成本/号码、移出） | ✅ | ✅ | 串行全量 PUT 保序 |
| 收藏备份（CSV 导出、导入合并） | ✅ | ✅ | 系统文件选择器，无需存储权限 |
| 拍照数币 | ✅ | ✅ | 系统照片选择器 + 服务端计数 |
| 藏品广场（列表、点赞、评论） | ✅ | ✅ | 首页不再展示晒单入口，广场页仍可从「我的 → 更多功能」进入 |
| 系列总览 / 系列详情 | ✅ | ✅ | 贵金属项目分页 |
| 意见反馈 / 我的反馈 | ✅ | ✅ | 支持 3 张截图 |
| 关于 / 隐私政策 / 用户协议 | ✅ | ✅ | 含个人信息收集清单 |
| 管理后台（用户/反馈/品种） | ✅ | ✅（部分） | 计划、贵金属、系列、图片请在网页后台操作 |
| 微信订阅消息提醒 | ✅ | ➖ | 改为应用内提醒记录，不申请后台通知权限 |
| 分享到微信/朋友圈 | ✅ | ➖ | 改为复制链接 / 系统分享 |

## 3. 口径（与 Web、小程序必须一致）

- 清单口径：1 套 = 套系件数（整卷 20 枚 / 多枚套币按套）；展示口径优先取预约限额。
- 账本口径：按「卷 / 套 / 张」记，记账单位与展示单位分开；贵金属只记成本，不进面值与估值。
- 推理价：`ln(P) = 12.605 − 2.2721·ln(M) + 0.1102·ln(M)² + 0.3325·ln(1+age) + 材质 + 钞`，通胀只作下限保护。
- 涨跌配色：涨红 `#C0392B`、跌绿 `#17724A`（国内习惯）。

改动以上任何一条，**网页 `public/app.js`、小程序 `utils/catalog.js`、鸿蒙 `utils/catalog.ets` 三处都要改**。

## 4. 数据同步

`resources/rawfile/catalog.json` 由 `tools/build_harmony_data.js` 从
`miniprogram/data/catalog.js`（优先）或 `public/data/*.json` 生成，**不要手改**。

品种 / 系列 / 发行计划有变动时：

```bash
npm run data:sync        # 导出 JSON + 重建小程序内置数据
npm run harmony:data     # 重建鸿蒙内置数据
```

## 5. 构建与运行

### 图形界面
用 DevEco Studio 6.0 打开 `harmony/` 目录，等待 Sync 完成，选模拟器或真机运行。
首次运行需在 `File → Project Structure → Signing Configs` 勾选自动签名。

### 命令行
```bash
npm run harmony:data      # 先同步数据
npm run harmony:build     # = bash harmony/build.sh
# 产物：harmony/entry/build/default/outputs/default/entry-default-unsigned.hap
```
脚本会自动使用 DevEco 自带的 SDK 与 JBR；换机器时用 `DEVECO_HOME` 指到 DevEco Studio 安装目录。

## 6. 已知差异与后续

1. **广场发布**：鸿蒙端目前只读（浏览/点赞/评论），发布晒单的多选流程待第二批；可先用「我的藏品 → 分享链接」。
2. **管理后台**：用户封禁/解封、反馈处理、品种基础字段编辑已实现；发行计划、贵金属规格、系列成员、图片上传仍在网页后台。
3. **通知提醒**：不申请 `PUBLISH_AGENT_REMINDER` 等受限权限，预约提醒只在应用内展示，符合最小权限原则。
4. **分享**：无微信 SDK，改为复制官网链接 + 系统分享面板。

## 7. 上架

见 [`docs/harmony-release.md`](../docs/harmony-release.md)。
