# 藏币录 · Coin Ledger

1984—2026 年中国人民银行普通纪念币 / 纪念钞的收藏管理站：**多用户**各自记账，按页签分为概览、我的藏品、收齐成本、全套清单、账户；**深色 / 浅色双主题**；行清单悬停可看官方币面实物图。

线上地址：<https://coin.virtualman.top/>（HTTP 自动 301 跳 HTTPS）

> **线上实例（2026-11-08 部署）**
> - 代码：`/www/wwwroot/coin-ledger`，systemd 服务 `coin-ledger`（User=www），端口 `3100` 仅监听 127.0.0.1，由 Nginx 反代。
> - 宝塔：站点已登记在「网站」列表（id 12，`coin.virtualman.top`），网站目录指向 `/www/wwwroot/coin-ledger/public`；`/api` 反代等指令放在宝塔的扩展目录 `vhost/nginx/extension/coin.virtualman.top/coin-ledger.conf`，**面板重新生成站点配置也不会丢**。
> - 证书：Let's Encrypt，走宝塔内置 ACME 实现申请，装在 `vhost/cert/coin.virtualman.top/`；每周一 04:40 检查，剩余 < 21 天才续。
> - 访问口令不写在任何文件里，只在服务器 `/etc/coin-ledger.env`（600），用 `grep APP_PASSWORD /etc/coin-ledger.env` 查看。
- 存储：**MySQL 8.4**（库 `coin_ledger`，应用账号 `coin_ledger@127.0.0.1`），连接参数同样在该 env 文件里；`/api/health` 会返回 `storage` 字段，一眼看出当前用的是 mysql 还是 json。

### 常用运维命令

```bash
systemctl restart coin-ledger          # 重启后端
journalctl -u coin-ledger -f           # 实时日志
tail -f /www/wwwlogs/coin.virtualman.top.log   # 访问日志
mysql coin_ledger -e 'SELECT uid,COUNT(*) FROM cl_holdings GROUP BY uid'   # 直接查库
bash /www/wwwroot/coin-ledger/deploy/backup.sh      # 手动备份一次
bash /www/wwwroot/coin-ledger/deploy/renew-cert.sh  # 手动续期检查
```

### 升级

改完代码重新打包上传，执行 `MYSQL_ROOT_PASSWORD='…' bash deploy/install.sh` 即可；脚本幂等，会保留数据库、`data/`、访问口令、证书与宝塔站点配置。

> **改了 `app.js` / `app.css` 一定要动 `index.html` 里的 `?v=` 号**（当前 `?v=3.0.1`）。
> 宝塔主配置对 js/css 有 12h 的 `expires`，正则 location 优先级高于我们片段里的 `location /`，
> 不改版本号的话用户浏览器会一直用旧脚本，改了代码却看不到变化。

---

## 目录结构

```
coin-ledger/
├─ public/                  ← Nginx 站点根目录
│  ├─ index.html            ← 页面骨架（含 SEO / Open Graph / manifest 引用）
│  ├─ app.css               ← 样式（深色 + 浅色双主题、移动端适配）
│  ├─ app.js                ← 前端逻辑（含 API 客户端与三级回退）
│  ├─ legal.html            ← 服务条款 / 隐私政策 / 免责声明
│  ├─ data/coins.json       ← 发行清单（135 品种），前端离线兜底 & 后端种子
│  ├─ data/images.json      ← 哪些品种是官方实拍、哪些是示意图
│  ├─ logo.svg              ← 标志（方孔圆钱，透明孔，可换色）
│  ├─ logo-lockup.svg       ← 横版组合标（含中英文字标）
│  ├─ icons/                ← 应用图标与社交分享封面
│  ├─ robots.txt / sitemap.xml / manifest.webmanifest
│  └─ img/001–095.jpg       ← 币面图（编号 = 清单 1-based 序号）
├─ server/
│  ├─ index.js              ← HTTP 服务、路由、静态托管
│  ├─ store.js              ← 存储门面（选后端 + commit 串行队列）
│  ├─ store-mysql.js        ← MySQL 后端（5 张表，事务落库）
│  ├─ store-json.js         ← JSON 单文档后端（回退 / 本地开发）
│  ├─ auth.js               ← 多用户口令 + 签名会话
│  └─ guard.js              ← 限流 / UA 拦截 / 蜜罐
├─ deploy/
│  ├─ install.sh            ← 一键安装 / 升级（幂等）
│  ├─ coin-ledger.service   ← systemd 单元
│  ├─ nginx.conf            ← 独立模式的完整 server 块
│  ├─ nginx-locations.conf  ← server 级片段（/api 反代、缓存、强制 HTTPS）
│  ├─ backup.sh             ← 每日备份（mysqldump + db.json）
│  └─ renew-cert.sh         ← 证书续期兜底
├─ tools/                   ← 抓取与校验脚本（开发期用，不参与运行）
│  └─ migrate-to-mysql.js   ← 把 data/db.json 导入 MySQL（带回读校验）
└─ package.json
```

## 技术选型

| 层 | 选型 | 理由 |
|---|---|---|
| 后端 | Node 18+，唯一运行时依赖 `mysql2`（纯 JS，无原生编译） | 不引入 Web 框架，路由 / 静态托管仍是内置模块；`mysql2` 走 npm 镜像安装，不涉及 g++ 编译 |
| 存储 | **MySQL 8**（5 张 InnoDB 表）+ 事务落库 | 多端并发写有行级锁与事务；给后台统计、导出留了 SQL 入口；JSON 单文档保留为回退与本地开发后端 |
| 前端 | 原生 JS，无框架 | 页面是一次性渲染 + 局部刷新，框架收益为负 |
| 部署 | systemd + Nginx 反代 | 与宝塔面板共存，重启自恢复 |

## 界面与主题

- **双主题**：`html[data-theme="light|dark"]` 切换，全部颜色收敛成 `app.css` 顶部的一组语义变量（`--surf` / `--hair` / `--sh-*` / `--row-mine` …），浅色主题只需覆盖变量 + 少量组件补丁。
- 首次访问跟随系统 `prefers-color-scheme`；手动切换后写入 `localStorage['coin-theme']` 并优先使用。`<head>` 里有内联脚本在首帧前定好主题，避免深色闪一下。
- 浅色并非简单反色：金色改为深金（`#9a6f24`）保证白底对比，系列标签、主按钮另有浅色专用配色。
- 全套清单支持**点击「年份」表头排序**（升 / 降切换）；顶部还有一条「我的藏品」合计：**总面值 / 总市值 / 浮动盈亏**（含独立藏品），筛选时额外显示「当前筛选 N 个品种 · 其中已藏 M」。
- **「一套」= 一整卷 = 20 枚**（纪念钞同样按 20 张/套展示），列里直接给出该卷的发行价（面额×20）与市价（单枚估值×20）。这是**清单展示口径**。
- **账本口径另算**：整卷纪念币按「卷」记（1 卷 = 20 枚）；独立发行的纪念钞（`set: "single"`、无套系声明）按「张」记，面值 = 面额 × 张数，**不能再乘 20**（否则 20 张 × 20 元会算成 ¥8,000）；冬奥对钞按「套」记（1 套 = 2 张）。`itemFace()` 通过 `holdingUnitSize()` 区分这两种口径，不要直接套用清单的 `setPriceOf()`。
  - 量词由 `holdingUnitName()` 统一派生：整卷（20 枚）叫「卷」、多枚套币与对钞叫「套」、独立纪念钞叫「张」、同组混装时退回中性的「份」。卡片右侧只在「1 份 > 1 件」时才补写件数（整卷写「共 400 枚」），独立钞本身按张记，不重复写。
- **「全部系列」页**：13 张卡片（12 个系列 + 独立发行），每张显示进度、整套发行价与市价、已藏市值、缺项清单；点卡片直接跳到清单并按该系列筛选（工具栏出现可清除的筛选标记）。概览只保留一行摘要（系列数 / 已集齐 / 品种进度 / 下一步建议）。
- 概览的「系列概览」按**品种数**计（如国家公园 5 个品种 5/5 已集齐），与「一套=20 枚」是两个不同维度的概念，界面上分开表述。系列划分用 `data/coins.json` 的 `sets` + 每个品种的 `set` 字段，把一轮/二轮生肖、奥运/冬奥分别拆开。
- **移动端**：≤640px 时清单从表格切换为卡片式行（年份 | 名称+看图 | 面额·市价+收藏 | 一套整行），彻底避免横向挤压；触屏下输入框字号 ≥16px 防 iOS 聚焦放大，按钮点击区加大，页面按安全区留白。
  - 顶栏压成固定 44px 一行：同步状态只留圆点、`账户` 按钮隐藏（用户名胶囊点击即进账户页），`用户管理` / `退出` / 主题 保留。
  - 页签用 `data-short` 换成两字短名（首页/概览/系列/藏品/成本/清单），6 项刚好铺满一屏；只有真的溢出时才给右侧渐隐（`syncTabOverflow()`）。
  - 清单筛选区默认折叠成一个「筛选」按钮；`.fpanel` 桌面端 `display:contents`、手机端才变成可折叠面板，两边共用同一套 DOM。
  - 成本卡 ≤820 单列；概览 KPI ≤640 两列；持仓卡「单卷成本」独占一行、`浮动` 带分隔线；**`.del`（移除）在 `pointer:coarse` 下常驻显示**——它原本只在 `:hover` 显形，手机上根本删不掉持仓。
  - 系列卡缺项名单会自动裁掉与系列名重复的前缀（`shortNames()`），长名字不再占两行。
