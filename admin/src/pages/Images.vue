<template>
  <section>
    <PageHeader title="图片管理" desc="按品种维护主图、正反面与图集；上传前自动压缩，删除需二次确认。">
      <template #actions>
        <el-button :loading="loading" @click="load">刷新</el-button>
      </template>
    </PageHeader>

    <div class="cl-stat-grid">
      <div class="cl-stat"><b>{{ coins.length }}</b><span>品种总数</span></div>
      <div class="cl-stat"><b>{{ withMain }}</b><span>有主图</span></div>
      <div class="cl-stat"><b>{{ coins.length - withMain }}</b><span>缺主图</span></div>
      <div class="cl-stat"><b>{{ withoutSet }}</b><span>缺正反面</span></div>
    </div>

    <AsyncState :loading="loading && !coins.length" :error="error" @retry="load">
      <div class="im-layout">
        <!-- 左：品种选择 -->
        <div class="cl-card im-side">
          <el-input v-model="kw" placeholder="搜索名称 / 编号" clearable size="small">
            <template #prefix><el-icon><Search /></el-icon></template>
          </el-input>
          <div class="im-list">
            <button
              v-for="c in filtered" :key="c.id" type="button"
              class="im-item" :class="{ on: c.id === currentId }" @click="currentId = c.id"
            >
              <img :src="thumb(c.id)" loading="lazy" alt="" @error="onImgError" />
              <span class="im-item-txt">
                <b>#{{ c.id }} {{ c.name }}</b>
                <small>{{ c.year }} · {{ (gallery[String(c.id)] || []).length }} 张图</small>
              </span>
            </button>
            <div v-if="!filtered.length" class="cl-empty">没有匹配的品种</div>
          </div>
        </div>

        <!-- 右：图集 -->
        <div class="cl-card im-main">
          <div class="im-head">
            <div>
              <h2>{{ current ? '#' + current.id + '　' + current.name : '请从左侧选择品种' }}</h2>
              <p class="cl-mono">当前 {{ images.length }} 张图</p>
            </div>
            <div class="cl-spacer" />
            <el-select v-model="uploadKind" size="small" style="width:120px">
              <el-option v-for="(label, k) in KINDS" :key="k" :label="label" :value="k" />
            </el-select>
            <input ref="fileInput" type="file" accept="image/*" hidden @change="onFile" />
            <el-button type="primary" size="small" :loading="uploading" :disabled="!currentId" @click="pickFile">
              上传替换
            </el-button>
          </div>

          <div v-if="images.length" class="im-grid">
            <figure v-for="it in images" :key="it.k" class="im-card">
              <a :href="full(it.f)" target="_blank" rel="noopener">
                <img :src="preview(it)" loading="lazy" :alt="KINDS[it.k] || it.k" />
              </a>
              <figcaption>
                <span>{{ KINDS[it.k] || it.k }}</span>
                <el-button size="small" text type="danger" @click="askDelete(it)">删除</el-button>
              </figcaption>
            </figure>
          </div>
          <el-empty v-else description="这个品种还没有图片，用右上角「上传替换」补一张" :image-size="80" />
        </div>
      </div>
    </AsyncState>

    <ConfirmDialog
      v-model="confirmOpen" title="删除图片" :danger="true" danger-text="服务器上的图片文件会一并删除"
      :message="`确认删除 #${currentId} 的「${pending && KINDS[pending.k]}」？`"
      :effects="['删除后该品种对应位置将显示占位图', '操作会记入审计日志']"
      :loading="deleting" @confirm="doDelete"
    />
  </section>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue';
import { ElMessage } from 'element-plus';
import PageHeader from '../components/PageHeader.vue';
import AsyncState from '../components/AsyncState.vue';
import ConfirmDialog from '../components/ConfirmDialog.vue';
import { imagesApi } from '../api/endpoints';
import { errorMessage } from '../api/client';
import { compressImage } from '../utils/image';

const KINDS = { main: '主图', obverse: '正面', reverse: '背面', set: '正反面' };

const coins = ref([]);
const gallery = ref({});
const loading = ref(false);
const error = ref('');
const kw = ref('');
const currentId = ref(1);
const uploadKind = ref('main');
const uploading = ref(false);
const deleting = ref(false);
const fileInput = ref(null);
const confirmOpen = ref(false);
const pending = ref(null);

