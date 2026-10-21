<script setup lang="ts">
import { computed, ref } from 'vue';
import { onLoad } from '@dcloudio/uni-app';
import NetworkBanner from '@/components/NetworkBanner.vue';
import {
  fetchIssueOptions,
  findUserIdByPhone,
  type IssueMerchantOption,
  type IssueOptions,
} from '@/services/merchant';
import { request } from '@/utils/request';
import { friendlyMessage } from '@/utils/errors';

type TemplateRow = {
  id: number;
  name: string;
  status?: string;
  faceValue?: number;
  ownerType?: string;
  remainingStock?: number;
  totalStock?: number;
};

type IssuedRow = { id: number; code?: string; expireAt?: string };

const loading = ref(true);
const submitting = ref(false);
const errorText = ref('');
const options = ref<IssueOptions | null>(null);
const templates = ref<TemplateRow[]>([]);
const templateId = ref(0);

/** one=单家 multi=多选 all=全体 */
const scopeMode = ref<'one' | 'multi' | 'all'>('one');
const selectedIds = ref<number[]>([]);

const audience = ref<'USER' | 'MERCHANT_VISITORS'>('USER');
const targetType = ref<'phone' | 'userId'>('phone');
const phone = ref('');
const userId = ref('');
const quantity = ref(1);
const resultText = ref('');
const issued = ref<IssuedRow[]>([]);

const isMain = computed(() => options.value?.merchantType === 'MAIN');
const merchants = computed(() => options.value?.merchants || []);
const current = computed(() => templates.value.find((t) => t.id === templateId.value) || null);

const selectedLabel = computed(() => {
  if (scopeMode.value === 'all') return `全体联盟（${merchants.value.length} 家）`;
  if (!selectedIds.value.length) return '请选择商家';
  const names = merchants.value
    .filter((m) => selectedIds.value.includes(m.id))
    .map((m) => m.name);
  return names.join('、');
});

const canSubmit = computed(() => {
  if (!templateId.value || submitting.value) return false;
  if (scopeMode.value !== 'all' && !selectedIds.value.length) return false;
  if (audience.value === 'MERCHANT_VISITORS') return true;
  if (targetType.value === 'phone') return /^1[3-9]\d{9}$/.test(phone.value.trim());
  return !!Number(userId.value);
});

onLoad((query) => {
  const preset = Number(query?.templateId || 0);
  if (preset) templateId.value = preset;
  load();
});

async function load() {
  loading.value = true;
  errorText.value = '';
  try {
    const opts = await fetchIssueOptions();
    options.value = opts;
    selectedIds.value = [opts.merchantId];
    scopeMode.value = opts.merchantType === 'MAIN' ? 'one' : 'one';

    const qs = opts.onlyMainCoupons
      ? 'page=1&pageSize=100&status=PUBLISHED&ownerType=MAIN_COUPON'
      : 'page=1&pageSize=100&status=PUBLISHED';
    const data = await request<{ list?: TemplateRow[] }>({
      url: `/coupon-templates?${qs}`,
      redirectOn401: false,
    });
    let rows = data?.list || [];
    if (opts.onlyMainCoupons) {
      rows = rows.filter((t) => !t.ownerType || t.ownerType === 'MAIN_COUPON');
    }
    templates.value = rows;
    if (!templateId.value && rows[0]) templateId.value = rows[0].id;
    if (templateId.value && !rows.some((t) => t.id === templateId.value)) {
      templateId.value = rows[0]?.id || 0;
    }
  } catch (error) {
    errorText.value = friendlyMessage(error, '发券选项加载失败');
    templates.value = [];
  } finally {
    loading.value = false;
  }
}

function pickTemplate() {
  if (!templates.value.length) {
    uni.showToast({
      title: options.value?.onlyMainCoupons ? '暂无可发主体券（需授权）' : '暂无已上架券',
      icon: 'none',
    });
    return;
  }
  uni.showActionSheet({
    itemList: templates.value.map(
      (t) => `${t.name} · ¥${t.faceValue ?? 0}（余 ${t.remainingStock ?? '—'}）`,
    ),
    success(res) {
      const row = templates.value[res.tapIndex];
      if (row) templateId.value = row.id;
    },
  });
}

function setScope(mode: 'one' | 'multi' | 'all') {
  if (!isMain.value && mode !== 'one') {
    uni.showToast({ title: '附属商家只能发本店', icon: 'none' });
    return;
  }
  scopeMode.value = mode;
  if (mode === 'all') {
    selectedIds.value = merchants.value.map((m) => m.id);
  } else if (mode === 'one' && selectedIds.value.length > 1) {
    selectedIds.value = [selectedIds.value[0] || options.value!.merchantId];
  }
}

function toggleMerchant(row: IssueMerchantOption) {
  if (!isMain.value) return;
  if (scopeMode.value === 'all') {
    scopeMode.value = 'multi';
  }
  if (scopeMode.value === 'one') {
    selectedIds.value = [row.id];
    return;
  }
  const set = new Set(selectedIds.value);
  if (set.has(row.id)) {
    if (set.size <= 1) return;
    set.delete(row.id);
  } else {
    set.add(row.id);
  }
  selectedIds.value = [...set];
}

