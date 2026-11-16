<template>
  <section>
    <PageHeader title="系列管理" desc="维护系列标识、名称、卡图与展示排序">
      <template #actions>
        <el-button :loading="loading" @click="reload">刷新</el-button>
        <el-button type="primary" @click="openCreate">新建系列</el-button>
      </template>
    </PageHeader>

    <AsyncState :loading="loading" :error="error" @retry="reload">
      <div class="cl-toolbar">
        <el-input
          v-model="kw" placeholder="搜索标识 / 名称" clearable
          style="width: 260px"
        />
        <div class="cl-spacer" />
        <span class="cl-mono">共 {{ total }} 条</span>
      </div>

      <div class="cl-card">
        <el-table :data="rows" v-loading="loading" stripe>
          <el-table-column label="卡图" width="80" align="center">
            <template #default="{ row }">
              <el-image
                v-if="row.img" :src="imgSrc(row.img)" fit="cover"
                class="s-thumb" :preview-src-list="[imgSrc(row.img)]" preview-teleported
              >
                <template #error><span style="color: var(--cl-muted)">—</span></template>
              </el-image>
              <span v-else style="color: var(--cl-muted)">—</span>
            </template>
          </el-table-column>

          <el-table-column label="标识" min-width="120" show-overflow-tooltip>
            <template #default="{ row }"><span class="cl-mono">{{ row.key }}</span></template>
          </el-table-column>

          <el-table-column label="名称" min-width="200">
            <template #default="{ row }">
              <el-input v-model="drafts[row.key].name" placeholder="系列名称" />
            </template>
          </el-table-column>

          <el-table-column label="品种数" width="92" align="center">
            <template #default="{ row }"><span class="cl-mono">{{ row.count ?? 0 }}</span></template>
          </el-table-column>

          <el-table-column label="排序" width="120">
            <template #default="{ row }">
              <el-input v-model="drafts[row.key].sort" type="number" />
            </template>
          </el-table-column>

          <el-table-column label="操作" width="300" fixed="right">
            <template #default="{ row }">
              <div class="s-acts">
                <el-button size="small" @click="openMembers(row)">成员</el-button>
                <el-button
                  size="small" type="primary" plain
                  :loading="drafts[row.key].saving" :disabled="drafts[row.key].uploading"
                  @click="saveRow(row)"
                >保存</el-button>
                <el-button
                  size="small"
                  :loading="drafts[row.key].uploading" :disabled="drafts[row.key].saving"
                  @click="pickImage(row)"
                >换图</el-button>
                <el-button
                  size="small" type="danger" plain
                  :disabled="drafts[row.key].saving || drafts[row.key].uploading"
                  @click="askDelete(row)"
                >删除</el-button>
              </div>
            </template>
          </el-table-column>

          <template #empty>
            <el-empty description="暂无系列，或没有匹配的搜索结果" :image-size="80" />
          </template>
        </el-table>

        <el-pagination
          layout="total, sizes, prev, pager, next, jumper"
          :current-page="params.page" :page-size="params.size" :total="total"
          :page-sizes="[10, 20, 50, 100]"
          @current-change="onPageChange" @size-change="onSizeChange"
        />
      </div>
    </AsyncState>

    <!-- 换图用的隐藏文件选择框（全表共用，靠 pendingImageKey 关联当前行） -->
    <input ref="fileInput" type="file" accept="image/*" class="s-file" @change="onFileChange" />

    <!-- 新建系列 -->
    <el-dialog v-model="createOpen" title="新建系列" width="440px" align-center>
      <el-form ref="createFormRef" :model="createForm" :rules="createRules" label-width="90px">
        <el-form-item label="标识" prop="key">
          <el-input v-model="createForm.key" placeholder="英文 / 数字，如 SXC" autocomplete="off" />
        </el-form-item>
        <el-form-item label="名称" prop="name">
          <el-input v-model="createForm.name" placeholder="系列名称" autocomplete="off" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="createOpen = false">取消</el-button>
        <el-button type="primary" :loading="creating" @click="submitCreate">新建</el-button>
      </template>
    </el-dialog>

    <!-- 成员管理：勾选该系列包含哪些品种，整份保存 -->
    <el-drawer v-model="memberOpen" :title="'成员管理 · ' + memberKey + ' ' + memberName" size="720px">
      <div class="m-toolbar">
        <el-input v-model="memberKw" placeholder="搜索品种名称 / 编号 / 年份" clearable style="width:260px">
          <template #prefix><el-icon><Search /></el-icon></template>
        </el-input>
        <span class="cl-mono">已选 {{ memberChecked.size }} / 共 {{ memberCoins.length }} 个品种</span>
        <div class="cl-spacer" />
        <el-button size="small" @click="memberSelectAll(true)">全选当前筛选</el-button>
        <el-button size="small" @click="memberSelectAll(false)">清空当前筛选</el-button>
      </div>

      <el-table :data="filteredMemberRows" v-loading="memberLoading" size="small" stripe max-height="500" row-key="id">
        <el-table-column width="46">
          <template #default="{ row }">
            <el-checkbox
              :model-value="memberChecked.has(row.id)"
              @change="(v) => toggleMember(row.id, v)"
            />
          </template>
        </el-table-column>
        <el-table-column prop="id" label="#" width="60" class-name="cl-mono" />
        <el-table-column prop="name" label="品种" min-width="200" show-overflow-tooltip />
        <el-table-column prop="year" label="年份" width="80" />
        <el-table-column label="主系列" width="110">
          <template #default="{ row }">{{ seriesLabel(row.series) }}</template>
        </el-table-column>
        <el-table-column label="所属系列" min-width="190" show-overflow-tooltip>
          <template #default="{ row }">{{ row.seriesKeys.map(seriesLabel).join('、') || '—' }}</template>
        </el-table-column>
      </el-table>

      <template #footer>
        <el-button @click="memberOpen = false">取消</el-button>
        <el-button type="primary" :loading="memberSaving" @click="saveMembers">
          保存成员（{{ memberChecked.size }}）
        </el-button>
      </template>
    </el-drawer>

    <!-- 删除确认 -->
    <ConfirmDialog
      v-model="confirmOpen" title="删除系列" :danger="true"
      danger-text="删除后不可恢复，请谨慎操作"
      :message="'确定删除系列「' + (deleteTarget || '') + '」吗？'"
      :effects="['该系列会从所有品种上移除，品种本身不删', '操作不可撤销，请确认后再执行']"
      :confirm-text="deleteTarget || ''" confirm-label="删除"
      :loading="deleting" @confirm="doDelete"
    />
  </section>
