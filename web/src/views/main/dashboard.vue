<template>
  <div class="page">
    <!-- ==================== 星系视图（主体/平台；附属/店员自动降级） ==================== -->
    <div v-if="viewMode === 'galaxy'" v-loading="galaxyLoading" class="galaxy">
      <div class="galaxy__stage">
      <div class="galaxy__canvas">
        <GalaxyChart :data="galaxy" />
      </div>
      <!-- 中心呼吸光环：纯 CSS 动画，不触发图表重绘（避免力导向布局抖动 / 掉帧） -->
      <div class="galaxy__halo" />

      <!-- 关键指标浮层（毛玻璃） -->
      <div class="galaxy__overlay glass">
        <div class="galaxy__overlay-title">
          <span class="galaxy__dot" />
          <span class="galaxy__name">{{ galaxy?.center.name || '—' }}</span>
          <el-tag size="small" type="info">{{ galaxy?.center.type === 'PLATFORM' ? '平台视角' : '主体视角' }}</el-tag>
        </div>
        <div class="galaxy__metrics">
          <div v-for="m in overlayMetrics" :key="m.label" class="galaxy__metric">
            <div class="galaxy__metric-value">
              {{ m.value }}<small v-if="m.unit" class="galaxy__unit">{{ m.unit }}</small>
            </div>
            <div class="galaxy__metric-label">{{ m.label }}</div>
          </div>
        </div>
        <div class="galaxy__overlay-todo">
          待办 <b>{{ todoTotal }}</b> 项 · 待审 {{ todo.pendingMerchants }} / 异常 {{ todo.abnormalOrders }} / 未读
          {{ unreadNotifications }}
        </div>
        <el-button size="small" type="primary" @click="viewMode = 'data'">查看详情</el-button>
      </div>

      <div class="galaxy__hint">悬停查看商家指标 · 点击星球进入商家详情 · 星球大小 = 本月交易额</div>
      </div>

      <div class="galaxy__footer">
      <!-- 底部指标卡（可点击跳转） -->
      <div class="galaxy__cards">
        <div v-for="c in metricCards" :key="c.key" class="galaxy__card glass" @click="onCardClick(c.key)">
          <div class="galaxy__card-value">{{ c.value }}</div>
          <div class="galaxy__card-label">{{ c.label }}</div>
          <div class="galaxy__card-trend">环比 {{ c.trend >= 0 ? '+' : '' }}{{ c.trend }}%</div>
        </div>
      </div>

      <!-- 视图切换（右下角） -->
      <div class="galaxy__switch glass">
        <el-radio-group v-model="viewMode" size="small">
          <el-radio-button value="galaxy">星系视图</el-radio-button>
          <el-radio-button value="data">数据视图</el-radio-button>
        </el-radio-group>
      </div>
      </div>
    </div>

    <!-- ==================== 数据视图（原有内容 + 顶部切换） ==================== -->
    <el-card v-else shadow="never" v-loading="loading">
      <div class="data-view__head">
        <div class="section-title">经营概览</div>
        <el-radio-group v-if="galaxyAvailable" v-model="viewMode" size="small">
          <el-radio-button value="galaxy">星系视图</el-radio-button>
          <el-radio-button value="data">数据视图</el-radio-button>
        </el-radio-group>
      </div>

      <!-- 指标卡片：订单 / 核销 / 兑换 / 发券 / 积分发行 / 积分消耗 -->
      <el-row :gutter="12" class="cards">
        <el-col v-for="c in metricCards" :key="c.key" :span="4">
          <el-card shadow="hover" class="metric" @click="onCardClick(c.key)">
            <el-statistic :title="c.label" :value="c.value" />
            <div class="card-sub">单位：{{ c.unit }} · 环比 {{ c.trend >= 0 ? '+' : '' }}{{ c.trend }}%</div>
          </el-card>
        </el-col>

        <!-- 主体/平台专属：管理类卡片（附属/店员无 merchant:audit 权限，自动隐藏） -->
        <el-col v-permission="'merchant:audit'" :span="4">
          <el-card shadow="hover" class="metric" @click="$router.push('/main/merchant-applications')">
            <el-statistic title="待审核商家" :value="todo.pendingMerchants" />
            <div class="card-sub link">点击前往审核 →</div>
          </el-card>
        </el-col>
        <el-col v-permission="'merchant:audit'" :span="4">
          <el-card shadow="hover" class="metric" @click="$router.push('/main/orders/abnormal')">
            <el-statistic title="异常订单" :value="todo.abnormalOrders" />
            <div class="card-sub link">点击前往处理 →</div>
          </el-card>
        </el-col>

        <!-- 待办汇总卡：所有人可见 -->
        <el-col :span="4">
          <el-card shadow="hover" class="metric todo" @click="onTodoClick">
            <el-statistic title="待办事项" :value="todoTotal" />
            <div class="card-sub">
              待审 {{ todo.pendingMerchants }} · 异常 {{ todo.abnormalOrders }} · 未读 {{ unreadNotifications }}
            </div>
          </el-card>
        </el-col>
      </el-row>

      <!-- 趋势：订单 / 核销 / 兑换 -->
      <el-card shadow="never" header="近 7 天趋势" style="margin-top: 12px">
        <EChart v-if="hasTrend" :option="trendOption" height="320px" />
        <el-empty v-else description="暂无趋势数据" />
      </el-card>

      <!-- 饼图：券类型分布 + 积分来源分布 -->
      <el-row :gutter="12" style="margin-top: 12px">
        <el-col :span="12">
          <el-card shadow="never" header="券类型分布（主体券 / 附属商家券）">
            <EChart v-if="hasCoupon" :option="couponPieOption" height="300px" />
            <el-empty v-else description="暂无券数据" />
          </el-card>
        </el-col>
        <el-col :span="12">
          <el-card shadow="never" header="积分来源分布">
            <EChart v-if="hasPoint" :option="pointPieOption" height="300px" />
            <el-empty v-else description="暂无积分数据" />
          </el-card>
        </el-col>
      </el-row>

      <!-- 柱状图：Top5 商家（仅主体/平台可见） -->
      <el-card v-permission="'merchant:audit'" shadow="never" header="交易额 Top5 商家" style="margin-top: 12px">
        <EChart v-if="hasTop" :option="topOption" height="320px" />
        <el-empty v-else description="暂无商家交易数据" />
      </el-card>

      <!-- 待办区：可点击跳转 -->
      <el-card shadow="never" header="待办事项" style="margin-top: 12px">
        <el-row :gutter="12">
          <el-col :span="8">
            <div class="todo-item" @click="$router.push('/main/merchant-applications')">
              <span class="todo-label">待审核商家</span>
              <span class="todo-num">{{ todo.pendingMerchants }}</span>
            </div>
          </el-col>
          <el-col :span="8">
            <div class="todo-item" @click="$router.push('/main/orders/abnormal')">
              <span class="todo-label">异常订单</span>
              <span class="todo-num warn">{{ todo.abnormalOrders }}</span>
            </div>
          </el-col>
          <el-col :span="8">
            <div class="todo-item" @click="$router.push('/main/notifications')">
              <span class="todo-label">未读通知</span>
              <span class="todo-num">{{ unreadNotifications }}</span>
            </div>
          </el-col>
        </el-row>
      </el-card>
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import EChart from '@/views/common/EChart.vue';
import GalaxyChart from '@/components/GalaxyChart.vue';
import {
  reportApi,
  type DashboardCard,
  type DashboardGalaxy,
  type DashboardStats,
  type DashboardTrend,
  type DashboardDistribution,
  type DashboardTopMerchant,
} from '@/api/report';
import { useNotificationStore } from '@/stores/notification';

