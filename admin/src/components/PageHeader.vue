<template>
  <div class="cl-page-head">
    <div>
      <h1>{{ title }}</h1>
      <p v-if="desc">{{ desc }}</p>
    </div>
    <div class="cl-spacer" />
    <slot name="actions" />
  </div>
</template>

<script setup>
defineProps({
  title: { type: String, required: true },
  desc: { type: String, default: '' }
});
</script>
