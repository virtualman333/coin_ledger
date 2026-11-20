<template>
  <section>
    <PageHeader title="操作审计" desc="管理端关键操作留痕，按时间倒序，仅供查阅">
      <template #actions>
        <el-button :loading="loading" @click="reload">刷新</el-button>
      </template>
    </PageHeader>

    <!-- 顶部统计卡：总记录数 -->
    <div class="cl-stat-grid" style="max-width: 220px;">
      <div class="cl-stat">
        <b>{{ total }}</b>
        <span>操作记录总数</span>
      </div>
    </div>

    <AsyncState :loading="loading" :error="error" @retry="reload">
      <div class="cl-toolbar">
        <el-input
          v-model="kw"
          placeholder="搜索操作人 / 动作 / 目标 / IP"
          clearable
          style="width: 280px"
          @input="search(kw)"
          @clear="search('')"
        />
        <div class="cl-spacer" />
        <span class="cl-mono">共 {{ total }} 条</span>
      </div>

      <div class="cl-card">
        <el-table :data="rows" v-loading="loading" stripe style="width: 100%">
          <el-table-column label="时间" width="170">
            <template #default="{ row }">
              <span class="cl-mono">{{ fmtTime(row.at) }}</span>
            </template>
          </el-table-column>

          <el-table-column label="操作人" min-width="120" show-overflow-tooltip>
            <template #default="{ row }">{{ dash(row.actor) }}</template>
          </el-table-column>

          <el-table-column label="动作" min-width="160">
            <template #default="{ row }">
              <el-tag :type="actionType(row.action)" size="small">
                {{ dash(row.action) }}
              </el-tag>
            </template>
          </el-table-column>

          <el-table-column label="目标" min-width="140" show-overflow-tooltip>
            <template #default="{ row }">{{ dash(row.target) }}</template>
          </el-table-column>

          <el-table-column label="详情" min-width="220" show-overflow-tooltip>
            <template #default="{ row }">{{ dash(row.detail) }}</template>
          </el-table-column>

          <el-table-column label="IP" width="150">
            <template #default="{ row }">
              <span class="cl-mono">{{ dash(row.ip) }}</span>
            </template>
          </el-table-column>

          <template #empty>
            <el-empty description="还没有操作记录" />
          </template>
        </el-table>

        <el-pagination
          layout="total, sizes, prev, pager, next, jumper"
          :current-page="params.page"
          :page-size="params.size"
          :page-sizes="[20, 50, 100]"
          :total="total"
          @current-change="onPageChange"
          @size-change="onSizeChange"
        />
      </div>
    </AsyncState>
  </section>
</template>

<script setup>
import { ref } from 'vue';
import PageHeader from '../components/PageHeader.vue';
import AsyncState from '../components/AsyncState.vue';
import { useTable } from '../composables/useTable';
import { auditApi } from '../api/endpoints';

const kw = ref('');

// 服务端分页：loader 拿到 useTable 的 { page, size, q, sort }，直接透传给 auditApi.list。
// 空串参数会被 client.js 的 buildUrl 过滤，最终即 q=&page=&size=。
const loader = (params, signal) => auditApi.list(params, signal);
const {
  rows, total, loading, error, params,
  reload, search, onPageChange, onSizeChange
} = useTable(loader, { pageSize: 20 });

// 后端存 UTC ISO，直接截串会差 8 小时；按浏览器本地时区显示
function fmtTime(v) {
  if (!v) return '—';
  const d = new Date(v);
  if (isNaN(d.getTime())) return String(v).replace('T', ' ').slice(0, 16);
  const p = (n) => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate())
    + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
}

function dash(v) {
  return (v === undefined || v === null || v === '') ? '—' : v;
}

// 按动作类型着色：含 delete 红色、含 role/disable 橙色、其余默认
function actionType(action) {
  const a = String(action || '').toLowerCase();
  if (a.includes('delete')) return 'danger';
  if (a.includes('role') || a.includes('disable')) return 'warning';
  return undefined;
}
</script>
