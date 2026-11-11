<template>
  <el-row :gutter="12" class="stat-cards">
    <el-col v-for="(it, i) in items" :key="i" :span="span">
      <el-card shadow="never">
        <el-statistic :title="it.label" :value="it.value" :precision="it.precision || 0" />
      </el-card>
    </el-col>
  </el-row>
</template>

<script setup lang="ts">
defineProps<{
  items: Array<{ label: string; value: number; precision?: number }>;
  span?: number;
}>();
</script>

<style scoped>
.stat-cards {
  margin-bottom: 12px;
}
</style>
