<template>
  <ReportView apiKey="merchant-onboarding" :load="reportApi.merchantOnboarding">
    <template #default="{ data, keyword }">
      <StatCards :items="statCards(data)" :span="4" />
      <el-card shadow="never" header="按状态分布">
        <el-table :data="data?.byStatus || []" border empty-text="暂无数据">
          <el-table-column prop="status" label="状态" />
          <el-table-column prop="count" label="数量" align="right" />
        </el-table>
      </el-card>
      <el-card shadow="never" header="按月新增趋势" style="margin-top: 12px">
        <el-table :data="filterByKeyword(data?.monthly, keyword, ['month'])" border empty-text="暂无数据">
          <el-table-column prop="month" label="月份" />
          <el-table-column prop="count" label="新增商家数" align="right" />
        </el-table>
      </el-card>
    </template>
  </ReportView>
</template>

<script setup lang="ts">
import ReportView from '@/views/common/ReportView.vue';
import StatCards from '@/views/common/StatCards.vue';
import { reportApi, type MerchantOnboardingData } from '@/api/report';
import { filterByKeyword } from '@/utils/report';

function statCards(d: MerchantOnboardingData | null) {
  const s = d?.summary ?? { total: 0, PENDING: 0, APPROVED: 0, SUSPENDED: 0, REJECTED: 0 };
  return [
    { label: '商家总数', value: s.total },
    { label: '待审核', value: s.PENDING },
    { label: '已通过', value: s.APPROVED },
    { label: '已停用', value: s.SUSPENDED },
    { label: '已拒绝', value: s.REJECTED },
  ];
}
</script>
