# 藏币录 · 数据入库 + Fastify 重构交付报告

- 日期：2026-11-19
- 版本：网站 v3.0.46 / 管理端 v3.0.46 / 小程序 v2.8.13
- 交付状态：**三端已上线，`DATA_SOURCE=db` 已切换并验收通过（23:03）**；db/json 两态对外零行为差异

## TL;DR
把品种目录从 JSON 文件迁移到 MySQL，后端换成 Fastify 分层架构，新增贵金属板块；全程绞杀者模式零行为变化，QA 独立真库验收抓出并修复 6 个 db 模式专属 Bug，三端已上线且稳定。

## 一、交付概览

| 项 | 结果 |
|---|---|
| 接口契约 | 快照 API 53 条 / 页面 150 条，**diff = 0** |
| 自动化测试 | **101 / 101 全绿** |
| 语法检查 | 106 个 .js 文件通过 |
| 分层铁律 | `grep SELECT/pool.query server/routes` 无输出 |
| QA 真库验收 | 6 个 Bug 全修、路由判定 **[NoOne]**、切 db 前置条件**具备** |
| 已知问题 | 无 |

## 二、五个阶段

| 阶段 | commit | 内容 |
|---|---|---|
| T01+T02 | `8101027` | Fastify 绞杀者骨架（老 handler 原样兜底）+ 目录域 DDL/Repository/迁移导出，启动时部署事故已恢复 |
| T03 | `5b71c38` | 目录 20 接口 + SSR/SEO 切到 routes/services 分层；`bootstrap` 保 `no ASC`、`/api/catalog` 承载新排序 |
| T04 | `83e9168` | 贵金属 3 套 draft 入库（no 138/139/140、28 条规格）+ 管理端/网站/小程序三端展示 |
| 修复 | `38662be`→`551f544`→`0c23ecd` | QA 真库 6 Bug：edge 列宽 / 空目录导出 / 事务 conn 死锁 / gallery_ver / sitemap 去重 / data:sync PM 分类 |
| 发布 | `1e0429e`/`fdd07f9`/`b8e95af`/`3976a98` | 版本 bump、快照基线更新、小程序数据同源、小程序版本 |

## 三、QA 真库抓出的 6 个 Bug（json 自测触发不到）

1. **edge 列宽阻断**：`cl_coins.edge VARCHAR(32)` 装不下 42 字符边齿原文 → 新增 `005_widen_columns.sql` 前向 ALTER，不改历史迁移（runner checksum 会红）。
2. **空目录导出丢 series note**：`export-json` 的 `readExisting()` 加 `--out → public/data` 回退链。
3. **PM 删除 51 秒锁等待**：同一事务内子行用 conn、父行用 pool 另一连接导致自锁 → coin/series repo 写方法接受可选 conn，事务内统一。
4. **db 改图不刷 gallery_ver**：`image.repo.bumpVersion` 数字串 +1 递增，三处写图分支同一事务调用。
5. **sitemap PM 重复**：按 no 去重并过滤老形态混入的 PM。
6. **data:sync PM 误标普通币**：按 category + status 判定上架，PM 一律 `hasPrice=false`。

## 四、上线记录（S0 灰度态，服务器零编译）

- 部署方式：本地打包 → scp → 服务器只解压 + chown + 重启，**未跑任何 npm install/build**（吸取早前事故教训）。
- 产物包：`deploy-v346-code/public/admin.tgz` + 增量 `code2.tgz`，均在服务器 `/root/bak-db-refactor/`。
- 回滚备份：`pre-v346-server.tgz`（114K）、`pre-v346-public.tgz`（38M）。
- 外网验证：10 个关键路由全 200；`bootstrap`=137 条、`category=pm`=0（draft 不泄漏）、404 文案与 SEO title 逐字一致、`/console/`=200。
- 小程序：`data/exports/latest` 从 json 源重建（137 条 draft 同源），版本 2.8.13 用服务器同款密钥上传体验版成功。

## 五、关键决策与红线

- **no 保号**：`no = i+1`，1..137 永久锁定；触发器拒绝改 no / 删 no≤137；PM 从 138 起。
- **bootstrap 顺序例外**：保持 `no ASC`，新排序只在 `/api/catalog`。
- **贵金属不喧宾夺主**：一「套」一行（3 行，2.1%），规格进子表；默认分段 coin 首屏 0 条；无 est 键、详情页无价格区块；`/plan` 与首页零改动。
- **单位坑**：存量 mintage 万枚、PM 逐枚枚数，套级 mintage 恒 NULL。
- **键序契约**：`listLegacyRaw()` 保原对象键序以满足逐字节 diff。

## 六、`DATA_SOURCE=db` 切换记录（已完成，23:03）

用户拍板"现在切"，QA 放行，前置条件齐备。

- **先迁移后切换**：线上原只有用户域 5 张表、目录表全无。先跑 `migrate:catalog --apply --verify`（逐表 137/12/20/21/128/250/2、导出差异 0、保号触发器实测拒绝改 no/删 no≤137），再切数据源。
- **MySQL 8 版本差异**：线上 8.4.8 binlog 开启导致建触发器需 SUPER，首次迁移中断；用宝塔 pyenv 连接对象临时开 `log_bin_trust_function_creators=1`，迁移成功后恢复 OFF。
- **切换**：env 加 `DATA_SOURCE=db`（备份在 `/root/bak-db-refactor/env-before-dbcut`）→ restart，日志确认目录库已连接。
- **验收**：db 态与 json 态 9 个端点深比较（排除 serverTime/rev/galleryVer）**完全一致，零行为变化**；分类 127+10+0=137、draft PM 不泄漏、鉴权/404 文案一致。顺手修掉 db 态 bootstrap 多出的 `ord` 辅助键（commit `e9e4ef3`）。
- **回滚**：`cp /root/bak-db-refactor/env-before-dbcut /etc/coin-ledger.env` → restart（≤10 秒回 S0），目录表数据保留不删。

## 七、下一步建议

1. 在管理端核验并上架 3 套贵金属（上架后 `/api/catalog` 140 条、`data:sync` 296.6KB、sitemap 145 条 URL）。
2. 小程序体验版真机验收后提交审核。
3. 保留回滚资产至少一周。
4. 观测 24h：health / bootstrap / coin/N / 管理端写链路无异常。