const router = useRouter();
const notificationStore = useNotificationStore();

/** 视图模式：galaxy=星系视图，data=数据视图；localStorage 持久化，默认星系视图 */
const VIEW_KEY = 'dashboard:view';
type ViewMode = 'galaxy' | 'data';
const viewMode = ref<ViewMode>((localStorage.getItem(VIEW_KEY) as ViewMode) || 'galaxy');
/** 星系是否可用（附属/店员会拿到 403 → 自动降级为数据视图，且不显示切换） */
const galaxyAvailable = ref(true);

const loading = ref(false);
const galaxyLoading = ref(false);
const stats = ref<DashboardStats | null>(null);
const trend = ref<DashboardTrend | null>(null);
const dist = ref<DashboardDistribution | null>(null);
const top = ref<DashboardTopMerchant[]>([]);
const galaxy = ref<DashboardGalaxy | null>(null);

const todo = computed(() => stats.value?.todo ?? { pendingMerchants: 0, abnormalOrders: 0, unreadNotifications: 0 });
/**
 * 未读通知数：**铃铛（store）是单一数据源**（S5.4-B2 第 6 步）。
 * store 尚未加载完成时先用工作台接口的快照兜底，避免首屏闪 0；
 * 这样在顶栏铃铛里点「全部已读」后，本卡片会立刻跟着变，不会出现「铃铛 0 / 待办 3」。
 */
