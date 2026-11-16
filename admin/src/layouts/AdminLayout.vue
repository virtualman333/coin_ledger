<template>
  <div class="cl-shell">
    <!-- 登录态门禁：管理端与前台共用同一份 Cookie 会话 -->
    <div v-if="gate" class="cl-gate">
      <div class="cl-gate-card cl-card">
        <div class="cl-brand">
          <span class="cl-brand-mark">藏</span>
          <span class="cl-brand-txt"><b>藏币录</b><small>管理控制台</small></span>
        </div>

        <template v-if="gate === 'loading'">
          <p class="cl-empty"><el-icon class="is-loading"><Loading /></el-icon> 正在验证登录态…</p>
        </template>
        <template v-else-if="gate === 'login'">
          <el-empty description="请先在前台登录管理员账号" />
          <el-button type="primary" @click="goLogin">前往登录</el-button>
        </template>
        <template v-else-if="gate === 'denied'">
          <el-empty description="当前账号没有管理员权限" />
          <el-button @click="goFront">返回前台</el-button>
        </template>
        <template v-else>
          <el-empty :description="'加载失败：' + gateMsg" />
          <el-button @click="check">重试</el-button>
        </template>
      </div>
    </div>

    <template v-else>
      <aside class="cl-side" :class="{ 'is-open': sideOpen }">
        <div class="cl-brand">
          <span class="cl-brand-mark">藏</span>
          <span class="cl-brand-txt"><b>藏币录</b><small>管理控制台</small></span>
        </div>
        <div class="cl-nav-wrap">
          <div v-for="g in MENU" :key="g.group" class="cl-group">
            <div class="cl-group-title">{{ g.group }}</div>
            <router-link
              v-for="it in g.items" :key="it.path" :to="it.path"
              class="cl-nav" active-class="is-active" @click="sideOpen = false"
            >
              <el-icon><component :is="it.icon" /></el-icon>
              <span>{{ it.title }}</span>
            </router-link>
          </div>
        </div>
        <div class="cl-side-foot">
          <a href="/">← 返回前台</a>
          <span>v{{ version }}</span>
        </div>
      </aside>

      <div class="cl-main">
        <header class="cl-top">
          <button class="cl-menu-btn" type="button" aria-label="菜单" @click="sideOpen = !sideOpen">☰</button>
          <div class="cl-crumb">{{ currentTitle }}</div>
          <div class="cl-spacer" />
          <el-tag size="small" type="warning" effect="dark">管理员</el-tag>
          <span class="cl-user">{{ me && me.name }}</span>
          <el-button size="small" text @click="goFront">前台</el-button>
        </header>
        <main class="cl-content">
          <router-view />
        </main>
      </div>
      <div v-if="sideOpen" class="cl-mask" @click="sideOpen = false" />
    </template>
  </div>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import { MENU } from '../router';
import { authApi } from '../api/endpoints';
import { errorMessage } from '../api/client';

const route = useRoute();
const gate = ref('loading'); // '' = 已通过
const gateMsg = ref('');
const me = ref(null);
const version = ref('');
const sideOpen = ref(false);

const currentTitle = computed(() => (route.meta && route.meta.title) || '管理控制台');

async function check() {
  gate.value = 'loading';
  gateMsg.value = '';
  try {
    const b = await authApi.bootstrap();
    version.value = b.version || '';
    if (!b.user) { gate.value = 'login'; return; }
    if (!b.isAdmin) { gate.value = 'denied'; return; }
    me.value = b.user;
    gate.value = '';
  } catch (e) {
    gateMsg.value = errorMessage(e);
    gate.value = 'error';
  }
}

function goLogin() { window.location.href = '/account'; }
function goFront() { window.location.href = '/'; }

onMounted(check);
</script>
