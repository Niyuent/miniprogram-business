<script setup lang="ts">
import { computed, ref } from 'vue';
import { onPullDownRefresh, onShareAppMessage, onShow } from '@dcloudio/uni-app';
import NetworkBanner from '@/components/NetworkBanner.vue';
import SlideSheet from '@/components/SlideSheet.vue';
import { useSessionStore } from '@/stores/session';
import {
  fetchMemberDesk,
  fetchMerchantAlliances,
  fetchWorkbench,
  toScannedMember,
  type MerchantAllianceItem,
} from '@/services/merchant';
import { earnWithOrder } from '@/services/earn';
import { friendlyMessage } from '@/utils/errors';
import { applySharePath, merchantInviteCode } from '@/utils/share';
import type { ScannedMember } from '@/utils/memberQr';

const session = useSessionStore();
const loading = ref(true);
const storeId = ref<number | null>(null);
const merchantId = ref<number | null>(null);
const errorText = ref('');
const sheetOpen = ref(false);
const allianceOpen = ref(false);
const memberLoading = ref(false);
const submitting = ref(false);
const member = ref<{ userId: number; name: string; phone: string } | null>(null);
const amount = ref('');
const mockOpen = ref(false);
const mockCode = ref('SM_MEMBER:');
const alliances = ref<MerchantAllianceItem[]>([]);
const selectedAlliance = ref<MerchantAllianceItem | null>(null);

const payAmount = computed(() => Number(amount.value));
const amountOk = computed(() => Number.isFinite(payAmount.value) && payAmount.value > 0);

onShareAppMessage(() => ({
  title: '邀请商家一起用小Z发积分',
  path: applySharePath(merchantInviteCode(merchantId.value)),
}));

function sampleHint(item: MerchantAllianceItem) {
  const names = (item.sampleMerchants || []).map((m) => m.name).filter(Boolean);
  if (!names.length) {
    return item.role === 'MAIN' ? '本店为主体商家' : '包含本店';
  }
  const head = names.slice(0, 3).join('、');
  if (item.peerMerchantCount > names.length) {
    return `包含${head}等 ${item.peerMerchantCount + 1} 家`;
  }
  return `包含${head}${names.length < item.peerMerchantCount + 1 ? '、本店' : ''}`;
}

function isWeb() {
  try {
    return uni.getSystemInfoSync().uniPlatform === 'web';
  } catch {
    return false;
  }
}

async function prepare() {
  loading.value = true;
  try {
    const desk = await fetchWorkbench();
    storeId.value = desk.storeId;
    merchantId.value = desk.merchantId;
    errorText.value = '';
  } catch (error) {
    errorText.value = friendlyMessage(error, '门店信息没有加载出来');
  } finally {
    loading.value = false;
    uni.stopPullDownRefresh();
  }
}

async function openConfirm(target: ScannedMember) {
  sheetOpen.value = true;
  allianceOpen.value = false;
  selectedAlliance.value = null;
  alliances.value = [];
  memberLoading.value = true;
  member.value = null;
  amount.value = '';
  errorText.value = '';
  try {
    // 与核销页共用 member-desk：兼容 5 分钟票据与旧版会员编号
    const desk = await fetchMemberDesk(target);
    member.value = {
      userId: desk.member.userId,
      name: desk.member.name,
      phone: desk.member.phone,
    };
  } catch (error) {
    sheetOpen.value = false;
    uni.showToast({ title: friendlyMessage(error, '会员信息没有查到'), icon: 'none' });
  } finally {
    memberLoading.value = false;
  }
}

function handleScanResult(raw: string) {
  const target = toScannedMember(raw);
  if (!target) {
    uni.showToast({ title: '无效的会员码', icon: 'none' });
    return;
  }
  openConfirm(target);
}

function scan() {
  if (isWeb()) {
    mockCode.value = 'SM_MEMBER:';
    mockOpen.value = true;
    return;
  }
  uni.scanCode({
    onlyFromCamera: false,
    success(res) {
      handleScanResult(res.result || '');
    },
    fail() {
      uni.showToast({ title: '扫码取消或失败', icon: 'none' });
    },
  });
}

function confirmMock() {
  mockOpen.value = false;
  handleScanResult(mockCode.value);
}

function closeSheet() {
  if (submitting.value) return;
  sheetOpen.value = false;
  allianceOpen.value = false;
}

async function loadAlliances(): Promise<MerchantAllianceItem[]> {
  if (!merchantId.value) {
    throw new Error('未绑定商家');
  }
  const data = await fetchMerchantAlliances(merchantId.value);
  const items = data.items || [];
  alliances.value = items;
  return items;
}