const unreadNotifications = computed(() =>
  notificationStore.loaded ? notificationStore.unreadCount : (stats.value?.todo?.unreadNotifications ?? 0),
);
const todoTotal = computed(
  () => todo.value.pendingMerchants + todo.value.abnormalOrders + unreadNotifications.value,
);
const metricCards = computed(() => (stats.value?.cards ?? []) as DashboardCard[]);

/** 星系浮层指标：今日订单 / 核销 / 交易额 / 积分发行 */
const overlayMetrics = computed(() => {
  const cards = stats.value?.cards ?? [];
  const pick = (key: string, label: string, unit = '') => {
    const c = cards.find((x) => x.key === key);
    return { label, value: c?.value ?? 0, unit: c?.unit ?? unit };
  };
  return [
    pick('orders', '今日订单'),
    pick('redemptions', '今日核销'),
    { label: '今日交易额', value: galaxy.value?.center.todayAmount ?? 0, unit: '元' },
    pick('pointIssued', '今日积分发行'),
  ];
});

// 卡片点击 → 对应列表页
const CARD_ROUTE: Record<string, string> = {
  orders: '/main/orders',
  redemptions: '/main/redemptions',
  exchanges: '/main/redemptions',
  coupons: '/main/coupon-instances',
  pointIssued: '/main/points',
  pointConsumed: '/main/points',
};
function onCardClick(key: string) {
  const to = CARD_ROUTE[key];
  if (to) router.push(to);
}
function onTodoClick() {
  if (todo.value.pendingMerchants) return router.push('/main/merchant-applications');
  if (todo.value.abnormalOrders) return router.push('/main/orders/abnormal');
  return router.push('/main/notifications');
}
/**
 * 视图模式持久化：**用 watch 而不是 radio-group 的 @change** ——
 * Element Plus 的 el-radio-group 事件名在不同版本有差异（实测当前版本 @change 未触发），
 * watch 能覆盖 radio / 按钮 / 编程式赋值等所有改法。
 */
watch(viewMode, (v) => localStorage.setItem(VIEW_KEY, v));

// ---- 趋势折线 ----
const hasTrend = computed(
  () =>
    !!trend.value &&
    (trend.value.orders.some((v) => v > 0) ||
      trend.value.redemptions.some((v) => v > 0) ||
      trend.value.exchanges.some((v) => v > 0)),
);
const trendOption = computed(() => ({
  tooltip: { trigger: 'axis' },
  legend: { data: ['订单', '核销', '兑换'] },
  grid: { left: 48, right: 24, top: 40, bottom: 32 },
  xAxis: { type: 'category', data: trend.value?.dates ?? [] },
  yAxis: { type: 'value' },
  series: [
    { name: '订单', type: 'line', smooth: true, data: trend.value?.orders ?? [] },
    { name: '核销', type: 'line', smooth: true, data: trend.value?.redemptions ?? [] },
    { name: '兑换', type: 'line', smooth: true, data: trend.value?.exchanges ?? [] },
  ],
}));

