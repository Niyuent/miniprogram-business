<template>
  <el-card shadow="never">
    <el-empty :description="`「${title}」将在 ${stage} 阶段实现`">
      <el-button type="primary" plain @click="$router.push('/dashboard')">返回工作台</el-button>
    </el-empty>
  </el-card>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useRoute } from 'vue-router';

const route = useRoute();
const title = computed(() => (route.meta.title as string) || '该页面');
const stage = computed(() => (route.meta.stage as string) || '后续');
</script>
