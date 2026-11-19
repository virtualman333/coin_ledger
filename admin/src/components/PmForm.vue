<template>
  <el-dialog
    :model-value="modelValue"
    :title="isNew ? '新建贵金属套' : '编辑贵金属套 · no=' + form.no"
    width="900px"
    top="4vh"
    destroy-on-close
    @update:model-value="$emit('update:modelValue', $event)"
  >
    <div v-if="errors.length" class="pm-errors">
      <b>有 {{ errors.length }} 处需要修改：</b>
      <ul><li v-for="(e, i) in errors" :key="i">{{ e.field || '字段' }}：{{ e.error }}</li></ul>
    </div>

    <el-form :model="form" label-width="110px" size="small">
      <el-divider content-position="left">基本（no 不可编辑）</el-divider>
      <el-row :gutter="12">
        <el-col :span="6"><el-form-item label="编号"><el-input :model-value="form.no || '自动分配'" disabled /></el-form-item></el-col>
        <el-col :span="6"><el-form-item label="年份"><el-input v-model.number="form.year" /></el-form-item></el-col>
        <el-col :span="12"><el-form-item label="套名称"><el-input v-model="form.name" maxlength="128" /></el-form-item></el-col>
      </el-row>
      <el-row :gutter="12">
        <el-col :span="8"><el-form-item label="系列"><el-input v-model="form.series" /></el-form-item></el-col>
        <el-col :span="8"><el-form-item label="材质"><el-input v-model="form.material" /></el-form-item></el-col>
        <el-col :span="8">
          <el-form-item label="套内材质">
            <el-select v-model="form.metal" style="width:100%">
              <el-option v-for="m in METALS" :key="m.value" :label="m.label" :value="m.value" />
            </el-select>
          </el-form-item>
        </el-col>
      </el-row>

      <el-divider content-position="left">规格（A2：套装套级克重留空，用总克重）</el-divider>
      <el-row :gutter="12">
        <el-col :span="6"><el-form-item label="成色"><el-input v-model.number="form.purity" placeholder="0.999" /></el-form-item></el-col>
        <el-col :span="6"><el-form-item label="是否成套"><el-switch v-model="form.is_set" /></el-form-item></el-col>
        <el-col :span="6"><el-form-item label="套内枚数"><el-input v-model.number="form.set_pieces" /></el-form-item></el-col>
        <el-col :span="6"><el-form-item label="总克重(g)"><el-input v-model.number="form.set_weight_g" /></el-form-item></el-col>
      </el-row>
      <el-form-item label="套级克重">
        <el-input :model-value="form.is_set ? '留空（用总克重）' : '单枚克重'" disabled />
        <span class="pm-hint">A2：is_set=1 时 weight_g 必须为空</span>
      </el-form-item>

      <el-divider content-position="left">发行（A3：套级发行量恒空，逐枚以「枚」计）</el-divider>
      <el-row :gutter="12">
        <el-col :span="6"><el-form-item label="整套面额"><el-input v-model.number="form.face" /></el-form-item></el-col>
        <el-col :span="6"><el-form-item label="套级发行量"><el-input model-value="NULL（固定）" disabled /></el-form-item></el-col>
        <el-col :span="12"><el-form-item label="发行量说明"><el-input v-model="form.mintage_note" /></el-form-item></el-col>
      </el-row>
      <el-row :gutter="12">
        <el-col :span="8"><el-form-item label="发行方式">
          <el-select v-model="form.issue_method" style="width:100%">
            <el-option v-for="m in METHODS" :key="m.value" :label="m.label" :value="m.value" />
          </el-select>
        </el-form-item></el-col>
        <el-col :span="8"><el-form-item label="发行日期"><el-input v-model="form.issue_date" placeholder="YYYY-MM-DD" /></el-form-item></el-col>
        <el-col :span="8"><el-form-item label="销售渠道"><el-input v-model="form.sales_channel" /></el-form-item></el-col>
      </el-row>

      <el-divider content-position="left">图案与来源</el-divider>
      <el-row :gutter="12">
        <el-col :span="12"><el-form-item label="正面图案"><el-input v-model="form.obverse" /></el-form-item></el-col>
        <el-col :span="12"><el-form-item label="背面图案"><el-input v-model="form.reverse" /></el-form-item></el-col>
      </el-row>
      <el-form-item label="公告链接"><el-input v-model="form.source_url" placeholder="https://" /></el-form-item>
      <el-row :gutter="12">
        <el-col :span="12"><el-form-item label="来源说明"><el-input v-model="form.source_text" /></el-form-item></el-col>
        <el-col :span="6"><el-form-item label="公告日期"><el-input v-model="form.source_date" placeholder="YYYY-MM-DD" /></el-form-item></el-col>
        <el-col :span="6"><el-form-item label="已核验"><el-switch v-model="form.verified" /></el-form-item></el-col>
      </el-row>

      <el-divider content-position="left">套内规格（发行量单位固定为「枚」）</el-divider>
      <el-table :data="form.pieces" size="small" border>
        <el-table-column label="#" width="50"><template #default="{ row }"><el-input v-model.number="row.seq" /></template></el-table-column>
        <el-table-column label="名称" min-width="150"><template #default="{ row }"><el-input v-model="row.name" /></template></el-table-column>
        <el-table-column label="材质" width="105">
          <template #default="{ row }"><el-select v-model="row.metal" style="width:100%">
            <el-option v-for="m in PIECE_METALS" :key="m.value" :label="m.label" :value="m.value" />
          </el-select></template>
        </el-table-column>
        <el-table-column label="克重" width="80"><template #default="{ row }"><el-input v-model.number="row.weight_g" /></template></el-table-column>
        <el-table-column label="面额" width="80"><template #default="{ row }"><el-input v-model.number="row.face" /></template></el-table-column>
        <el-table-column label="发行量(枚)" width="110"><template #default="{ row }"><el-input v-model.number="row.max_mintage" /></template></el-table-column>
        <el-table-column label="尺寸" width="120"><template #default="{ row }"><el-input v-model="row.size_text" /></template></el-table-column>
        <el-table-column label="操作" width="70">
          <template #default="{ $index }"><el-button link type="danger" @click="form.pieces.splice($index, 1)">删除</el-button></template>
        </el-table-column>
      </el-table>
      <el-button size="small" style="margin-top:8px" @click="addPiece">＋ 添加规格</el-button>
      <div class="pm-hint">
        当前明细：{{ form.pieces.length }} 行 / {{ sumWeight }} 克 / {{ sumFace }} 元（须与套级字段一致）
      </div>
    </el-form>

    <template #footer>
      <el-button @click="$emit('update:modelValue', false)">取消</el-button>
      <el-button type="primary" :loading="saving" @click="save">保存草稿</el-button>
    </template>
  </el-dialog>
