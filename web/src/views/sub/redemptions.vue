<template>
  <div class="page">
    <el-card shadow="never">
      <template #header>
        <div class="page__head">
          <span>本店核销记录</span>
          <span class="page__muted">
            数据隔离由后端收敛：这里只有本商家的核销记录，传别人的 merchantId 会被后端 403 拒绝
          </span>
        </div>
      </template>
      <RedemptionRecords scope="sub" />
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