async function doEarn(allianceId: number, allianceName?: string) {
  if (!member.value) return;
  submitting.value = true;
  errorText.value = '';
  try {
    // 与核销页同一条链路：先建消费订单，再发分（services/earn.ts）
    const outcome = await earnWithOrder({
      userId: member.value.userId,
      amount: payAmount.value,
      allianceId,
      storeId: storeId.value,
    });
    if (!outcome.earned) {
      errorText.value =
        outcome.message ||
        (outcome.reasonCode === 'BELOW_MIN_AMOUNT' ? '金额太小，这次不发积分' : '这次没有发放积分');
      allianceOpen.value = false;
      return;
    }
    try {
      uni.vibrateShort({ type: 'medium' });
    } catch {
      /* ignore */
    }
    sheetOpen.value = false;
    allianceOpen.value = false;
    amount.value = '';
    member.value = null;
    selectedAlliance.value = null;
    const tag = outcome.allianceName || allianceName || '';
    uni.showToast({
      title: tag ? `已发放 +${outcome.points} [${tag}]` : `积分发放成功 +${outcome.points}`,
      icon: 'success',
      duration: 2200,
    });
  } catch (error) {
    errorText.value = friendlyMessage(error, '积分没有发放成功');
    allianceOpen.value = false;
  } finally {
    submitting.value = false;
  }
}

async function confirmEarn() {
  if (submitting.value || !amountOk.value || !member.value) return;
  submitting.value = true;
  errorText.value = '';
  try {
    const items = await loadAlliances();
    if (!items.length) {
      errorText.value = '本店尚未加入任何联盟，无法发分';
      submitting.value = false;
      return;
    }
    if (items.length === 1) {
      selectedAlliance.value = items[0];
      // doEarn 自行管理 submitting
      await doEarn(items[0].allianceId, items[0].name);
      return;
    }
    // 多联盟：弹出选择抽屉
    submitting.value = false;
    allianceOpen.value = true;
  } catch (error) {
    errorText.value = friendlyMessage(error, '获取联盟列表失败');
    submitting.value = false;
  }
}

async function pickAlliance(item: MerchantAllianceItem) {
  if (submitting.value) return;
  selectedAlliance.value = item;
  await doEarn(item.allianceId, item.name);
}

onPullDownRefresh(() => prepare());
onShow(() => {
  session.hydrate();
  prepare();
});
</script>

<template>
  <view class="pm-page pm-page--plain">
    <network-banner />

    <view class="pm-hero pm-hero--short">
      <view class="pm-hero__glow" />
      <view class="pm-hero__glow2" />
      <view class="pm-hero__inner">
        <text class="pm-hero__title">扫码录单</text>
        <text class="pm-hero__cap hero-cap">扫描顾客「我的会员码」，录入消费金额并发放积分</text>
      </view>
    </view>

    <view class="pm-body">
      <view v-if="loading" class="pm-card">
        <view class="pm-skel" style="height: 300rpx" />
      </view>
      <template v-else>
        <view class="pm-card scan-card">
          <view class="scan-ico">
            <view class="scan-ico__box" />
          </view>
          <text class="scan-t">扫一扫会员码</text>
          <text class="scan-d">顾客在「会员码」页亮码，扫完即可录单</text>
          <view class="pm-btn pm-btn--primary scan-go" hover-class="press" @tap="scan">开始扫码</view>
        </view>

        <view v-if="errorText && !sheetOpen" class="pm-card fail">
          <text class="fail__t">{{ errorText }}</text>
        </view>

        <view class="pm-card tips">
          <text class="tips__t">积分怎么算</text>
          <text class="tips__d">积分 = 消费金额 × 联盟积分比例，由后端规则引擎计算，不需要店员换算。</text>
        </view>
      </template>
    </view>

    <slide-sheet :visible="sheetOpen && !allianceOpen" @close="closeSheet">
      <view class="sheet">
        <text class="sheet__title">确认录单</text>
        <view v-if="memberLoading" class="sheet__skel" />
        <template v-else-if="member">
          <view class="member">
            <text class="member__name">{{ member.name }}</text>
            <text class="member__phone">{{ member.phone }}</text>
          </view>
          <text class="label">本次消费金额（元）</text>
          <input
            v-model="amount"
            class="field"
            type="digit"
            placeholder="请输入消费金额"
          />
          <view v-if="errorText" class="fail">{{ errorText }}</view>
          <button
            class="go"
            hover-class="press"
            :loading="submitting"
            :disabled="!amountOk || submitting"
            @tap="confirmEarn"
          >
            {{ submitting ? '正在发放…' : '确认发放' }}
          </button>
        </template>
      </view>
    </slide-sheet>

    <slide-sheet :visible="allianceOpen" @close="allianceOpen = false">
      <view class="sheet">
        <text class="sheet__title">请选择本次积分的发放联盟</text>
        <text class="sheet__hint">本店属于多个联盟，请确认积分记入哪一个池</text>
        <view
          v-for="item in alliances"
          :key="item.allianceId"
          class="alliance"
          hover-class="press"
          @tap="pickAlliance(item)"
        >
          <view class="alliance__row">
            <text class="alliance__name">{{ item.name }}</text>
            <text class="alliance__role">{{ item.role === 'MAIN' ? '主体' : '附属' }}</text>
          </view>
          <text class="alliance__desc">{{ sampleHint(item) }}</text>
        </view>
        <view v-if="errorText" class="fail">{{ errorText }}</view>
      </view>
    </slide-sheet>

    <slide-sheet :visible="mockOpen" @close="mockOpen = false">
      <view class="sheet">
        <text class="sheet__title">模拟扫码（H5）</text>
        <text class="label">粘贴会员码内容</text>
        <input v-model="mockCode" class="field" placeholder="SM_TICKET:… 或 SM_MEMBER:用户ID" />
        <button class="go" hover-class="press" @tap="confirmMock">确认</button>
      </view>
    </slide-sheet>
  </view>
