<template>
  <section>
    <PageHeader title="用户管理" desc="账号、角色、状态与藏品概览。所有敏感操作均需二次确认并留痕。">
      <template #actions>
        <el-button :loading="loading" @click="reload">
          <el-icon><Refresh /></el-icon> 刷新
        </el-button>
      </template>
    </PageHeader>

    <!-- 概览 -->
    <div class="cl-stat-grid">
      <div class="cl-stat"><b>{{ stats.total ?? total }}</b><span>注册用户</span></div>
      <div class="cl-stat"><b>{{ stats.admins ?? 0 }}</b><span>管理员</span></div>
      <div class="cl-stat"><b>{{ stats.tests ?? 0 }}</b><span>测试账号</span></div>
      <div class="cl-stat"><b>{{ stats.disabled ?? 0 }}</b><span>已禁用</span></div>
    </div>

    <AsyncState :loading="loading && !rows.length" :error="error" @retry="reload">
      <div class="cl-toolbar">
        <el-input
          v-model="kw" placeholder="搜索用户名 / 昵称 / ID" clearable
          style="width: 240px" @input="search(kw)"
        >
          <template #prefix><el-icon><Search /></el-icon></template>
        </el-input>
        <el-select v-model="roleFilter" style="width: 130px" @change="setParam('role', roleFilter)">
          <el-option label="全部角色" value="all" />
          <el-option label="管理员" value="admin" />
          <el-option label="普通用户" value="user" />
        </el-select>
        <el-select v-model="statusFilter" style="width: 140px" @change="setParam('status', statusFilter)">
          <el-option label="全部状态" value="all" />
          <el-option label="正常" value="active" />
          <el-option label="已禁用" value="disabled" />
          <el-option label="测试账号" value="test" />
        </el-select>

        <div class="cl-spacer" />

        <el-dropdown
          trigger="click" :disabled="!selected.length || busy"
          @command="onBatchCommand"
        >
          <el-button type="primary" plain :disabled="!selected.length">
            批量操作（{{ selected.length }}）<el-icon><ArrowDown /></el-icon>
          </el-button>
          <template #dropdown>
            <el-dropdown-menu>
              <el-dropdown-item command="markTest">标记为测试账号</el-dropdown-item>
              <el-dropdown-item command="unmarkTest">取消测试标记</el-dropdown-item>
              <el-dropdown-item command="disable" divided>禁用账号</el-dropdown-item>
              <el-dropdown-item command="enable">启用账号</el-dropdown-item>
              <el-dropdown-item command="delete" divided>删除所选</el-dropdown-item>
            </el-dropdown-menu>
          </template>
        </el-dropdown>
      </div>

      <div class="cl-card">
        <el-table
          :data="rows" v-loading="loading" stripe row-key="id"
          @selection-change="onSelectionChange" @sort-change="onSort"
        >
          <el-table-column type="selection" width="46" reserve-selection />
          <el-table-column prop="id" label="ID" width="80" class-name="cl-mono" />
          <el-table-column label="用户" min-width="180">
            <template #default="{ row }">
              <div class="u-cell">
                <el-avatar :size="28" :src="row.avatar || undefined">
                  {{ (row.nickname || row.name || '?').slice(0, 1) }}
                </el-avatar>
                <div class="u-cell-txt">
                  <b>{{ row.name }}</b>
                  <small v-if="row.nickname && row.nickname !== row.name">{{ row.nickname }}</small>
                </div>
                <el-tag v-if="row.wx" size="small" effect="plain">微信</el-tag>
              </div>
            </template>
          </el-table-column>
          <el-table-column label="角色" width="100">
            <template #default="{ row }">
              <el-tag :type="row.role === 'admin' ? 'warning' : 'info'" size="small" effect="dark">
                {{ row.role === 'admin' ? '超管' : '用户' }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column label="状态" width="110">
            <template #default="{ row }">
              <el-tag :type="statusOf(row).type" size="small">{{ statusOf(row).text }}</el-tag>
            </template>
          </el-table-column>
          <el-table-column prop="holdings" label="藏品" width="90" sortable="custom" align="right" />
          <el-table-column prop="createdAt" label="注册时间" width="160" sortable="custom">
            <template #default="{ row }"><span class="cl-mono">{{ fmt(row.createdAt) }}</span></template>
          </el-table-column>
          <el-table-column prop="lastLogin" label="最近登录" width="160" sortable="custom">
            <template #default="{ row }"><span class="cl-mono">{{ fmt(row.lastLogin) }}</span></template>
          </el-table-column>
          <el-table-column label="操作" width="170" fixed="right">
            <template #default="{ row }">
              <el-button size="small" text type="primary" @click="openDetail(row)">详情</el-button>
              <el-dropdown trigger="click" @command="(c) => onRowCommand(c, row)">
                <el-button size="small" text>更多<el-icon><ArrowDown /></el-icon></el-button>
                <template #dropdown>
                  <el-dropdown-menu>
                    <el-dropdown-item :command="row.role === 'admin' ? 'role-user' : 'role-admin'" :disabled="isMe(row)">
                      {{ row.role === 'admin' ? '取消管理员' : '设为管理员' }}
                    </el-dropdown-item>
                    <el-dropdown-item :command="row.disabled ? 'enable' : 'disable'" :disabled="isMe(row)" divided>
                      {{ row.disabled ? '启用账号' : '禁用账号' }}
                    </el-dropdown-item>
                    <el-dropdown-item :command="row.isTest ? 'unmarkTest' : 'markTest'">
                      {{ row.isTest ? '取消测试标记' : '标记为测试账号' }}
                    </el-dropdown-item>
                    <el-dropdown-item command="delete" :disabled="isMe(row)" divided>删除账号</el-dropdown-item>
                  </el-dropdown-menu>
                </template>
              </el-dropdown>
            </template>
          </el-table-column>
        </el-table>

        <el-pagination
          layout="total, sizes, prev, pager, next, jumper"
          :current-page="params.page" :page-size="params.size" :total="total"
          :page-sizes="[10, 20, 50, 100]"
          @current-change="onPageChange" @size-change="onSizeChange"
        />
      </div>
    </AsyncState>

    <!-- 详情抽屉 -->
    <el-drawer v-model="drawerOpen" :title="'用户详情 · ' + (detail.name || '')" size="560px">
      <div v-loading="detailLoading">
        <el-descriptions :column="2" border size="small">
          <el-descriptions-item label="用户 ID">{{ detail.id }}</el-descriptions-item>
          <el-descriptions-item label="用户名">{{ detail.name }}</el-descriptions-item>
          <el-descriptions-item label="昵称">{{ detail.nickname || '—' }}</el-descriptions-item>
          <el-descriptions-item label="角色">{{ detail.role === 'admin' ? '超级管理员' : '普通用户' }}</el-descriptions-item>
          <el-descriptions-item label="状态">{{ statusOf(detail).text }}</el-descriptions-item>
          <el-descriptions-item label="登录方式">
            {{ detail.hasPassword ? '口令' : '—' }}{{ detail.wx ? ' + 微信' : '' }}
          </el-descriptions-item>
          <el-descriptions-item label="注册时间">{{ fmt(detail.createdAt) }}</el-descriptions-item>
          <el-descriptions-item label="最近登录">{{ fmt(detail.lastLogin) }}</el-descriptions-item>
        </el-descriptions>

        <el-divider content-position="left">藏品明细</el-divider>
        <div v-if="holdings.length" class="cl-stat-grid">
          <div class="cl-stat"><b>{{ summary.rolls }}</b><span>套数合计</span></div>
          <div class="cl-stat"><b>¥{{ summary.cost.toFixed(0) }}</b><span>投入成本</span></div>
          <div class="cl-stat"><b>¥{{ summary.market.toFixed(0) }}</b><span>参考市值</span></div>
        </div>
        <el-table v-if="holdings.length" :data="holdings" size="small" max-height="320">
          <el-table-column prop="name" label="品种" min-width="150" show-overflow-tooltip />
          <el-table-column prop="rolls" label="套数" width="80" align="right" />
          <el-table-column label="成本" width="100" align="right">
            <template #default="{ row }">{{ money(row.cost) }}</template>
          </el-table-column>
          <el-table-column label="市值" width="100" align="right">
            <template #default="{ row }">{{ money(row.market) }}</template>
          </el-table-column>
          <el-table-column label="盈亏" width="100" align="right">
            <template #default="{ row }">
              <span :class="Number(row.market) - Number(row.cost) >= 0 ? 'cl-up' : 'cl-down'">
                {{ money(Number(row.market) - Number(row.cost)) }}
              </span>
            </template>
          </el-table-column>
        </el-table>
        <el-empty v-else description="这个用户还没有记录藏品" :image-size="70" />
      </div>
    </el-drawer>

    <!-- 统一危险/批量确认 -->
    <ConfirmDialog
      v-model="confirmOpen" :title="confirmCfg.title" :message="confirmCfg.message"
      :danger="confirmCfg.danger" :danger-text="confirmCfg.dangerText"
      :effects="confirmCfg.effects" :confirm-text="confirmCfg.confirmText"
      :confirm-label="confirmCfg.confirmLabel" :loading="busy"
      @confirm="doConfirm"
    />
  </section>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue';
import { ElMessage } from 'element-plus';
import PageHeader from '../components/PageHeader.vue';
import AsyncState from '../components/AsyncState.vue';
import ConfirmDialog from '../components/ConfirmDialog.vue';
import { useTable } from '../composables/useTable';
import { authApi, usersApi } from '../api/endpoints';
import { errorMessage } from '../api/client';

const kw = ref('');
const roleFilter = ref('all');
const statusFilter = ref('all');
const stats = ref({});
const selected = ref([]);
const busy = ref(false);
const meId = ref('');

const table = useTable(async (params, signal) => {
  const r = await usersApi.list(params, signal);
  stats.value = r.stats || {};
  return { items: r.users || [], total: r.total ?? (r.users || []).length };
}, { pageSize: 20, defaultParams: { role: 'all', status: 'all', sort: '-createdAt' } });

const {
  rows, total, loading, error, params,
  reload, search, setParam, onPageChange, onSizeChange
} = table;

onMounted(async () => {
  try {
    const b = await authApi.bootstrap();
    meId.value = (b.user && b.user.id) || '';
  } catch { /* 门禁已在 Layout 处理 */ }
});

/* ---------- 展示辅助 ---------- */
// 后端存 UTC ISO，直接截串会差 8 小时；按浏览器本地时区显示
function fmt(v) {
  if (!v) return '—';
  const d = new Date(v);
  if (isNaN(d.getTime())) return String(v).replace('T', ' ').slice(0, 16);
  const p = (n) => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate())
    + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
}
function money(v) { return '¥' + (Number(v) || 0).toFixed(0); }
function isMe(row) { return !!meId.value && row.id === meId.value; }
function statusOf(u) {
  if (!u) return { text: '—', type: 'info' };
  if (u.disabled) return { text: '已禁用', type: 'danger' };
  if (u.isTest) return { text: '测试账号', type: 'warning' };
  return { text: '正常', type: 'success' };
}

