<template>
  <section>
    <PageHeader title="封禁管理" desc="反爬封禁查询与一键解封">
      <template #actions>
        <el-button :loading="loading" @click="reload">刷新</el-button>
      </template>
    </PageHeader>

    <!-- 顶部统计卡 -->
    <div class="cl-stat-grid">
      <div class="cl-stat">
        <b>{{ bannedCount }}</b>
        <span>生效封禁数</span>
      </div>
      <div class="cl-stat">
        <b>{{ threshold }}</b>
        <span>蜜罐阈值（命中次数）</span>
      </div>
      <div class="cl-stat">
        <b>{{ banMinutes }}</b>
        <span>封禁时长（分钟）</span>
      </div>
      <div class="cl-stat">
        <b>{{ whitelistCount }}</b>
        <span>白名单数</span>
      </div>
    </div>

    <AsyncState :loading="loading" :error="error" @retry="reload">
      <div class="cl-toolbar">
        <el-input v-model="kw" placeholder="搜索 IP / 原因" clearable style="width:240px" />
        <div class="cl-spacer" />
        <span class="cl-mono">共 {{ total }} 条封禁</span>
      </div>

      <div class="cl-card">
        <el-table :data="rows" v-loading="loading" stripe row-key="ip">
          <el-table-column prop="ip" label="IP 地址" min-width="160" show-overflow-tooltip>
            <template #default="{ row }">
              <span class="cl-mono">{{ row.ip }}</span>
            </template>
          </el-table-column>
          <el-table-column label="原因" min-width="120" show-overflow-tooltip>
            <template #default="{ row }">
              <el-tag size="small" :type="reasonType(row.reason)">{{ reasonText(row.reason) }}</el-tag>
            </template>
          </el-table-column>
          <el-table-column label="剩余时间" min-width="120" show-overflow-tooltip>
            <template #default="{ row }">
              <span class="cl-mono">{{ formatRemain(row.remainMs) }}</span>
            </template>
          </el-table-column>
          <el-table-column label="到期时间" min-width="180" show-overflow-tooltip>
            <template #default="{ row }">
              <span class="cl-mono">{{ formatTime(row.until) }}</span>
            </template>
          </el-table-column>
          <el-table-column label="操作" width="110" fixed="right" show-overflow-tooltip>
            <template #default="{ row }">
              <el-button
                size="small" type="primary" plain
                :loading="busy && currentIp === row.ip"
                :disabled="busy && currentIp !== row.ip"
                @click="askUnban(row)"
              >解封</el-button>
            </template>
          </el-table-column>
          <template #empty>
            <el-empty :description="kw ? '没有匹配的封禁记录' : '当前没有封禁'" />
          </template>
        </el-table>
        <el-pagination
          layout="total, sizes, prev, pager, next, jumper"
          :current-page="params.page" :page-size="params.size" :total="total"
          :page-sizes="[10, 20, 50]"
          @current-change="onPageChange" @size-change="onSizeChange"
        />
      </div>
    </AsyncState>

    <!-- 底部策略说明 -->
    <div class="cl-card cl-guard-note">
      <h3>当前封禁策略</h3>
      <p>10 分钟内命中 3 次才封 30 分钟；本机/白名单/搜索引擎/已登录会话豁免；误伤可在管理端一键解封。</p>
      <p class="cl-guard-note-sub">
        实时参数：窗口 {{ windowMinutes }} 分钟 · 阈值 {{ threshold }} 次 · 封禁 {{ banMinutes }} 分钟 · 白名单 {{ whitelistCount }} 条
      </p>
    </div>

    <!-- 解封确认：低危操作，无需输入文本，仅做简单二次确认 -->
    <ConfirmDialog
      v-model="confirmOpen" title="解除封禁"
      :message="confirmMessage"
      :effects="['清除该 IP 当前的封禁记录', '同时清空其蜜罐命中与连续违规计数']"
      confirm-label="确认解封"
      :loading="busy"
      @confirm="doUnban"
    />
  </section>