// ---- 饼图：券类型分布（ownerType → 中文） ----
const OWNER_LABEL: Record<string, string> = { MAIN_COUPON: '主体券', SUB_COUPON: '附属商家券' };
const hasCoupon = computed(() => !!dist.value && dist.value.couponTypes.length > 0);
const couponPieOption = computed(() => ({
  tooltip: { trigger: 'item', formatter: '{b}: {c} ({d}%)' },
  legend: { bottom: 0 },
  series: [
    {
      type: 'pie',
      radius: ['40%', '70%'],
      data: (dist.value?.couponTypes ?? []).map((r) => ({
        name: OWNER_LABEL[r.type] ?? r.type,
        value: r.count,
      })),
    },
  ],
}));

// ---- 饼图：积分来源分布（type → 中文） ----
const POINT_LABEL: Record<string, string> = {
  EARN: '积分发行',
  SPEND: '积分消耗',
  EXPIRE: '过期清零',
  REFUND: '退款',
  ADJUST: '人工调整',
};
const hasPoint = computed(() => !!dist.value && dist.value.pointSources.length > 0);
const pointPieOption = computed(() => ({
  tooltip: { trigger: 'item', formatter: '{b}: {c} ({d}%)' },
  legend: { bottom: 0 },
  series: [
    {
      type: 'pie',
      radius: ['40%', '70%'],
      data: (dist.value?.pointSources ?? []).map((r) => ({
        name: POINT_LABEL[r.type] ?? r.type,
        value: r.value,
      })),
    },
  ],
}));

// ---- 柱状图：Top5 商家（仅主体/平台返回数据，附属/店员此处已被 v-permission 隐藏） ----
const hasTop = computed(() => top.value.length > 0);
const topOption = computed(() => {
  const rows = [...top.value].reverse(); // 金额高在下，视觉更直观
  return {
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
    grid: { left: 96, right: 32, top: 24, bottom: 32 },
    xAxis: { type: 'value' },
    yAxis: { type: 'category', data: rows.map((r) => r.name) },
    series: [
      {
        type: 'bar',
        data: rows.map((r) => r.amount),
        label: { show: true, position: 'right' },
        itemStyle: { color: '#409eff' },
      },
    ],
  };
});

async function loadAll() {
  loading.value = true;
  galaxyLoading.value = true;
  try {
    const [s, t, d, m] = await Promise.all([
      reportApi.dashboardStats(),
      reportApi.dashboardTrend(7),
      reportApi.dashboardDistribution(),
      reportApi.dashboardTopMerchants(),
    ]);
    stats.value = s;
    trend.value = t;
    dist.value = d;
    top.value = m;

    // 星系：仅平台/主体可看；附属/店员拿到 403 → 自动降级数据视图
    try {
      galaxy.value = await reportApi.dashboardGalaxy();
      galaxyAvailable.value = true;
    } catch {
      galaxyAvailable.value = false;
      galaxy.value = null;
      viewMode.value = 'data';
      localStorage.setItem(VIEW_KEY, 'data');
    }
  } finally {
    loading.value = false;
    galaxyLoading.value = false;
  }
}

onMounted(loadAll);
</script>

<style scoped>
.section-title {
  font-size: 15px;
  font-weight: 600;
  margin-bottom: 12px;
  color: var(--el-text-color-primary);
}
.data-view__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.cards {
  margin-bottom: 4px;
}
.metric {
  cursor: pointer;
  transition: transform 0.1s;
}
.metric:hover {
  transform: translateY(-2px);
}
.card-sub {
  margin-top: 6px;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}
