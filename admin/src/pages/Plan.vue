<template>
  <section>
    <PageHeader title="发行管理" desc="维护央行年度发行计划。改动先在本地暂存，确认后整份保存；保存后 /plan 页面与小程序立即生效。">
      <template #actions>
        <el-button :loading="loading" @click="askReload">刷新</el-button>
        <el-button type="primary" :disabled="!dirty" :loading="saving" @click="askSave">
          保存全部修改
        </el-button>
      </template>
    </PageHeader>

    <div class="cl-toolbar">
      <el-button @click="openNewYear">＋ 新增年度</el-button>
      <span class="cl-mono">共 {{ yearCount }} 个年度 / {{ itemCount }} 个项目</span>
      <div class="cl-spacer" />
      <el-tag v-if="dirty" type="warning" effect="dark">有未保存修改</el-tag>
      <el-tag v-else type="success" effect="plain">已同步</el-tag>
    </div>

    <AsyncState :loading="loading && !draft.years.length" :error="error" @retry="load">
      <div v-for="(y, yi) in draft.years" :key="y.year" class="cl-card pl-year">
        <div class="pl-year-head">
          <div class="pl-year-title">
            <b>{{ y.year }} 年</b>
            <span class="cl-mono">{{ (y.items || []).length }} 个项目</span>
          </div>
          <div class="pl-year-meta">
            <span v-if="y.publishedAt">公布 {{ y.publishedAt }}</span>
            <span v-if="y.publishedBy">{{ y.publishedBy }}</span>
            <a v-if="y.sourceUrl" :href="y.sourceUrl" target="_blank" rel="noopener">来源公告 ↗</a>
          </div>
          <div class="cl-spacer" />
          <el-button size="small" text @click="openEditYear(yi)">年度信息</el-button>
          <el-button size="small" text type="danger" @click="askDeleteYear(yi)">删除年度</el-button>
        </div>

        <el-table :data="y.items || []" size="small" stripe>
          <el-table-column prop="key" label="标识" width="170" class-name="cl-mono" show-overflow-tooltip />
          <el-table-column prop="name" label="名称" min-width="200" show-overflow-tooltip />
          <el-table-column prop="short" label="简称" width="130" show-overflow-tooltip />
          <el-table-column label="类别" width="90">
            <template #default="{ row }">{{ row.kind === 'note' ? '纪念钞' : '纪念币' }}</template>
          </el-table-column>
          <el-table-column label="状态" width="100">
            <template #default="{ row }">
              <el-tag :type="row.status === 'issued' ? 'success' : 'warning'" size="small" effect="plain">
                {{ row.status === 'issued' ? '已发行' : '待发行' }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column prop="date" label="发行日" width="120" class-name="cl-mono" />
          <el-table-column label="面额" width="80" align="right">
            <template #default="{ row }">{{ row.face ?? '—' }}</template>
          </el-table-column>
          <el-table-column label="发行量(万)" width="110" align="right">
            <template #default="{ row }">{{ row.mintage ?? '—' }}</template>
          </el-table-column>
          <el-table-column prop="reserve" label="预约期" min-width="170" show-overflow-tooltip />
          <el-table-column label="操作" width="130" fixed="right">
            <template #default="{ row, $index }">
              <el-button size="small" text type="primary" @click="openEditItem(yi, $index)">编辑</el-button>
              <el-button size="small" text type="danger" @click="askDeleteItem(yi, $index)">删除</el-button>
            </template>
          </el-table-column>
        </el-table>

        <div class="pl-year-foot">
          <el-button size="small" type="primary" plain @click="openNewItem(yi)">＋ 新增项目</el-button>
        </div>
      </div>

      <el-empty v-if="!draft.years.length" description="还没有发行计划，点「新增年度」开始" />
    </AsyncState>

    <!-- 项目编辑抽屉 -->
    <el-drawer v-model="itemDrawer" :title="isNewItem ? '新增发行项目' : '编辑 · ' + (editItem.name || '')" size="640px">
      <el-form label-width="120px" label-position="left">
        <template v-for="g in FIELD_GROUPS" :key="g.title">
          <el-divider content-position="left">{{ g.title }}</el-divider>
          <el-form-item v-for="f in g.fields" :key="f.k" :label="f.label" :required="!!f.required">
            <el-select
              v-if="f.type === 'select'" :model-value="fieldGet(editItem, f.k)"
              style="width:100%" @update:model-value="(v) => onField(f, v)"
            >
              <el-option v-for="o in f.options" :key="o.v" :label="o.t" :value="o.v" />
            </el-select>
            <el-switch
              v-else-if="f.type === 'switch'" :model-value="!!fieldGet(editItem, f.k)"
              @update:model-value="(v) => onField(f, v)"
            />
            <el-input
              v-else-if="f.type === 'textarea'" type="textarea" :rows="2"
              :model-value="fieldGet(editItem, f.k)" @update:model-value="(v) => onField(f, v)"
            />
            <el-input
              v-else :model-value="fieldGet(editItem, f.k)"
              @update:model-value="(v) => onField(f, v)"
            />
          </el-form-item>
        </template>

        <el-divider content-position="left">发行日程</el-divider>
        <div v-for="(s, i) in editItem.schedule || []" :key="i" class="pl-sched">
          <el-input v-model="s.k" placeholder="环节，如 预约" @input="markDirty" />
          <el-input v-model="s.v" placeholder="时间，如 11-17 22:00 起" @input="markDirty" />
          <el-button text type="danger" @click="removeSchedule(i)">删除</el-button>
        </div>
        <el-button size="small" plain @click="addSchedule">＋ 添加日程</el-button>
      </el-form>

      <template #footer>
        <el-button @click="itemDrawer = false">取消</el-button>
        <el-button type="primary" @click="commitItem">确定</el-button>
      </template>
    </el-drawer>

    <!-- 年度信息 -->
    <el-dialog v-model="yearDialog" :title="yearEditing === null ? '新增年度' : '编辑年度信息'" width="540px">
      <el-form label-width="110px">
        <el-form-item label="年度" required>
          <el-input-number v-model="yearForm.year" :min="1990" :max="2100" :disabled="yearEditing !== null" />
        </el-form-item>
        <el-form-item label="公布日期"><el-input v-model="yearForm.publishedAt" placeholder="2025-12-08" /></el-form-item>
        <el-form-item label="发布机构"><el-input v-model="yearForm.publishedBy" placeholder="中国人民银行" /></el-form-item>
        <el-form-item label="来源链接"><el-input v-model="yearForm.sourceUrl" /></el-form-item>
        <el-form-item label="来源摘要"><el-input v-model="yearForm.sourceText" type="textarea" :rows="3" /></el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="yearDialog = false">取消</el-button>
        <el-button type="primary" @click="commitYear">确定</el-button>
      </template>
    </el-dialog>

    <ConfirmDialog
      v-model="confirmOpen" :title="confirmCfg.title" :message="confirmCfg.message"
      :danger="confirmCfg.danger" :danger-text="confirmCfg.dangerText"
      :effects="confirmCfg.effects" :confirm-text="confirmCfg.confirmText"
      :confirm-label="confirmCfg.confirmLabel" :loading="confirmCfg.loading"
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
import { planApi } from '../api/endpoints';
import { errorMessage } from '../api/client';

const FIELD_GROUPS = [
  {
    title: '基本信息',
    fields: [
      { k: 'key', label: '标识 key', required: true },
      { k: 'name', label: '名称', required: true },
      { k: 'short', label: '简称' },
      { k: 'kind', label: '类别', type: 'select', options: [{ v: 'coin', t: '纪念币' }, { v: 'note', t: '纪念钞' }] },
      { k: 'status', label: '状态', type: 'select', options: [{ v: 'issued', t: '已发行' }, { v: 'upcoming', t: '待发行' }] },
      { k: 'date', label: '发行日' },
      { k: 'face', label: '面额' },
      { k: 'mintage', label: '发行量(万)' },
      { k: 'limit', label: '每人限额' },
      { k: 'coinNo', label: '品种编号' },
      { k: 'seriesKey', label: '系列 key' },
      { k: 'extra', label: '计划外增发', type: 'switch' }
    ]
  },
  {
    title: '预约与兑换',
    fields: [
      { k: 'reserve', label: '预约期' },
      { k: 'exchange', label: '兑换期' },
      { k: 'verify', label: '核实期' },
      { k: 'proxy', label: '代领人数' },
      { k: 'banks', label: '承办银行', type: 'textarea' }
    ]
  },
  {
    title: '说明与来源',
    fields: [
      { k: 'note', label: '备注', type: 'textarea' },
      { k: 'sourceUrl', label: '来源链接' },
      { k: 'sourceText', label: '来源摘要', type: 'textarea' },
      { k: 'material', label: '材质' },
      { k: 'dia', label: '直径' }
    ]
  },
  {
    title: '币面设计',
    fields: [
      { k: 'design.obverse', label: '正面', type: 'textarea' },
      { k: 'design.reverse', label: '背面', type: 'textarea' }
    ]
  }
];

const draft = ref({ years: [] });
const loading = ref(false);
const error = ref('');
const dirty = ref(false);
const saving = ref(false);

const yearCount = computed(() => (draft.value.years || []).length);
const itemCount = computed(() => (draft.value.years || [])
  .reduce((a, y) => a + (y.items || []).length, 0));

function clone(o) { return JSON.parse(JSON.stringify(o)); }
function markDirty() { dirty.value = true; }

function fieldGet(obj, path) {
  const v = String(path).split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
  return v === undefined || v === null ? '' : v;
}
function fieldSet(obj, path, value) {
  const parts = String(path).split('.');
  let o = obj;
  for (let i = 0; i < parts.length - 1; i += 1) {
    if (!o[parts[i]] || typeof o[parts[i]] !== 'object') o[parts[i]] = {};
    o = o[parts[i]];
  }
  o[parts[parts.length - 1]] = value;
}
function onField(f, v) { fieldSet(editItem.value, f.k, v); markDirty(); }

async function load() {
  loading.value = true;
  error.value = '';
  try {
    const r = await planApi.get();
    draft.value = clone(r.plan || { years: [] });
    if (!Array.isArray(draft.value.years)) draft.value.years = [];
    dirty.value = false;
  } catch (e) {
    error.value = errorMessage(e);
  } finally {
    loading.value = false;
  }
}
onMounted(load);

/* ---------- 项目编辑 ---------- */
const itemDrawer = ref(false);
const editItem = ref({});
const editYearIndex = ref(-1);
const editItemIndex = ref(-1);
const isNewItem = ref(false);

function newItem() {
  return {
    key: '', name: '', short: '', kind: 'coin', status: 'upcoming',
    date: '', face: '', mintage: '', limit: 20, coinNo: 0,
    reserve: '', exchange: '', note: '', sourceUrl: '', seriesKey: '',
    schedule: []
  };
}
function openNewItem(yi) {
  editYearIndex.value = yi;
  editItemIndex.value = -1;
  isNewItem.value = true;
  editItem.value = newItem();
  itemDrawer.value = true;
}
function openEditItem(yi, ii) {
  editYearIndex.value = yi;
  editItemIndex.value = ii;
  isNewItem.value = false;
  editItem.value = clone(draft.value.years[yi].items[ii]);
  if (!Array.isArray(editItem.value.schedule)) editItem.value.schedule = [];
  itemDrawer.value = true;
}
function addSchedule() {
  if (!Array.isArray(editItem.value.schedule)) editItem.value.schedule = [];
  editItem.value.schedule.push({ k: '', v: '' });
  markDirty();
}
function removeSchedule(i) { editItem.value.schedule.splice(i, 1); markDirty(); }

function commitItem() {
  const it = editItem.value;
  if (!String(it.key || '').trim()) { ElMessage.warning('请填写项目标识 key'); return; }
  if (!String(it.name || '').trim()) { ElMessage.warning('请填写项目名称'); return; }
  const y = draft.value.years[editYearIndex.value];
  if (!Array.isArray(y.items)) y.items = [];
  if (isNewItem.value) y.items.push(clone(it));
  else y.items[editItemIndex.value] = clone(it);
  itemDrawer.value = false;
  markDirty();
}

/* ---------- 年度编辑 ---------- */
const yearDialog = ref(false);
const yearEditing = ref(null);
const yearForm = ref({ year: new Date().getFullYear() + 1, publishedAt: '', publishedBy: '中国人民银行', sourceUrl: '', sourceText: '' });

function openNewYear() {
  yearEditing.value = null;
  yearForm.value = { year: new Date().getFullYear() + 1, publishedAt: '', publishedBy: '中国人民银行', sourceUrl: '', sourceText: '' };
  yearDialog.value = true;
}
function openEditYear(yi) {
  yearEditing.value = yi;
  const y = draft.value.years[yi];
  yearForm.value = {
    year: y.year, publishedAt: y.publishedAt || '', publishedBy: y.publishedBy || '',
    sourceUrl: y.sourceUrl || '', sourceText: y.sourceText || ''
  };
  yearDialog.value = true;
}
function commitYear() {
  const f = yearForm.value;
  if (!Number.isFinite(Number(f.year))) { ElMessage.warning('年度不合法'); return; }
  if (yearEditing.value === null) {
    if (draft.value.years.some((y) => Number(y.year) === Number(f.year))) {
      ElMessage.warning('这个年度已存在'); return;
    }
    draft.value.years.push({ year: Number(f.year), publishedAt: f.publishedAt, publishedBy: f.publishedBy, sourceUrl: f.sourceUrl, sourceText: f.sourceText, items: [] });
    draft.value.years.sort((a, b) => Number(a.year) - Number(b.year));
  } else {
    Object.assign(draft.value.years[yearEditing.value], {
      publishedAt: f.publishedAt, publishedBy: f.publishedBy,
      sourceUrl: f.sourceUrl, sourceText: f.sourceText
    });
  }
  yearDialog.value = false;
  markDirty();
}

/* ---------- 统一确认 ---------- */
const confirmOpen = ref(false);
const confirmCfg = ref({});
let pendingFn = null;
function askConfirm(cfg, fn) {
  confirmCfg.value = { danger: false, confirmLabel: '确认', effects: [], loading: false, ...cfg };
  pendingFn = fn;
  confirmOpen.value = true;
}
async function doConfirm() {
  if (!pendingFn) return;
  confirmCfg.value = { ...confirmCfg.value, loading: true };
  try {
    const ok = await pendingFn();
    if (ok !== false) confirmOpen.value = false;
  } finally {
    confirmCfg.value = { ...confirmCfg.value, loading: false };
  }
}

function askDeleteItem(yi, ii) {
  const it = draft.value.years[yi].items[ii];
  askConfirm({
    title: '删除发行项目', danger: true, dangerText: '删除后需保存才会写入文件',
    message: `删除「${it.name}」？`, confirmText: it.key, confirmLabel: '删除',
    effects: ['该项目会从发行计划中移除', '保存后 /plan 页面与小程序同步生效']
  }, async () => {
    draft.value.years[yi].items.splice(ii, 1);
    markDirty();
    return true;
  });
}
function askDeleteYear(yi) {
  const y = draft.value.years[yi];
  askConfirm({
    title: '删除年度', danger: true, dangerText: '该年度下所有项目会一并删除',
    message: `删除 ${y.year} 年及其 ${(y.items || []).length} 个项目？`,
    confirmText: String(y.year), confirmLabel: '删除',
    effects: ['保存后 /plan 页面将不再显示该年度']
  }, async () => {
    draft.value.years.splice(yi, 1);
    markDirty();
    return true;
  });
}
function askSave() {
  askConfirm({
    title: '保存发行计划', message: `将 ${yearCount.value} 个年度 / ${itemCount.value} 个项目写入 public/data/plan.json？`,
    effects: ['保存后网站 /plan 与小程序立即使用新数据', '操作会记入审计日志'],
    confirmLabel: '保存'
  }, saveAll);
}
function askReload() {
  if (!dirty.value) { load(); return; }
  askConfirm({
    title: '放弃未保存修改', danger: true, dangerText: '未保存的改动会丢失',
    message: '当前有未保存的修改，确定重新加载吗？', confirmLabel: '放弃并刷新'
  }, async () => { await load(); return true; });
}

async function saveAll() {
  saving.value = true;
  try {
    const r = await planApi.save(draft.value);
    ElMessage.success(`已保存 ${r.years} 个年度 / ${r.items} 个项目`);
    dirty.value = false;
    await load();
    return true;
  } catch (e) {
    ElMessage.error(errorMessage(e));
    return false;
  } finally {
    saving.value = false;
  }
}
</script>

<style scoped>
.pl-year-head { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; margin-bottom: 12px; }
.pl-year-title { display: flex; align-items: baseline; gap: 10px; }
.pl-year-title b { font-size: 16px; color: var(--cl-gold); }
.pl-year-title span { color: var(--cl-dim); font-size: 12px; }
.pl-year-meta { display: flex; gap: 12px; flex-wrap: wrap; color: var(--cl-muted); font-size: 11.5px; }
.pl-year-meta a { color: var(--cl-gold); text-decoration: none; }
.pl-year-foot { margin-top: 12px; }
.pl-sched { display: grid; grid-template-columns: 120px 1fr auto; gap: 8px; margin-bottom: 8px; }
</style>
