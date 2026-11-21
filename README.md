# 藏币录 · Coin Ledger

1984—2026 年中国人民银行普通纪念币 / 纪念钞的收藏管理站。**137 个品种**（含 10 张纪念钞）、19 个系列、21 个套系，多用户各自记账；一套后端同时服务**网页**和**微信小程序**，数据同源。

| | |
|---|---|
| 网页 | <https://coin.virtualman.top/>（HTTP 自动跳 HTTPS） |
| 小程序 | 微信搜索「藏币录」 |
| 鸿蒙 | `harmony/`（原生 ArkTS，待上架华为应用市场） |
| 备案 | [鲁ICP备2020034737号](https://beian.miit.gov.cn/) |
| 当前版本 | Web `3.0.75` · 小程序 `2.9.33` |
| 数据说明 | 发行量、面额、图案取自央行公告与中国金币网；推理价为公开参数估算，**不是市场价** |

**目录**

1. [快速开始](#1-快速开始) · 2. [目录结构](#2-目录结构) · 3. [核心口径](#3-核心口径必读) · 4. [设计规范](#4-设计规范)
5. [接口](#5-接口) · 6. [数据模型](#6-数据模型) · 7. [部署](#7-部署) · 8. [排障](#8-排障速查) · 9. [更新日志](#9-更新日志)

---

## 1. 快速开始

### 1.1 跑网页

```bash
node server/index.js                       # 默认 JSON 单文档后端，不需要装数据库
PORT=3100 COIN_DATA_DIR=./data node server/index.js
# 打开 http://127.0.0.1:3100
```

连 MySQL（可选）：

```bash
npm install                                # 只为 mysql2
STORAGE=mysql MYSQL_HOST=127.0.0.1 MYSQL_DB=coin_ledger \
MYSQL_USER=coin_ledger MYSQL_PASSWORD=xxx node server/index.js
```

首次启动自动建超管，用户名 `virtualman`（`SUPERADMIN_NAME` 可改），口令取 `SUPERADMIN_PASSWORD`；**没配就随机生成并打进日志**，登录后请立刻修改。仓库里不存任何默认口令。

### 1.2 跑小程序

用微信开发者工具打开 `miniprogram/` 目录即可。接口域名在 `miniprogram/utils/api.js` 的 `BASE`。

### 1.3 跑鸿蒙

用 DevEco Studio 6.0 打开 `harmony/`，或命令行：

```bash
npm run harmony:data     # 从小程序同源数据生成 rawfile/catalog.json
npm run harmony:build    # 需要本机 DevEco Studio（自带 SDK/JBR）
```

详见 [`harmony/README.md`](harmony/README.md) 与上架清单 [`docs/harmony-release.md`](docs/harmony-release.md)。

上传（不需要开开发者工具）：

```bash
# 需要 .secrets/private.<appid>.key（CI 上传密钥，不进仓库）
npm run mp:upload -- -d "这次改了什么"
```

上传前确认 `miniprogram/app.js` 里的 `version` 已递增——它决定 `getApp().globalData.version`，也会显示在「关于」页。

### 1.3 跑测试

```bash
npm test                        # 全部
node --test tests/mp-*.test.js  # 只跑小程序侧
```

`tests/` 下 45 个文件、约 196 条用例，绝大多数是**源码级回归**（断言模板结构、样式 token、事件绑定与 JS 方法是否对得上），跑一次几秒钟，不需要起服务。

> `tests/pm-rules.test.js` 是服务端集成测试，要连库，单独跑会以 exit 2 结束，属正常。

---

## 2. 目录结构

```
coin-ledger/
├─ public/                      ← Nginx 站点根目录
│  ├─ index.html                ← 页面骨架（SEO / Open Graph / manifest）
│  ├─ app.css / app.js / serial.js
│  ├─ legal.html                ← 服务条款 / 隐私政策 / 免责声明
│  ├─ data/coins.json           ← 发行清单（137 品种），前端离线兜底 + 后端种子
│  ├─ data/images.json          ← 实拍 / 示意图口径
│  ├─ data/plan.json、plan-pm.json ← 发行计划
│  ├─ icons/ · img/             ← 应用图标、导图封面、币面图
│  └─ robots.txt / sitemap.xml / manifest.webmanifest
├─ server/
│  ├─ index.js                  ← HTTP 服务、路由、静态托管
│  ├─ legacy/api-handler.js     ← 业务路由（体量最大的一块）
│  ├─ store.js                  ← 存储门面（选后端 + 写入串行队列）
│  ├─ store-mysql.js            ← MySQL 后端
│  ├─ store-json.js             ← JSON 单文档后端（回退 / 本地开发）
│  ├─ auth.js                   ← 多用户口令 + 签名会话 + 微信登录
│  └─ guard.js                  ← 限流 / UA 拦截 / 蜜罐
├─ harmony/                     ← 鸿蒙原生客户端（Stage / ArkTS，API 20）
│  ├─ entry/src/main/ets/       ← 页面、视图、utils、数据模型
│  ├─ entry/src/main/resources/rawfile/catalog.json  ← 内置品种目录（同源生成）
│  └─ README.md                 ← 功能对照、构建、已知差异
├─ miniprogram/                 ← 微信小程序（原生，无框架）
│  ├─ app.js / app.json / app.wxss  ← 全局样式与 token 在这里
│  ├─ pages/                    ← 页面；首页/计划/清单/我的四个主标签挂在宿主页里，其余是二级页
│  ├─ components/               ← 复用组件（底部 tabbar）
│  ├─ utils/                    ← api、store、catalog、admin-guard、datetime …
│  └─ data/                     ← 由 tools/build_mp_data.js 从 public/data 生成
├─ tests/                       ← 源码级回归
├─ tools/                       ← 抓取、校验、数据构建（不参与运行）
├─ deploy/                      ← install.sh、备份、证书、nginx 片段
└─ docs/CHANGELOG.md            ← 逐条变更记录
```

---

## 3. 核心口径（必读）

这块最容易算错，改代码前先看一眼。

### 3.1 清单口径 vs 账本口径

| | 清单（展示） | 账本（记录） |
|---|---|---|
| 整卷纪念币 | 1 套 = 20 枚 | 按「卷」记，1 卷 = 20 枚 |
| 多枚套币 / 对钞 | 按套计 | 按「套」记 |
| 独立纪念钞 | 按套计 | 按「张」记，**面值 = 面额 × 张数，不能再乘 20** |
| 贵金属 | 单列目录，2823 条 | 记成本，**不进面值、不进估值** |

`itemFace()` 通过 `holdingUnitSize()` 区分这两种口径，**不要直接套用清单的 `setPriceOf()`**。

### 3.2 量词

由 `holdingUnitName()` 统一派生：整卷叫「卷」、多枚套币与对钞叫「套」、独立纪念钞叫「张」、混装退回「份」。卡片只在「1 份 > 1 件」时补写件数。

### 3.3 估值

- 页面上统一叫**推理价**，按发行量、材质、年份等公开参数估算，**不含题材溢价**，不标成市场价或售价。
- **贵金属不出市值与盈亏**：没有可靠行情，硬算会给出假亏损。相关页面显示「不计估值」。
- 各页底部统一带一句「价格为参考估算，不构成投资建议」。

### 3.4 数据不许编

发行量、面额、材质、图案必须有来源（央行公告 / 中国金币网 / 新华社）；拿不到就留空，不填估算值。结构化数据里刻意不给 `offers`。

---

## 4. 设计规范

两端共用一套 token，新增页面**只允许用下面这些值**，不要另起一套（这是历史上返工最多的原因）。

### 4.1 色彩

| 用途 | 值 | 说明 |
|---|---|---|
| 页面背景 | `#f6f4ef` | 暖白 |
| 卡片 | `#ffffff` | 配 `border-radius: 20rpx` + `box-shadow: 0 3rpx 16rpx rgba(74,55,20,.06)` |
| 主文字 | `#2b2926` | |
| 次文字 | `#6b6559` | 全站用得最多的一级 |
| 弱文字 | `#8a8378` | 辅助信息、占位 |
| 分割线 | `#ece7dc` / `#f6f3ec` | |
| 品牌金 | `#9a6b1f` | 深金，用于文字强调 |
| 品牌金（亮） | `#b98f43` → `#d9b364` | 仅用于主按钮渐变、进度条填充 |
| 次级金 | `#8a6420` | 图标、胶囊文字 |
| 浅金底 | `#f6efe0` | 图标底、标签底 |
| 涨 / 跌 | `#9c5850` / `#3f7050` | 语义色，不是装饰色 |

### 4.2 其他约定

- **字号下限 20rpx**，正文 22–28rpx，页面最大数字 54rpx（首页与藏品页同级）。
- **渐变只出现在主 CTA 按钮和进度条**；卡片不用渐变、不叠发光。
- 触控热区 ≥ 88rpx，靠伪元素扩展，不撑大视觉尺寸。
- 小程序 `app.wxss` 提供通用类：`.card`、`.cell`（列表行）、`.cell-ico`（行首图标）、`.btn-primary`、`.tap-hover`；新页面优先复用。
- 新建页面**不要覆盖 `.page` 的全局内边距**（顶部 24rpx），只有底部让位悬浮 tabBar 时才加 `padding-bottom`。

---

## 5. 接口

### 5.1 前台

| 方法 | 路径 | 鉴权 | 说明 |
|---|---|---|---|
| GET | `/api/bootstrap` | - | 清单 + 行情 + 登录态；持仓只返回当前用户的 |
| GET | `/api/health` | - | 存活、版本、品种与用户数、当前存储后端 |
| POST | `/api/auth/register` `login` `logout` | - | 口令登录，HttpOnly Cookie 7 天 |
| POST | `/api/auth/password` | ✔ | 改密码 |
| GET | `/api/auth/me` | - | 当前会话 |
| POST | `/api/auth/wx/login` `bind` `unbind` | ✔/- | 微信一键登录与绑定 |
| POST | `/api/me/profile` | ✔ | 改昵称 / 头像（`avatar: ""` 表示**清除头像**） |
| PUT | `/api/holdings` · `/api/holdings/reset` | ✔ | 整包替换自己的持仓 / 恢复初始 |
| POST | `/api/holding/image` | ✔ | 单条藏品传图 |
| GET | `/api/catalog` · `/api/catalog/pm` | - | 品种目录 / 贵金属全量（分页 + facets） |
| GET | `/api/series` · `/api/series/detail` | - | 系列列表与详情 |
| GET | `/api/plans` | - | 发行计划（普通币 + 贵金属） |
| GET | `/api/metal-price` | - | 金银材料价 |
| POST | `/api/serial/analyze` `analyze-batch` | - | 号码花样识别 |
| POST | `/api/feedback` · GET `/api/feedback/mine` | ✔ | 纠错反馈 |
| POST | `/api/reminders` | ✔ | 发行提醒（订阅消息） |
| POST | `/api/visit` | - | 访问统计 |

### 5.2 管理端（全部要求管理员身份）

`/api/admin/users`（分页 / `q` 搜索 / `role` / `status` / 排序，返回 `stats`）、`users/batch`（批量标记测试 / 禁用 / 删除）、`users/:id/holdings`、`coins`、`coin`、`image`、`categories`、`pm-all`、`series`（含 `image` / `members`）、`plan` / `plan-pm`、`feedback`、`visitors` / `visitors/detail`、`audit`、`guard/bans` / `guard/unban`。

权限：未登录读持仓返回空数组、写接口 `401`；普通用户访问管理端 `403`；登录失败按 IP 累计，10 分钟内超过 8 次锁 `429`。

---

## 6. 数据模型

`public/data/coins.json`

```jsonc
{
  "series": { "NP": "国家公园", "...": "..." },
  "sets":   { "np": { "name": "国家公园", "total": 5, "unit": "套" } },
  "coins": [{
    "i": 0,                       // 清单序号（0 起），img 文件名用 i+1
    "year": 2000, "name": "敦煌藏经洞发现100周年",
    "series": "ZT", "face": 1,    // 面额（元）
    "mintage": 1000,              // 发行量（万）
    "material": "钢芯镀镍", "dia": 25,
    "kind": "coin",               // coin | note
    "est": 15                     // 单枚推理价（可被 prices 覆盖）
  }]
}
```

运行时数据 `data/db.json`（v2 多用户结构，MySQL 后端时同构）：

```jsonc
{
  "version": 2, "rev": 42,
  "users": [{ "id": "u1", "name": "virtualman", "role": "admin", "salt": "…", "hash": "…" }],
  "holdings": { "u1": [{ "name": "三江源国家公园", "rolls": 1, "cost": 200 }] },
  "prices": { "0": 17.5 }          // 行情全局共享
}
```

旧版单用户数据（`holdings` 是数组）启动时自动迁移，原持仓归属超管。

---

## 7. 部署

### 7.1 网页

生产用宝塔 **Supervisor** 托管（`systemd` 单元已停用，文件保留可回滚）：

```bash
# 改完代码上传后
chown www:www <改动的文件>
/www/server/panel/pyenv/bin/supervisorctl restart coin-ledger
curl -s http://127.0.0.1:3100/api/health     # 看 version 是否变了
```

**发布检查清单**（踩过的坑都在这）：

1. 静态文件（`index.html` / `app.js` / `app.css`）要传到 `public/` 子目录——nginx 的 root 是 `public`，传到父目录不生效。
2. 改 `app.js` 或 `app.css` 必须同步改 `index.html` 里的 `?v=`，宝塔对 js/css 有 12h 缓存。
3. `package.json` 在父目录，它决定 `/api/health` 报的版本号。
4. 上传后对一遍 `md5sum`，别只看 curl 200。

首次部署 / 回滚：`MYSQL_ROOT_PASSWORD='…' bash deploy/install.sh`（幂等）。**升级时不要执行**，它会重新启用 systemd 单元，和 Supervisor 抢 3100 端口。

### 7.2 小程序

```bash
# 1. 数据有变时先重建（coins.json → miniprogram/data）
node tools/build_mp_data.js
# 2. 递增 miniprogram/app.js 的 version
# 3. 上传
npm run mp:upload -- -d "本次改动说明"
```

### 7.3 多任务并行时的规矩

这个仓库经常有并行的改动（定时任务也在写）。**提交和上传前先 `git status`**：

- 有别人正在写的文件（mtime 就在几秒前）→ 只 `git add` 自己的路径，别用 `git add -A`；上传是整包，会把半成品打进体验版。
- 等对方 commit 后再统一上传。

---

## 8. 排障速查

```bash
supervisorctl status coin-ledger                 # 完整路径 /www/server/panel/pyenv/bin/supervisorctl
tail -f /www/wwwlogs/coin-ledger-supervisor.log
tail -f /www/wwwlogs/coin.virtualman.top.log
mysql coin_ledger -e 'SELECT uid,COUNT(*) FROM cl_holdings GROUP BY uid'
bash /www/wwwroot/coin-ledger/deploy/backup.sh
grep APP_PASSWORD /etc/coin-ledger.env           # 口令只在服务器 env 文件里
```

常见问题：

| 现象 | 原因 |
|---|---|
| 改了代码线上没变 | `?v=` 没动 / 文件传到了父目录 |
| 服务起不来 | `/etc/coin-ledger.env` 权限不是 `root:www 640`，`www` 读不到口令 |
| 时间显示差 8 小时 / 带 T | 后端返回 ISO，前端要转本地时间 |
| 内容出现方块 | 响应头缺 charset 或源文件非 UTF-8 |
| 小程序白屏 | 看是否 `app.json` 引用了未注册的页面 / 组件路径写错 |

---

## 9. 更新日志

逐条变更记录在 [docs/CHANGELOG.md](docs/CHANGELOG.md)（从 v1.0 到 v2.9，按时间排列）。
README 只保留"怎么跑、怎么改、怎么发"，新改动请追加到 CHANGELOG，不要再往这里堆。