.card-sub.link {
  color: var(--el-color-primary);
}
.todo-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 18px 16px;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 8px;
  cursor: pointer;
  transition: background 0.1s;
}
.todo-item:hover {
  background: var(--el-fill-color-light);
}
.todo-label {
  font-size: 14px;
  color: var(--el-text-color-regular);
}
.todo-num {
  font-size: 22px;
  font-weight: 700;
  color: var(--el-color-primary);
}
.todo-num.warn {
  color: var(--el-color-danger);
}

/* ---------------- 星系视图 ---------------- */
.galaxy {
  display: flex;
  flex-direction: column;
  height: calc(100vh - 118px);
  min-height: 520px;
  border-radius: 12px;
  overflow: hidden;
  background: radial-gradient(ellipse at 50% 45%, #1e293b 0%, #0f172a 55%, #0b1220 100%);
  color: #e2e8f0;
}
.galaxy__stage {
  position: relative;
  flex: 1;
  min-height: 0;
}
.galaxy__canvas {
  position: absolute;
  inset: 0;
}
.galaxy__halo {
  position: absolute;
  left: 50%;
  top: 45%;
  width: 240px;
  height: 240px;
  border-radius: 50%;
  pointer-events: none;
  background: radial-gradient(circle, rgba(79, 124, 255, 0.32) 0%, rgba(79, 124, 255, 0) 68%);
  animation: galaxy-breathe 4s ease-in-out infinite;
}
@keyframes galaxy-breathe {
  0%,
  100% {
    transform: translate(-50%, -50%) scale(1);
    opacity: 0.7;
  }
  50% {
    transform: translate(-50%, -50%) scale(1.16);
    opacity: 1;
  }
}
.glass {
  background: rgba(15, 23, 42, 0.55);
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
  border: 1px solid rgba(148, 163, 184, 0.22);
}
.galaxy__overlay {
  position: absolute;
  left: 20px;
  top: 20px;
  width: 300px;
  padding: 16px;
  border-radius: 14px;
}
.galaxy__overlay-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 15px;
  font-weight: 700;
}
.galaxy__dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: #4f7cff;
  box-shadow: 0 0 10px rgba(79, 124, 255, 0.9);
}
.galaxy__name {
  max-width: 160px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.galaxy__metrics {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 10px;
  margin: 14px 0;
}
.galaxy__metric-value {
  font-size: 20px;
  font-weight: 700;
  color: #fff;
}
.galaxy__unit {
  margin-left: 2px;
  font-size: 11px;
  font-weight: 400;
  color: #94a3b8;
}
.galaxy__metric-label {
  font-size: 12px;
  color: #94a3b8;
}
.galaxy__overlay-todo {
  margin-bottom: 12px;
  font-size: 12px;
  color: #cbd5e1;
}
.galaxy__overlay-todo b {
  color: #fbbf24;
  font-size: 14px;
}
.galaxy__footer {
  position: relative;
  z-index: 3;
  flex: none;
  height: 108px;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 0 16px 10px;
}
.galaxy__cards {
  flex: 1;
  min-width: 0;
  display: flex;
  gap: 12px;
  justify-content: center;
  flex-wrap: nowrap;
  overflow: auto;
}
.galaxy__card {
  min-width: 120px;
  padding: 10px 14px;
  border-radius: 12px;
  cursor: pointer;
  transition:
    transform 0.12s,
    border-color 0.12s;
}
.galaxy__card:hover {
  transform: translateY(-3px);
  border-color: rgba(79, 124, 255, 0.6);
}
.galaxy__card-value {
  font-size: 20px;
  font-weight: 700;
  color: #fff;
}
.galaxy__card-label {
  font-size: 12px;
  color: #94a3b8;
}
.galaxy__card-trend {
  font-size: 11px;
  color: #64748b;
}
.galaxy__switch {
  position: relative;
  z-index: 4;
  flex: none;
  padding: 6px;
  border-radius: 10px;
}
.galaxy__hint {
  position: absolute;
  right: 16px;
  top: 20px;
  font-size: 12px;
  color: #64748b;
}
</style>
