<template>
  <section>
    <PageHeader title="品种参数" desc="发行信息批量维护：改动先在本地暂存，确认后一次提交，避免逐条请求被限流打断。">
      <template #actions>
        <el-button :loading="loading" @click="reload">刷新</el-button>
        <el-button type="primary" :disabled="!dirtyCount" :loading="saving" @click="saveAll">
          保存全部修改（{{ dirtyCount }}）
        </el-button>
      </template>
    </PageHeader>

    <div class="cl-stat-grid">
      <div class="cl-stat"><b>{{ allRows.length }}</b><span>品种总数</span></div>
      <div class="cl-stat"><b>{{ withMain }}</b><span>有主图</span></div>
      <div class="cl-stat"><b>{{ allRows.length - withMain }}</b><span>缺主图</span></div>
      <div class="cl-stat"><b>{{ withoutSet }}</b><span>缺正反面</span></div>
    </div>

    <AsyncState :loading="loading && !allRows.length" :error="error" @retry="reload">
      <div class="cl-toolbar">
        <el-input v-model="kw" placeholder="搜索名称 / 年份 / 编号" clearable style="width:240px" @input="search(kw)">
          <template #prefix><el-icon><Search /></el-icon></template>
        </el-input>
        <el-select v-model="filter" style="width:150px" @change="setParam('filter', filter)">
          <el-option label="全部品种" value="all" />
          <el-option label="缺主图" value="noimg" />
          <el-option label="缺正反面" value="noset" />
        </el-select>
        <div class="cl-spacer" />
        <span class="cl-mono">共 {{ total }} 条 · 未保存 {{ dirtyCount }} 行</span>
      </div>

      <div class="cl-card">
        <el-table :data="rows" v-loading="loading" stripe row-key="id" size="small">
          <el-table-column label="图" width="62">
            <template #default="{ row }">
              <button class="p-thumb-btn" type="button" title="配置图片" aria-label="配置图片" @click="openImages(row)">
                <img class="p-thumb" :src="thumb(row.id)" loading="lazy" alt="" @error="onImgError" />
              </button>
            </template>
          </el-table-column>
          <el-table-column prop="id" label="#" width="54" class-name="cl-mono" />
          <el-table-column prop="name" label="名称" min-width="150" show-overflow-tooltip />
          <el-table-column label="年份" width="100">
            <template #default="{ row }"><el-input v-model="draftOf(row).year" size="small" @input="markDirty(row)" /></template>
          </el-table-column>
          <el-table-column label="面额" width="96">
            <template #default="{ row }"><el-input v-model="draftOf(row).face" size="small" @input="markDirty(row)" /></template>
          </el-table-column>
          <el-table-column label="参考价" width="96">
            <template #default="{ row }"><el-input v-model="draftOf(row).est" size="small" @input="markDirty(row)" /></template>
          </el-table-column>
          <el-table-column label="发行量" width="108">
            <template #default="{ row }"><el-input v-model="draftOf(row).mintage" size="small" @input="markDirty(row)" /></template>
          </el-table-column>
          <el-table-column label="每套枚数" width="108">
            <template #default="{ row }"><el-input v-model="draftOf(row).setSize" size="small" placeholder="默认" @input="markDirty(row)" /></template>
          </el-table-column>
          <el-table-column label="所属系列" width="150">
            <template #default="{ row }">
              <el-select v-model="draftOf(row).series" size="small" @change="markDirty(row)">
                <el-option v-for="(name, key) in meta.series" :key="key" :label="name" :value="key" />
              </el-select>
            </template>
          </el-table-column>
          <el-table-column label="套系" width="150">
            <template #default="{ row }">
              <el-select v-model="draftOf(row).set" size="small" @change="markDirty(row)">
                <el-option label="独立发行" value="single" />
                <el-option v-for="(s, key) in meta.sets" :key="key" :label="s.name || key" :value="key" />
              </el-select>
            </template>
          </el-table-column>
          <el-table-column label="操作" width="170" fixed="right">
            <template #default="{ row }">
              <el-button size="small" text @click="openImages(row)">图片</el-button>
              <el-button size="small" text type="primary" :disabled="!isDirty(row)" :loading="savingId === row.id" @click="saveOne(row)">存</el-button>
              <el-button size="small" text :disabled="!isDirty(row)" @click="undo(row)">撤销</el-button>
            </template>
          </el-table-column>
        </el-table>
        <el-pagination
          layout="total, sizes, prev, pager, next, jumper"
          :current-page="params.page" :page-size="params.size" :total="total"
          :page-sizes="[20, 50, 100]"
          @current-change="onPageChange" @size-change="onSizeChange"
        />
      </div>
    </AsyncState>

    <CoinImageEditor
      v-model="imageOpen" :coin="imageCoin" :images="imageList"
      @changed="onImagesChanged"
    />
  </section>
</template>

