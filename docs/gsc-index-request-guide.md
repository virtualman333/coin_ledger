# Google Search Console 请求索引操作清单

生成日期：2026-11-27
站点：`https://coin.virtualman.top`
用途：配合本轮 SEO 收尾（sitemap lastmod 刷新到 2026-11-27、移除 Crawl-delay、首页补栏目静态内链），在 GSC 侧推动「已发现未抓取」「已抓取未索引」的页面尽快入库。

---

## 一、先用 sitemap 让 Google 重新发现（一次操作，覆盖全部 143 条）

比逐条请求更高效，先做这步。

1. 打开 Google Search Console，切换到 `coin.virtualman.top` 资源。
2. 左侧菜单 → **站点地图（Sitemaps）**。
3. 在「添加新的站点地图」输入框填 `sitemap.xml`，点 **提交**。
4. 提交后状态会显示「成功」，并列出发现的 URL 数（应为 143）。即使之前提交过，重新提交一次会触发 Google 重新读取 lastmod。
5. 可点开该 sitemap 行查看「已发现的网址」，确认数量为 143。

> sitemap 已在服务端刷新，全部 URL 的 `lastmod` 均为 `2026-11-27`，Google 会据此判断内容有更新、提高重抓优先级。

---

## 二、导出待处理的 URL（用于定位问题 + 重点请求）

GSC 的请求索引配额有限（每天约 10 条左右，不保证），所以优先处理高价值页面。先导出两份列表：

### 2.1 「已抓取 - 尚未索引」
1. 左侧菜单 → **网页（Pages）**（旧版位于「索引 > 网页」）。
2. 在「为什么网页未被编入索引？」列表里，找到 **已抓取 - 尚未索引（Crawled - currently not indexed）**，点开。
3. 右上角 **导出**，下载 CSV。里面是 Google 已经抓取但暂未收录的 URL —— 这是最值得手动请求索引的一批（内容已被看到，只差收录决策）。

### 2.2 「已发现 - 尚未抓取」
1. 同一页面，点开 **已发现 - 尚未抓取（Discovered - currently not indexed）**。
2. 同样 **导出** CSV。这批是 GSC 知道但还没来抓的 URL，通常是内链权重不足或抓取预算问题。

> 本轮已经做的两件事正好对症：首页补了 `/all` `/series` `/plan` 的静态内链（提升发现权重）、移除了 `Crawl-delay: 3`（解除人为抓取限速）。这批 URL 会在 Google 下一轮抓取中优先被处理。

---

## 三、批量请求索引（重点页面优先）

### 操作入口
GSC 顶部搜索框（「检查任何网址」）→ 粘贴 URL → 回车 → 若未索引，点 **请求编入索引（Request Indexing）**。

### 优先级顺序（配额有限，按此顺序用）

**第 1 批：栏目入口页（权重最高，务必先做）**
```
https://coin.virtualman.top/
https://coin.virtualman.top/all
https://coin.virtualman.top/series
https://coin.virtualman.top/plan
https://coin.virtualman.top/sitemap
```

**第 2 批：GSC 导出的「已抓取 - 尚未索引」里排名靠前的品种页**
把 2.1 导出的 CSV 打开，按访问量/重要性挑前 5-10 条逐个请求。品种页 URL 形如：
```
https://coin.virtualman.top/coin/1
https://coin.virtualman.top/coin/2
...
https://coin.virtualman.top/coin/137
```

**第 3 批：「已发现 - 尚未抓取」里的高价值页**
用 2.2 导出的 CSV，挑近期发行、有实物图的品种页（`/coin/120` 之后的新品种优先）。

> 每天上限不固定，通常是「一天几条到十几条」。不必强求一次做完，分批、每天几条持续请求即可。

---

## 四、全部 143 条 URL 清单（供批量复制 / 对照）

按 URL 分组。前 6 条为首页与栏目页，其余 137 条为品种页。可在 GSC 检查工具中逐条粘贴。

### 首页与栏目页（6 条）
```
https://coin.virtualman.top/
https://coin.virtualman.top/all
https://coin.virtualman.top/series
https://coin.virtualman.top/plan
https://coin.virtualman.top/sitemap
https://coin.virtualman.top/legal.html
```

### 品种页（137 条）
URL 模式：`https://coin.virtualman.top/coin/N`，其中 N = 1 到 137 连续。
```
https://coin.virtualman.top/coin/1
https://coin.virtualman.top/coin/2
https://coin.virtualman.top/coin/3
...（中间连续，逐条递增）...
https://coin.virtualman.top/coin/137
```
> 完整逐条清单可直接从线上 sitemap 获取：`curl -s https://coin.virtualman.top/sitemap.xml | tr '>' '\n' | grep -F 'https://coin.virtualman.top' | grep -v '.jpg'`，输出即为全部 143 条 URL（已排除图片 sitemap 里的实拍图地址）。

---

## 五、预期与后续

- **时间线**：提交 sitemap + 请求索引后，Google 重新抓取通常需要几天到两三周；收录与否由 Google 决定，请求索引只是加快发现，不保证收录。
- **内容侧已就绪**：所有品种页都有 SSR 静态正文（面额/发行量/材质/公告原文 + Product/BreadcrumbList 结构化数据），不再是 JS 空壳；`/all` `/series` `/plan` 有专属正文和互链。这是「已抓取但没索引」页面最需要的内容信号。
- **观察指标**：1-2 周后在「网页」报告里看「已编入索引」数量是否上升、「已抓取 - 尚未索引」是否下降。
- **如果仍不索引**：多为站点整体权重/外链不足，属于长期建设（外链、社媒曝光、内容更新频率），不是技术故障；robots、canonical、noindex 本轮已确认无硬伤。
