<template>
  <section>
    <PageHeader title="访客分析" desc="按来源与会话查看访问趋势、页面留存；点任意一行查看完整访问明细。">
      <template #actions>
        <el-button :loading="loading" @click="load">刷新</el-button>
      </template>
    </PageHeader>

    <div class="cl-toolbar">
      <el-radio-group v-model="range" size="small" @change="onFilterChange">
        <el-radio-button value="today">今日</el-radio-button>
        <el-radio-button value="week">本周</el-radio-button>
        <el-radio-button value="month">本月</el-radio-button>
        <el-radio-button value="year">本年</el-radio-button>
        <el-radio-button value="all">全部</el-radio-button>
      </el-radio-group>
      <span class="cl-mono vs-range">{{ rangeHint }}</span>
      <span class="cl-mono vs-live" v-if="lastUpdated">更新于 {{ lastUpdated }} · 每 30 秒自动刷新</span>
      <div class="cl-spacer" />
      <el-radio-group v-model="client" size="small" @change="onFilterChange">
        <el-radio-button value="all">全部来源</el-radio-button>
        <el-radio-button value="web">网页</el-radio-button>
        <el-radio-button value="mp">小程序</el-radio-button>
      </el-radio-group>
      <el-radio-group v-model="viewMode" size="small" @change="onFilterChange">
        <el-radio-button value="ip">按 IP 聚合</el-radio-button>
        <el-radio-button value="session">按会话</el-radio-button>
      </el-radio-group>
    </div>

    <AsyncState :loading="loading && !data.daily" :error="error" @retry="load">
      <div class="cl-stat-grid">
        <div class="cl-stat"><b>{{ data.rangePv ?? 0 }}</b><span>{{ rangeLabel }} PV</span></div>
        <div class="cl-stat"><b>{{ data.rangeUv ?? 0 }}</b><span>{{ rangeLabel }}独立 IP</span></div>
        <div class="cl-stat" v-if="range !== 'today'"><b>{{ data.todayPv ?? 0 }}</b><span>今日 PV</span></div>
        <div class="cl-stat" v-if="range !== 'today'"><b>{{ data.todayUv ?? 0 }}</b><span>今日独立 IP</span></div>
        <div class="cl-stat"><b>{{ data.allPv ?? 0 }}</b><span>累计 PV</span></div>
        <div class="cl-stat"><b>{{ data.allUv ?? 0 }}</b><span>累计独立 IP</span></div>
        <div class="cl-stat"><b>{{ data.avgPages ?? 0 }}</b><span>平均每会话页</span></div>
      </div>

      <div class="vs-cols">
        <div class="cl-card">
          <h3 class="vs-h3">{{ trendTitle }}</h3>
          <div class="cl-mono vs-source">网页 {{ byClient.web.pv }} 次 / {{ byClient.web.uv }} IP · 小程序 {{ byClient.mp.pv }} 次 / {{ byClient.mp.uv }} IP</div>
          <div v-if="daily.length" class="vs-trend">
            <div v-for="d in daily" :key="d.date" class="vs-day">
              <span class="cl-mono">{{ d.label || String(d.date).slice(5) }}</span>
              <div class="vs-bar"><i :style="{ width: barWidth(d.pv) + '%' }" /></div>
              <b>{{ d.pv }}</b>
              <small>{{ d.uv }} IP</small>
            </div>
          </div>
          <el-empty v-else description="暂无数据" :image-size="60" />
        </div>

        <div v-if="client !== 'web'" class="cl-card">
          <h3 class="vs-h3">小程序页面留存 · {{ rangeLabel }}</h3>
          <el-table v-if="retention.length" :data="retention" size="small" max-height="260">
            <el-table-column label="页面" min-width="100">
              <template #default="{ row }">{{ tabName(row.tab) }}</template>
            </el-table-column>
            <el-table-column prop="pv" label="访问" width="70" align="right" />
            <el-table-column prop="sessions" label="会话" width="70" align="right" />
            <el-table-column label="继续浏览" min-width="120">
              <template #default="{ row }">
                <div class="vs-pbar"><i :style="{ width: row.keepRate + '%' }" /></div>
                <span class="cl-mono">{{ row.keepRate }}%</span>
              </template>
            </el-table-column>
            <el-table-column label="次日回访" min-width="120">
              <template #default="{ row }">
                <div class="vs-pbar"><i :style="{ width: row.nextRate + '%' }" /></div>
                <span class="cl-mono">{{ row.nextRate }}%</span>
              </template>
            </el-table-column>
          </el-table>
          <el-empty v-else description="还没有小程序访问数据" :image-size="60" />
        </div>
      </div>

      <div class="cl-card">
        <div class="cl-toolbar">
          <h3 class="vs-h3">{{ viewMode === 'ip' ? 'IP 聚合' : '会话列表' }}</h3>
          <div class="cl-spacer" />
          <span class="cl-mono">共 {{ total }} 条</span>
        </div>
        <el-table :data="rows" v-loading="loading" stripe size="small" @row-click="openDetail" class="vs-clickable">
          <el-table-column label="最后访问" width="150">
            <template #default="{ row }"><span class="cl-mono">{{ fmt(row.last) }}</span></template>
          </el-table-column>
          <el-table-column label="访客" min-width="150">
            <template #default="{ row }">
              <b>{{ row.name || (viewMode === 'ip' ? '访客' : '未登录') }}</b>
              <el-tag size="small" :type="isMp(row) ? 'warning' : 'info'" effect="plain" style="margin-left:8px">
                {{ sourceText(row) }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column label="设备" width="80">
            <template #default="{ row }">{{ device(row.ua) }}</template>
          </el-table-column>
          <el-table-column v-if="viewMode === 'ip'" label="访问概览" min-width="220">
            <template #default="{ row }">
              <b>{{ row.pv }}</b> 次 · {{ row.sessionCount }} 会话 · {{ row.pageCount }} 页 · {{ row.days }} 天
            </template>
          </el-table-column>
          <el-table-column v-else label="浏览页面" min-width="220">
            <template #default="{ row }">
              <b>{{ row.pageCount }}</b> 页 · {{ (row.pages || []).map(tabName).join(' / ') }}
            </template>
          </el-table-column>
          <el-table-column label="IP" width="150">
            <template #default="{ row }"><span class="cl-mono">{{ row.ip || '—' }}</span></template>
          </el-table-column>
        </el-table>
        <el-pagination
          layout="total, sizes, prev, pager, next, jumper"
          :current-page="page" :page-size="size" :total="total"
          @current-change="(p) => page = p" @size-change="(s) => { size = s; page = 1 }"
        />
      </div>
    </AsyncState>

    <el-drawer v-model="drawer" :title="'访问明细 · ' + detailLabel" size="620px">
      <div v-loading="detailLoading">
        <div class="cl-stat-grid">
          <div class="cl-stat"><b>{{ detailTotal }}</b><span>访问次数</span></div>
          <div class="cl-stat"><b>{{ distinct('sid') }}</b><span>会话数</span></div>
          <div class="cl-stat"><b>{{ distinct('tab') }}</b><span>页面数</span></div>
        </div>
        <el-table :data="detailRows" size="small" max-height="520">
          <el-table-column label="时间" width="150">
            <template #default="{ row }"><span class="cl-mono">{{ fmt(row.at || row.time || row.ts) }}</span></template>
          </el-table-column>
          <el-table-column label="页面" min-width="110">
            <template #default="{ row }">{{ tabName(row.tab) }}</template>
          </el-table-column>
          <el-table-column label="来源" width="90">
            <template #default="{ row }">{{ row.client === 'mp' ? '小程序' : '网页' }}</template>
          </el-table-column>
          <el-table-column label="IP" width="140">
            <template #default="{ row }"><span class="cl-mono">{{ row.ip || '—' }}</span></template>
          </el-table-column>
        </el-table>
      </div>
    </el-drawer>
  </section>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { ElMessage } from 'element-plus';
import PageHeader from '../components/PageHeader.vue';
import AsyncState from '../components/AsyncState.vue';
import { visitorsApi } from '../api/endpoints';
import { errorMessage } from '../api/client';

const TABS = {
  home: '首页', all: '全套清单', plan: '发行计划', series: '系列', holdings: '我的藏品',
  mine: '我的', detail: '品种详情', account: '账户', about: '关于', more: '更多',
  feedback: '反馈', privacy: '隐私', sitemap: '站点地图', admin: '管理端',
  overview: '总览', cost: '成本'
};
function tabName(k) { return TABS[k] || k || '—'; }
/** 后端存 UTC ISO，直接截串会差 8 小时；这里按浏览器本地时区显示 */
function fmt(v) {
  if (!v) return '—';
  const d = new Date(v);
  if (isNaN(d.getTime())) return String(v).replace('T', ' ').slice(0, 16);
  const p = (n) => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate())
    + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
}
function device(ua) {
  const s = String(ua || '');
  if (/iPhone|Android|Mobile/i.test(s)) return '手机';
  if (/iPad|Tablet/i.test(s)) return '平板';
  return '电脑';
}
function isMp(row) {
  return viewMode.value === 'ip'
    ? !!(row.clients && row.clients.includes('mp'))
    : row.client === 'mp';
}
function sourceText(row) {
  if (viewMode.value === 'ip') {
    const c = row.clients || [];
    if (c.includes('mp') && c.includes('web')) return '混合';
    return c.includes('mp') ? '小程序' : '网页';
  }
  return row.client === 'mp' ? '小程序' : '网页';
}

