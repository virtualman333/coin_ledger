# 藏币录 · 管理控制台

独立的 Vue 3 + Vite 应用，挂载在 `https://coin.virtualman.top/console/`。
与前台收藏账本彻底解耦；登录态沿用同源 Cookie（`cl_session`），不另造账号体系。

## 三条硬约束

1. **只在本地 / CI 构建**：`npm run build` 产出 `admin/dist/`，服务器只接收静态产物，
   绝不在服务器上执行 `npm install` / `npm run build`。
2. **不影响 SEO**：本应用挂全新路径 `/console/`，页面带 `noindex,nofollow,noarchive`，
   nginx 下发 `X-Robots-Tag`，`robots.txt` 新增 `Disallow: /console/`。
   前台的 `<head>`（title / description / canonical / JSON-LD）、真实路径路由
   `/coin/N`、sitemap.xml 与任何已收录 URL 的返回内容一律不动。
3. **不改动已收录内容**：后台不生成对外可索引页面，不写入 sitemap。

## 目录

```
admin/
  index.html            # 应用外壳（含 noindex）
  vite.config.js        # base=/console/，构建产物 outDir=dist
  src/
    main.js             # Vue + Element Plus（暗色）+ 图标
    App.vue / router/   # 路由与侧栏菜单定义
    api/                # 统一请求客户端 + 全量接口契约
    composables/        # useTable：分页/搜索/排序/loading/error/取消
    components/         # PageHeader / AsyncState / ConfirmDialog
    layouts/            # AdminLayout：侧栏、顶栏、登录态门禁
    pages/              # 8 个管理页面
    styles/theme.css    # 与前台一致的暗色 + 金色设计令牌
```

## 开发

```bash
cd admin
npm install
npm run dev        # http://127.0.0.1:5174/console/ ，/api 代理到 127.0.0.1:3100
```

## 构建与部署

```bash
cd admin
npm run build      # 产物 admin/dist/
# 将 dist/ 内容上传到服务器 /www/wwwroot/coin-ledger/console/
# nginx: location ^~ /console/ { alias .../console/; try_files $uri $uri/ /console/index.html; }
```

`dist/` 与 `node_modules/` 不进仓库（见 `admin/.gitignore`）；部署脚本只上传构建产物。
