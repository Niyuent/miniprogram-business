<template>
  <div class="page">
    <el-card shadow="never">
      <template #header>
        <div class="page__head">
          <span>核销记录（全平台，按商家分组合计）</span>
          <span class="page__muted">数据隔离由后端收敛：这里只显示自己门店产生的 + 自己模板产生的核销</span>
        </div>
      </template>
      <RedemptionRecords scope="main" />
    </el-card>
  </div>
</template>

<script setup lang="ts">
import RedemptionRecords from '@/views/common/redemption-records.vue';
</script>

<style scoped>
.page__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.page__muted {
  color: #94a3b8;
  font-size: 12px;
}
</style>