- **图片策略**：**133 个品种使用真实币面照片**（央行公告 + 百度图片，逐张人工核验），2 个（刘少奇诞辰100周年、邓小平诞辰100周年，公开图源只有新闻截图）用示意图代替；口径以 `public/data/images.json` 的 `real` / `mock` 为准，页面页脚文案由前端按该口径动态生成。
  - 抓取方式：用**本地 Chrome 无头渲染**百度图片搜索页（`--dump-dom`），从 `data-thumbnail-url` / `data-objurl` 取图，绕开接口反爬（百度图片 API 直接返回 `Forbid spider access`，搜狗 403，必应结果与查询无关）。
  - 坑：词条首图/搜索结果经常是**风景照、人物照、奥运项目图标、红色海报、红包包装、金银币**，必须生成接触表逐张核验；脚本见 `tools/browser_find_images.py`。

## URL 与 SEO

**路由用真实路径，不用 `#hash`。** `#` 之后的内容浏览器根本不会发给服务器，搜索引擎也就看不到，`/#!/coin/12` 这类地址基本进不了索引。现在长这样：

| 页 | URL |
|---|---|
| 首页 | `/` |
| 全套清单 | `/all` |
| 品种详情 | `/coin/12`（编号 = 清单里的顺序号，1 基） |
| 系列 / 概览 / 藏品 / 收齐成本 | `/series` `/overview` `/holdings` `/cost` |
| 账户 / 用户管理 | `/account` `/admin` |

一次导航的完整链路：

```
浏览器 GET /coin/12
  └─ Nginx：location ~ "^/coin/[0-9]{1,3}/?$" → proxy_pass 127.0.0.1:3100
       └─ Node：没有同名文件 → 回 index.html，并按下标把 <title>/description/canonical 换成该品种的
            └─ 页面加载后 app.js 读 location.pathname 渲染对应视图（pushState 只改地址，不再请求）
```

几条硬约束，改代码时别踩：

- **Nginx 正则里的 `{1,3}` 必须给 location 加引号**（`location ~ "^/coin/[0-9]{1,3}/?$"`），否则 nginx 把 `{` 当配置块起始，`nginx -t` 直接报 unknown directive。
- **`index.html` 里有 `<base href="/">`**。真实路径下相对路径会被解析成 `/coin/app.js`、`/coin/img/135.jpg`（全是 404），base 把它们统一拉回站点根。新增静态引用也建议写 `/xxx` 绝对路径。
- **`location` 里不要再写 `add_header`**：nginx 的 add_header 不继承，写了会把 server 级的安全头（X-Frame-Options 等）全顶掉。`Cache-Control` 由 Node 发。
- 只有**公开页**进 sitemap（`/`、`/all`、`/coin/N`、`/legal.html`）。`/series`、`/holdings`、`/cost`、`/overview`、`/account`、`/admin` 要登录，别提交，否则蜘蛛抓到的是空壳。
- 未知路径**保持 404**（`/nope` 不会回 200 首页），避免产生一堆软 404 垃圾索引。
- **老链接兼容**：`#/coin/12`、`#/all` 打开时会自动换成 `/coin/12`、`/all`（`legacyPath()`），外链与历史收藏不失效。
- **JS 端每次切路由都要同步 title / description / canonical**（`syncSeo()`），否则抓取端看到全站同一个标题。

改完路由记得更新 sitemap：`node tools/gen-sitemap.js`（读 `public/data/coins.json`，输出 138 条 URL，含全部 `/coin/N`）。robots.txt 里已声明 `Sitemap:` 行。

> 眼下是「服务端注入页面级 meta + 前端渲染正文」。百度这类不跑 JS 的蜘蛛能读到正确的标题/描述，但**正文仍是空的**——要让详情页正文被索引，下一步得做预渲染（把 135 个 `/coin/N` 提前生成静态 HTML）。Google 能跑 JS，影响不大。

## 反爬与防刷

分两层做，思路是「抬高成本」而不是「绝对防住」——真要抄，135 个品种的公开数据拦不死，但会让批量抓取变得很慢很贵。

**Nginx 层**（`deploy/nginx-zones.conf` + `nginx-locations.conf`）

| 措施 | 说明 |
|---|---|
| 限流 | 全站 240r/m、`/api/` 120r/m（burst 60）、`/img/` 180r/m，超限 429 |
| 并发限制 | 单 IP 最多 20 个并发连接 |
| 脚本 UA 拦截 | `python-requests` / `scrapy` / `aiohttp` / `wget` / `httpclient` / `okhttp` 等直接 403 |
| 原始数据封禁 | `/data/*.json` 对外 403（整站原料，前端走 `/api/bootstrap`）；唯一例外 `location = /data/coins.json` 放行，供后端挂掉时前端兜底渲染 |
| 图片防盗链 | `valid_referers none blocked server_names`，外站引用 403 |
| 搜索引擎放行 | 不拦 Baiduspider / Googlebot 等（商业站点要靠收录） |

**Node 层**（`server/guard.js`）

- 按 IP 的 60 秒滑窗限流：读 120、写 30、登录 8、静态 300
- 连续 5 个窗口超限 → 封 10 分钟；可疑脚本 UA 连续 3 次才封
- **蜜罐分级处置**：诱饵只放在 `robots.txt` 的 `Disallow: /api/__trap`（守规矩的爬虫不碰，恶意爬虫才会扫）。**一次命中只记录，不封**；同一 IP 10 分钟内命中 3 次才封 30 分钟。真人误点一次完全无感。
- **不连坐**：本机 / 白名单 / 搜索引擎 UA / **已登录会话**（Cookie 或 Bearer）都豁免 IP 封禁，登录用户照常可用
- 误伤可自救：`GET /api/admin/guard/bans` 看封禁列表，`POST /api/admin/guard/unban` 带 `{"ip":"x.x.x.x"}` 立即解封（均需管理员）
- 本机（127.0.0.1）豁免，避免自检和运维脚本把自己封掉

| 环境变量 | 默认值 | 说明 |
|---|---|---|
| `TRAP_WINDOW_MS` | `600000` | 蜜罐命中计数窗口 |
| `TRAP_BAN_THRESHOLD` | `3` | 窗口内命中几次才封（最小 2，防止配回「一击封」） |
| `BAN_MS` | `1800000` | 蜜罐封禁时长（老部署若已显式设置，沿用旧值） |
| `GUARD_WHITELIST` | 空 | 逗号分隔的可信 IP，支持 `1.2.3.*` / `1.2.3.` 前缀 |

回归测试：`npm test`（`tests/guard.test.js` 锁死「一次误点不封」「登录会话不连坐」等行为）。

**踩过的三个坑**

1. **宝塔主配置里有个正则 `location ~ .*\.(jpg|png)$`，优先级高于普通前缀 `location /img/`**，导致防盗链和图片限流根本没生效。必须用 `location ^~ /img/` 才能压住正则。
2. **别拦 `HeadlessChrome`**：真爬虫都伪装成普通 Chrome，拦它拦不到人，反而把截图/预览/无障碍工具误伤成 403。
3. **别把「视觉隐藏」当成「只有爬虫看得见」**：`aria-hidden` + `tabindex="-1"` 的诱饵链接照样会被搜索引擎索引、被浏览器预取，真人从 Bing 结果点进去就命中蜜罐，接着被 24 小时封死全站 API（日志里清一色 403，很容易误判成「后端挂了」）。现在诱饵只放 `robots.txt`，且蜜罐改成「反复命中才短封」+ 登录会话豁免 + 管理端解封。

## 商业化相关

| 项 | 已做 |
|---|---|
| 搜索收录 | 独立 title/description/keywords、canonical、`robots.txt`、`sitemap.xml`、JSON-LD（WebSite） |
| 社交分享 | Open Graph + Twitter Card，1200×630 分享封面（`icons/og-cover.png`），页脚「分享本站」调用 Web Share / 剪贴板 |
| 移动安装 | `manifest.webmanifest` + apple-touch-icon，可「添加到主屏幕」 |
| 合规 | `legal.html` 含用户协议、隐私政策、免责声明（明确非官方、非投资建议、图片版权归属与处理方式） |
| 数据 | 页脚「累计访问」为自建匿名计数，不接入第三方统计、不采集 IP |
| 待你补 | ICP 备案号（大陆服务器对外提供服务的硬性要求）、域名邮箱 `admin@virtualman.top` 是否可用 |
- **屏蔽浏览器自动填充**：所有输入框 `autocomplete="off"` + `data-form-type="other"`（顺带屏蔽 LastPass / 1Password / Bitwarden）。Chrome 对密码框会无视 `autocomplete="off"`，因此密码框加载时置 `readonly`，用户首次 focus / 点击 / 按键时解锁，填充逻辑就无从触发。登录频次低（Cookie 7 天），这个取舍是划算的。
- **数值框防误改**：`input[type=number]` 在聚焦状态下被鼠标滚轮一滚就会静默改值，会直接改坏账目——现在滚轮会先让其失焦；写入前统一 `clamp(0, 1e8)` 收敛，异常值不会落库。

## 本地运行

```bash
# 默认走 JSON 单文档后端，不需要装数据库
PORT=3100 COIN_DATA_DIR=./data node server/index.js
# 打开 http://127.0.0.1:3100，用超管登录

# 想连本地 MySQL：先 npm install，再给一组连接参数
STORAGE=mysql MYSQL_HOST=127.0.0.1 MYSQL_DB=coin_ledger \
  MYSQL_USER=coin_ledger MYSQL_PASSWORD=xxx node server/index.js
```

