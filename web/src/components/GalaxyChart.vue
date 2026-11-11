<template>
  <div class="galaxy-chart">
    <div class="galaxy-chart__orbit galaxy-chart__orbit--outer" aria-hidden="true" />
    <div class="galaxy-chart__orbit galaxy-chart__orbit--inner" aria-hidden="true" />
    <div ref="el" class="galaxy-chart__canvas" />
  </div>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { graphic, init, use, type ECharts, type EChartsCoreOption } from 'echarts/core';
import { GraphChart, LinesChart } from 'echarts/charts';
import { GridComponent, TooltipComponent } from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
import type { DashboardGalaxy, DashboardGalaxyPlanet } from '@/api/report';

use([GraphChart, LinesChart, GridComponent, TooltipComponent, CanvasRenderer]);

const props = defineProps<{ data: DashboardGalaxy | null }>();
const router = useRouter();
const el = ref<HTMLDivElement>();
let chart: ECharts | null = null;
let orbit = 0;
let meteorFrame = 0;
let timer: ReturnType<typeof setInterval> | null = null;

const ORBIT_RADIUS = 300;

const PALETTE: Record<string, { base: string; glow: string }> = {
  APPROVED: { base: '#34d399', glow: 'rgba(52, 211, 153, 0.75)' },
  PENDING: { base: '#fbbf24', glow: 'rgba(251, 191, 36, 0.75)' },
  SUSPENDED: { base: '#f87171', glow: 'rgba(248, 113, 113, 0.7)' },
  REJECTED: { base: '#94a3b8', glow: 'rgba(148, 163, 184, 0.55)' },
};

const yuan = (v: number) => `¥${Number(v).toLocaleString('zh-CN', { maximumFractionDigits: 2 })}`;

/** 行星：左上高光，右下暗部。 */
function sphere(base: string) {
  return new graphic.RadialGradient(0.3, 0.3, 1, [
    { offset: 0, color: 'rgba(255, 255, 255, 0.95)' },
    { offset: 0.35, color: base },
    { offset: 1, color: 'rgba(0, 0, 0, 0.85)' },
  ]);
}

function buildModel(offset: number) {
  const data = props.data;
  const w = el.value?.clientWidth ?? 960;
  const h = el.value?.clientHeight ?? 640;
  const cx = w / 2;
  const cy = h / 2;
  if (!data) return { nodes: [], meteors: [], w, h };

  const nodes: Record<string, unknown>[] = [
    {
      ...data.center,
      id: data.center.id,
      name: data.center.name,
      kind: 'center',
      x: cx,
      y: cy,
      fixed: true,
      symbol: 'circle',
      symbolSize: 120,
      itemStyle: {
        color: '#0b1b36',
        borderColor: 'rgba(125, 211, 252, 0.9)',
        borderWidth: 2,
        shadowBlur: 80,
        shadowColor: '#3b82f6',
      },
      label: {
        show: true,
        position: 'bottom',
        distance: 18,
        fontSize: 16,
        fontWeight: 700,
        color: '#ffffff',
      },
    },
  ];

  const meteors: Array<{ coords: [[number, number], [number, number]] }> = [];
  const planets = data.planets;
  planets.forEach((planet, index) => {
    const palette = PALETTE[planet.status] ?? PALETTE.REJECTED;
    const angle = (index / Math.max(1, planets.length)) * Math.PI * 2 - Math.PI / 2 + offset;
    const x = cx + Math.cos(angle) * ORBIT_RADIUS;
    const y = cy + Math.sin(angle) * ORBIT_RADIUS;
    meteors.push({ coords: [[x, y], [cx, cy]] });
    nodes.push({
      ...planet,
      id: planet.id,
      name: planet.name,
      kind: 'planet',
      merchantId: planet.id,
      x,
      y,
      fixed: true,
      symbol: 'circle',
      symbolSize: 50,
      itemStyle: {
        color: sphere(palette.base),
        shadowBlur: 28,
        shadowColor: palette.glow,
      },
      label: {
        show: true,
        position: 'bottom',
        distance: 8,
        fontSize: 13,
        color: '#e2e8f0',
      },
    });
  });

  return { nodes, meteors, w, h };
}

