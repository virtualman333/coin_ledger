# 管理端页面实现规范

所有页面共用的约定。实现新页面前先读本文件 + `src/api/endpoints.js` +
`src/composables/useTable.js` + `src/components/*.vue`。

## 硬性约束

- Vue 3 `<script setup>`；Element Plus 已全局注册，`el-*` 组件与图标直接用
- **每人只改自己负责的那一个 `src/pages/*.vue` 文件**；共享层（`api/`、`components/`、`router/`、`styles/`）不许改，
  缺能力请反馈给主程，不要自己往共享层塞东西
- 禁止 `window.confirm / prompt / alert` → 用 `ConfirmDialog`
- 禁止裸 `fetch` → 用 `src/api/endpoints.js` 里的 `*Api`
- 不要运行 `npm install` / `npm run build`（主程统一构建，避免并发写 dist）
- 图片 / 文件链接一律以 `/` 开头（应用挂在 `/console/`，相对路径会 404）
- 中文文案，专业克制；不引入新依赖（包括 dayjs，时间自己简单格式化）

## 通用结构

```vue
<template>
  <section>
    <PageHeader title="页面标题" desc="一句话说明">
      <template #actions>
        <el-button :loading="busy" @click="reload">刷新</el-button>
      </template>
    </PageHeader>

    <AsyncState :loading="loading" :error="error" @retry="reload">
      <div class="cl-toolbar">
        <el-input v-model="kw" placeholder="搜索…" clearable style="width:240px" @input="search(kw)" />
        <div class="cl-spacer" />
        <span class="cl-mono">共 {{ total }} 条</span>
      </div>

      <div class="cl-card">
        <el-table :data="rows" v-loading="loading" stripe>
          <el-table-column prop="..." label="..." min-width="..." show-overflow-tooltip />
          <el-table-column label="操作" width="..." fixed="right">
            <template #default="{ row }"> ... </template>
          </el-table-column>
        </el-table>
        <el-pagination
          layout="total, sizes, prev, pager, next, jumper"
          :current-page="params.page" :page-size="params.size" :total="total"
          @current-change="onPageChange" @size-change="onSizeChange"
        />
      </div>
    </AsyncState>

    <ConfirmDialog v-model="confirmOpen" title="…" :danger="true"
      :message="…" :effects="[…]" :confirm-text="…" :loading="busy"
      @confirm="doDanger" />
  </section>
</template>

<script setup>
import { ref } from 'vue';
import { ElMessage } from 'element-plus';
import PageHeader from '../components/PageHeader.vue';
import AsyncState from '../components/AsyncState.vue';
import ConfirmDialog from '../components/ConfirmDialog.vue';
import { useTable } from '../composables/useTable';
import { xxxApi } from '../api/endpoints';
import { errorMessage } from '../api/client';
</script>
```

## 组件契约

| 组件 | props | 事件 / 插槽 |
|---|---|---|
| `PageHeader` | `title`, `desc` | `#actions` |
| `AsyncState` | `loading:Boolean`, `error:String` | `@retry`，默认插槽放表格 |
| `ConfirmDialog` | `v-model`, `title`, `message`, `danger`, `dangerText`, `effects:String[]`, `confirmText`, `confirmLabel`, `loading` | `@confirm`（需 `confirmText` 时输入一致才可点） |
| `CoinImageEditor` | `v-model`, `coin:{id,name}`, `images:[{f,k}]` | `@changed`（上传 / 删除成功后父级刷新数据） |

图片压缩与路径工具统一放在 `src/utils/image.js`（`compressImage` / `imageFull` / `imagePreview` / `IMAGE_KINDS`），参数页与图片页共用同一份实现。

`useTable(loader, options)` 返回：
`rows, allRows, total, loading, error, params, load, reload, refresh, search, setParam, onPageChange, onSizeChange, applyLocal`

- `loader(params, signal)` 返回 `{ items, total }` 或数组
- `options.clientSide: true` 时 loader 返回全量数组，由 useTable 本地过滤/排序/切片；
  配 `searchKeys: ['field1']` 与 `localFilter(row, filterValue)`
- `search(kw)` 自带 300ms 防抖；`setParam(key, value)` 用于筛选条件

## 交互底线（商业化）

1. 所有写操作：按钮 `:loading` 锁 → `try/catch/finally` 解锁 → `ElMessage.success/error` → 成功后 `reload()` 或 `refresh()`
2. 危险操作必须 `ConfirmDialog`：`danger=true`，`effects` 列清影响范围，`confirmText` 要求输入名称
3. 列表必须有搜索、分页、空态、错误重试；表格 `show-overflow-tooltip`
4. 禁止整页刷新；局部刷新即可
5. 时间用 `String(iso).replace('T',' ').slice(0,16)` 之类简单处理，不引依赖

## 页面清单

| 页面 | 主要 API | 备注 |
|---|---|---|
| Users | `usersApi` | 标杆页，主程实现；服务端分页/批量/详情抽屉/角色与禁用/一步删除 |
| Plan | `planApi` | 发行计划年度与项目维护；整份编辑后一次 PUT 保存（`/api/admin/plan`），后端校验 key 唯一并写 `public/data/plan.json` |
| Feedback | `feedbackApi` | `list(status)` → `{items, open}`，本地分页 |
| Series | `seriesApi` | `list()` → `{items}`，行内编辑 + 新建/换图/删除；「成员」抽屉用 `coins()` 全量品种勾选，`members(key, ids)` 整份保存成员（一次请求完成增减） |
| Audit | `auditApi` | `list(params)` → `{items,total}`，服务端分页 |
| Guard | `guardApi` | `bans()` → `{bans, stats}`，解封 |
| Params | `coinsApi` + `imagesApi`（经 `CoinImageEditor`） | `all()` → `{coins, series, sets, gallery}`，批量编辑保存；行内「图片」按钮 / 缩略图直接配置四类图片 |
| Images | `imagesApi` | 复用 `all()`，左列表 + 右图集 + 上传/删除 |
| Visitors | `visitorsApi` | `list(params)`、`detail(params)`，来源/视图切换 + 明细抽屉 |
