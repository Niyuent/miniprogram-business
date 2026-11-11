<template>
  <ReportView ref="rv" apiKey="store-settlement" :load="reportApi.storeSettlement">
    <template #default="{ data, keyword, query }">
      <StatCards :items="statCards(data)" :span="6" />
      <el-card shadow="never" header="按结算状态">
        <el-table :data="data?.bySettleStatus || []" border empty-text="暂无数据">
          <el-table-column prop="settleStatus" label="状态" />
          <el-table-column prop="count" label="笔数" align="right" />
          <el-table-column prop="totalAmount" label="金额" align="right" />
        </el-table>
      </el-card>
      <el-card shadow="never" header="按商家（采购额 vs 核销额）" style="margin-top: 12px">
        <el-table
          :data="paged(filterByKeyword(data?.byMerchant, keyword, ['merchantName']), query.page, query.pageSize)"
          border
          empty-text="暂无数据"
        >
          <el-table-column prop="merchantName" label="商家" min-width="120" />
          <el-table-column prop="purchaseCount" label="采购笔数" align="right" />
          <el-table-column prop="purchaseAmount" label="采购金额" align="right" />
          <el-table-column prop="redemptionCount" label="核销笔数" align="right" />
          <el-table-column prop="redemptionAmount" label="核销金额" align="right" />
          <el-table-column prop="diffAmount" label="差额" align="right" />
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
    </template>
  </ReportView>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import ReportView from '@/views/common/ReportView.vue';
import StatCards from '@/views/common/StatCards.vue';
import { reportApi, type StoreSettlementData } from '@/api/report';
import { filterByKeyword } from '@/utils/report';

const rv = ref();
function statCards(d: StoreSettlementData | null) {
  const s = d?.summary ?? {
    purchaseCount: 0,
    purchaseAmount: 0,
    redemptionCount: 0,
    redemptionAmount: 0,
  };
  return [
    { label: '采购笔数', value: s.purchaseCount },
    { label: '采购金额', value: s.purchaseAmount, precision: 2 },
    { label: '核销笔数', value: s.redemptionCount },
    { label: '核销金额', value: s.redemptionAmount, precision: 2 },
  ];
}
function paged(arr: unknown[], page: number, size: number) {
  return (arr || []).slice((page - 1) * size, page * size);
}
</script>
