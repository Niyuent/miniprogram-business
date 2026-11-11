<template>
  <ReportView ref="rv" apiKey="points-summary" :load="reportApi.pointsSummary">
    <template #default="{ data, keyword, query }">
      <StatCards :items="statCards(data)" :span="3" />
      <el-card shadow="never" header="按流水类型">
        <el-table
          :data="paged(filterByKeyword(data?.byType, keyword, ['type']), query.page, query.pageSize)"
          border
          empty-text="暂无数据"
        >
          <el-table-column prop="type" label="类型" />
          <el-table-column prop="count" label="笔数" align="right" />
          <el-table-column prop="amount" label="积分变动" align="right" />
        </el-table>
        <el-pagination
          v-model:current-page="query.page"
          v-model:page-size="query.pageSize"
          :total="filterByKeyword(data?.byType, keyword, ['type']).length"
          layout="total, sizes, prev, pager, next"
          :page-sizes="[10, 20, 50]"
          style="margin-top: 12px; justify-content: flex-end"
        />
      </el-card>
    </template>
  </ReportView>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import ReportView from '@/views/common/ReportView.vue';
import StatCards from '@/views/common/StatCards.vue';
import { reportApi, type PointsSummaryData } from '@/api/report';
import { filterByKeyword } from '@/utils/report';

const rv = ref();
function statCards(d: PointsSummaryData | null) {
  const s = d?.summary ?? {
    count: 0,
    net: 0,
    earned: 0,
    spent: 0,
    expired: 0,
    refunded: 0,
    adjusted: 0,
  };
  return [
    { label: '流水笔数', value: s.count },
    { label: '净变动', value: s.net },
    { label: '获取', value: s.earned },
    { label: '消耗', value: s.spent },
    { label: '过期', value: s.expired },
    { label: '回退', value: s.refunded },
    { label: '调整', value: s.adjusted },
  ];
}
function paged(arr: unknown[], page: number, size: number) {
  return (arr || []).slice((page - 1) * size, page * size);
}
</script>