</template>

<script setup>
import { computed, reactive, ref, watch } from 'vue';
import { ElMessage } from 'element-plus';
import { pmApi } from '../api/endpoints';
import { errorMessage } from '../api/client';

const props = defineProps({
  modelValue: { type: Boolean, default: false },
  row: { type: Object, default: null }
});
const emit = defineEmits(['update:modelValue', 'saved']);

const METALS = [
  { value: 'gold', label: '金' }, { value: 'silver', label: '银' },
  { value: 'platinum', label: '铂' }, { value: 'bimetal', label: '双金属' },
  { value: 'mixed', label: '多种材质（套）' }
];
const PIECE_METALS = METALS.slice(0, 4);
const METHODS = [
  { value: 'reservation', label: '预约' }, { value: 'lottery', label: '抽签' },
  { value: 'direct_sale', label: '直销' }, { value: 'unknown', label: '未知' }
];

const empty = () => ({
  no: null, year: 2026, name: '', series: 'PM', material: '', metal: 'mixed', purity: 0.999,
  is_set: true, set_pieces: 0, set_weight_g: null, weight_g: null,
  face: 0, mintage_note: '', issue_method: 'unknown', issue_date: '', sales_channel: '',
  dealer: '', obverse: '', reverse: '', caster: '', packaging: '', certificate: '',
  source_url: '', source_text: '', source_date: '', verified: false, shape: null,
  quality: null, pieces: []
});
const form = reactive(empty());
const errors = ref([]);
const saving = ref(false);
const isNew = computed(() => !form.no);

watch(() => props.row, (row) => {
  Object.assign(form, empty(), row ? JSON.parse(JSON.stringify(row)) : {});
  form.verified = !!form.verified;
  form.is_set = !!form.is_set;
  errors.value = [];
}, { immediate: true });

const sumWeight = computed(() => form.pieces.reduce((a, p) => a + (Number(p.weight_g) || 0), 0));
const sumFace = computed(() => form.pieces.reduce((a, p) => a + (Number(p.face) || 0), 0));

function addPiece() {
  form.pieces.push({ seq: form.pieces.length + 1, name: '', metal: 'gold', weight_g: 0, purity: 0.999, face: 0, max_mintage: 0, shape: 'round', size_text: '', quality: 'uncirculated' });
}

async function save() {
  saving.value = true;
  errors.value = [];
  try {
    const body = JSON.parse(JSON.stringify(form));
    body.verified = body.verified ? 1 : 0;
    body.is_set = body.is_set ? 1 : 0;
    body.weight_g = null;                  // A2：套级恒 NULL
    body.mintage = null;                   // A3：套级恒 NULL
    const r = isNew.value ? await pmApi.create(body) : await pmApi.update(body.no, body);
    if (!r.ok) {
      errors.value = [{ field: r.field, error: r.error }];
      ElMessage.error(r.error || '保存失败');
      return;
    }
    ElMessage.success('已保存草稿');
    emit('saved');
    emit('update:modelValue', false);
  } catch (e) {
    errors.value = (e.payload && e.payload.field)
      ? [{ field: e.payload.field, error: errorMessage(e) }]
      : [{ field: '', error: errorMessage(e) }];
  } finally {
    saving.value = false;
  }
}
</script>

<style scoped>
.pm-hint { color: #8a8a8a; font-size: 12px; margin-top: 6px; }
.pm-errors { background: #fff3f3; border: 1px solid #ffc9c9; padding: 10px 14px; border-radius: 6px; margin-bottom: 12px; color: #a12d2d; font-size: 13px; }
.pm-errors ul { margin: 4px 0 0 18px; }
</style>
