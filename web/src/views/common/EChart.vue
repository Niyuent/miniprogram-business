<template>
  <div ref="el" :style="{ width: '100%', height: height }"></div>
</template>

<script setup lang="ts">
// 按需引入：只注册用到的图表与组件，避免全量包（bundle 增量 < 300KB）
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { init, use, type ECharts } from 'echarts/core';
import { BarChart, GraphChart, LineChart, PieChart } from 'echarts/charts';
import {
  GridComponent,
  LegendComponent,
  TitleComponent,
  TooltipComponent,
} from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';

use([
  LineChart,
  BarChart,
  PieChart,
  GraphChart,
  GridComponent,
  TooltipComponent,
  LegendComponent,
  TitleComponent,
  CanvasRenderer,
]);

const props = defineProps<{ option: Record<string, unknown>; height?: string }>();
const el = ref<HTMLDivElement>();
let chart: ECharts | null = null;

function render() {
  if (!el.value) return;
  if (chart) chart.dispose();
  chart = init(el.value);
  chart.setOption(props.option);
}
function onResize() {
  chart?.resize();
}
onMounted(() => {
  render();
  window.addEventListener('resize', onResize);
});
onBeforeUnmount(() => {
  window.removeEventListener('resize', onResize);
  chart?.dispose();
  chart = null;
});
watch(() => props.option, () => render(), { deep: true });
</script>
