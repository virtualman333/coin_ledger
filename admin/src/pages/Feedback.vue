<template>
  <section>
    <PageHeader title="反馈处理" desc="用户纠错与建议的受理流转">
      <template #actions>
        <el-tag type="warning" effect="dark" round size="small" disable-transitions>
          待处理 {{ openCount }} 条
        </el-tag>
        <el-button :loading="loading" @click="reload">刷新</el-button>
      </template>
    </PageHeader>

    <AsyncState :loading="loading" :error="error" @retry="reload">
      <div class="cl-toolbar">
        <el-radio-group v-model="status" @change="onStatusChange">
          <el-radio-button value="open">待处理</el-radio-button>
          <el-radio-button value="done">已处理</el-radio-button>
          <el-radio-button value="all">全部</el-radio-button>
        </el-radio-group>
        <el-input
          v-model="kw" clearable placeholder="搜索品种 / 正文 / 提交人"
          style="width: 260px" @input="(v) => search(v)"
        />
        <div class="cl-spacer" />
        <span class="cl-mono">共 {{ total }} 条</span>
      </div>

      <div class="cl-card">
        <el-table :data="rows" row-key="id" v-loading="loading" stripe>
          <el-table-column label="状态" width="92">
            <template #default="{ row }">
              <el-tag
                :type="row.status === 'done' ? 'success' : 'warning'"
                effect="dark" size="small" disable-transitions
              >{{ row.status === 'done' ? '已处理' : '待处理' }}</el-tag>
            </template>
          </el-table-column>

          <el-table-column label="品种" min-width="170" show-overflow-tooltip>
            <template #default="{ row }">
              <template v-if="row.coinId">
                <span class="cl-mono">#{{ row.coinId }}</span>
                {{ row.coinName || '（未知品种）' }}
              </template>
              <span v-else class="fb-muted">—</span>
            </template>
          </el-table-column>

          <el-table-column label="提交人" width="190">
            <template #default="{ row }">
              <div class="fb-user">
                <img v-if="row.avatar" :src="row.avatar" class="fb-ava" alt="">
                <span v-else class="fb-ava fb-ava-ph">{{ (row.nickname || row.userName || '?').slice(0, 1) }}</span>
                <span class="fb-user-txt">
                  <b class="fb-nick">{{ row.nickname || row.userName || '—' }}</b>
                  <span v-if="row.nickname && row.userName" class="fb-name">{{ row.userName }}</span>
                </span>
              </div>
            </template>
          </el-table-column>

          <el-table-column label="时间" width="150">
            <template #default="{ row }">
              <div class="cl-mono fb-t">{{ fmtTime(row.createdAt) }}</div>
              <div v-if="row.repliedAt" class="fb-muted fb-t">回复 {{ fmtTime(row.repliedAt) }}</div>
            </template>
          </el-table-column>

          <el-table-column label="正文" min-width="220" show-overflow-tooltip>
            <template #default="{ row }">{{ row.text || '—' }}</template>
          </el-table-column>

          <el-table-column label="截图" width="150">
            <template #default="{ row }">
              <div v-if="row.images && row.images.length" class="fb-imgs">
                <a
                  v-for="f in row.images" :key="f" class="fb-img-link"
                  :href="imgUrl(f)" target="_blank" rel="noopener" :title="f"
                >
                  <img class="fb-thumb" :src="imgUrl(f)" alt="反馈截图" loading="lazy" />
                </a>
              </div>
              <span v-else class="fb-muted">无</span>
            </template>
          </el-table-column>

          <el-table-column label="操作" width="240" fixed="right">
            <template #default="{ row }">
              <a
                v-if="row.coinId" class="fb-jump"
                :href="coinUrl(row)" target="_blank" rel="noopener"
              >看这个品种</a>
              <el-button
                link type="primary" size="small"
                :loading="statusBusyId === row.id"
                @click="setStatus(row, row.status === 'done' ? 'open' : 'done')"
              >{{ row.status === 'done' ? '恢复待处理' : '标记已处理' }}</el-button>
              <el-button link type="danger" size="small" @click="askDelete(row)">删除</el-button>
            </template>
          </el-table-column>

          <template #empty>
            <el-empty
              :image-size="72"
              :description="allRows.length ? '没有匹配的反馈' : '暂无反馈'"
            />
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

    <ConfirmDialog
      v-model="confirmOpen" title="删除反馈" :danger="true"
      danger-text="删除后不可恢复"
      :message="confirmMessage"
      :effects="['该条反馈及其提交信息将被永久移除', '关联的截图会一并删除，不可恢复']"
      confirm-label="确认删除" :loading="deleteBusy"
      @confirm="doDelete"
    />
  </section>
</template>

