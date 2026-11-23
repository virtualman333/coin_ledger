<template>
  <section class="st-page">
    <PageHeader title="维护状态" desc="一键收敛小程序里的收藏账本功能，用于功能调整或审核期间；网站不受影响。" />

    <AsyncState :loading="loading" :error="error" @retry="load">
      <div class="cl-card st-card">
        <div class="st-row">
          <div class="st-txt">
            <div class="st-name">
              维护状态
              <el-tag :type="on ? 'warning' : 'success'" size="small" effect="plain">
                {{ on ? '已开启' : '已关闭' }}
              </el-tag>
            </div>
            <p class="st-desc">
              开启后，小程序会隐藏：首页账本卡、我的页账本与最近添加、「加入我的收藏」按钮、
              我的收藏页、收藏备份入口与页面。
              图鉴、发行计划、拍照数币、账户与反馈照常使用。
            </p>
          </div>
          <el-switch v-model="on" :loading="saving" @change="save" />
        </div>

        <div class="st-note">
          <b>注意</b>
          <ul>
            <li>这是真实生效的全局开关，开启后<b>所有用户</b>立即受影响，不是预览。</li>
            <li>小程序有 60 秒缓存，用户重新进入小程序后生效；无需重新发版。</li>
            <li>关闭后功能原样恢复，账本数据不会被删除或修改。</li>
            <li>操作会记入「操作审计」，记录操作人与开关状态。</li>
          </ul>
        </div>

        <div class="st-foot">
          <span class="cl-mono">{{ savedAt ? '上次保存：' + savedAt : '' }}</span>
          <el-button size="small" :loading="loading" @click="load">重新读取</el-button>
        </div>
      </div>
    </AsyncState>
  </section>
</template>

<script setup>
import { onMounted, ref } from 'vue';
import { ElMessage } from 'element-plus';
import PageHeader from '../components/PageHeader.vue';
import AsyncState from '../components/AsyncState.vue';
import { appConfigApi } from '../api/endpoints';
import { errorMessage } from '../api/client';

const loading = ref(false);
const saving = ref(false);
const error = ref('');
const on = ref(false);
const savedAt = ref('');

async function load() {
  loading.value = true;
  error.value = '';
  try {
    const r = await appConfigApi.get();
    on.value = !!r.maintenance;
  } catch (e) {
    error.value = errorMessage(e);
  } finally {
    loading.value = false;
  }
}

async function save(val) {
  saving.value = true;
  try {
    const r = await appConfigApi.setMaintenance(!!val);
    on.value = !!r.maintenance;
    savedAt.value = new Date().toLocaleTimeString('zh-CN', { hour12: false });
    ElMessage.success(on.value ? '已开启维护状态' : '已关闭维护状态');
  } catch (e) {
    on.value = !val;               // 失败回滚开关，别让界面撒谎
    ElMessage.error(errorMessage(e));
  } finally {
    saving.value = false;
  }
}

onMounted(load);
</script>

<style scoped>
.st-card { max-width: 760px; }
.st-row { display: flex; gap: 24px; align-items: flex-start; justify-content: space-between; }
.st-name { font-size: 16px; font-weight: 600; display: flex; align-items: center; gap: 8px; }
.st-desc { margin: 10px 0 0; color: var(--el-text-color-regular); font-size: 13px; line-height: 1.8; }
.st-note {
  margin-top: 20px; padding: 14px 16px; border-radius: 10px;
  background: var(--el-fill-color-light); font-size: 12.5px; line-height: 1.9;
  color: var(--el-text-color-regular);
}
.st-note b { color: var(--el-text-color-primary); }
.st-note ul { margin: 6px 0 0; padding-left: 18px; }
.st-foot { margin-top: 16px; display: flex; align-items: center; justify-content: space-between; }
</style>
