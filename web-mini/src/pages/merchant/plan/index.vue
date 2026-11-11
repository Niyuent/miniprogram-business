<script setup lang="ts">
import { computed, ref } from 'vue';
import { onLoad } from '@dcloudio/uni-app';
import NetworkBanner from '@/components/NetworkBanner.vue';
import {
  fetchBilling,
  fetchCatalog,
  fetchOrders,
  submitSubscription,
  type Billing,
  type PlanCatalog,
  type SubscriptionOrder,
} from '@/services/subscription';
import { friendlyMessage } from '@/utils/errors';

const loading = ref(true);
const errorText = ref('');
const billing = ref<Billing | null>(null);
const catalog = ref<PlanCatalog | null>(null);
const orders = ref<SubscriptionOrder[]>([]);
const submitting = ref('');

/** 主体会员周期选择（默认年卡：单价最低，续费也最省事） */
const pickedPeriod = ref('YEAR');

onLoad(() => load());

async function load() {
  loading.value = true;
  errorText.value = '';
  try {
    const [b, c, o] = await Promise.all([fetchBilling(), fetchCatalog(), fetchOrders()]);
    billing.value = b;
    catalog.value = c;
    orders.value = o.items || [];
  } catch (error) {
    errorText.value = friendlyMessage(error, '计费信息加载失败');
  } finally {
    loading.value = false;
  }
}

const tier = computed(() => billing.value?.subTier ?? null);
const tierColor = computed(() => tier.value?.color || '#F5B301');
const usedPct = computed(() => {
  if (!tier.value || !tier.value.allianceLimit) return 0;
  return Math.min(100, Math.round((tier.value.allianceUsed / tier.value.allianceLimit) * 100));
});
const expireText = computed(() => {
  const t = tier.value;
  if (!t) return '';
  if (!t.expiresAt) return '未开通高级档位，长期有效';
  return `高级档位有效期至 ${fmt(t.expiresAt)}`;
});

const mainExpireText = computed(() => {
  const m = billing.value?.mainMember;
  if (!m) return '';
  if (m.blocked) return '会员已到期，联盟内发分与发券已暂停';
  if (!m.expiresAt) return '未开通';
  return `${m.trial ? '试用中' : '有效期至'} ${fmt(m.expiresAt)}`;
});

const mainBlocked = computed(() => Boolean(billing.value?.mainMember?.blocked));

function fmt(iso: string) {
  return iso.slice(0, 10).replace(/-/g, '/');
}

async function buyTier() {
  await submit({ planType: 'SUB_TIER', tier: 'ADVANCED' }, '高级合作商');
}

async function buyMain(period: string) {
  await submit({ planType: 'MAIN_MEMBER', period }, '主体商家会员');
}

async function submit(body: { planType: 'SUB_TIER' | 'MAIN_MEMBER'; tier?: 'ADVANCED'; period?: string }, label: string) {
  if (submitting.value) return;
  const amount = body.planType === 'SUB_TIER'
    ? 19.9
    : catalog.value?.mainMember.items.find((i) => i.period === body.period)?.price ?? 0;
  const ok = await confirmModal(
    `提交${label}充值申请`,
    `本次应付 ¥${amount.toFixed(2)}。\n提交后由平台确认到账，确认前不会生效。`,
  );
  if (!ok) return;

  submitting.value = label;
  try {
    await submitSubscription(body);
    uni.showToast({ title: '已提交，等待确认', icon: 'success' });
    await load();
  } catch (error) {
    uni.showModal({
      title: '提交失败',
      content: friendlyMessage(error, '请稍后重试'),
      showCancel: false,
    });
  } finally {
    submitting.value = '';
  }
}

function confirmModal(title: string, content: string): Promise<boolean> {
  return new Promise((resolve) => {
    uni.showModal({
      title,
      content,
      confirmText: '提交申请',
      success: (res) => resolve(Boolean(res.confirm)),
      fail: () => resolve(false),
    });
  });
}

const STATUS_TEXT: Record<string, string> = {
  PENDING: '待确认',
  ACTIVE: '已生效',
  EXPIRED: '已到期',
  CANCELLED: '已取消',
};
</script>