<script setup>
import { computed, reactive, ref } from 'vue';
import { ElMessage } from 'element-plus';
import PageHeader from '../components/PageHeader.vue';
import AsyncState from '../components/AsyncState.vue';
import CoinImageEditor from '../components/CoinImageEditor.vue';
import { useTable } from '../composables/useTable';
import { coinsApi } from '../api/endpoints';
import { errorMessage } from '../api/client';

const kw = ref('');
const filter = ref('all');
const meta = ref({ series: {}, sets: {}, gallery: {} });
const drafts = reactive({});
const dirty = reactive({});
const saving = ref(false);
const savingId = ref(null);

const table = useTable(async () => {
  const r = await coinsApi.all();
  meta.value = { series: r.series || {}, sets: r.sets || {}, gallery: r.gallery || {} };
  return (r.coins || []).map((c) => ({ ...c, id: Number(c.i) + 1 }));
}, {
  clientSide: true,
  pageSize: 20,
  searchKeys: ['name', 'year', 'id'],
  defaultParams: { filter: 'all' },
  localFilter: (row, f) => {
    const imgs = meta.value.gallery[String(row.id)] || [];
    if (f === 'noimg') return !imgs.some((x) => x.k === 'main');
    if (f === 'noset') return !imgs.some((x) => x.k === 'set');
    return true;
  }
});
const {
  rows, allRows, total, loading, error, params,
  reload, refresh, search, setParam, onPageChange, onSizeChange
} = table;

const withMain = computed(() => allRows.value.filter((r) =>
  (meta.value.gallery[String(r.id)] || []).some((x) => x.k === 'main')).length);
const withoutSet = computed(() => allRows.value.filter((r) =>
  !(meta.value.gallery[String(r.id)] || []).some((x) => x.k === 'set')).length);
const dirtyCount = computed(() => Object.keys(dirty).filter((k) => dirty[k]).length);

function draftOf(row) {
  if (!drafts[row.id]) {
    drafts[row.id] = {
      year: row.year, face: row.face, est: row.est, mintage: row.mintage,
      setSize: row.setSize ?? '', series: row.series || '', set: row.set || 'single'
    };
  }
  return drafts[row.id];
}
function markDirty(row) { dirty[row.id] = true; }
function isDirty(row) { return !!dirty[row.id]; }
function undo(row) { delete drafts[row.id]; delete dirty[row.id]; }

function patchOf(row) {
  const d = draftOf(row);
  const patch = {
    year: d.year, face: d.face, est: d.est, mintage: d.mintage,
    series: d.series, set: d.set
  };
  if (String(d.setSize).trim() !== '') patch.setSize = d.setSize;
  return patch;
}

function thumb(id) { return '/img/th/s/' + String(id).padStart(3, '0') + '.jpg'; }
function onImgError(e) { e.target.style.visibility = 'hidden'; }

/* ---------- 行内配置图片 ---------- */
const imageOpen = ref(false);
const imageCoin = ref({ id: 0, name: '' });
const imageList = computed(() =>
  imageCoin.value.id ? (meta.value.gallery[String(imageCoin.value.id)] || []) : []);

function openImages(row) {
  imageCoin.value = { id: row.id, name: row.name };
  imageOpen.value = true;
}
async function onImagesChanged() {
  // refresh() 保留当前页码与筛选，避免配完图被弹回第一页
  await refresh();
}

function clearDirty(ids) {
  ids.forEach((id) => { delete drafts[id]; delete dirty[id]; });
}

async function saveAll() {
  const ids = Object.keys(dirty).filter((k) => dirty[k]).map(Number);
  if (!ids.length) return;
  const items = ids.map((id) => {
    const row = allRows.value.filter((c) => c.id === id)[0];
    return { id, patch: patchOf(row) };
  }).filter((x) => x.patch);
  saving.value = true;
  try {
    const r = await coinsApi.batchUpdate(items);
    if (r.failed && r.failed.length) {
      ElMessage.warning(`已保存 ${r.saved} 条，${r.failed.length} 条失败：${r.failed[0].error || ''}`);
    } else {
      ElMessage.success(`已保存 ${r.saved} 个品种`);
    }
    clearDirty(ids);
    await reload();
  } catch (e) {
    ElMessage.error(errorMessage(e));
  } finally {
    saving.value = false;
  }
}

async function saveOne(row) {
  savingId.value = row.id;
  try {
    await coinsApi.updateOne({ id: row.id, patch: patchOf(row) });
    ElMessage.success(`已保存 #${row.id} ${row.name}`);
    undo(row);
    await reload();
  } catch (e) {
    ElMessage.error(errorMessage(e));
  } finally {
    savingId.value = null;
  }
}
</script>

<style scoped>
.p-thumb { width: 40px; height: 40px; object-fit: cover; border-radius: 6px; background: #0f141b; }
.p-thumb-btn {
  padding: 0; border: 1px solid transparent; border-radius: 8px;
  background: transparent; cursor: pointer; line-height: 0;
  transition: border-color .15s, transform .15s;
}
.p-thumb-btn:hover { border-color: var(--cl-gold); transform: translateY(-1px); }
.p-thumb-btn:focus-visible { outline: 2px solid var(--cl-gold); outline-offset: 2px; }
</style>