/* ---------- 选择 / 排序 ---------- */
function onSelectionChange(list) { selected.value = list; }
function onSort({ prop, order }) {
  params.sort = order ? (order === 'ascending' ? prop : '-' + prop) : '';
}

/* ---------- 统一写操作 ---------- */
async function execute(fn, successMsg) {
  busy.value = true;
  try {
    await fn();
    ElMessage.success(successMsg);
    await reload();
    return true;
  } catch (e) {
    ElMessage.error(errorMessage(e));
    return false;
  } finally {
    busy.value = false;
  }
}

const confirmOpen = ref(false);
const confirmCfg = ref({});
let pendingFn = null;

function askConfirm(cfg, fn) {
  confirmCfg.value = { danger: true, confirmLabel: '确认', effects: [], ...cfg };
  pendingFn = fn;
  confirmOpen.value = true;
}

async function doConfirm() {
  if (!pendingFn) return;
  busy.value = true;
  try {
    const ok = await pendingFn();
    if (ok !== false) confirmOpen.value = false;
  } finally {
    busy.value = false;
  }
}

/* ---------- 单行操作 ---------- */
function onRowCommand(cmd, row) {
  const patchRole = (role) => () => execute(
    () => usersApi.patch(row.id, { role }),
    role === 'admin' ? '已设为管理员' : '已取消管理员'
  );
  const patchFlag = (key, value, msg) => () => execute(
    () => usersApi.patch(row.id, { [key]: value }), msg
  );

  if (cmd === 'role-admin') {
    askConfirm({
      title: '调整角色', message: `将「${row.name}」设为管理员？`,
      danger: false,
      effects: ['该用户将获得管理端全部权限', '操作会记入审计日志']
    }, patchRole('admin'));
  } else if (cmd === 'role-user') {
    askConfirm({
      title: '调整角色', message: `取消「${row.name}」的管理员权限？`,
      danger: false, effects: ['该用户将无法再进入管理控制台']
    }, patchRole('user'));
  } else if (cmd === 'disable') {
    askConfirm({
      title: '禁用账号', message: `禁用「${row.name}」？`,
      effects: ['该用户立即无法登录', '已有藏品数据保留']
    }, patchFlag('disabled', true, '已禁用账号'));
  } else if (cmd === 'enable') {
    execute(() => usersApi.patch(row.id, { disabled: false }), '已启用账号');
  } else if (cmd === 'markTest') {
    execute(() => usersApi.patch(row.id, { isTest: true }), '已标记为测试账号');
  } else if (cmd === 'unmarkTest') {
    askConfirm({
      title: '取消测试标记', message: `取消「${row.name}」的测试账号标记？`,
      danger: false, effects: ['该账号将按真实用户对待']
    }, patchFlag('isTest', false, '已取消测试标记'));
  } else if (cmd === 'delete') {
    askDelete([row], row.name);
  }
}