<template>
  <view class="pm-page">
    <network-banner />

    <view class="pm-hero pm-hero--short">
      <view class="pm-hero__glow" />
      <view class="pm-hero__inner">
        <view class="plan-tag" :style="{ '--tc': tierColor }">
          <view class="plan-tag__dot" />
          <text class="plan-tag__n">{{ tier?.name || '初级合作商' }}</text>
        </view>
        <view class="plan-usage">
          <text class="plan-usage__v">{{ tier?.allianceUsed ?? 0 }}</text>
          <text class="plan-usage__s"> / {{ tier?.allianceLimit ?? 2 }} 个联盟</text>
        </view>
        <text class="pm-hero__cap">{{ expireText }}</text>
      </view>
    </view>

    <view class="pm-body">
      <view v-if="errorText" class="pm-card">
        <view class="pm-empty">
          <text class="pm-empty__t">加载失败</text>
          <text class="pm-empty__d">{{ errorText }}</text>
        </view>
        <button class="pm-btn pm-btn--ghost" hover-class="press" @tap="load">重新加载</button>
      </view>

      <block v-else>
        <!-- 联盟用量 -->
        <view class="pm-card">
          <view class="pm-section">
            <text class="pm-section__t">联盟数量</text>
            <text class="pm-section__more">{{ tier?.allianceRemaining ?? 0 }} 个余量</text>
          </view>
          <view class="pm-bar plan-bar">
            <view class="pm-bar__fill" :style="{ width: `${usedPct}%`, background: tierColor }" />
          </view>
          <text class="plan-hint">
            初级合作商最多 {{ 2 }} 个联盟，高级合作商可到 {{ 10 }} 个。到期后已加入的联盟保留，但不能再新增。
          </text>
        </view>

        <!-- 附属档位 -->
        <view class="pm-card">
          <view class="pm-section">
            <text class="pm-section__t">合作商档位</text>
          </view>
          <view
            v-for="item in catalog?.subTier.items || []"
            :key="item.tier"
            class="plan-opt"
            :class="{ 'is-on': tier?.tier === item.tier }"
          >
            <view class="plan-opt__l">
              <view class="plan-opt__dot" :style="{ background: item.color }" />
              <view class="plan-opt__t">
                <text class="plan-opt__n">{{ item.name }}</text>
                <text class="plan-opt__d">{{ item.desc }}</text>
              </view>
            </view>
            <view class="plan-opt__r">
              <text class="plan-opt__p">{{ item.price ? `¥${item.price}/月` : '免费' }}</text>
              <text v-if="tier?.tier === item.tier" class="pm-pill pm-pill--muted">当前</text>
              <button
                v-else-if="item.tier === 'ADVANCED'"
                class="pm-btn pm-btn--primary pm-btn--sm"
                hover-class="press"
                :loading="submitting === '高级合作商'"
                @tap="buyTier"
              >
                开通
              </button>
            </view>
          </view>
        </view>

        <!-- 主体会员 -->
        <view class="pm-card" :class="{ 'is-bad': mainBlocked }">
          <view class="pm-section">
            <text class="pm-section__t">主体商家会员</text>
            <text class="pm-pill" :class="mainBlocked ? 'pm-pill--danger' : 'pm-pill--teal'">
              {{ billing?.mainMember.trial ? '试用中' : billing?.mainMember.active ? '生效中' : '已停服' }}
            </text>
          </view>
          <text class="plan-hint plan-hint--tight">{{ mainExpireText }}</text>
          <view class="plan-grid">
            <view
              v-for="item in catalog?.mainMember.items || []"
              :key="item.period"
              class="plan-grid__i"
              :class="{ 'is-on': pickedPeriod === item.period }"
              @tap="pickedPeriod = item.period"
            >
              <text class="plan-grid__n">{{ item.name }}</text>
              <text class="plan-grid__p">¥{{ item.price }}</text>
              <text class="plan-grid__m">{{ item.months }} 个月</text>
            </view>
          </view>
          <button
            class="pm-btn pm-btn--dark"
            hover-class="press"
            :loading="submitting === '主体商家会员'"
            @tap="buyMain(pickedPeriod)"
          >
            购买主体会员
          </button>
        </view>

        <!-- 订单 -->
        <view v-if="orders.length" class="pm-card pm-card--flush">
          <view class="pm-section plan-pad">
            <text class="pm-section__t">充值记录</text>
          </view>
          <view v-for="o in orders" :key="o.id" class="pm-row">
            <view class="pm-row__main">
              <text class="pm-row__t">{{ o.tierName || o.periodName }} · ¥{{ o.amount }}</text>
              <text class="pm-row__d">{{ o.orderNo }} · {{ fmt(o.createdAt) }}</text>
            </view>
            <text
              class="pm-pill"
              :class="o.status === 'ACTIVE' ? 'pm-pill--teal' : o.status === 'PENDING' ? 'pm-pill--warn' : 'pm-pill--muted'"
            >
              {{ STATUS_TEXT[o.status] || o.status }}
            </text>
          </view>
        </view>

        <view class="plan-foot">
          <text>线下收款：提交后请联系平台确认到账，确认后立即生效，续费从原到期日顺延。</text>
        </view>
      </block>
    </view>
  </view>