首次启动会自动建超级管理员：用户名 `virtualman`（可用 `SUPERADMIN_NAME` 改），口令取 `SUPERADMIN_PASSWORD`；**没配就随机生成一个并打进日志**（`journalctl -u coin-ledger | grep 超管口令`），登录后请立刻改掉。仓库里不存任何默认口令。注册的新用户默认是普通用户，账本从空白开始。

开发工具（`tools/smoke.js`、`mp_*.js`、`fix_note_rolls.js`）登录用的口令也要走环境变量：

```bash
ADMIN_PASSWORD='你的口令' node tools/smoke.js
```

## 服务器部署

```bash
# 上传后，在服务器上以 root 执行（幂等，可反复用于升级）
MYSQL_ROOT_PASSWORD='MySQL 的 root 口令' bash deploy/install.sh

# 指定应用口令（不指定则自动生成并打印一次）
APP_PASSWORD='你的口令' MYSQL_ROOT_PASSWORD='…' bash deploy/install.sh

# 退回 JSON 单文档后端（不碰数据库）
STORAGE=json bash deploy/install.sh
```

> **生产托管方式（2026-11-13 起）**：线上后端已改用宝塔面板「Supervisor 进程管理器」托管，
> `coin-ledger.service` 单元停用并禁用（文件保留，可随时回滚）。进程配置在
> `/www/server/panel/plugin/supervisor/profile/coin-ledger.ini`，运行日志为
> `/www/wwwlogs/coin-ledger-supervisor.log`，面板里可直接启停 / 重启 / 看日志。
> `deploy/install.sh` 仍用于首次部署与回滚，但**升级时不要再执行**，否则会重新启用 systemd
> 单元，与 Supervisor 同时抢 3100 端口。回滚脚本见服务器 `/root/coin-ledger-rollback-systemd.sh`。

## Web 管理控制台（2026-11-16 起）

前台登录后可见的「管理端」按钮跳转到独立的 Vue 3 + Vite 应用：
**https://coin.virtualman.top/console/**（8 个页面：用户、反馈、访客、参数、图片、系列、审计、封禁）。
与前台共用同源 Cookie 会话，未登录 / 非管理员会看到门禁提示；工程结构与页面规范见
[admin/README.md](admin/README.md)、[admin/PAGE_SPEC.md](admin/PAGE_SPEC.md)。

**只在本地构建，服务器不构建**：

```bash
cd admin && npm install && npm run build
# 上传 admin/dist/ 内容 → /www/wwwroot/coin-ledger/public/console/
# nginx 片段 deploy/console-nginx.conf 放到站点 extension 目录，nginx -t && nginx -s reload
# 后端代码变更时：/www/server/panel/pyenv/bin/supervisorctl restart coin-ledger
```

**SEO 保护**：控制台挂全新路径 `/console/`，页面 `noindex` + nginx `X-Robots-Tag`
+ `robots.txt` 新增 `Disallow: /console/`；前台 `<head>`、真实路径路由 `/coin/N`、
`sitemap.xml` 与已收录 URL 的返回内容一律不动，部署前后逐页比对过 SEO 指纹。

脚本做的事：探测/安装 Node → 同步代码到 `/www/wwwroot/coin-ledger`（保留 `data/` 与 `node_modules/`）→ 生成 `/etc/coin-ledger.env`（600）→ **建库建账号**（`coin_ledger`）→ `npm install`（mysql2）→ **首次把 `data/db.json` 导入 MySQL** → 装 systemd 单元并启动 → 写 Nginx 站点配置并 reload → 配置日志轮转（保留 14 天）→ 添加每日 03:20 备份的 cron → 自检 `/api/health`。

几个关键点：

- **root 口令只用来建库建账号，不会写进任何文件**。应用账号的随机口令写进 `/etc/coin-ledger.env`（600），之后升级复用同一份，不会每次重置。
- **首次导入前会先 `systemctl stop`**：否则旧进程还在往 `db.json` 落盘，切完库就丢那几条。导入失败会自动把 `STORAGE` 改回 `json` 并重启，数据不受影响。
- 导入是**只读** `db.json`，原文件一直留着，随时可以回退。
- 备份落在 `data/backups/`：MySQL 走 `mysqldump --single-transaction` 打成 `mysql-YYYYMMDD.sql.gz`，JSON 后端仍是 `db-YYYYMMDD.json`，保留 14 天，备份后校验非空且含 `CREATE TABLE`（或 JSON 可解析），不合格直接报错退出。

自检与排障：

```bash
systemctl status coin-ledger
journalctl -u coin-ledger -f
curl http://127.0.0.1:3100/api/health
```

## 接口

| 方法 | 路径 | 鉴权 | 说明 |
|---|---|---|---|
| GET | `/api/health` | - | 存活、版本、品种与图片数量、用户数 |
| GET | `/api/bootstrap` | - | 清单 + 行情 + 登录态；持仓只返回**当前用户**的 |
| POST | `/api/auth/register` | - | `{name, password}`，注册即登录（HttpOnly Cookie，7 天） |
| POST | `/api/auth/login` | - | `{name, password}` |
| POST | `/api/auth/logout` | - | 清 Cookie |
| POST | `/api/auth/password` | ✔ | `{oldPassword, newPassword}` |
| GET | `/api/auth/me` | - | 当前会话 |
| PUT | `/api/holdings` | ✔ | 整包替换**自己的**持仓，逐条校验品种与数值 |
| POST | `/api/holdings/reset` | ✔ | 恢复初始 12 条持仓 |
| PUT | `/api/prices` | 管理员 | 覆盖某品种参考市价（行情全站共享）`{prices:{"0":17.5}}` |
| GET | `/api/admin/users` | 管理员 | 用户列表（含各自藏品数） |
| DELETE | `/api/admin/users/:id` | 管理员 | 删除用户及其账本；不能删自己和管理员 |

权限：未登录读持仓返回空数组、写接口 `401`；普通用户访问管理端 `403`；登录失败按 IP 累计，10 分钟内超过 8 次锁 `429`。

## 数据模型

`public/data/coins.json`

```jsonc
{
  "series": { "NP": "国家公园", "...": "..." },
  "coins": [{
    "i": 0,                    // 清单序号（0 起），img/ 文件名用 i+1
    "year": 2000, "name": "敦煌藏经洞发现100周年",
    "series": "ZT", "face": 1, // 面额（元）
    "mintage": 1000,           // 发行量（万）
    "material": "钢芯镀镍", "dia": 25,
    "kind": "coin",            // coin | note
    "est": 15                  // 单枚参考市价（可被 store.prices 覆盖）
  }],
  "defaults": [{ "name": "三江源国家公园", "rolls": 1, "cost": 200, "market": 215, "group": "国家公园系列" }]
}
```

运行时数据在 `data/db.json`（**v2 多用户结构**）：

```jsonc
{
  "version": 2,
  "rev": 42,                                  // 每次写入 +1
  "users": [{
    "id": "u1", "name": "virtualman", "role": "admin",   // admin | user
    "salt": "…", "hash": "…",                 // scrypt(口令, 随机盐)
    "createdAt": "…", "lastLogin": "…"
  }],
  "holdings": {                               // 按用户隔离
    "u1": [{ "name": "三江源国家公园", "rolls": 1, "cost": 200, "market": 215, "group": "国家公园系列" }],
    "u2": []
  },
  "prices": { "0": 17.5 }                     // 行情全局共享
}
```

旧版（单用户、`holdings` 是数组）的数据会在启动时自动迁移，原有持仓归属超管。

**新增品种**：改 `public/data/coins.json` 后重启服务；`coins[].i` 必须与数组下标一致。**新增实物图**：把图裁剪成正方形放进 `public/img/NNN.jpg`（`NNN` = `i+1` 三位补零），服务端启动时扫目录自动纳入白名单，前端无需改代码。

## MySQL 存储

`STORAGE=mysql` 时，上面这份「文档」会落成 5 张 InnoDB 表（库名默认 `coin_ledger`，统一 `utf8mb4`）：

| 表 | 主键 | 说明 |
|---|---|---|
| `cl_users` | `id`（`u1`/`u2`…，另有 `name` 唯一键） | 账号，`salt`/`hash` 原样存，口令仍是 scrypt |
| `cl_holdings` | `(uid, ord)` | 一条持仓一行；`ord` 是前端数组下标，保住展示顺序 |
| `cl_prices` | `coin_i` | 行情覆盖，只有被改过的品种才占行 |
| `cl_visits` | `day`（`CHAR(10)`） | 按天的匿名访问计数，不存 IP |
| `cl_meta` | `k` | `version` / `rev` / `created_at` / `updated_at` / `visits_total` |

为什么要知道这些：

- **持仓的主键是 `(uid, ord)` 而不是 `id`**。线上历史数据里出现过两条持仓 `id` 都是 `h13`（前端不同路径生成的 id 撞车），拿业务 id 当主键会把两条合成一条。`ord` 是数组下标，天然唯一。
- **对外 API 一点没变**，前端不用感知存储换了。`store.js` 仍是「读整份文档 → `commit(draft => …)` 改 → 落库」的模型：数据量极小（十几个账号、几十条持仓），整份同步比维护十几条增量 SQL 更不容易错；每次 `commit` 在一个事务里，写失败整体回滚，内存镜像不领先于数据库。
- **`commit` 变成异步**（落库成功才替换内存镜像），所有调用点 `await`；并发请求排在同一条队列上，不会互相覆盖。
- **只有真变了的表才写**：`/api/visit` 只改 `cl_visits` + `cl_meta`，不会顺带重写几十行持仓。
- 时间统一按 **UTC** 存取（连接参数 `timezone: 'Z'`），和文档里的 ISO 字符串严格对齐，迁移脚本会逐字段比对时间戳。