</template>

<script setup>
import { computed, nextTick, reactive, ref, watch } from 'vue';
import { ElMessage } from 'element-plus';
import PageHeader from '../components/PageHeader.vue';
import AsyncState from '../components/AsyncState.vue';
import ConfirmDialog from '../components/ConfirmDialog.vue';
import { useTable } from '../composables/useTable';
import { seriesApi } from '../api/endpoints';
import { errorMessage } from '../api/client';

const kw = ref('');

/* clientSide 模式：list() 返回全量数组，由 useTable 本地搜索 / 排序 / 分页 */
const {
  rows, allRows, total, loading, error, params,
  reload, refresh, search, onPageChange, onSizeChange
} = useTable(
  () => seriesApi.list().then((res) => (Array.isArray(res) ? res : (res && res.items) || [])),
  { clientSide: true, searchKeys: ['key', 'name'] }
);

/* 搜索框（含 clearable 清空）统一驱动本地过滤，search 自带 300ms 防抖 */
watch(kw, (v) => search(v));

/* 卡图：相对路径补 /（应用挂 /console/，相对会 404），并带时间戳避免缓存 */
const cacheBust = ref(Date.now());
function imgSrc(img) {
  const s = String(img || '').trim();
  if (!s) return '';
  let p = s;
  if (!/^(https?:\/\/|data:|\/)/i.test(p)) p = '/' + p;
  return p + (p.includes('?') ? '&' : '?') + 'v=' + cacheBust.value;
}