function askDelete(users, singleName) {
  const names = users.map((u) => u.name);
  const one = users.length === 1;
  askConfirm({
    title: one ? '删除用户' : `批量删除 ${users.length} 个用户`,
    message: one ? `即将删除账号「${singleName}」` : '即将删除以下账号：' + names.slice(0, 8).join('、') + (names.length > 8 ? '…' : ''),
    dangerText: '删除后无法恢复',
    effects: [
      one ? '该用户的藏品记录会一并删除' : `共 ${users.length} 个账号及其藏品记录会一并删除`,
      '该操作会记入审计日志'
    ],
    confirmText: one ? singleName : 'DELETE',
    confirmLabel: '永久删除'
  }, async () => {
    if (one) return execute(() => usersApi.remove(users[0].id), '已删除 ' + singleName);
    return execute(() => usersApi.batch({ ids: users.map((u) => u.id), action: 'delete' }), '批量删除完成');
  });
}

/* ---------- 批量 ---------- */
function onBatchCommand(cmd) {
  const list = selected.value.slice();
  if (!list.length) return;
  const ids = list.map((u) => u.id);
  const labels = {
    markTest: '标记为测试账号', unmarkTest: '取消测试标记',
    disable: '禁用账号', enable: '启用账号'
  };
  if (cmd === 'delete') { askDelete(list); return; }
  askConfirm({
    title: '批量操作', message: `对选中的 ${list.length} 个账号执行「${labels[cmd]}」？`,
    danger: cmd === 'disable', effects: ['操作会记入审计日志']
  }, () => execute(() => usersApi.batch({ ids, action: cmd }), '批量操作完成'));
}