手工迁移 / 体检：

```bash
cd /www/wwwroot/coin-ledger
set -a && . /etc/coin-ledger.env && set +a

node tools/migrate-to-mysql.js            # 预演：连库建表、报告两侧差异
node tools/migrate-to-mysql.js --write    # 写入；库非空需再加 --force
```

写入后会**把 MySQL 里的数据读回来逐字段比对**（账号、持仓的数量/成本/市价/分组、行情、访问数、rev），不一致就以非 0 退出并列差异。

回退到 JSON：

```bash
STORAGE=json bash deploy/install.sh        # 改回单文档后端并重启
# 库里这段时间的新数据不会自动回写 JSON，需要的话先导出：
mysqldump coin_ledger > /tmp/dump.sql
```

## 前端的三级数据回退

1. `GET /api/bootstrap` 成功 → 正常在线，登录可写；
2. 后端不可用 → 读同源 `data/coins.json`，页面照常展示，编辑只写 localStorage；
3. 连静态数据都没有 → 用 localStorage 上一次的缓存。

顶栏右上角的状态点会如实反映当前处于哪一级，不会假装已同步。

## 安全说明

- 用户口令以 `scrypt(口令, 16 字节随机盐, 64 字节)` 存储，只落 `data/db.json`；校验用 `timingSafeEqual`。超管初始口令由 `SUPERADMIN_PASSWORD` 或默认值生成，**建议首次登录后立即修改**。
- 用户名限制 2–20 位（中文/字母/数字/下划线），口令至少 8 位且不能是纯数字；注册开放，单实例上限 500 个账号。
- 会话是 HMAC-SHA256 签名的无状态 Cookie（`HttpOnly` + `SameSite=Lax`）；HTTPS 下自动附加 `Secure`（由 Nginx 的 `X-Forwarded-Proto` 判定），HTTP 下不加，避免 IP 直连方式登不上。
- 站点已强制 HTTPS（`/.well-known/` 例外，保证 ACME 续期不被跳转打断），口令不会以明文过网。
- 静态服务做了目录穿越防护；`/api` 一律 `no-store`。
- 每个用户的持仓按 `userId` 隔离，任何接口都不会返回他人账本；删号会同时清掉其持仓并使其会话立即失效。
- 服务器上 **3306 端口当前对公网开放**，建议在宝塔「安全」中关闭或限定来源 IP。

## 已知取舍

- 单用户、单进程、无并发写冲突处理：两人同时编辑时后写覆盖先写。若要多端并发，需引入 `rev` 乐观锁（接口已返回 `rev`，前端尚未强制校验）。
- 行情 `est` 是 2026-11 的静态估算，没有接实时行情源。
- 数据覆盖 1984—2026：1984—1999 段（40 个品种）按本地宝《普通纪念币大全目录》整理并逐条核对；1999 年以前的发行公告央行官网未归档，这些品种暂无「发行信息」摘录。
- 裸 IP（`http://47.119.132.60/`）现在落到宝塔默认站点返回 404；域名是唯一入口，避免 HTTP 侧存在登录入口。
- 宝塔站点目录下会有一个 `chattr +i` 的 `.user.ini`（面板的防跨站标记，纯静态站无实际作用），属正常现象。

---

## 微信小程序（miniprogram/）

与网站共用同一套后端数据库：**品种目录内置在包体里**（静态参考数据，离线秒开、不耗流量），**账号 / 持仓 / 行情走服务器**（`https://coin.virtualman.top`），网页和小程序同一个账号、同一份账本。

```
miniprogram/
├─ app.json / app.js / app.wxss / project.config.json（appid wx905c4968911fa23d）
├─ data/catalog.js          ← 由 tools/build_mp_data.js 从 public/data/*.json 生成，勿手改
├─ utils/api.js             ← wx.request 封装；小程序无 Cookie，用 Authorization: Bearer <token>
├─ utils/catalog.js         ← 目录查询与金额格式化（一套 = 20 件，纪念钞 20 张）
├─ utils/store.js           ← 状态：hydrate（本机缓存秒开）→ refresh（/api/state 拉权威数据）→ persist（PUT /api/holdings）
└─ pages/{index,list,mine,detail,account}/
```

页面：首页（统计 + 最新发行 + 系列入口）、全套清单（搜索 / 系列筛选 / 年份排序）、品种详情（发行信息 + 三档价格 + 加入或移出藏品）、我的藏品（分组 + 套数增减 + 移出）、账户（登录 / 注册 / 退出）。

### 上传发布（不需要开开发者工具）

小程序用 `miniprogram-ci` 传，不依赖 IDE、不用扫码：

```bash
npm run mp:upload -- -v 1.2.0 -d "这次改了什么"
```

前置只有一步：把小程序后台的上传私钥放好一次。

> mp.weixin.qq.com → 管理 → 开发管理 → 开发设置 → 小程序代码上传 → 生成/下载密钥
> 下载后重命名为 `private.wx905c4968911fa23d.key`，放进 `.secrets/`（该目录已在 `.gitignore` 里）

上传成功后版本号记录在 `tools/_data/mp-version.txt`，下次不带 `-v` 就沿用它。

> **为什么不用开发者工具的 CLI**：`cli.bat upload` 依赖 IDE 的登录态，登录过期会直接报 `需要重新登录 (code 10)`；而且 IDE 启动时会调 `reg.exe` 读注册表，在一些受限环境里会被安全策略拦掉。`miniprogram-ci` 只认私钥，更适合脚本化。

### 后端为此新增的两处

| 改动 | 说明 |
|---|---|
| `GET /api/state` | 轻量状态接口，只回 `rev / user / isAdmin / holdings / prices / userCount`，供小程序使用（`/api/bootstrap` 带 135 条介绍，对小程序太重） |
| `Authorization: Bearer <token>` | `server/auth.js` 的 `requestToken()` 先看 Bearer，再回落 Cookie；`/api/auth/login` 与 `/api/auth/register` 的响应体同时返回 `token`，浏览器仍走 `Set-Cookie`，行为不变 |

### 构建与自检

```bash
node tools/build_mp_data.js   # 改了 coins/descriptions/images 后重新生成内置目录
node tools/mp_smoke.js        # 数据层冒烟：目录、匿名态、Bearer 登录、藏品增删改、清理测试账号
node tools/mp_render.js       # 页面渲染模拟：真实执行每个页面的 onLoad/onShow 与关键交互
```

### 发布前必须做的一步（我改不了，需要小程序管理员）

在 **微信公众平台 → 开发管理 → 开发设置 → 服务器域名**，把 `https://coin.virtualman.top` 同时加进 **request 合法域名** 和 **downloadFile 合法域名**（前者用于登录与藏品同步，后者用于加载币面图）。没配置时，目录浏览仍可用，但登录、同步和图片都会失败。

正式版还需要小程序完成 **备案**（2023 年起微信要求）；体验版可先行测试。

### 视觉回归：没有开发者工具也能看见页面

`node tools/mp_preview.js` 会把 WXML + WXSS 按真实页面数据渲成 HTML（rpx 按 375 宽折算、`page`→`body`），再用无头 Chrome 按 iPhone 尺寸截图。用途是**在改样式前后对比**，不替代真机。

```bash
node tools/mp_preview.js
# 产物在 .preview/，截图示例：
# chrome --headless=new --screenshot=.preview/home.png --window-size=375,1150 \
#        --force-device-scale-factor=2 file:///$PWD/.preview/home.html
```

写这个工具时踩到三个坑，都留在代码注释里了：WXML 属性值里的 `>`（如 `wx:if="{{a > 0}}"`）不能当作标签结束；`<image></image>` 的闭合标签不能弹栈；把 `page` 选择器替换成 `body` 时不能顺手把 `.page` 类名也改掉。

### 2026-11-08 样式与体验修复（v1.0.1）

| 问题 | 原因 | 修复 |
|---|---|---|
| **整站没有样式**（卡片、色板、缩略图、按钮全裸奔） | 重建工程时 `app.wxss` 被删且未补回 | 重写全局样式：色板、卡片、按钮、空态、缩略图、点击反馈类 |
| tabBar 只有文字，观感廉价 | 未配图标 | 用品牌方孔圆钱元素生成 3 组共 6 张 81×81 PNG（灰/金两态） |
| 账户页头像里用户名溢出圆形被裁 | 直接把昵称塞进 132rpx 圆 | 只取首字（`avatarText`），字号 52rpx |
| 我的藏品每行信息挤成一坨 | 名称、年份、成本、市值、步进器、移出全挤一行 | 两段式：名称 + 步进器在上，成本/市值在下；名称与 meta 单行省略；步进器 56×54rpx 点击区 |
| 详情页主图太小、标题与卡片不对齐 | 主图区 440rpx 且带 padding，标题左右内边距与卡片内容线不一致 | 主图区放大到 620rpx 径向渐变底；标题左内边距 28rpx，与卡片内容同一条基线 |
| 详情页正文末尾出现 `法律声明 \| 联系我们 … <script>` | 早期抓央行页面时把页脚一起抓了 | `tools/clean_desc.js` 清洗 10 条描述并复查无残留标签 |
| 首页点系列跳转后筛选不生效 | `switchTab` 回调里 `getCurrentPages()` 取到的不是目标页 | 改为一次性标记 `cl_pending_series`，清单页 `onShow` 消费 |
| 点哪都没反馈 | 未配 `hover-class` | 行、卡片、筛选项、步进器、系列块统一加 `tap-hover` / `row-hover` |
| 同系列标签一行只放得下一个长名 | 直接用全称 | 接入网站同款简称规则（`马钞` / `净角` / `泰山`） |
| 清单页不能下拉刷新 | 未开启 | 开启并接 `store.refresh()` |