const data = ref({});
const loading = ref(false);
const error = ref('');
const range = ref('today');
const client = ref('all');
const viewMode = ref('ip');
const page = ref(1);
const size = ref(20);

const RANGE_LABELS = { today: '今日', week: '本周', month: '本月', year: '本年', all: '累计' };
const rangeLabel = computed(() => RANGE_LABELS[range.value] || '所选区间');
const rangeHint = computed(() => {
  const r = data.value.range || {};
  return r.from ? r.from + ' ~ ' + r.to : '全部时间';
});
const trendTitle = computed(() => ({
  hour: '今日分时趋势', day: rangeLabel.value + '每日趋势', month: rangeLabel.value + '每月趋势'
}[data.value.gran] || '访问趋势'));

const byClient = computed(() => data.value.byClient || { web: { pv: 0, uv: 0 }, mp: { pv: 0, uv: 0 } });
const daily = computed(() => data.value.daily || []);
const retention = computed(() => data.value.retention || []);
const rowsAll = computed(() => viewMode.value === 'ip'
  ? (data.value.ipGroups || []) : (data.value.sessions || []));
const total = computed(() => rowsAll.value.length);
const rows = computed(() => rowsAll.value.slice((page.value - 1) * size.value, page.value * size.value));
const maxPv = computed(() => Math.max(1, ...daily.value.map((d) => Number(d.pv) || 0)));
function barWidth(pv) { return Math.round((Number(pv) || 0) / maxPv.value * 100); }

