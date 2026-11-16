import { onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import { errorMessage } from '../api/client';

/**
 * 列表页统一状态机：分页 / 搜索防抖 / 排序 / loading / error / 请求取消。
 *
 * loader(params, signal) 返回：
 *   - 服务端分页：{ items, total }（或数组）
 *   - clientSide: true 时返回全量数组，本函数负责本地过滤、排序与切片
 *
 * 页面只管渲染 rows / total，不再各自维护一套 loading 和分页变量。
 */
export function useTable(loader, options = {}) {
  const {
    defaultParams = {},
    pageSize = 20,
    debounceMs = 300,
    clientSide = false,
    searchKeys = [],
    localFilter = null,
    immediate = true
  } = options;

  const rows = ref([]);
  const allRows = ref([]);
  const total = ref(0);
  const loading = ref(false);
  const error = ref('');
  const params = reactive({ page: 1, size: pageSize, q: '', sort: '', ...defaultParams });

  let timer = null;
  let controller = null;

  function applyLocal() {
    let list = allRows.value.slice();
    const q = String(params.q || '').trim().toLowerCase();
    if (q && searchKeys.length) {
      list = list.filter((row) => searchKeys.some((k) => String(row[k] ?? '').toLowerCase().includes(q)));
    }
    if (params.filter && localFilter) {
      list = list.filter((row) => localFilter(row, params.filter));
    }
    if (params.sort) {
      const desc = String(params.sort).startsWith('-');
      const key = desc ? String(params.sort).slice(1) : String(params.sort);
      list.sort((a, b) => {
        const av = a[key], bv = b[key];
        const n = typeof av === 'number' && typeof bv === 'number'
          ? av - bv
          : String(av ?? '').localeCompare(String(bv ?? ''), 'zh-CN');
        return desc ? -n : n;
      });
    }
    total.value = list.length;
    const start = (params.page - 1) * params.size;
    rows.value = list.slice(start, start + params.size);
  }

  async function load() {
    if (controller) controller.abort();
    controller = new AbortController();
    loading.value = true;
    error.value = '';
    try {
      const res = await loader({ ...params }, controller.signal);
      const list = Array.isArray(res) ? res : (res && (res.items || res.rows)) || [];
      if (clientSide) {
        allRows.value = list;
        applyLocal();
      } else {
        rows.value = list;
        total.value = Number((res && res.total) ?? list.length);
      }
    } catch (e) {
      if (e && e.name === 'AbortError') return;
      error.value = errorMessage(e);
    } finally {
      loading.value = false;
    }
  }

  function reload() { params.page = 1; return load(); }
  function refresh() { return load(); }

  function search(q) {
    params.q = q;
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (clientSide) { params.page = 1; applyLocal(); }
      else reload();
    }, debounceMs);
  }

  function setParam(key, value) {
    params[key] = value;
    params.page = 1;
    if (clientSide) applyLocal();
    else load();
  }

  function onPageChange(p) {
    params.page = p;
    if (clientSide) applyLocal();
    else load();
  }

  function onSizeChange(s) {
    params.size = s;
    params.page = 1;
    if (clientSide) applyLocal();
    else load();
  }

  watch(() => params.sort, () => {
    params.page = 1;
    if (clientSide) applyLocal();
    else load();
  });

  onMounted(() => { if (immediate) load(); });
  onBeforeUnmount(() => {
    clearTimeout(timer);
    if (controller) controller.abort();
  });

  return {
    rows, allRows, total, loading, error, params,
    load, reload, refresh, search, setParam, onPageChange, onSizeChange, applyLocal
  };
}