const filtered = computed(() => {
  const q = kw.value.trim().toLowerCase();
  if (!q) return coins.value;
  return coins.value.filter((c) =>
    String(c.name).toLowerCase().includes(q) || String(c.id) === q);
});
const current = computed(() => coins.value.filter((c) => c.id === currentId.value)[0] || null);
const images = computed(() => (gallery.value[String(currentId.value)] || []).slice()
  .sort((a, b) => Object.keys(KINDS).indexOf(a.k) - Object.keys(KINDS).indexOf(b.k)));
const withMain = computed(() => coins.value.filter((c) =>
  (gallery.value[String(c.id)] || []).some((x) => x.k === 'main')).length);
const withoutSet = computed(() => coins.value.filter((c) =>
  !(gallery.value[String(c.id)] || []).some((x) => x.k === 'set')).length);

function pad3(n) { return String(n).padStart(3, '0'); }
function thumb(id) { return '/img/th/s/' + pad3(id) + '.jpg'; }
function full(f) { return '/img/' + f; }
function preview(it) {
  return /^\d{3}\.jpg$/.test(it.f) ? '/img/th/' + pad3(Number(it.f.slice(0, 3))) + '.jpg' : full(it.f);
}
function onImgError(e) { e.target.style.visibility = 'hidden'; }

async function load() {
  loading.value = true;
  error.value = '';
  try {
    const r = await imagesApi.all();
    coins.value = (r.coins || []).map((c) => ({ ...c, id: Number(c.i) + 1 }));
    gallery.value = r.gallery || {};
    if (!coins.value.some((c) => c.id === currentId.value)) currentId.value = coins.value[0]?.id || 1;
  } catch (e) {
    error.value = errorMessage(e);
  } finally {
    loading.value = false;
  }
}
onMounted(load);

function pickFile() {
  if (fileInput.value) { fileInput.value.value = ''; fileInput.value.click(); }
}

async function onFile(e) {
  const file = e.target.files && e.target.files[0];
  if (!file || !currentId.value) return;
  uploading.value = true;
  try {
    const data = await compressImage(file);
    await imagesApi.upload({ id: currentId.value, kind: uploadKind.value, data });
    ElMessage.success('图片已上传');
    await load();
  } catch (err) {
    ElMessage.error(errorMessage(err));
  } finally {
    uploading.value = false;
  }
}

function askDelete(it) { pending.value = it; confirmOpen.value = true; }

async function doDelete() {
  if (!pending.value) return;
  deleting.value = true;
  try {
    await imagesApi.remove(currentId.value, pending.value.k);
    ElMessage.success('已删除');
    confirmOpen.value = false;
    await load();
  } catch (e) {
    ElMessage.error(errorMessage(e));
  } finally {
    deleting.value = false;
  }
}
</script>

<style scoped>
.im-layout { display: grid; grid-template-columns: 260px minmax(0, 1fr); gap: 16px; align-items: start; }
.im-side { padding: 12px; }
.im-list { margin-top: 10px; max-height: 620px; overflow-y: auto; }
.im-item {
  display: flex; align-items: center; gap: 9px; width: 100%;
  padding: 7px 8px; border: none; border-radius: 8px;
  background: transparent; color: var(--cl-text); text-align: left; cursor: pointer;
}
.im-item:hover { background: rgba(255, 255, 255, .045); }
.im-item.on { background: rgba(232, 200, 119, .12); box-shadow: inset 2px 0 0 var(--cl-gold); }
.im-item img { width: 34px; height: 34px; object-fit: cover; border-radius: 6px; flex: 0 0 34px; background: #0f141b; }
.im-item-txt { min-width: 0; display: flex; flex-direction: column; }
.im-item-txt b { font-size: 12.5px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.im-item-txt small { color: var(--cl-dim); font-size: 11px; margin-top: 2px; }
.im-head { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-bottom: 16px; }
.im-head h2 { font-size: 15px; margin: 0 0 3px; }
.im-head p { color: var(--cl-dim); font-size: 11.5px; margin: 0; }
.im-head .cl-spacer { flex: 1; }
.im-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(170px, 1fr)); gap: 14px; }
.im-card { margin: 0; border: 1px solid var(--cl-line-2); border-radius: 10px; overflow: hidden; background: #0f141b; }
.im-card a { display: block; height: 170px; }
.im-card img { width: 100%; height: 100%; object-fit: contain; }
.im-card figcaption { display: flex; align-items: center; justify-content: space-between; padding: 6px 10px; font-size: 12px; color: var(--cl-muted); }
@media (max-width: 860px) { .im-layout { grid-template-columns: 1fr; } .im-list { max-height: 240px; } }
</style>
