<template>
  <div class="page">
    <el-card shadow="never">
      <el-form :inline="true" class="filter">
        <el-form-item label="时间范围">
          <el-date-picker
            v-model="query.dateRange"
            type="daterange"
            value-format="YYYY-MM-DD"
            range-separator="~"
            start-placeholder="开始"
            end-placeholder="结束"
            clearable
            @change="onSearch"
          />
        </el-form-item>
        <el-form-item v-if="isMainOrPlatform" label="商家ID">
          <el-input
            v-model.number="query.merchantId"
            clearable
            placeholder="留空=全部"
            style="width: 130px"
            @keyup.enter="onSearch"
          />
        </el-form-item>
        <el-form-item label="关键词">
          <el-input
            v-model="query.keyword"
            clearable
            placeholder="名称/编号"
            style="width: 170px"
            @keyup.enter="onSearch"
          />
        </el-form-item>
        <el-form-item>
          <el-button type="primary" :loading="loading" @click="onSearch">查询</el-button>
          <el-button @click="reset">重置</el-button>
          <el-button v-permission="'report:export'" :disabled="!data" @click="onExport">导出 CSV</el-button>
        </el-form-item>
      </el-form>

      <div v-loading="loading">
        <slot :data="data" :keyword="query.keyword" :query="query" />
      </div>
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { useUserStore } from '@/stores/user';
import { reportApi, type ReportQuery } from '@/api/report';

const props = defineProps<{
  apiKey: string;
  load: (filters: ReportQuery) => Promise<unknown>;
}>();

const userStore = useUserStore();
const loading = ref(false);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const data = ref<any>(null);

const query = reactive({
  dateRange: [] as string[],
  merchantId: undefined as number | undefined,
  keyword: '' as string,
  page: 1,
  pageSize: 10,
});

/** 刷新页面保持筛选条件：localStorage 按报表维度持久化 */
const LS_KEY = `report-${props.apiKey}`;
const saved = localStorage.getItem(LS_KEY);
if (saved) {
  try {
    Object.assign(query, JSON.parse(saved));
  } catch {
    /* ignore */
  }
}
watch(query, (v) => localStorage.setItem(LS_KEY, JSON.stringify(v)), { deep: true });

/** 商家筛选只对平台/主体显示：附属/店员被后端强制收敛到自身，不给选别家的入口 */
const isMainOrPlatform = computed(() => {
  const p = userStore.profile;
  if (!p) return false;
  if (p.userType === 'PLATFORM') return true;
  if (p.userType === 'MERCHANT' && p.merchant?.type === 'MAIN') return true;
  return false;
});

/** 时间范围转 ISO：to 推后一天 00:00Z，保证覆盖 end 当天全天（后端 lte 不含当天末尾） */
function currentFilters(): ReportQuery {
  const [s, e] = query.dateRange || [];
  const from = s ? new Date(`${s}T00:00:00.000Z`).toISOString() : undefined;
  const to = e
    ? new Date(new Date(`${e}T00:00:00.000Z`).getTime() + 86400000).toISOString()
    : undefined;
  return {
    from,
    to,
    merchantId: query.merchantId || undefined,
    page: query.page,
    pageSize: query.pageSize,
  };
}

async function onSearch() {
  loading.value = true;
  try {
    data.value = await props.load(currentFilters());
  } finally {
    loading.value = false;
  }
}

function reset() {
  query.dateRange = [];
  query.merchantId = undefined;
  query.keyword = '';
  query.page = 1;
  onSearch();
}

async function onExport() {
  await reportApi.exportCsv(props.apiKey, currentFilters());
}

onMounted(onSearch);
defineExpose({ reload: onSearch });
</script>

<style scoped>
.filter {
  margin-bottom: 4px;
}
</style>