function buildOption(offset: number): EChartsCoreOption {
  const { nodes, meteors, w, h } = buildModel(offset);
  return {
    backgroundColor: 'transparent',
    animationDurationUpdate: 90,
    animationEasingUpdate: 'linear',
    grid: { left: 0, right: 0, top: 0, bottom: 0 },
    xAxis: { type: 'value', min: 0, max: w, show: false },
    yAxis: { type: 'value', min: 0, max: h, inverse: true, show: false },
    tooltip: {
      confine: true,
      appendToBody: true,
      backgroundColor: 'rgba(5, 8, 17, 0.92)',
      borderWidth: 0,
      padding: [8, 12],
      textStyle: { color: '#e2e8f0', fontSize: 12 },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      formatter: (p: any) => {
        if (p?.dataType !== 'node' || !p?.data) return '';
        if (p.data.kind === 'center') {
          return `<b>${p.data.name}</b><br/>本月交易额 ${yuan(p.data.monthAmount)}<br/>本月订单 ${p.data.monthOrderCount} 笔 · 附属 ${p.data.planetCount} 家`;
        }
        if (p.data.kind !== 'planet') return '';
        return `<b>${p.data.name}</b><br/>本月交易额 ${yuan(p.data.monthAmount)}<br/>本月订单 ${p.data.orderCount} 笔<br/>状态 ${p.data.status}<br/><span style="color:#94a3b8">点击查看商家详情 →</span>`;
      },
    },
    series: [
      {
        id: 'meteors',
        type: 'lines',
        coordinateSystem: 'cartesian2d',
        z: 1,
        silent: true,
        animation: false,
        effect: {
          show: true,
          period: 4,
          trailLength: 0.8,
          symbol: 'arrow',
          symbolSize: 4,
          color: '#ffffff',
        },
        lineStyle: {
          color: 'transparent',
          width: 0,
          curveness: 0,
          opacity: 0,
        },
        data: meteors,
      },
      {
        id: 'galaxy',
        type: 'graph',
        layout: 'none',
        roam: false,
        draggable: false,
        z: 3,
        emphasis: { scale: 1.08 },
        data: nodes,
      },
    ],
  };
}

function render() {
  if (!el.value) return;
  if (!chart) chart = init(el.value);
  chart.setOption(buildOption(orbit), true);
}

function tick() {
  if (!chart || !props.data?.planets.length) return;
  orbit += 0.004;
  meteorFrame += 1;
  const { nodes, meteors } = buildModel(orbit);
  const series: Array<Record<string, unknown>> = [{ id: 'galaxy', data: nodes }];
  if (meteorFrame % 22 === 0) series.unshift({ id: 'meteors', data: meteors });
  chart.setOption({
    animationDurationUpdate: 90,
    animationEasingUpdate: 'linear',
    series,
  });
}

function onResize() {
  if (!chart || !el.value) return;
  chart.resize();
  chart.setOption(buildOption(orbit), true);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function onClick(params: any) {
  if (params?.dataType !== 'node') return;
  const kind = params.data?.kind;
  if (kind !== 'center' && kind !== 'planet') return;
  const id = kind === 'center' ? params.data?.id : params.data?.merchantId;
  if (typeof id === 'number' && id > 0) router.push({ path: '/main/merchants', query: { id: String(id) } });
}

let observer: ResizeObserver | null = null;

onMounted(() => {
  render();
  chart?.on('click', onClick);
  window.addEventListener('resize', onResize);
  if (typeof ResizeObserver !== 'undefined' && el.value) {
    observer = new ResizeObserver(() => onResize());
    observer.observe(el.value);
  }
  timer = setInterval(tick, 90);
  (window as unknown as { __galaxyChart?: ECharts }).__galaxyChart = chart ?? undefined;
});

onBeforeUnmount(() => {
  if (timer) clearInterval(timer);
  timer = null;
  window.removeEventListener('resize', onResize);
  observer?.disconnect();
  observer = null;
  delete (window as unknown as { __galaxyChart?: ECharts }).__galaxyChart;
  chart?.dispose();
  chart = null;
});

watch(
  () => props.data,
  () => render(),
  { deep: true },
);
</script>

<style scoped>
.galaxy-chart {
  position: relative;
  width: 100%;
  height: 100%;
  background: radial-gradient(circle at center, #0d1627 0%, #050811 100%);
  animation: galaxy-breathe 7s ease-in-out infinite;
  transform-origin: center center;
}
.galaxy-chart__canvas {
  position: relative;
  z-index: 1;
  width: 100%;
  height: 100%;
}
.galaxy-chart__orbit {
  position: absolute;
  left: 50%;
  top: 50%;
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 50%;
  pointer-events: none;
  z-index: 0;
}
.galaxy-chart__orbit--outer {
  width: 600px;
  height: 260px;
  transform: translate(-50%, -50%) rotate(-22deg);
}
.galaxy-chart__orbit--inner {
  width: 400px;
  height: 172px;
  transform: translate(-50%, -50%) rotate(-22deg);
}
@keyframes galaxy-breathe {
  0%,
  100% {
    transform: scale(1);
  }
  50% {
    transform: scale(1.02);
  }
}
</style>