<script setup>
import { computed, ref } from 'vue';
import { ElMessage } from 'element-plus';
import PageHeader from '../components/PageHeader.vue';
import AsyncState from '../components/AsyncState.vue';
import ConfirmDialog from '../components/ConfirmDialog.vue';
import { useTable } from '../composables/useTable';
import { feedbackApi } from '../api/endpoints';
import { errorMessage } from '../api/client';

// 状态筛选：list(status) 由服务端筛选，切换需重新拉取，故独立于 useTable 管理
const status = ref('open');
const kw = ref('');
const openCount = ref(0); // list 响应的 open 为全局待处理数，与当前筛选无关

// clientSide：loader 返回全量 items，搜索 / 分页由 useTable 在本地完成
const {
  rows, allRows, total, loading, error, params,
  reload, search, onPageChange, onSizeChange
} = useTable(
  async () => {
    const res = await feedbackApi.list(status.value);
    openCount.value = Number(res?.open ?? 0);
    return Array.isArray(res?.items) ? res.items : [];
  },
  { clientSide: true, searchKeys: ['coinName', 'text', 'userName'], pageSize: 20 }
);

function onStatusChange() {
  reload();
}

/* ---------- 展示辅助 ---------- */
// 后端存 UTC ISO，直接截串会差 8 小时；按浏览器本地时区显示
function fmtTime(v) {
  if (!v) return '—';
  const d = new Date(v);
  if (isNaN(d.getTime())) return String(v).replace('T', ' ').slice(0, 16);
  const p = (n) => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate())
    + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
}
// 链接一律以 / 开头（应用挂在 /console/），相对路径会 404
function imgUrl(file) {
  return '/feedback/' + encodeURIComponent(file);
}
function coinUrl(row) {
  return '/coin/' + encodeURIComponent(row.coinId);
}

/* ---------- 标记已处理 / 恢复待处理 ---------- */
const statusBusyId = ref('');
async function setStatus(row, next) {
  if (statusBusyId.value) return;
  statusBusyId.value = row.id;
  try {
    await feedbackApi.update(row.id, next);
    ElMessage.success(next === 'done' ? '已标记为已处理' : '已恢复为待处理');
    await reload();
  } catch (e) {
    ElMessage.error(errorMessage(e));
  } finally {
    statusBusyId.value = '';
  }
}

/* ---------- 删除（ConfirmDialog 确认，无 window.confirm） ---------- */
const confirmOpen = ref(false);
const deleteBusy = ref(false);
const pendingRow = ref(null);
const confirmMessage = computed(() => {
  const r = pendingRow.value;
  if (!r) return '确定删除这条反馈吗？';
  const who = r.userName || '匿名用户';
  const coin = r.coinId ? `（#${r.coinId} ${r.coinName || ''}）` : '';
  return `确定删除由「${who}」提交的这条反馈${coin}吗？`;
});
function askDelete(row) {
  pendingRow.value = row;
  confirmOpen.value = true;
}
async function doDelete() {
  const row = pendingRow.value;
  if (!row || deleteBusy.value) return;
  deleteBusy.value = true;
  try {
    await feedbackApi.remove(row.id);
    ElMessage.success('反馈已删除');
    confirmOpen.value = false;
    await reload();
  } catch (e) {
    ElMessage.error(errorMessage(e));
  } finally {
    deleteBusy.value = false;
  }
}
</script>

<style scoped>
/* 提交人：头像 + 昵称（认人）+ 用户名（账号） */
.fb-user { display: flex; align-items: center; gap: 8px; min-width: 0; }
.fb-ava {
  flex: 0 0 auto; width: 26px; height: 26px; border-radius: 50%;
  object-fit: cover; border: 1px solid var(--cl-line-2); background: var(--cl-panel-2);
}
.fb-ava-ph {
  display: inline-flex; align-items: center; justify-content: center;
  color: var(--cl-muted); font-size: 12px;
}
.fb-user-txt { display: flex; flex-direction: column; min-width: 0; }
.fb-nick {
  font-size: 13px; font-weight: 600; line-height: 1.3;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 130px;
}
.fb-name {
  font-size: 11.5px; color: var(--cl-muted); line-height: 1.3;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 130px;
}
.fb-t { line-height: 1.4; }
.fb-muted { color: var(--cl-muted); }
.fb-jump {
  color: var(--el-color-primary); font-size: 12px;
  text-decoration: none; vertical-align: middle; margin-right: 12px;
}
.fb-jump:hover { text-decoration: underline; }
.fb-imgs { display: flex; flex-wrap: wrap; gap: 6px; }
.fb-img-link { display: inline-flex; line-height: 0; }
.fb-thumb {
  width: 40px; height: 40px; object-fit: cover;
  border: 1px solid var(--cl-line-2); border-radius: 6px;
  background: var(--cl-panel-2);
  transition: transform .15s, border-color .15s;
}
.fb-img-link:hover .fb-thumb { transform: scale(1.06); border-color: var(--cl-gold); }
</style>