自检：`tools/mp_render.js` 35 项、`tools/mp_smoke.js` 20 项全通过；另加一道静态检查（页面文件齐全、事件处理器存在、标签闭合、WXML 用到的 class 在 WXSS 中有定义）。

---

## 数据重整（v3，2026-11-08）

`node tools/fix_taxonomy.js`（预演，加 `--write` 落盘）把发行数据收拾了一遍，两类问题都是真错，会直接影响价格与进度。

### 一、系列分类

| 原 | 现 | 为什么 |
|---|---|---|
| 奥运·体育（14） | **奥运**（10）+ **体育赛事**（4） | 2008/2022 奥运币与六运会、亚运会、女足、世乒赛混在一起，题材完全不同 |
| 周年·事件（22） | **周年庆典**（18）+ **盛会·博览**（4） | 千禧年、世博会、联合国成立 50 周年、世界妇女大会属于「盛会」，不是周年 |
| 专题（6） | **社会公益·文化**（6） | 命名更贴近内容（和平年、植树、希望工程、环保、敦煌） |

系列从 16 类变为 **18 类**；纪念钞（CN）保持独立品类，不按题材拆散。合计仍是 135 个品种。

### 二、一套的口径（这次钱算错了）

原先把「一套 = 20 件」套用到所有品种。可是建国三十五周年发行时就是一套 3 枚，按 20 枚算会把整套市价放大近 7 倍。

现在由套系自己声明：

| 套系 | 一套 | 发行价 | 市价 |
|---|---|---|---|
| 建国三十五周年 | 3 枚 | ¥3 | ¥420 |
| 第六届全运会 | 3 枚 | ¥0.3 | ¥519.9 |
| 第十一届亚运会 / 女足 / 港澳回归 | 2 枚 | 按面额 | — |
| 第24届冬奥会纪念钞 | 2 张（对钞） | ¥20 | ¥21 |
| 生肖、世遗、国家公园等 | 20 枚 | 单枚面额 × 20 | — |

`sets[id]` 新增 `size`（一套件数）与 `kind`（`roll` 整卷 / `box` 发行套），`total` 改为目录条目数。网页端新增 `setSizeOf()/setPriceOf()` 两个helper统一口径，小程序 `catalog.js` 同步。

顺带修掉一个老 bug：8 个套系的 `total` 原本写的是套内枚数、成员却只有 1 条，导致「已收 1 / 3」永远收不齐；现在显示 `0 / 1 品种`。

### 三、小程序体验优化（v1.1.0）

- **全站收齐进度**：首页账本卡加进度条与「已收 / 总数 · 百分比」。
- **系列进度**：首页 6 个系列入口按完成度排序，并显示「2 / 5」。
- **只看已收**：清单页加了筛选开关，配合系列与关键词使用；搜索支持简称（「马钞」「净角」）。
- **分组进度**：我的藏品每个分组标题显示「已收 / 整套」并带细分进度条。
- **所属套系**：详情页显示「本套已收 2 / 5」，价格行写清「一套（3 枚）」。
- 修复模板 bug：`{{progress.label}` 少一个花括号，导致首页该处只渲染出一个 `%`；已加「模板括号配对」全量检查。

自检：`tools/mp_render.js` 49 项、`tools/mp_smoke.js` 20 项全通过；线上清单 135 行、建国 35 周年显示「整套发行 ¥3 / 整套市价 ¥420」。

### 微信渲染与浏览器的差异（真机踩坑）

`calc(50% - 8rpx)` 配 `margin-right: 16rpx`，在浏览器里两列正好 100% 能并排；**微信会因四舍五入换行，整块退化成单列**。改成父级 `justify-content: space-between`、子项只留 `calc(50% - 8rpx)`（总宽 100%−16rpx，留出余量）才稳。

同类要求：两列/三列布局不要让「宽度 + 外边距」精确等于 100%，永远留一点余量；`<image>` 一定要写死宽高或走 `.thumb` 这类定尺寸类，否则会拿到 320×240 默认尺寸。

预览工具现在支持指定屏宽，可用来查小屏溢出：

```bash
MP_WIDTH=320 node tools/mp_preview.js     # 生成 *-320.html
```

### 持仓数据修正：纪念钞「张 → 套」

早期纪念钞按「1 套 = 1 张」记账，马钞那条存成了 `rolls=20`。口径改为「1 套 = 20 张」后，同一条数据被读成 20 套 = 400 张，面值虚高 20 倍（¥8,000 vs 实际 ¥400），把「面值 ¥10,500 / 投入 ¥2,900」拉得不合理。

`node tools/fix_note_rolls.js`（预演 / `--write` 写回）只处理纪念钞：`rolls` 能被 20 整除、且折算后的面值与成本相差不到 50% 时才折算，其余只报告不动。修正后：面值 ¥2,900 = 投入 ¥2,900、市值 ¥3,360、浮动 +¥460，13 个品种 16 套。

配套：网页持仓行单位由「张」改为「套」（「单张成本」→「单套成本」），小程序步进器显示「1 套 / 2 套」，避免再把套数当张数填。

### 统一口径（网页与小程序共用同一套公式）

| 概念 | 定义 | 存哪里 |
|---|---|---|
| 单件面额 | 一枚/一张的面额，**所有品种统一按单件存** | `coins[].face` |
| 一套件数 | 整卷 20 枚、整刀 20 张；多枚套币按发行套（建国 35 年 3 枚、冬奥对钞 2 张） | `sets[].size` / `sets[].kind` |
| 一套面额 | 单件面额 × 一套件数 | 计算值 |
| 面值 | 件数 × 单件面额 | 计算值 |
| 持仓数量 | 以「套」为单位，同时显示件数（`20 套 · 40 张`） | `holdings[].rolls` |

两边实现的函数一一对应：网页 `unitPrice / setSizeOf / setPriceOf / itemFace`，小程序 `catalog.unitOf / catalog.setSizeOf / store.setPriceOf / store.stats`。

这次修掉的历史不一致：**冬奥对钞的 `face` 存的是「一对 20 元」**，而其它品种存单件面额，导致页面出现「面额 20 元 + 一套 2 张」这种自相矛盾的表述，也让人误算成 40 元/套。现改为 `face: 10`（单张），同时删除「对钞除以 2」的特例——特例存在本身就是口径不统一的信号。

### 转发分享（小程序）

| 位置 | 行为 |
|---|---|
| `app.js onLaunch` | `wx.showShareMenu({ withShareTicket: true, menus: ['shareAppMessage','shareTimeline'] })`，让右上角菜单出现「转发给朋友 / 分享到朋友圈」 |
| `pages/index` | 转发标题「藏币录 · 1984—2026 中国纪念币图鉴」，落地首页；深色卡片右下角有「分享」按钮 |
| `pages/list` | 带上当前系列筛选，好友打开就是同一批品种（`/pages/list/list?code=XX`，清单页 `onLoad` 消费） |
| `pages/detail` | 标题带「品种名｜年份 · 面额」，封面用该品种实物图；主按钮下方有「分享给朋友」 |
| `pages/mine` | 「我的纪念币账本」，落地我的藏品 |
| `pages/account` | **不提供分享**（避免把登录页转出去） |

文案与落地页集中在 `utils/share.js`（`appMessage / timeline / coinMessage / coinTimeline`），封面是 5:4 的 `images/share-cover.png`。

注意：详情页分享封面用的是远程币面图，需要 **downloadFile 合法域名** 已配置；没配置时会退化成页面截图，不影响转发本身。

### 按钮文字不居中（微信默认样式）

微信 `button` 自带 `line-height: 2.55555556` 和左右 `14px` 内边距，行高撑出来的居中一旦遇到固定 `height` 就会偏。统一改成：

```css
button {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  line-height: 1;
}
button::after { border: none; }   /* 微信用 ::after 画那条 1px 边框 */
```

各具体按钮只声明 `height` 与字号，不再写 `line-height`。预览工具里也照微信默认值模拟了 `button`，以后这类偏移能提前看出来。

### 微信一键登录

| 接口 | 作用 |
|---|---|
| `POST /api/auth/wx/login {code}` | `wx.login` 的 code 换 openid；已绑定则直接登录，未绑定则自动建号（昵称「藏友XXXX」，空账本） |
| `POST /api/auth/wx/bind {code}` | 已登录状态下把当前账号与微信绑定；同一微信不能绑两个账号 |
| `POST /api/auth/wx/unbind` | 解绑 |

- `openid` 存在 `users[].wxOpenid`，`session_key` **不落库**。
- AppSecret 只从环境变量 `WX_APPSECRET` 读取，不写进任何文件、不进仓库、不经过对话。未配置时接口返回 **503** 并给出可读提示，小程序会弹窗说明。
- 微信建的账号没有密码，账户页会出现「设置密码」卡片；`/api/auth/password` 对无密码账号跳过原密码校验，设置后即可在网页版登录。

配置方式（服务器上执行，把密钥换成自己的）：

```bash
grep -q WX_APPSECRET /etc/coin-ledger.env || echo 'WX_APPSECRET=你的AppSecret' >> /etc/coin-ledger.env
chmod 600 /etc/coin-ledger.env
systemctl restart coin-ledger
```

AppSecret 在 **微信公众平台 → 开发管理 → 开发设置 → 开发者ID**（管理员扫码后可查看/重置）。

### 密码框显示明文（WXML 布尔属性坑）

