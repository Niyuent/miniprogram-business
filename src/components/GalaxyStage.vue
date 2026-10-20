<script setup lang="ts">
import { computed } from 'vue';
import type { GalaxyChart } from '@/services/galaxy';

const props = defineProps<{ chart: GalaxyChart | null; focusId?: number; tall?: boolean }>();
const emit = defineEmits<{ pick: [id: number, role: 'center' | 'planet'] }>();

const laid = computed(() => {
  const planets = props.chart?.planets || [];
  return planets.map((planet, index) => {
    const angle = (index / Math.max(planets.length, 1)) * Math.PI * 2 - Math.PI / 2;
    const tone = planet.status === 'APPROVED' || planet.status === 'GUEST'
      ? 'is-live'
      : planet.status === 'PENDING'
        ? 'is-wait'
        : 'is-off';
    return {
      id: planet.id,
      name: planet.name,
      tone,
      style: {
        left: `${50 + Math.cos(angle) * 36}%`,
        top: `${48 + Math.sin(angle) * 30}%`,
      },
    };
  });
});

function pick(id: number, role: 'center' | 'planet') {
  emit('pick', id, role);
}
</script>

<template>
  <view class="sky" :class="{ 'is-tall': tall }">
    <view v-for="n in 8" :key="n" class="star" :class="'star--' + n" />
    <view class="ring ring--a" />
    <view class="ring ring--b" />
    <view v-if="chart" class="sun" hover-class="press" @tap="pick(chart.center.id, 'center')">
      <view class="sun__glow" />
      <view class="sun__name">{{ chart.center.name }}</view>
      <view class="sun__meta">本月 {{ chart.center.monthOrderCount }} 笔</view>
    </view>
    <view
      v-for="item in laid"
      :key="item.id"
      class="sat"
      :class="{ 'is-on': item.id === focusId }"
      :style="item.style"
      hover-class="press"
      @tap="pick(item.id, 'planet')"
    >
      <view class="ball" :class="item.tone" />
      <view class="sat__name">{{ item.name }}</view>
    </view>
    <view v-if="chart && !chart.planets.length" class="empty">
      {{ chart.mode === 'SUB' ? '本月还没有到店客人' : '还没有附属商家加入轨道' }}
    </view>
  </view>
</template>

<style scoped>
.sky {
  position: relative;
  height: 560rpx;
  margin-top: 28rpx;
  border-radius: 36rpx;
  overflow: hidden;
  background: radial-gradient(circle at 50% 46%, #16325c 0%, #0b1730 42%, #050811 100%);
  box-shadow: 0 18rpx 40rpx rgba(15, 23, 42, 0.18);
}
.is-tall { height: 760rpx; margin-top: 0; border-radius: 0; box-shadow: none; }
.star {
  position: absolute;
  width: 6rpx;
  height: 6rpx;
  border-radius: 50%;
  background: #fff;
  opacity: 0.45;
  animation: twinkle 3.6s ease-in-out infinite;
}
.star--1 { left: 12%; top: 18%; }
.star--2 { left: 78%; top: 14%; animation-delay: .4s; }
.star--3 { left: 88%; top: 62%; animation-delay: .8s; }
.star--4 { left: 8%; top: 70%; animation-delay: 1.1s; }
.star--5 { left: 24%; top: 30%; width: 4rpx; height: 4rpx; }
.star--6 { left: 66%; top: 28%; animation-delay: .6s; }
.star--7 { left: 48%; top: 12%; width: 4rpx; height: 4rpx; animation-delay: 1.4s; }
.star--8 { left: 34%; top: 78%; animation-delay: .2s; }
.ring {
  position: absolute;
  left: 50%;
  top: 48%;
  border: 1px solid rgba(255, 255, 255, 0.14);
  border-radius: 50%;
  pointer-events: none;
}
.ring--a {
  width: 520rpx;
  height: 250rpx;
  margin-left: -260rpx;
  margin-top: -125rpx;
  animation: spin 36s linear infinite;
}
.ring--b {
  width: 360rpx;
  height: 170rpx;
  margin-left: -180rpx;
  margin-top: -85rpx;
  animation: spin 24s linear infinite reverse;
}
.sun {
  position: absolute;
  left: 50%;
  top: 48%;
  width: 168rpx;
  height: 168rpx;
  margin-left: -84rpx;
  margin-top: -84rpx;
  border-radius: 50%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  color: #fff;
  text-align: center;
  z-index: 2;
}
.sun__glow {
  position: absolute;
  left: 0;
  top: 0;
  right: 0;
  bottom: 0;
  border-radius: 50%;
  background: radial-gradient(circle at 35% 30%, #7dd3fc, #1d4ed8 55%, #0b1b36 100%);
  box-shadow: 0 0 40rpx rgba(59, 130, 246, 0.85);
  animation: breathe 4.8s ease-in-out infinite;
}
.sun__name, .sun__meta { position: relative; z-index: 1; }
.sun__name { font-size: 26rpx; font-weight: 800; line-height: 1.2; padding: 0 12rpx; }
.sun__meta { margin-top: 6rpx; font-size: 20rpx; color: rgba(255,255,255,.8); }
.sat {
  position: absolute;
  width: 140rpx;
  margin-left: -70rpx;
  margin-top: -28rpx;
  z-index: 2;
  text-align: center;
}
.ball {
  width: 56rpx;
  height: 56rpx;
  margin: 0 auto;
  border-radius: 50%;
  background: radial-gradient(circle at 32% 30%, #fff, #34d399 40%, #064e3b 100%);
  box-shadow: 0 0 18rpx rgba(52, 211, 153, 0.8);
}
.ball.is-wait { background: radial-gradient(circle at 32% 30%, #fff, #fbbf24 42%, #78350f 100%); box-shadow: 0 0 18rpx rgba(251, 191, 36, 0.75); }
.ball.is-off { background: radial-gradient(circle at 32% 30%, #fff, #94a3b8 42%, #1e293b 100%); box-shadow: none; }
.is-on .ball { transform: scale(1.12); }
.sat__name {
  margin-top: 8rpx;
  font-size: 20rpx;
  color: #e2e8f0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.empty {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 28rpx;
  text-align: center;
  color: #94a3b8;
  font-size: 24rpx;
}
@keyframes spin { to { transform: rotate(360deg); } }
@keyframes breathe {
  0%, 100% { transform: scale(1); }
  50% { transform: scale(1.06); }
}
@keyframes twinkle {
  0%, 100% { opacity: 0.25; }
  50% { opacity: 0.9; }
}
</style>
