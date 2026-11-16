<template>
  <el-dialog
    :model-value="modelValue" :title="title" width="460px"
    align-center destroy-on-close @update:model-value="close"
  >
    <div v-if="danger" class="cf-alert">
      <el-alert type="error" :closable="false" show-icon :title="dangerText" />
    </div>
    <p class="cf-msg">{{ message }}</p>
    <ul v-if="effects && effects.length" class="cf-effects">
      <li v-for="(e, i) in effects" :key="i">{{ e }}</li>
    </ul>
    <el-input
      v-if="confirmText" v-model="typed"
      :placeholder="'请输入「' + confirmText + '」以确认'"
      autocomplete="off" data-form-type="other"
    />
    <template #footer>
      <el-button @click="close">取消</el-button>
      <el-button
        type="danger" :loading="loading"
        :disabled="!!confirmText && typed !== confirmText"
        @click="$emit('confirm')"
      >{{ confirmLabel }}</el-button>
    </template>
  </el-dialog>
</template>

<script setup>
import { ref, watch } from 'vue';

const props = defineProps({
  modelValue: { type: Boolean, default: false },
  title: { type: String, default: '确认操作' },
  message: { type: String, default: '' },
  danger: { type: Boolean, default: false },
  dangerText: { type: String, default: '此操作不可撤销' },
  effects: { type: Array, default: () => [] },
  confirmText: { type: String, default: '' },
  confirmLabel: { type: String, default: '确认' },
  loading: { type: Boolean, default: false }
});
const emit = defineEmits(['update:modelValue', 'confirm']);
const typed = ref('');

function close() { emit('update:modelValue', false); }
watch(() => props.modelValue, (v) => { if (v) typed.value = ''; });
</script>

<style scoped>
.cf-alert { margin-bottom: 14px; }
.cf-msg { color: var(--cl-text); line-height: 1.7; margin: 0 0 10px; }
.cf-effects {
  margin: 0 0 14px; padding-left: 20px; color: var(--cl-muted);
  font-size: 12.5px; line-height: 1.9;
}
.cf-effects + .el-input { margin-top: 4px; }
</style>
