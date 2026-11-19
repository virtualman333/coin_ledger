<template>
  <section>
    <PageHeader title="贵金属" desc="一「套」一行；套内规格逐枚维护。套级发行量恒为 NULL，逐枚以「枚」为单位，本站不提供参考估值。">
      <template #actions>
        <el-button :loading="loading" @click="reload">刷新</el-button>
        <el-button type="primary" @click="openNew">＋ 新建一套</el-button>
      </template>
    </PageHeader>

    <div class="cl-stat-grid">
      <div class="cl-stat"><b>{{ rows.length }}</b><span>套数</span></div>
      <div class="cl-stat"><b>{{ pieceCount }}</b><span>套内规格</span></div>
      <div class="cl-stat"><b>{{ draftCount }}</b><span>未上架</span></div>
      <div class="cl-stat"><b>{{ publishedCount }}</b><span>已上架</span></div>
    </div>

    <AsyncState :loading="loading && !rows.length" :error="error" @retry="reload">
      <div class="cl-toolbar">
        <el-select v-model="filter" style="width:160px" @change="reload">
          <el-option label="全部状态" value="" />
          <el-option label="未上架 (draft)" value="draft" />
          <el-option label="已上架 (published)" value="published" />
        </el-select>
        <el-input v-model="kw" placeholder="搜索套名称" clearable style="width:240px" />
        <div class="cl-spacer" />
        <span class="cl-mono">贵金属占比 {{ ratioText }}（红线 ≤10%）</span>
      </div>

      <div class="cl-card">
        <el-table :data="filtered" v-loading="loading" stripe size="small" row-key="no">
          <el-table-column prop="no" label="编号" width="70" class-name="cl-mono" />
          <el-table-column prop="year" label="年份" width="80" />
          <el-table-column prop="name" label="套名称" min-width="220" show-overflow-tooltip />
          <el-table-column label="枚数" width="70"><template #default="{ row }">{{ row.set_pieces }}</template></el-table-column>
          <el-table-column label="总克重" width="100"><template #default="{ row }">{{ row.set_weight_g }} g</template></el-table-column>
          <el-table-column label="整套面额" width="110"><template #default="{ row }">{{ row.set_face_total }} 元</template></el-table-column>
          <el-table-column label="状态" width="110">
            <template #default="{ row }">
              <el-tag :type="row.status === 'published' ? 'success' : 'info'" size="small">
                {{ row.status === 'published' ? '已上架' : '未上架' }}
              </el-tag>
              <el-tag v-if="!row.verified" type="warning" size="small" style="margin-left:4px">未核验</el-tag>
            </template>
          </el-table-column>
          <el-table-column label="来源" min-width="160">
            <template #default="{ row }">
              <a v-if="row.source_url" :href="row.source_url" target="_blank" rel="noopener">公告链接 ↗</a>
              <span v-else class="pm-missing">缺公告链接</span>
            </template>
          </el-table-column>
          <el-table-column label="操作" width="240" fixed="right">
            <template #default="{ row }">
              <el-button link type="primary" @click="openEdit(row)">编辑</el-button>
              <el-button v-if="row.status !== 'published'" link type="success" :loading="busy === row.no" @click="publish(row)">上架</el-button>
              <el-button v-else link :loading="busy === row.no" @click="unpublish(row)">下架</el-button>
              <el-button link type="danger" :disabled="row.status === 'published'" @click="remove(row)">删除</el-button>
            </template>
          </el-table-column>
        </el-table>
      </div>
    </AsyncState>

    <PmForm v-model="formVisible" :row="editing" @saved="reload" />
  </section>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import PageHeader from '../components/PageHeader.vue';
import AsyncState from '../components/AsyncState.vue';
import PmForm from '../components/PmForm.vue';
import { pmApi } from '../api/endpoints';
import { errorMessage } from '../api/client';

const rows = ref([]);
const loading = ref(false);
const error = ref(null);
const filter = ref('');
const kw = ref('');
const busy = ref(0);
const formVisible = ref(false);
const editing = ref(null);

const pieceCount = computed(() => rows.value.reduce((a, r) => a + ((r.pieces && r.pieces.length) || r.set_pieces || 0), 0));
const draftCount = computed(() => rows.value.filter((r) => r.status !== 'published').length);
const publishedCount = computed(() => rows.value.filter((r) => r.status === 'published').length);
const ratioText = computed(() => {
  const pm = rows.value.length;
  const total = 137 + pm;
  return ((pm / total) * 100).toFixed(1) + '%';
});
const filtered = computed(() => {
  const q = String(kw.value || '').trim().toLowerCase();
  return q ? rows.value.filter((r) => String(r.name).toLowerCase().includes(q)) : rows.value;
});

async function reload() {
  loading.value = true;
  error.value = null;
  try {
    const r = await pmApi.list(filter.value);
    rows.value = Array.isArray(r.items) ? r.items : [];
  } catch (e) {
    error.value = errorMessage(e);
  } finally {
    loading.value = false;
  }
}
onMounted(reload);

function openNew() { editing.value = null; formVisible.value = true; }
function openEdit(row) { editing.value = row; formVisible.value = true; }

async function changeStatus(row, status) {
  busy.value = row.no;
  try {
    const r = await pmApi.status(row.no, status);
    if (!r.ok) { ElMessage.error(r.error || '操作失败'); return; }
    ElMessage.success(status === 'published' ? '已上架' : '已下架');
    await reload();
  } catch (e) {
    ElMessage.error(errorMessage(e));
  } finally {
    busy.value = 0;
  }
}
function publish(row) { changeStatus(row, 'published'); }
function unpublish(row) { changeStatus(row, 'draft'); }

async function remove(row) {
  try {
    await ElMessageBox.confirm('确认删除「' + row.name + '」？只能删除未上架的套。', '删除确认', { type: 'warning' });
    const r = await pmApi.remove(row.no);
    if (!r.ok) { ElMessage.error(r.error || '删除失败'); return; }
    ElMessage.success('已删除');
    await reload();
  } catch (e) {
    if (e !== 'cancel' && e !== 'close') ElMessage.error(errorMessage(e));
  }
}
</script>

<style scoped>
.pm-missing { color: #b4791f; }
</style>