/* 行内草稿：按 key 维护 name/sort 与各自的 loading 锁；重新加载时只补缺失项，保留未保存的编辑 */
const drafts = reactive({});
function ensureDraft(row) {
  if (drafts[row.key]) return drafts[row.key];
  return (drafts[row.key] = {
    name: row.name == null ? '' : String(row.name),
    sort: Number(row.sort) || 0,
    saving: false,
    uploading: false
  });
}
watch(allRows, (list) => {
  list.forEach(ensureDraft);
  cacheBust.value = Date.now(); // 每次拉到新数据后更换时间戳，令换图后的图片立即生效
}, { immediate: true });

/* ---------- 行内编辑：保存名称与排序 ---------- */
async function saveRow(row) {
  const d = drafts[row.key];
  if (!d || d.saving) return;
  d.saving = true;
  try {
    await seriesApi.update(row.key, {
      name: String(d.name ?? ''),
      sort: Number(d.sort) || 0
    });
    ElMessage.success('已保存');
    await refresh();
  } catch (err) {
    ElMessage.error('保存失败：' + errorMessage(err));
  } finally {
    d.saving = false;
  }
}

/* ---------- 换图 ---------- */
const fileInput = ref(null);
const pendingImageKey = ref('');
function pickImage(row) {
  pendingImageKey.value = row.key;
  const el = fileInput.value;
  if (el) { el.value = ''; el.click(); }
}
function onFileChange(e) {
  const key = pendingImageKey.value;
  const file = e.target.files && e.target.files[0];
  e.target.value = ''; // 允许再次选择同一文件
  if (!key || !file || !drafts[key]) return;
  const reader = new FileReader();
  reader.onload = () => uploadImage(key, reader.result);
  reader.onerror = () => ElMessage.error('读取图片失败');
  reader.readAsDataURL(file);
}
async function uploadImage(key, dataUrl) {
  const d = drafts[key];
  if (!d || d.uploading) return;
  d.uploading = true;
  try {
    await seriesApi.image(key, dataUrl);
    ElMessage.success('已换图');
    await refresh();
  } catch (err) {
    ElMessage.error('上传失败：' + errorMessage(err));
  } finally {
    d.uploading = false;
  }
}

/* ---------- 新建系列 ---------- */
const createOpen = ref(false);
const createFormRef = ref(null);
const createForm = reactive({ key: '', name: '' });
const creating = ref(false);
const createRules = {
  key: [
    { required: true, message: '请输入系列标识', trigger: 'blur' },
    {
      validator: (rule, value, cb) =>
        /^[A-Za-z0-9]+$/.test(String(value || ''))
          ? cb()
          : cb(new Error('只允许英文字母和数字')),
      trigger: 'blur'
    }
  ],
  name: [{ required: true, message: '请输入系列名称', trigger: 'blur' }]
};
function openCreate() {
  createForm.key = '';
  createForm.name = '';
  createOpen.value = true;
  nextTick(() => createFormRef.value && createFormRef.value.clearValidate());
}
async function submitCreate() {
  if (!createFormRef.value) return;
  let valid = false;
  try { valid = await createFormRef.value.validate(); } catch (e) { valid = false; }
  if (!valid) return;
  creating.value = true;
  try {
    await seriesApi.create({ key: createForm.key.trim(), name: createForm.name.trim() });
    ElMessage.success('已新建');
    createOpen.value = false;
    await reload();
  } catch (err) {
    ElMessage.error('新建失败：' + errorMessage(err));
  } finally {
    creating.value = false;
  }
}

