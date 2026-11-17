<template>
  <el-drawer v-model="visible" :title="'图片配置 · #' + coin.id + ' ' + coin.name" size="620px">
    <div class="cie-tip">
      每个位置只保留一张图片，重复上传会替换原图；上传前自动压缩到最长边 900px（JPEG）。
      改动会立即写进服务器上的图片文件，并记入操作审计。
    </div>

    <div class="cie-grid">
      <div v-for="k in IMAGE_KINDS" :key="k.key" class="cie-card">
        <div class="cie-head">
          <b>{{ k.label }}</b>
          <el-tag :type="imgOf(k.key) ? 'success' : 'info'" size="small" effect="plain">
            {{ imgOf(k.key) ? '已配置' : '未配置' }}
          </el-tag>
        </div>

        <div class="cie-preview">
          <a v-if="imgOf(k.key)" :href="imageFull(imgOf(k.key).f)" target="_blank" rel="noopener" title="点击看原图">
            <img :src="imagePreview(imgOf(k.key).f, cacheBust)" :alt="k.label" />
          </a>
          <el-empty v-else description="暂无图片" :image-size="44" />
        </div>

        <div class="cie-ops">
          <el-button size="small" type="primary" plain :loading="busyKind === k.key" @click="pick(k.key)">
            {{ imgOf(k.key) ? '替换' : '上传' }}
          </el-button>
          <el-button
            v-if="imgOf(k.key)" size="small" text type="danger"
            :loading="busyKind === k.key" @click="askDelete(k)"
          >删除</el-button>
        </div>
      </div>
    </div>

    <input ref="fileInput" type="file" accept="image/*" hidden @change="onFile" />

    <ConfirmDialog
      v-model="confirmOpen" title="删除图片" :danger="true"
      danger-text="服务器上的图片文件会一并删除"
      :message="`确认删除 #${coin.id} 的「${pending ? pending.label : ''}」？`"
      :effects="['删除后该位置将显示占位图', '操作会记入审计日志']"
      :loading="deleting" @confirm="doDelete"
    />
  </el-drawer>
</template>

<script setup>
import { computed, ref } from 'vue';
import { ElMessage } from 'element-plus';
import ConfirmDialog from './ConfirmDialog.vue';
import { imagesApi } from '../api/endpoints';
import { errorMessage } from '../api/client';
import { compressImage, makeThumbnail, imageFull, imagePreview, IMAGE_KINDS } from '../utils/image';

const props = defineProps({
  modelValue: { type: Boolean, default: false },
  coin: { type: Object, required: true },        // { id, name }
  images: { type: Array, default: () => [] }     // 当前品种的 gallery 列表 [{f,k}]
});
const emit = defineEmits(['update:modelValue', 'changed']);

const visible = computed({
  get: () => props.modelValue,
  set: (v) => emit('update:modelValue', v)
});

const fileInput = ref(null);
const busyKind = ref('');
const deleting = ref(false);
const confirmOpen = ref(false);
const pending = ref(null);
const cacheBust = ref(Date.now());
let pendingKind = 'main';

function imgOf(kind) {
  return props.images.find((x) => x.k === kind) || null;
}

function pick(kind) {
  pendingKind = kind;
  if (fileInput.value) {
    fileInput.value.value = '';
    fileInput.value.click();
  }
}

async function onFile(e) {
  const file = e.target.files && e.target.files[0];
  if (!file) return;
  const kind = pendingKind;
  busyKind.value = kind;
  try {
    const data = await compressImage(file);
    const body = { id: props.coin.id, kind, data };
    // 主图额外生成两种预生成缩略图（站点列表卡片与小图都读这两个文件）
    if (kind === 'main') {
      const [big, small] = await Promise.all([
        makeThumbnail(file, 480),
        makeThumbnail(file, 160),
      ]);
      body.thumb480 = big;
      body.thumb160 = small;
    }
    await imagesApi.upload(body);
    ElMessage.success(kind === 'main' ? '主图已上传，缩略图已同步生成' : '图片已上传');
    cacheBust.value = Date.now();
    emit('changed');
  } catch (err) {
    ElMessage.error(errorMessage(err));
  } finally {
    busyKind.value = '';
  }
}

function askDelete(kind) { pending.value = kind; confirmOpen.value = true; }

async function doDelete() {
  if (!pending.value) return;
  deleting.value = true;
  try {
    await imagesApi.remove(props.coin.id, pending.value.key);
    ElMessage.success('已删除');
    confirmOpen.value = false;
    cacheBust.value = Date.now();
    emit('changed');
  } catch (e) {
    ElMessage.error(errorMessage(e));
  } finally {
    deleting.value = false;
  }
}
</script>

<style scoped>
.cie-tip {
  margin-bottom: 16px; padding: 10px 12px; border-radius: 8px;
  background: rgba(232, 200, 119, .07); border: 1px solid rgba(232, 200, 119, .18);
  color: var(--cl-muted); font-size: 12px; line-height: 1.7;
}
.cie-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; }
.cie-card { border: 1px solid var(--cl-line-2); border-radius: 10px; overflow: hidden; background: #0f141b; }
.cie-head {
  display: flex; align-items: center; justify-content: space-between;
  padding: 9px 12px; border-bottom: 1px solid var(--cl-line-2); font-size: 13px;
}
.cie-preview { height: 180px; display: grid; place-items: center; }
.cie-preview a { display: block; width: 100%; height: 100%; }
.cie-preview img { width: 100%; height: 100%; object-fit: contain; }
.cie-ops { display: flex; gap: 6px; padding: 8px 10px; border-top: 1px solid var(--cl-line-2); }
@media (max-width: 560px) { .cie-grid { grid-template-columns: 1fr; } }
</style>
