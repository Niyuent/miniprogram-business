<template>
  <ReportView apiKey="orders-summary" :load="reportApi.ordersSummary">
    <template #default="{ data, keyword, query }">
      <StatCards :items="statCards(data)" :span="6" />
      <el-card shadow="never" header="按订单状态">
        <el-table :data="data?.byStatus || []" border empty-text="暂无数据">
          <el-table-column prop="status" label="状态" />
          <el-table-column prop="count" label="笔数" align="right" />
          <el-table-column prop="payAmount" label="实付金额" align="right" />
        </el-table>
      </el-card>
      <el-card shadow="never" header="按商家" style="margin-top: 12px">
        <el-table
          :data="paged(filterByKeyword(data?.byMerchant, keyword, ['merchantName']), query.page, query.pageSize)"
          border
          empty-text="暂无数据"
        >
          <el-table-column prop="merchantName" label="商家" min-width="120" />
          <el-table-column prop="count" label="笔数" align="right" />
          <el-table-column prop="payAmount" label="实付金额" align="right" />
        </el-table>
        <el-pagination
          v-model:current-page="query.page"
          v-model:page-size="query.pageSize"
          :total="filterByKeyword(data?.byMerchant, keyword, ['merchantName']).length"
          layout="total, sizes, prev, pager, next"
          :page-sizes="[10, 20, 50]"
          style="margin-top: 12px; justify-content: flex-end"
        />
      </el-card>
      <el-card shadow="never" header="按日趋势" style="margin-top: 12px">
        <el-table :data="data?.daily || []" border empty-text="暂无数据">
          <el-table-column prop="date" label="日期" />
          <el-table-column prop="count" label="笔数" align="right" />
          <el-table-column prop="payAmount" label="实付金额" align="right" />
        </el-table>
      </el-card>
    </template>
  </ReportView>
</template>

<script setup lang="ts">
import ReportView from '@/views/common/ReportView.vue';
import StatCards from '@/views/common/StatCards.vue';
import { reportApi, type OrdersSummaryData } from '@/api/report';
import { filterByKeyword } from '@/utils/report';

function statCards(d: OrdersSummaryData | null) {
  const s = d?.summary ?? { count: 0, totalAmount: 0, payAmount: 0, discountAmount: 0 };
  return [
    { label: '订单数', value: s.count },
    { label: '订单总额', value: s.totalAmount, precision: 2 },
    { label: '实付金额', value: s.payAmount, precision: 2 },
    { label: '优惠金额', value: s.discountAmount, precision: 2 },
  ];
}

function paged(arr: unknown[], page: number, size: number) {
  return (arr || []).slice((page - 1) * size, page * size);
}
</script>