`<input password>` 这种裸写法在 WXML 里等价于 `password=""`，是 **false**，所以密码会明文显示。布尔属性必须写值：`password="{{true}}"`。静态检查里已加断言，防止回退。

### 搜索框进页面自动弹输入法

清单页原本直接渲染 `<input>`，部分机型会自动聚焦页面里第一个输入框，一进页面就弹键盘。现在改成**点击后才挂 input**：未激活时显示一个「假搜索框」（纯 view），点一下才换成真 input 并聚焦；失焦且无关键词时自动收回假框。任何机型都没有可以被自动聚焦的对象。

### 图片展示

- **网页**：币面图改为自适应比例（`max-height: 300px` + `object-fit: contain`），竖版纪念钞不再被压成小方块；鼠标悬停轻微放大并浮出「点击看大图」；点击打开全屏灯箱（Esc / 点遮罩关闭）。
- **小程序**：详情页主图可点，走 `wx.previewImage` 原生预览，支持双指缩放与长按保存。
- 顺带修掉网页一个真 bug：`#/coin/N` 直链打开是**空白**——首屏路由只认页签，不认 `coin`，分享出去的详情链接会落到首页。现在 `start()` 会先解析 hash，命中 `coin` 直接渲染详情。

### 联系方式

微信 `virtualman2001` 已放在：网页页脚（可点击复制）、`legal.html` 的联系方式一节、小程序账户页「关于藏币录」卡片与首页页脚（点击复制）。

## 多图（正面 / 背面 / 整套）

图库独立成 **`public/data/gallery.json`**，与 `coins.json` 解耦：

```json
{ "coins": { "2": [
  { "f": "002.jpg",   "k": "main"    },
  { "f": "002-b.jpg", "k": "reverse" },
  { "f": "002-f.jpg", "k": "obverse" }
] } }
```

`k` 取值 `main / obverse / reverse / set`；文件统一放 `public/img/`。没有条目的品种自动退回单图。

- **网页**：主图下方一排缩略图，点选切换；悬停主图放大并提示「点击看大图」，点击进全屏灯箱。
- **小程序**：主图下方同样有缩略图（带标签与选中态），点主图走 `wx.previewImage`，可左右滑、双指缩放、长按保存。
- 后端 `GET /api/bootstrap` 多返回一个 `gallery`，小程序打包时由 `tools/build_mp_data.js` 写进 `catalog.js` 的 `imgs`。

### 补图与替换

```bash
python312 tools/fetch_gallery.py --kind reverse --workers 5   # 补背面（宽图自动记为整套）
python312 tools/fetch_gallery.py --kind obverse --workers 5   # 补正面

node tools/set_gallery_image.js --id 2 --list                 # 看某品种现有图
node tools/set_gallery_image.js --id 2 --kind reverse --file D:/图/西藏背面.png
node tools/set_gallery_image.js --id 2 --remove reverse       # 去掉某一张
```

补图走无头 Chrome 渲染百度图片搜索页、取 `img0.baidu.com` 代理图；校验尺寸（≥240px）、
用均值哈希与已有图去重、压到 720px。**标注按搜索词自动定**（搜「背面」记背面、搜「正面」记正面），
个别品种可能互换；介意的话用上面的 `set_gallery_image.js` 单张替换即可。

当前覆盖：399 张 / 133 个品种（正面 112、背面 112、整套 42），平均 3 张/品种。
图片均为公开网络图源，详情页底部已标注，仅供对照。

## 管理后台（参数 / 图片）

`#/admin` 只有超级管理员能进，现在分为三个子页：

| 子页 | 能做什么 |
|---|---|
| 用户 | 看注册用户、藏品数量、删除普通用户（原功能） |
| 参数 | 就地改每个品种的 **年份 / 面额 / 市价 / 发行量 / 系列 / 套系**，改动行高亮，右上角「保存修改（N）」批量提交 |
| 图片 | 按编号载入某品种，查看它的全部图；每张可删除；可上传并替换主图 / 正面 / 背面 / 整套 |

接口（均需管理员）：

```
GET    /api/admin/coins            品种 + 系列 + 套系 + 图库
PATCH  /api/admin/coin             { id, patch:{year,face,est,mintage,series,set,kind,pieces} }
POST   /api/admin/gallery          { id, images:[{f,k}] }        整份覆盖
POST   /api/admin/image            { id, kind, data:"data:image/jpeg;base64,..." }
DELETE /api/admin/image?id=&kind=  删掉某一张（同时删文件）
```

要点：

- **名称不可改**。持仓是按名称关联的，改名会把用户账本打断；要改名得连 holdings 一起迁，暂不支持。
- 改动直接写 `public/data/coins.json` 与 `public/data/gallery.json`，重启后依然生效（已验证：改成 143 → 重启 → 接口仍返回 143 → 已还原 140）。
- 图片上传在**浏览器里**先用 canvas 压到 900px 内、转 JPEG(0.86)，再 base64 提交；服务端不依赖任何图形库，超过 4MB 直接拒。
- 上传后文件名固定为 `<编号><后缀>.jpg`（后缀：空=主图、-f=正面、-b=背面、-s=整套），所以同一类型替换会覆盖旧图。

安全边界：所有写操作都过 `requireAdmin`；`kind`、`series`、`set` 都做白名单校验；`readBody` 对上传单独放宽到 6MB、其它接口仍是 16KB。

## 图片改用本地宝目录（正反面并排原图）

`https://nc.bendibao.com/gouwu/202419/84518.shtm` 是「普通纪念币大全目录」，每条是
`序号、品种名` + 简介 + 一张 `bigpicsrc` 原图（正面国徽 + 背面图案并排，PNG 无水印）。
比按关键词搜图靠谱得多——搜图会把别的品种、别的钞搜进来。

**该站有滑块验证：桌面 UA 会被拦，移动 UA 能直出。** 抓取脚本已内置移动 UA：

```bash
python312 tools/fetch_bendibao.py --reset           # 重置为「主图 + 正反面」，再灌 111 张
python312 tools/fetch_bendibao.py --dry             # 只做匹配，不下载
python312 tools/fetch_bendibao.py --reset --dry     # 看匹配结果
```

匹配规则（都在脚本里）：

- 名称归一化后相等 / 互相包含；
- 用括号里的限定词消歧（`（净角）`→`中国京剧艺术·净角`）；
- 命名差异给别名表：`上海世界博览会`→`中国2010年上海世博会`、`抗日战争胜利70周年`→`抗战胜利70周年`；
- **故意不做「按序号对位」兜底**。之前加了这个兜底，页面序号在结尾处错位，把「净角」的图配给了「三江源国家公园」——错得毫无痕迹。现在匹配不上就报出来，宁缺毋错；
- 奥运那几组（一组 3 枚）直接跳过，不能配给单枚。

当前覆盖：**244 张 / 135 个品种**（133 主图 + 111 正反面），109 个品种有两张图。

> 旧的搜索图（`*-b.jpg` / `*-f.jpg` 共 224 张）已从图库引用中移除，文件仍留在 `public/img/` 里没删（清单见 `_scrape/bdb/orphans.txt`），确认不需要可自行清理。

### 管理后台 v2（体验重做）

第一版太糙：图片要手输编号、参数 135 行一坨、改完不知道存没存。第二版：

**参数页**
- 每行带 **缩略图**，认品种不用靠编号；名称超长截断、hover 出全名
- 支持 **筛选**：全部 / 缺主图 / 缺正反面 —— 直接定位需要人工补的品种
- **分页**（50 行/页），不再一次渲染 135 行
- **行内保存**：每行「存」按钮，或输入框里按 Enter 只存这一行；「↺」撤销本行
- 批量保存仍然保留，按钮上显示待存行数

**图片页**
- 左侧 **品种列表**（缩略图 + 名称 + 图数，可搜索），点一下切换，不用再背编号
- 右侧「← 上一个 / 下一个 →」按列表顺序翻
- 图片卡片可点开原图（新窗口）；删除有二次确认
- 上传用文件选择框（原生 `input[type=file]` 藏在按钮里），选完才可点「上传替换」

**顶部统计**：`共 135 个品种 · 133 有主图 · 2 缺主图 · 24 缺正反面` —— 一眼看出还差多少图。

**详情页入口**：管理员在品种详情页左上角会多一个「管理这个品种」，直接跳到图片页并选中它。

改完仍是写 `coins.json` / `gallery.json`，重启后保持。

### 小程序端：折叠与文案精简（v1.3.1）

**我的藏品按系列折叠**

- 分组标题左侧有 `▾ / ▸`，点标题收起/展开该组
- 顶部一行 `6 个分组` + `全部收起 / 全部展开`
- 折叠状态写 `cl_mine_collapsed`（本地），下次进来保持
- 收起时仍能看到该组的「已收 / 整套」进度与合计金额，信息不丢

实现用 `setData({ 'groups[0].open': false })` 路径写法；测试环境（`tools/mp_render.js`、`mp_preview.js`）原先只支持平铺赋值，已补上路径解析，否则测试和真机行为不一致。

**说明性文案精简**（小程序里不再放大段解释）