</template>

<script setup>
import { computed, ref, watch } from 'vue';
import { ElMessage } from 'element-plus';
import PageHeader from '../components/PageHeader.vue';
import AsyncState from '../components/AsyncState.vue';
import ConfirmDialog from '../components/ConfirmDialog.vue';
import { useTable } from '../composables/useTable';
import { guardApi } from '../api/endpoints';
import { errorMessage } from '../api/client';

/* ---------- 原因映射 ---------- */
const REASON_MAP = {
  honeypot: '蜜罐命中',
  'rate-abuse': '限流滥用',
  'bad-ua': '可疑UA',
  'manual-test': '手动'
};
const REASON_TYPE = {
  honeypot: 'warning',
  'rate-abuse': 'danger',
  'bad-ua': 'info',
  'manual-test': ''
};
function reasonText(r) { return REASON_MAP[r] || r || '—'; }
function reasonType(r) { return REASON_TYPE[r] ?? ''; }

/* ---------- 时间格式化（不引依赖） ---------- */
function pad2(n) { return String(n).padStart(2, '0'); }
function formatTime(ts) {
  const d = new Date(Number(ts));
  if (isNaN(d.getTime())) return '—';
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ` +
    `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
}
function formatRemain(ms) {
  const sec = Math.max(0, Math.floor(Number(ms || 0) / 1000));
  return `${Math.floor(sec / 60)} 分 ${sec % 60} 秒`;
}

/* ---------- 数据 ---------- */
const stats = ref(null);
const ready = computed(() => !!stats.value);
const trap = computed(() => (stats.value && stats.value.trap) || {});
const bannedCount = computed(() => (ready.value ? Number(stats.value.banned || 0) : '—'));
const threshold = computed(() => (ready.value ? (trap.value.threshold ?? '—') : '—'));
const banMinutes = computed(() => (ready.value ? Math.round(Number(trap.value.banMs || 0) / 60000) : '—'));
const whitelistCount = computed(() => (ready.value ? Number(stats.value.whitelist || 0) : '—'));
const windowMinutes = computed(() => (ready.value ? Math.round(Number(trap.value.windowMs || 0) / 60000) : '—'));

const kw = ref('');
const {
  rows, total, loading, error, params,
  reload, search, onPageChange, onSizeChange
} = useTable(
  async () => {
    const res = await guardApi.bans();
    stats.value = res.stats || {};
    return (res.bans || []).map((b) => Object.assign({}, b, { reasonLabel: reasonText(b.reason) }));
  },
  { clientSide: true, searchKeys: ['ip', 'reason', 'reasonLabel'], pageSize: 10 }
);
watch(kw, (v) => search(v));

/* ---------- 解封 ---------- */
const confirmOpen = ref(false);
const busy = ref(false);
const currentIp = ref('');
const confirmMessage = computed(() =>
  `确认解除 IP ${currentIp.value} 的封禁吗？解封后该 IP 可立即恢复访问。`
);

function askUnban(row) {
  if (busy.value) return;
  currentIp.value = row.ip;
  confirmOpen.value = true;
}

async function doUnban() {
  if (!currentIp.value || busy.value) return;
  busy.value = true;
  try {
    const res = await guardApi.unban(currentIp.value);
    ElMessage.success(res && res.removed
      ? `已解封 ${currentIp.value}`
      : `已处理 ${currentIp.value}（该 IP 可能已不在封禁列表）`);
    confirmOpen.value = false;
    await reload();
  } catch (e) {
    ElMessage.error(errorMessage(e));
  } finally {
    busy.value = false;
  }
}
</script>

<style scoped>
.cl-guard-note h3 { margin: 0 0 8px; font-size: 14px; font-weight: 600; }
.cl-guard-note p { margin: 0; color: var(--cl-muted); font-size: 12.5px; line-height: 1.9; }
.cl-guard-note .cl-guard-note-sub { margin-top: 6px; color: var(--cl-dim); }
</style>
