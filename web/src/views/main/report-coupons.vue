<template>
  <ReportView ref="rv" apiKey="coupon-summary" :load="reportApi.couponSummary">
    <template #default="{ data, keyword, query }">
      <StatCards :items="statCards(data)" :span="4" />
      <el-card shadow="never" header="按券状态">
        <el-table :data="data?.byStatus || []" border empty-text="暂无数据">
          <el-table-column prop="status" label="状态" />
          <el-table-column prop="count" label="张数" align="right" />
        </el-table>
      </el-card>
      <el-card shadow="never" header="按券模板" style="margin-top: 12px">
        <el-table
          :data="paged(filterByKeyword(data?.byTemplate, keyword, ['templateName']), query.page, query.pageSize)"
          border
          empty-text="暂无数据"
        >
          <el-table-column prop="templateName" label="券模板" min-width="120" />
          <el-table-column prop="count" label="发放张数" align="right" />
        </el-table>
        <el-pagination
          v-model:current-page="query.page"
          v-model:page-size="query.pageSize"
          :total="filterByKeyword(data?.byTemplate, keyword, ['templateName']).length"
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
import { reportApi, type CouponSummaryData } from '@/api/report';
import { filterByKeyword } from '@/utils/report';

const rv = ref();
function statCards(d: CouponSummaryData | null) {
  const s = d?.summary ?? { total: 0, used: 0, unused: 0, frozen: 0, expired: 0, usedRate: 0 };
  return [
    { label: '发放总数', value: s.total },
    { label: '已使用', value: s.used },
    { label: '未使用', value: s.unused },
    { label: '已冻结', value: s.frozen },
    { label: '已过期', value: s.expired },
    { label: '使用率(%)', value: s.usedRate, precision: 2 },
  ];
}
function paged(arr: unknown[], page: number, size: number) {
  return (arr || []).slice((page - 1) * size, page * size);
}
</script>