| 位置 | 原来 | 现在 |
|---|---|---|
| 首页 hero | 「账号与网页版 coin.virtualman.top 互通」 | 删除，只保留「分享给朋友」 |
| 首页未登录卡 | 「与网页版同一个账号，面值、投入、盈亏自动算好」+「135 个品种 · 127 条官方介绍」 | 「与网页版同一账号」 |
| 首页页脚 | 「127 个品种附官方介绍 · 数据来自中国人民银行公告…」 | 删除，只留微信号 |
| 账户页关于 | 一长段（收录范围 + 18 个系列 + 计价口径） | 「135 个品种 · 18 个系列」 |
| 账户页提示 | 「与网页版同一账号，登录后藏品两边同步」 | 「与网页版同一账号」 |
| 详情页底部 | 「图片来自公开网络图源，仅供对照；可在 gallery.json 中替换单张」 | 删除 |
| 我的藏品空态 | 「去「全套清单」挑几枚，点「加入我的藏品」，就会出现在这里」 | 「去清单里挑几枚加进来」 |

### 首页重做（v1.3.2）

原先两块深色大卡叠在一起、没有一张真实图片，看起来闷且空。重排后：

1. **品牌区**：深色渐变 + 右上角出血摆放一枚**用户真实藏品图**（未登录/无藏品时退回「方孔圆钱」线稿装饰）。品牌名放大到 54rpx，「分享给朋友」收进左侧、不再抢眼。
2. **账本卡**：白色，用负 margin 浮在品牌区下沿，形成层次；「14 / 135」用大字，进度条加粗，四个金额一栏一格。
3. **快捷入口**：去掉 emoji（跨端渲染不一致、显廉价），改为金色竖条 + 两行文字。
4. **最新发行**：由竖排列表改为**横滑卡片**（282rpx 宽，图 212rpx，年份角标），一眼能看到更多且有点击欲。
5. **按系列**：每格加细进度条，完成度可见。

数据侧同步：`latest` 从 4 条扩到 8 条供横滑，`seriesTop` 增加 `pct` 字段。

### 我的藏品重排（v1.3.4）

原来四宫格把「面值 / 投入 / 市值 / 浮动」平铺成同样大小，主次不分；每行三行小字也没地方放盈亏。

- **总览卡**：市值做成 56rpx 大字，右上角独立小卡显示盈亏金额与百分比（涨红跌绿），投入与面值降为一行副信息；底部加「已收 14 / 135」进度条。
- **持仓行**：两段式。上段「缩略图 + 名称 + 件数/面值」和右侧「市值 + 盈亏」；下段独立一条工具行放步进器与「移出」，不再挤压名称宽度。
- 顺手修了个优先级 bug：`a >= 0 ? '+' : '-' + '¥' + money` 实际会解析成 `a >= 0 ? '+' : ('-' + '¥' + money)`，正数时只显示一个「+」。已改成先算 `pnl` 再拼。

### 我的页补全导航 + 关于页（v1.3.7）

问题：tabBar 只有「首页 / 全套清单 / 我的藏品」，账户页在登录后**没有任何入口**（之前靠首页快捷入口，被删掉了）。

- 我的页底部加菜单：`账户与安全`（显示用户名）、`关于藏币录`（显示版本号）。
- 总览卡的用户名右侧加 `›`，点一下直接进账户页——列表很长时不必滚到底。
- 新增 `pages/about/about`：品牌、版本号、收录品种/系列数、时间跨度、计价口径、微信与网页版（点击复制）、数据来源说明。
- 版本号收敛到 `app.globalData.version`，页面不再各自硬编码；测试与预览工具补了 `getApp()` 注入，否则断言里会显示 fallback 的 1.0.0。

### 「我的」拆成入口页 + 二级列表页（v1.4.0）

问题：藏品一多，列表把底部菜单（账户 / 关于）顶到很远，摸不到。

- `pages/mine/mine` 变成**入口页**：总览卡（市值/盈亏/已收进度）+ 三项菜单（我的藏品 N 个品种 / 账户与安全 / 关于藏币录），一屏放得下。
- 新增 `pages/holdings/holdings` **二级页**：汇总行（品种数 · 套数 · 市值）+ 分组折叠列表 + 步进器/移出，逻辑从原 mine 迁过来。
- tabBar 第三项改名「我的」；首页的账本卡也可以点进二级页。

### 缩略图统一裁切（v1.4.0）

卡片图片看起来大小不一，根因不是框架尺寸，而是**源图里币占画布的比例不同**（有的自带 30% 白边）。

`tools/make_thumbs.py` 用四角颜色当背景、算内容外接框，裁掉白边后补成正方形、缩到 480px，
输出 `public/img/th/<编号>.jpg`。首页卡片与持仓行改用 `thumbUrl`，详情页仍用原图。

```bash
python312 tools/make_thumbs.py            # 全量 135 张
python312 tools/make_thumbs.py --only 120 # 单张重做
```

## 纠错反馈（v1.5.0）

**小程序**：详情页底部「数据有误？点这里反馈」→ `pages/feedback/feedback`，可写文字（≥4 字）与最多 3 张截图（微信压缩后读成 base64 上传）。未登录会先引导登录。

**网页管理端**：`#/admin` 第四个标签「反馈」

- 默认只看「待处理」，可切「已处理 / 全部」；标签上红点提示有待处理
- 每条显示：状态、#编号+品种名、提交人与时间、正文、截图缩略（点开原图）
- 操作：看这个品种（跳到详情）、标记已处理 / 恢复待处理、删除（截图一并删）

**接口**

```
POST   /api/feedback                  { coinId, text, images:[dataURL] }   需登录
GET    /api/admin/feedback?status=   open|done|all                       需管理员
PATCH  /api/admin/feedback/:id       { status: 'open'|'done' }
DELETE /api/admin/feedback/:id       连图片一起删
```

**存储**：`data/feedback.json` + `public/feedback/<随机名>.jpg`。
没有塞进 store 的 doc —— MySQL 后端是固定表（users/holdings/prices/visits），加表要动迁移脚本；反馈是低频独立数据，单独文件更省事，也能直接备份/查看。

校验：正文 ≥4 字、≤800 字；每张图 ≤3MB、最多 3 张；未登录 401、非管理员 403。

### 冬奥纪念钞拆成两个品种（v1.6.0）

原来记成一条「第24届冬奥会纪念钞（对钞 2 张）」，与「纪念币」记成冰上 / 雪上两枚不一致。

按央行 2021-11-30 公告核实：

- 每张面额 **20 元**（不是 10 元），票幅 145×70mm
- 冰上运动项目 = **塑料钞**，雪上运动项目 = **纸钞**
- 发行 2 亿套，每套 2 张

改动：

- 原条目改为「第24届冬奥会纪念钞·冰上运动」，新增「…·雪上运动」（追加在数组末尾，避免既有编号整体位移导致图片文件对不上）
- 两枚都记 `face: 20`、`pieces: 1`；套系 `cny24` 改为 total 2
- **删掉 `limit: 20`** —— web 端 `setSizeOf` 优先取预约限额，会把「一套」算成 20 张、发行价 ¥400；实际一套 2 张 / ¥40
- 图片：冰上沿用原正面图 + 补一张干净的正反面；雪上从官方四联图切出正面前景

教训：抓来的图必须先看内容再入库 —— `115-s.jpg` 原本是「京剧艺术纪念币」，是 bendibao 按块切分时错位了一张。

## 代码体检与修复（v1.7.0）

按「数据 → 服务端 → 两端页面」过了一遍，逐条修：

### 性能

- **160px 小图**：`tools/make_thumbs.py` 现在同时产出 `img/th/`（480px，详情主图）与 `img/th/s/`（160px）。
  实测 160px 只有 **4–7KB**（原图 39–84KB），列表/持仓/首页卡片/详情缩略条全部改用它。
- **静态资源本来就有 gzip**（bootstrap 215KB → 39KB，app.js 136KB → 42KB），
  所以原计划把 `desc` 拆出 bootstrap 的改动**没做** —— 属于误判，先更正结论。

### 正确性

- **管理端批量保存**：原来逐行 PATCH，超过 30 行会被写接口限流打断、只存一半。
  新增 `PATCH /api/admin/coins`（一次事务写多条，返回 `saved`/`failed`），前端改为一次提交并如实提示「已保存 X 条，Y 条失败」。
  同时把管理端写请求单独分到 `adminWrite` 桶（300/min），不再挤占普通写额度。
- **一套的口径**：`setSizeOf` 原来优先取「央行预约限额」，导致 2016 贺岁猴显示「一套 10 枚」、冬奥钞显示「一套 20 张 ¥400」。
  现在**只按实物成套**（整卷 20 枚 / 套系声明件数），限额字段改名 `reserveLimit` 仅作说明用。
- **写死的数字**：`18 个系列`、`全部 18 个`、meta 里的 `135 个品种` 全部改成取数据（`seriesCount` / 去掉具体数字）。

### 微信一键登录

- 真机上最常见的失败是 **code 过期（40029）/ 被重复使用（40163）** —— 用户停在这一页久了或连点两次。
  现在遇到这两种错误会**自动重新 `wx.login` 换新 code 重试一次**，仍失败则弹「重试 / 取消」。
- 「绑定微信」同样处理。
- 服务端失败时打印 `errcode` 与 appid（不打印密钥），便于排查。

### 显示

- 详情页规格里「铸造单位」「边齿」这类长字段改为**独占一行**，不再挤压相邻列。
- 清单/持仓/管理端的缩略图统一用裁过白边的小图，视觉大小一致。

### 未做

- `public/app.js`（136KB 单文件）拆分未执行：另一个会话正在并发修改它，此时大范围移动代码冲突概率高。
  建议单独安排一轮，拆成 `core / views / admin / format` 四个文件。

## 上架审核合规改造（v1.8.1）

### 代码侧

