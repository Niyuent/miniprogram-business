<script setup lang="ts">
import Skeleton from '@/components/Skeleton.vue';

withDefaults(defineProps<{ count?: number }>(), { count: 3 });
</script>

<template>
  <skeleton type="wallet" :count="count" />
</template>