const lastUpdated = ref('');

async function load(opts) {
  const silent = !!(opts && opts.silent);
  if (silent && loading.value) return;
  if (!silent) loading.value = true;
  error.value = '';
  try {
    data.value = await visitorsApi.list({ client: client.value, range: range.value });
    lastUpdated.value = new Date().toLocaleTimeString('zh-CN', { hour12: false });
  } catch (e) {
    error.value = errorMessage(e);
  } finally {
    loading.value = false;
  }
}
function onFilterChange() { page.value = 1; load(); }

// 访客数据是实时写入的，页面每 30 秒静默拉一次；切回标签页立刻补一次
const POLL_MS = 30000;
let timer = 0;
function onVisible() {
  if (document.visibilityState === 'visible') load({ silent: true });
}
onMounted(() => {
  load();
  timer = setInterval(() => {
    if (document.visibilityState === 'hidden') return;
    load({ silent: true });
  }, POLL_MS);
  document.addEventListener('visibilitychange', onVisible);
});
onBeforeUnmount(() => {
  if (timer) clearInterval(timer);
  document.removeEventListener('visibilitychange', onVisible);
});

/* 明细 */
const drawer = ref(false);
const detailLoading = ref(false);
const detailRows = ref([]);
const detailTotal = ref(0);
const detailLabel = ref('');
function distinct(key) {
  return new Set(detailRows.value.map((r) => r[key]).filter(Boolean)).size;
}
async function openDetail(row) {
  const key = viewMode.value === 'ip' ? row.ip : row.sid;
  if (!key) return;
  detailLabel.value = viewMode.value === 'ip' ? key : String(key).slice(0, 8);
  drawer.value = true;
  detailLoading.value = true;
  detailRows.value = [];
  try {
    const q = viewMode.value === 'ip' ? { ip: key } : { sid: key };
    q.range = range.value;
    const r = await visitorsApi.detail(q);
    detailRows.value = r.rows || [];
    detailTotal.value = r.total || detailRows.value.length;
  } catch (e) {
    ElMessage.error(errorMessage(e));
  } finally {
    detailLoading.value = false;
  }
}
</script>

<style scoped>
.vs-h3 { font-size: 14px; font-weight: 600; margin: 0 0 12px; }
.vs-range { font-size: 12px; color: var(--cl-muted); }
.vs-live { font-size: 12px; color: var(--cl-dim); }
.vs-source { font-size: 11px; color: var(--cl-dim); margin: -6px 0 10px; }
.vs-cols { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 16px; }
.vs-trend { max-height: 260px; overflow-y: auto; }
.vs-day { display: flex; align-items: center; gap: 8px; padding: 4px 0; font-size: 12px; }
.vs-day > span { width: 42px; color: var(--cl-muted); flex: 0 0 42px; }
.vs-day b { width: 40px; text-align: right; }
.vs-day small { color: var(--cl-dim); width: 48px; text-align: right; }
.vs-bar { flex: 1; height: 8px; border-radius: 4px; background: rgba(255, 255, 255, .06); overflow: hidden; }
.vs-bar i { display: block; height: 100%; background: linear-gradient(90deg, var(--cl-gold-2), var(--cl-gold)); }
.vs-pbar { display: inline-block; width: 62px; height: 6px; border-radius: 3px; background: rgba(255, 255, 255, .07); vertical-align: middle; margin-right: 6px; }
.vs-pbar i { display: block; height: 100%; background: var(--cl-gold-2); }
.vs-clickable :deep(.el-table__row) { cursor: pointer; }
</style>