| 项 | 改动 |
|---|---|
| UGC 内容安全 | 新增 `server/wxsec.js`：文本走 `msg_sec_check`（v2，带 openid），图片走 `img_sec_check`（multipart）。反馈落库前先检测，`risky`/`review` 直接 400 拒收；接口异常只记日志放行，不阻断业务 |
| 内容安全降级 | v2 需要真实 openid；密码注册的老账号没有 openid 会报 40003，自动退回 v1 |
| 账号级限流 | 同一账号每天最多 10 条反馈 |
| 隐私政策 | 新增 `pages/privacy`，含收集范围、用途、存储、第三方（内容安全接口）、用户权利、注销方式 |
| 隐私授权 | 新增 `utils/privacy.js`（`getPrivacySetting` + `requirePrivacyAuthorize`），在选图、复制微信号前调用 |
| 价格表述 | 「市值」→「参考市值」、「市价」→「参考价」、「浮动盈亏」→ 保留但加「不构成投资建议」；首页/我的页底部各加一行免责 |
| 站外引导 | 关于页移除可复制的网址、「网页版」改为隐私政策入口；账户页去掉复制外链 |
| 图片来源 | 关于页补「币面图来自公开资料，仅作辨识参考，如有侵权请联系删除」 |
| 分享文案 | 去掉写死的「135 个」与「市价/盈亏」表述 |

### 需要在微信后台做的（不是代码）

1. **类目**：工具 → 信息查询（不要选金融）
2. **用户隐私保护指引**：勾选「用户信息（openid）」「相册（选择图片）」「剪贴板」
3. **审核备注**：给测试账号密码，并注明「个人收藏记录工具，不涉及交易与投资建议」
4. **服务器 IP 白名单**：`开发设置 - IP 白名单` 需包含 `47.119.132.60`，否则取 `access_token` 会失败（内容安全随之降级）

### 微信登录拿不到 openid 的根因（v3.0.33 后端）

现象：微信一键登录后进不去原账号，每次都是新账号；绑定微信也不生效。

根因：**MySQL 的 `cl_users` 表里根本没有 `wx_openid` 列**。
`server/index.js` 里登录/绑定都会把 `wxOpenid` 写进内存文档，但 `store-mysql.js` 的
`SELECT` / `INSERT` 语句里没有这个字段 —— 落库那一刻就丢了。于是：

1. 微信登录按 openid 找用户 → 永远找不到
2. 走「新建用户」分支 → 每次登录多一个账号
3. 绑定微信同样丢字段 → 绑了等于没绑

修复：

- `cl_users` 增加 `wx_openid` / `wx_unionid`（带索引）
- `init()` 用 `information_schema` 检查列是否存在，缺了就 `ALTER TABLE`（MySQL 8 的 `ADD COLUMN` 不支持 `IF NOT EXISTS`）
- `SELECT` / `INSERT ... ON DUPLICATE KEY UPDATE` 全链路带上这两列

已存在的账号需要**重新绑定一次微信**才会写入 openid；历史遗留的重复账号可在管理端删除。

## 品牌标识（v1.8.4）

新 LOGO：红底（#B23A2C）印章 + 米色（#F6E7C6）圆环与方孔，圆角 120/1024。

`public/logo.svg` 是按原图量出来的**矢量重绘**（外框 922、圆角 120、圆环 r=290.5 描边 58、内方孔 222 圆角 30），
`viewBox="51 51 922 922"` 只框印章本体 —— 否则四周留白会让它在同样尺寸下看起来偏小。

| 位置 | 文件 |
|---|---|
| 网页 favicon / 顶栏 / hero / 载入页 | `public/logo.svg` |
| PWA 图标 | `public/icons/icon-192.png`、`icon-512.png` |
| iOS 主屏 | `public/icons/apple-touch-icon.png` |
| 微信分享卡片 | `public/icons/og-cover.png`（1200×630） |
| 小程序关于页 | `miniprogram/images/logo-seal.png` |
| 小程序转发封面 | `miniprogram/images/share-cover.png`（500×400） |

原始 PNG 存于 `_assets/logo-seal-1024.png`，改版时从这里重新导出各尺寸。

## 发行预约提醒（v1.9.0）

小程序「发行计划」页可为待发行项目订阅提醒：预约当天 09:00 通过微信订阅消息推送一条。

### 实现

| 层 | 文件 | 说明 |
|---|---|---|
| 定时与发送 | `server/reminders.js` | 每 60s 扫描；到点调 `subscribeMessage.send`；模板字段按 `thing2/time25/thing14/thing11` |
| 接口 | `server/index.js` | `GET/POST/DELETE /api/reminders` |
| 前端 | `pages/plan` | 「提醒我」按钮 → `wx.requestSubscribeMessage` → accept 后落库 |

### 规则

- **提醒时间**：`reserve` 预约期的首日 09:00（+08:00）；没有预约期就用发行日
- **一次性订阅**：一次授权只能发一条，所以「一个项目 = 点一次」。重复点同一项目只刷新时间，不叠加
- **必须有 openid**：密码注册的老账号要先绑定微信（`cl_users.wx_openid`，v3.0.33 修复）
- **失败处理**：43101（未授权）标记 invalid 不再重试；其它错误最多重试 5 次；超过提醒时间 6 小时置 expired，不在半夜补发
- 存储：`data/reminders.json`（写前留 `.bak`，与 feedback 一致）

### 模板字段

```
thing2  提醒内容   → 项目短名（≤20 字，超长截断加…）
time25  时间       → 2026年11月17日 09:00
thing14 平台       → 手机银行 APP
thing11 备注       → 项目备注，最多 20 字
```

## 发行计划数据核实（v1.9.1）

原数据只有 2026 一年 4 项，且部分日期取错。按央行公告 / 新华社 / 承办银行公告交叉核对后重写 `public/data/plan.json`。

### 修正

| 问题 | 原值 | 现值 |
|---|---|---|
| 缺 2025 年 | 只有 2026 | 补 2025 全年（4 项计划 + 抗战 80 周年增发） |
| 缺计划外增发 | — | 新增「抗战胜利 80 周年」「江泽民诞辰 100 周年」并标注增发 |
| 武夷山日期 | 2026-06-09 | 2026-04-03（发行日），6/09 是兑换首日 |
| 贺岁币钞缺预约期 | 无 | 蛇 2024-12-23~24、马 2026-01-13~14 |
| 无兑换期 | 无 | 每项补 `exchange` |
| 无每人限额 | 无 | 每项补 `limit`（均为 20） |

### 每条都带来源

每个项目新增 `sourceUrl`，年度保留 `sourceUrl` / `sourceText`（央行年度计划公告原文）。

### 字段口径

- `date`：官方**发行起始日**（公告「定于 X 日起发行」）
- `reserve`：预约期　`exchange`：兑换期　`limit`：每人预约兑换限额
- `extra: true`：计划外增发，页面显示「增发」标记，年份统计拆成「计划 N 项 · 增发 M 项」

## 行情更新机制（v1.9.3）

### 为什么不是自动抓取

实测闲鱼（2026-11-09）：

```
GET https://www.goofish.com/search?q=蛇钞
→ 200，11KB，React 空壳，数据全走 XHR

GET https://h5api.m.goofish.com/h5/mtop.taobao.idlemtopsearch.pc.search/1.0/
→ {"ret":["RGV587_ERROR::SM::哎哟喂,被挤爆啦"], "data":{"url":"passport.goofish.com/mini_login.htm"}}
```

三层拦截：登录态 + `sign` 签名（由 `_m_h5_tk` 算 md5）+ 滑块风控。服务器 IP 抓取会被限流封禁。

### 替代方案：快照 + 批量导入

| 层 | 文件 | 说明 |
|---|---|---|
| 快照存储 | `server/quotes.js` | `data/quotes.json`，每品种保留最近 60 条 `{p, at, src}` |
| 导入接口 | `POST /api/admin/quotes/import` | 文本「名称 价格」逐行匹配品种，写价格覆盖 + 快照 |
| 下发 | `/api/bootstrap`、`/api/state` | 带 `quotes` 映射：`{price, prev, pct, at, src}` |
| 展示 | 详情页（网页+小程序） | 「参考价 11/9 更新（闲鱼）— ▲7.7%」 |

### 导入写法

```
蛇钞 28                 ← 名称匹配（含括号别名）
2025年贺岁（蛇） 11.5    ← 全名
#132 11                 ← 用编号强制指定
// 这是注释
```

- 价格按**单枚 / 单张**填；整刀整卷先除以张数
- 一次最多 500 行；同批次重复编号以最后一条为准
- 返回 `saved` 与 `unmatched`（附原因），管理端会列出来

## 小程序管理端（v2.0.0）

超管登录后，「我的」页底部出现「管理端」入口，进入 `pages/admin`，四个页签与网页管理端一致：

| 页签 | 能力 | 对应接口 |
|---|---|---|
| 用户 | 列表（角色/藏品数/注册日）、查看某账号藏品、删除账号 | `GET /api/admin/users`、`GET /api/admin/users/:id/holdings`、`DELETE /api/admin/users/:id` |
| 参数 | 搜索品种、底部弹层编辑面额/发行量/参考价/材质/直径，单条保存 | `GET /api/admin/coins`、`PATCH /api/admin/coin` |
| 图片 | 网格浏览、点开大图、长按替换（主图/正面/背面/整套） | `POST /api/admin/image`（base64） |
| 反馈 | 按状态筛选、查看详情与截图、标记已处理/改回、删除 | `GET/PATCH/DELETE /api/admin/feedback` |

- 入口按 `state.isAdmin` 判定，非管理员看不到；直接进页面也会被拦下并返回
- 鉴权复用同一套 token（`Authorization: Bearer`），与网页共用数据
- `utils/api.js` 补了 `patch()` / `del()`