</template>

<style scoped>
.page {
  min-height: 100vh;
  padding: 40rpx 32rpx 80rpx;
  box-sizing: border-box;
  background: linear-gradient(180deg, #dbeafe 0%, #e7eef8 45%, #f8fafc 100%);
}
.skel { height: 360rpx; border-radius: 24rpx; background: #e2e8f0; }
.hero { margin-bottom: 40rpx; }
.hero__title { display: block; font-size: 48rpx; font-weight: 800; color: #0f172a; }
.hero__sub { display: block; margin-top: 12rpx; color: #64748b; line-height: 1.5; font-size: 26rpx; }
.scan {
  height: 200rpx;
  line-height: 200rpx;
  font-size: 44rpx;
  font-weight: 800;
  color: #fff;
  background: linear-gradient(135deg, #1d4ed8, #0284c7);
  border-radius: 28rpx;
  box-shadow: 0 18rpx 40rpx rgba(29, 78, 216, 0.3);
}
.fail { color: #b91c1c; font-weight: 700; line-height: 1.5; margin-top: 20rpx; }
.sheet { padding-bottom: 24rpx; }
.sheet__title { display: block; font-size: 40rpx; font-weight: 800; margin-bottom: 12rpx; }
.sheet__hint { display: block; color: #64748b; font-size: 26rpx; margin-bottom: 24rpx; line-height: 1.4; }
.sheet__skel { height: 280rpx; border-radius: 16rpx; background: #e2e8f0; }
.member {
  background: #f1f5f9;
  border-radius: 20rpx;
  padding: 24rpx;
  margin-bottom: 28rpx;
}
.member__name { display: block; font-size: 36rpx; font-weight: 800; }
.member__phone { display: block; margin-top: 8rpx; color: #64748b; }
.label { display: block; color: #64748b; margin-bottom: 12rpx; font-size: 26rpx; }
.field {
  background: #f8fafc;
  border: 2rpx solid #e2e8f0;
  border-radius: 16rpx;
  padding: 28rpx 24rpx;
  font-size: 36rpx;
  margin-bottom: 20rpx;
}
.go {
  background: #1d4ed8;
  color: #fff;
  border-radius: 20rpx;
  font-size: 36rpx;
  font-weight: 800;
  height: 104rpx;
  line-height: 104rpx;
}
.go[disabled] { opacity: 0.45; }
.alliance {
  background: #f8fafc;
  border: 2rpx solid #e2e8f0;
  border-radius: 20rpx;
  padding: 28rpx 24rpx;
  margin-bottom: 16rpx;
}
.alliance__row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16rpx;
}
.alliance__name { font-size: 34rpx; font-weight: 800; color: #0f172a; }
.alliance__role {
  font-size: 22rpx;
  color: #1d4ed8;
  background: #dbeafe;
  padding: 6rpx 14rpx;
  border-radius: 999rpx;
  flex-shrink: 0;
}
.alliance__desc {
  display: block;
  margin-top: 10rpx;
  color: #64748b;
  font-size: 24rpx;
  line-height: 1.4;
}

/* ---------- 新首屏 ---------- */
.hero-cap { display: block; margin-top: 12rpx; line-height: 1.5; }

.scan-card { display: flex; flex-direction: column; align-items: center; padding: 44rpx 32rpx 36rpx; }
.scan-ico {
  width: 152rpx; height: 152rpx; border-radius: 44rpx;
  background: #e8fbf7; border: 1rpx solid #c7f5eb;
  display: flex; align-items: center; justify-content: center;
}
.scan-ico__box {
  width: 72rpx; height: 72rpx; border-radius: 12rpx;
  border: 6rpx solid #00b8a0;
  position: relative;
}
.scan-t { margin-top: 28rpx; font-size: 32rpx; font-weight: 700; color: #0e1f26; }
.scan-d { margin-top: 10rpx; font-size: 22rpx; color: #8a9aa3; text-align: center; line-height: 1.5; }
.scan-go { width: 100%; margin-top: 32rpx; }

.tips { margin-top: 20rpx; }
.tips__t { display: block; font-size: 24rpx; font-weight: 700; color: #33454f; }
.tips__d { display: block; margin-top: 8rpx; font-size: 22rpx; color: #8a9aa3; line-height: 1.6; }
.fail__t { font-size: 26rpx; color: #c0342f; line-height: 1.55; }
</style>