/* ---------- 详情抽屉 ---------- */
const drawerOpen = ref(false);
const detailLoading = ref(false);
const detail = ref({});
const holdings = ref([]);
const summary = computed(() => {
  let rolls = 0, cost = 0, market = 0;
  holdings.value.forEach((h) => {
    rolls += Number(h.rolls) || 0;
    cost += Number(h.cost) || 0;
    market += Number(h.market) || 0;
  });
  return { rolls, cost, market };
});

async function openDetail(row) {
  drawerOpen.value = true;
  detailLoading.value = true;
  detail.value = { ...row };
  holdings.value = [];
  try {
    const [u, h] = await Promise.all([
      usersApi.detail(row.id).catch(() => ({ user: row })),
      usersApi.holdings(row.id)
    ]);
    detail.value = u.user || row;
    holdings.value = h.holdings || [];
  } catch (e) {
    ElMessage.error(errorMessage(e));
  } finally {
    detailLoading.value = false;
  }
}
</script>

<style scoped>
.u-cell { display: flex; align-items: center; gap: 9px; min-width: 0; }
.u-cell-txt { min-width: 0; display: flex; flex-direction: column; }
.u-cell-txt b { font-size: 13px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.u-cell-txt small { color: var(--cl-dim); font-size: 11px; }
.cl-up { color: var(--cl-success); }
.cl-down { color: var(--cl-danger); }
</style>