/* ---------- 删除系列 ---------- */
const confirmOpen = ref(false);
const deleteTarget = ref('');
const deleting = ref(false);
function askDelete(row) {
  deleteTarget.value = row.key;
  confirmOpen.value = true;
}
async function doDelete() {
  const key = deleteTarget.value;
  if (!key || deleting.value) return;
  deleting.value = true;
  try {
    const res = await seriesApi.remove(key);
    const touched = Number(res && res.touched) || 0;
    ElMessage.success('已删除，清理 ' + touched + ' 个品种');
    confirmOpen.value = false;
    delete drafts[key];
    await reload();
  } catch (err) {
    ElMessage.error('删除失败：' + errorMessage(err));
  } finally {
    deleting.value = false;
  }
}
/* ---------- 成员管理 ---------- */
const memberOpen = ref(false);
const memberKey = ref('');
const memberName = ref('');
const memberKw = ref('');
const memberCoins = ref([]);
const memberSeriesList = ref([]);
const memberLoading = ref(false);
const memberSaving = ref(false);
const memberChecked = ref(new Set());

const filteredMemberRows = computed(() => {
  const q = memberKw.value.trim().toLowerCase();
  if (!q) return memberCoins.value;
  return memberCoins.value.filter((c) =>
    String(c.name).toLowerCase().includes(q) ||
    String(c.id) === q ||
    String(c.year).includes(q));
});

function seriesLabel(k) {
  const hit = memberSeriesList.value.find((s) => s.key === k);
  return hit ? hit.name : (k || '—');
}
function toggleMember(id, on) {
  const next = new Set(memberChecked.value);
  if (on) next.add(id); else next.delete(id);
  memberChecked.value = next;
}
function memberSelectAll(on) {
  const next = new Set(memberChecked.value);
  filteredMemberRows.value.forEach((r) => { if (on) next.add(r.id); else next.delete(r.id); });
  memberChecked.value = next;
}

async function openMembers(row) {
  memberKey.value = row.key;
  memberName.value = row.name || '';
  memberKw.value = '';
  memberOpen.value = true;
  memberLoading.value = true;
  try {
    const [seriesRes, coinsRes] = await Promise.all([seriesApi.list(), seriesApi.coins()]);
    memberSeriesList.value = Array.isArray(seriesRes) ? seriesRes : (seriesRes.items || []);
    memberCoins.value = (coinsRes.coins || []).map((c) => ({
      id: Number(c.i) + 1,
      name: c.name,
      year: c.year,
      series: c.series || '',
      seriesKeys: Array.isArray(c.seriesKeys)
        ? c.seriesKeys.slice()
        : (c.series ? [c.series] : [])
    }));
    memberChecked.value = new Set(
      memberCoins.value.filter((c) => c.seriesKeys.indexOf(row.key) >= 0).map((c) => c.id)
    );
  } catch (err) {
    ElMessage.error(errorMessage(err));
  } finally {
    memberLoading.value = false;
  }
}

async function saveMembers() {
  memberSaving.value = true;
  try {
    const ids = Array.from(memberChecked.value);
    const res = await seriesApi.members(memberKey.value, ids);
    ElMessage.success('已保存 ' + (res.count || 0) + ' 个成员，变更 ' + (res.changed || 0) + ' 个品种');
    memberOpen.value = false;
    await refresh();   // 系列列表的品种数会随之更新
  } catch (err) {
    ElMessage.error(errorMessage(err));
  } finally {
    memberSaving.value = false;
  }
}

</script>

<style scoped>
.s-thumb {
  width: 44px; height: 44px; border-radius: 8px;
  border: 1px solid var(--cl-line-2); background: var(--cl-panel-2);
}
.s-acts { display: flex; gap: 6px; flex-wrap: wrap; }
.s-file { display: none; }
.m-toolbar { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-bottom: 12px; }
</style>