function setAudience(value: 'USER' | 'MERCHANT_VISITORS') {
  audience.value = value;
}

function setTarget(type: 'phone' | 'userId') {
  targetType.value = type;
}

function buildScopePayload() {
  if (scopeMode.value === 'all') {
    return { allMerchants: true as const };
  }
  return { targetMerchantIds: [...selectedIds.value], allMerchants: false as const };
}

async function onIssue() {
  if (!canSubmit.value || !templateId.value) return;
  submitting.value = true;
  resultText.value = '';
  issued.value = [];
  try {
    const scope = buildScopePayload();
    const qty = Math.min(50, Math.max(1, Number(quantity.value) || 1));
    let payload: Record<string, unknown> = {
      templateId: templateId.value,
      quantity: qty,
      audience: audience.value,
      ...scope,
    };

    if (audience.value === 'USER') {
      if (targetType.value === 'phone') {
        const uid = await findUserIdByPhone(phone.value.trim()).catch(() => null);
        payload = uid
          ? { ...payload, userId: uid }
          : { ...payload, phone: phone.value.trim() };
      } else {
        payload = { ...payload, userId: Number(userId.value) };
      }
    }

    // 主体单选商家时，可用该商家身份发券
    if (isMain.value && scopeMode.value === 'one' && selectedIds.value[0]) {
      payload = { ...payload, merchantId: selectedIds.value[0] };
    }

    const res = await request<{
      quantity?: number;
      expireAt?: string;
      issued?: IssuedRow[];
      mode?: string;
      userCount?: number;
      failCount?: number;
      issuedQuantity?: number;
      targetMerchantIds?: number[];
    }>({
      url: '/coupon-instances/issue',
      method: 'POST',
      data: payload,
      redirectOn401: false,
    });

    if (res.mode === 'MERCHANT_VISITORS') {
      resultText.value = `已向 ${res.userCount} 位到店会员发放，共 ${res.issuedQuantity} 张${
        res.failCount ? `（跳过 ${res.failCount}）` : ''
      }`;
      issued.value = [];
    } else {
      issued.value = res.issued || [];
      resultText.value = `已发放 ${res.quantity} 张${res.expireAt ? `，有效期至 ${res.expireAt}` : ''}`;
    }
    uni.showToast({ title: '发放成功', icon: 'success' });
    await load();
  } catch (error) {
    uni.showToast({ title: friendlyMessage(error, '发放失败'), icon: 'none' });
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <view class="page">
    <network-banner />
    <view class="hero">
      <text class="hero__t">代金券发放</text>
      <text class="hero__d">
        {{
          isMain
            ? '可选某家 / 多家 / 全体联盟商家'
            : '附属商家仅可发放主体商家代金券'
        }}
      </text>
    </view>

    <view v-if="loading" class="skel" />
    <view v-else-if="errorText" class="fail">{{ errorText }}</view>
    <view v-else class="card">
      <text class="label">券模板{{ options?.onlyMainCoupons ? '（仅主体券）' : '' }}</text>
      <view class="picker" @tap="pickTemplate">
        <text v-if="current">{{ current.name }} · 余 {{ current.remainingStock ?? '—' }}</text>
        <text v-else class="ph">选择已上架券模板</text>
        <text class="arrow">›</text>
      </view>

      <text class="label">发放商家</text>
      <view class="tabs">
        <view class="tab" :class="{ on: scopeMode === 'one' }" @tap="setScope('one')">某家</view>
        <view class="tab" :class="{ on: scopeMode === 'multi', dim: !isMain }" @tap="setScope('multi')">多选</view>
        <view class="tab" :class="{ on: scopeMode === 'all', dim: !isMain }" @tap="setScope('all')">全体</view>
      </view>
      <text class="hint">{{ selectedLabel }}</text>
      <view class="merchant-list">
        <view
          v-for="m in merchants"
          :key="m.id"
          class="m-row"
          :class="{ on: scopeMode === 'all' || selectedIds.includes(m.id) }"
          @tap="toggleMerchant(m)"
        >
          <view class="check">{{ scopeMode === 'all' || selectedIds.includes(m.id) ? '✓' : '' }}</view>
          <view class="m-main">
            <text class="m-name">{{ m.name }}</text>
            <text class="m-role">{{ m.role === 'MAIN' ? '主体' : '附属' }}</text>
          </view>
        </view>
      </view>

      <text class="label">发放对象</text>
      <view class="tabs">
        <view class="tab" :class="{ on: audience === 'USER' }" @tap="setAudience('USER')">指定会员</view>
        <view
          class="tab"
          :class="{ on: audience === 'MERCHANT_VISITORS' }"
          @tap="setAudience('MERCHANT_VISITORS')"
        >所选商家到店会员</view>
      </view>

      <template v-if="audience === 'USER'">
        <view class="tabs sm">
          <view class="tab" :class="{ on: targetType === 'phone' }" @tap="setTarget('phone')">手机号</view>
          <view class="tab" :class="{ on: targetType === 'userId' }" @tap="setTarget('userId')">用户 id</view>
        </view>
        <input
          v-if="targetType === 'phone'"
          v-model="phone"
          class="input"
          type="number"
          maxlength="11"
          placeholder="会员手机号"
        />
        <input
          v-else
          v-model="userId"
          class="input"
          type="number"
          placeholder="用户 id"
        />
      </template>
      <text v-else class="hint">将向所选商家近到店会员各发 {{ quantity }} 张（最多 100 人）</text>

      <text class="label">每人数量（1–50）</text>
      <input v-model.number="quantity" class="input" type="number" />

      <button class="btn" :disabled="!canSubmit" :loading="submitting" @tap="onIssue">
        {{ submitting ? '发放中…' : '确认发放' }}
      </button>
    </view>

    <view v-if="resultText" class="card result">
      <text class="ok">{{ resultText }}</text>
      <view v-for="row in issued" :key="row.id" class="code-row">
        <text class="code">{{ row.code || `#${row.id}` }}</text>
        <text class="exp">{{ row.expireAt || '' }}</text>
      </view>
    </view>
  </view>
</template>

<style scoped>
.page { min-height: 100vh; padding-bottom: 80rpx; box-sizing: border-box; background: #f3f7f8; }
.hero {
  padding: 36rpx 32rpx 48rpx;
  background: linear-gradient(135deg, #09303a 0%, #0b2440 100%);
  border-radius: 0 0 40rpx 40rpx;
}
.hero__t { display: block; font-size: 40rpx; font-weight: 800; color: #fff; }
.hero__d { display: block; margin-top: 10rpx; font-size: 24rpx; color: rgba(255,255,255,.85); }
.card {
  margin: -20rpx 32rpx 20rpx; padding: 28rpx; background: #fff; border-radius: 32rpx;
  box-shadow: 0 12rpx 36rpx rgba(10, 60, 58, 0.06); position: relative; z-index: 1;
}
.label { display: block; margin: 8rpx 0 12rpx; font-size: 24rpx; color: #8a9aa3; font-weight: 600; }
.picker {
  display: flex; align-items: center; justify-content: space-between;
  padding: 22rpx 24rpx; border-radius: 20rpx; background: #f3f7f8; margin-bottom: 16rpx;
  font-size: 28rpx; font-weight: 700; color: #0e1f26;
}
.ph { color: #8a9aa3; font-weight: 500; }
.arrow { color: #8a9aa3; font-size: 36rpx; }
.tabs { display: flex; gap: 12rpx; margin-bottom: 12rpx; flex-wrap: wrap; }
.tabs.sm .tab { font-size: 24rpx; padding: 12rpx 0; }
.tab {
  flex: 1; min-width: 28%; text-align: center; padding: 16rpx 0; border-radius: 999rpx;
  background: #f1f5f7; color: #556670; font-weight: 700; font-size: 26rpx;
}
.tab.on { background: linear-gradient(135deg, #00d6b2, #19a7f8); color: #fff; }
.tab.dim { opacity: 0.45; }
.hint { display: block; margin: 0 0 12rpx; font-size: 22rpx; color: #8a9aa3; line-height: 1.4; }
.merchant-list { margin-bottom: 12rpx; }
.m-row {
  display: flex; align-items: center; gap: 16rpx; padding: 18rpx 0;
  border-top: 1px solid #eaf0f2;
}
.m-row:first-child { border-top: none; }
.m-row.on .check { background: #00b8a0; color: #fff; border-color: #00b8a0; }
.check {
  width: 44rpx; height: 44rpx; border-radius: 12rpx; border: 2rpx solid #c5d0d6;
  display: flex; align-items: center; justify-content: center; font-size: 22rpx; font-weight: 800;
  color: transparent; flex-shrink: 0;
}
.m-main { flex: 1; min-width: 0; display: flex; align-items: center; gap: 12rpx; }
.m-name { font-size: 28rpx; font-weight: 700; color: #0e1f26; }
.m-role {
  padding: 2rpx 10rpx; border-radius: 999rpx; background: #f1f5f7; color: #556670;
  font-size: 20rpx; font-weight: 600;
}
.input {
  height: 84rpx; padding: 0 24rpx; border-radius: 20rpx; background: #f3f7f8;
  margin-bottom: 16rpx; font-size: 28rpx;
}
.btn {
  margin-top: 12rpx; background: linear-gradient(135deg, #00d6b2, #19a7f8);
  color: #fff; border-radius: 999rpx; font-weight: 800; border: none;
}
.btn[disabled] { opacity: 0.45; }
.result .ok { display: block; font-size: 28rpx; font-weight: 800; color: #00766a; margin-bottom: 12rpx; }
.code-row {
  display: flex; justify-content: space-between; gap: 12rpx;
  padding: 14rpx 0; border-top: 1px solid #eaf0f2; font-size: 24rpx;
}
.code { font-weight: 700; color: #0e1f26; font-family: ui-monospace, monospace; }
.exp { color: #8a9aa3; }
.fail { margin: 32rpx; color: #c22a2e; font-weight: 700; }
.skel { margin: 32rpx; height: 360rpx; border-radius: 32rpx; background: #e2eaee; }
</style>
