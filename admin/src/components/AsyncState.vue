<template>
  <div v-if="loading" class="cl-st cl-loading">
    <el-icon class="is-loading"><Loading /></el-icon>
    <span>加载中…</span>
  </div>
  <div v-else-if="error" class="cl-st">
    <el-alert type="error" :closable="false" show-icon :title="error">
      <template #default>
        <el-button size="small" @click="$emit('retry')">重试</el-button>
      </template>
    </el-alert>
  </div>
  <template v-else>
    <slot />
  </template>
</template>

<script setup>
defineProps({
  loading: { type: Boolean, default: false },
  error: { type: String, default: '' }
});
defineEmits(['retry']);
</script>

<style scoped>
.cl-st { padding: 24px 0; }
.cl-loading {
  display: flex; align-items: center; justify-content: center; gap: 8px;
  color: var(--cl-muted); font-size: 13px;
}
</style>
