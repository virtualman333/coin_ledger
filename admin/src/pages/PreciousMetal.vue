<template>
  <section>
    <PageHeader title="贵金属" desc="收录发行的贵金属纪念币，逐枚一行。数据来源金币云集全量目录（只读展示，不在本站编辑）。">
      <template #actions>
        <el-button :loading="loading" @click="reloadAll">刷新</el-button>
      </template>
    </PageHeader>

    <div class="cl-stat-grid">
      <div class="cl-stat"><b>{{ stats.count }}</b><span>品种（枚）</span></div>
      <div class="cl-stat"><b>{{ stats.withThumb }}</b><span>有缩略图</span></div>
      <div class="cl-stat"><b>{{ stats.withMintage }}</b><span>有发行量</span></div>
      <div class="cl-stat"><b>{{ stats.holdings }}</b><span>我的藏品</span></div>
    </div>

    <AsyncState :loading="loading && !rows.length" :error="error" @retry="reload">
      <div class="cl-toolbar">
        <el-input
          v-model="kw" clearable placeholder="搜索名称 / 编号"
          style="width: 260px" @input="search"
        />
        <div class="cl-spacer" />
        <span class="cl-mono">共 {{ total }} 枚</span>
      </div>

      <div class="cl-card">
        <el-table :data="rows" row-key="code" v-loading="loading" stripe size="small">
          <el-table-column prop="code" label="编号" width="110" class-name="cl-mono" />
          <el-table-column label="缩略图" width="72">
            <template #default="{ row }">
              <img
                v-if="imgUrl(row.thumb)" class="pm-thumb" :src="imgUrl(row.thumb)"
                alt="" loading="lazy" referrerpolicy="no-referrer"
              />
              <span v-else class="fb-muted">—</span>
            </template>
          </el-table-column>
          <el-table-column prop="name" label="名称" min-width="240" show-overflow-tooltip />
          <el-table-column prop="projectName" label="项目" min-width="180" show-overflow-tooltip>
            <template #default="{ row }">{{ row.projectName || '—' }}</template>
          </el-table-column>
          <el-table-column prop="year" label="年份" width="80" />
          <el-table-column prop="material" label="材质" width="110" show-overflow-tooltip>
            <template #default="{ row }">{{ row.material || '—' }}</template>
          </el-table-column>
          <el-table-column label="面额" width="110">
            <template #default="{ row }">{{ row.face != null ? row.face + ' 元' : '—' }}</template>
          </el-table-column>
          <el-table-column label="发行量" width="120">
            <template #default="{ row }">{{ row.circulation != null ? Number(row.circulation).toLocaleString() : '—' }}</template>
          </el-table-column>
        </el-table>

        <div class="cl-pager">
          <el-pagination
            background layout="total, sizes, prev, pager, next, jumper"
            :current-page="params.page" :page-size="params.size" :total="total"
            :page-sizes="[20, 30, 50]"
            @current-change="onPageChange" @size-change="onSizeChange"
          />
        </div>
      </div>
    </AsyncState>
  </section>
</template>

<script setup>
import { onMounted, reactive, ref } from 'vue';
import PageHeader from '../components/PageHeader.vue';
import AsyncState from '../components/AsyncState.vue';
import { useTable } from '../composables/useTable';
import { pmAllApi, categoriesApi } from '../api/endpoints';

const kw = ref('');
const stats = reactive({ count: 0, withThumb: 0, withMintage: 0, holdings: 0 });

const {
  rows, total, loading, error, params,
  reload, search, onPageChange, onSizeChange
} = useTable(
  (p, signal) => pmAllApi.page({ page: p.page, size: p.size, q: p.q }, signal),
  { pageSize: 30, debounceMs: 300 }
);

async function loadStats() {
  try {
    const res = await categoriesApi.list();
    const pm = (Array.isArray(res?.items) ? res.items : []).find((x) => x.code === 'pm') || {};
    stats.count = Number(pm.count) || 0;
    stats.withThumb = Number(pm.withThumb) || 0;
    stats.withMintage = Number(pm.withMintage) || 0;
    stats.holdings = Number(pm.holdings) || 0;
  } catch (e) {
    // 统计失败不影响主列表
  }
}

// 缩略图可能是 CDN 绝对 URL，也可能是站内路径
function imgUrl(v) {
  if (!v) return '';
  const s = String(v);
  if (s.indexOf('http') === 0 || s.charAt(0) === '/') return s;
  return 'https://chngc-prod-c2c-cdn.ecgci.com/' + s;
}

function reloadAll() {
  reload();
  loadStats();
}
onMounted(loadStats);
</script>

<style scoped>
.pm-thumb { width: 46px; height: 46px; object-fit: cover; border-radius: 4px; background: #f5f5f5; }
.fb-muted { color: #909399; }
</style>