</template>

<style scoped>
.plan-tag {
  display: inline-flex;
  align-items: center;
  gap: 12rpx;
  padding: 8rpx 22rpx;
  border-radius: 999rpx;
  background: rgba(255, 255, 255, 0.1);
  border: 1rpx solid rgba(255, 255, 255, 0.16);
}
.plan-tag__dot {
  width: 14rpx;
  height: 14rpx;
  border-radius: 50%;
  background: var(--tc);
  box-shadow: 0 0 14rpx var(--tc);
}
.plan-tag__n {
  font-size: 24rpx;
  font-weight: 700;
  color: #fff;
}
.plan-usage {
  margin-top: 18rpx;
  display: flex;
  align-items: baseline;
}
.plan-usage__v {
  font-size: 68rpx;
  font-weight: 800;
  color: #fff;
  line-height: 1;
}
.plan-usage__s {
  font-size: 26rpx;
  color: rgba(255, 255, 255, 0.6);
  margin-left: 6rpx;
}

.plan-bar {
  margin-top: 20rpx;
}
.plan-hint {
  display: block;
  margin-top: 18rpx;
  font-size: 22rpx;
  line-height: 1.65;
  color: #6b7f88;
}
.plan-hint--tight {
  margin-top: 10rpx;
}

.plan-opt {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16rpx;
  padding: 22rpx 0;
}
.plan-opt + .plan-opt {
  border-top: 1rpx solid #eef3f5;
}
.plan-opt.is-on .plan-opt__n {
  color: #0e1f26;
}
.plan-opt__l {
  display: flex;
  align-items: center;
  gap: 16rpx;
  flex: 1;
  min-width: 0;
}
.plan-opt__dot {
  width: 18rpx;
  height: 18rpx;
  border-radius: 50%;
  flex-shrink: 0;
}
.plan-opt__t {
  min-width: 0;
}
.plan-opt__n {
  display: block;
  font-size: 28rpx;
  font-weight: 700;
  color: #0e1f26;
}
.plan-opt__d {
  display: block;
  margin-top: 6rpx;
  font-size: 21rpx;
  color: #8a9aa2;
  line-height: 1.5;
}
.plan-opt__r {
  display: flex;
  align-items: center;
  gap: 14rpx;
  flex-shrink: 0;
}
.plan-opt__p {
  font-size: 24rpx;
  font-weight: 700;
  color: #0e1f26;
}

.plan-grid {
  display: flex;
  gap: 14rpx;
  margin: 20rpx 0 22rpx;
}
.plan-grid__i {
  flex: 1;
  padding: 20rpx 8rpx;
  border-radius: 20rpx;
  border: 2rpx solid #e6eef1;
  text-align: center;
  background: #fff;
}
.plan-grid__i.is-on {
  border-color: #00d6b2;
  background: #f2fdfa;
}
.plan-grid__n {
  display: block;
  font-size: 22rpx;
  color: #6b7f88;
}
.plan-grid__p {
  display: block;
  margin-top: 8rpx;
  font-size: 32rpx;
  font-weight: 800;
  color: #07262f;
}
.plan-grid__m {
  display: block;
  margin-top: 4rpx;
  font-size: 19rpx;
  color: #a4b3ba;
}

.plan-pad {
  padding: 0 24rpx;
}
.plan-foot {
  padding: 8rpx 12rpx 40rpx;
  font-size: 21rpx;
  line-height: 1.7;
  color: #9aa9b0;
}
</style>
