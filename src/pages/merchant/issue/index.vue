<script setup lang="ts">
import { computed, ref } from 'vue';
import { onLoad } from '@dcloudio/uni-app';
import NetworkBanner from '@/components/NetworkBanner.vue';
import {
  fetchIssueOptions,
  findUserIdByPhone,
  quickIssueCoupon,
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
  thresholdAmount?: number;
  ownerType?: string;
  remainingStock?: number;
  totalStock?: number;
};

type IssuedRow = { id: number; code?: string; expireAt?: string };

const FACE_MAX = 500;

const loading = ref(true);
const submitting = ref(false);
const errorText = ref('');
const options = ref<IssueOptions | null>(null);
const templates = ref<TemplateRow[]>([]);
const templateId = ref(0);

const sheetOpen = ref(false);
const createOpen = ref(false);
const creating = ref(false);
const createForm = ref({
  benefitType: 'VOUCHER' as 'VOUCHER' | 'ITEM',
  itemName: '',
  faceValue: 15,
  thresholdAmount: 0,
  validDays: 7,
  totalStock: 100,
});

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
const canQuickCreate = computed(() => !!options.value?.canQuickCreate);
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

/** 首屏主数字：以当前券的面值为主 */
const heroFace = computed(() => {
  const t = current.value;
  if (!t) return { v: '—', u: '请选择券模板' };
  const face = Number(t.faceValue) || 0;
  const thr = Number(t.thresholdAmount) || 0;
  if (face > 0) return { v: String(face), u: thr > 0 ? `元 · 满 ${thr} 可用` : '元 · 无门槛' };
  return { v: '兑换', u: '物品兑换券' };
});

const heroSub = computed(() => {
  const t = current.value;
  if (!t) return '尚未选择券模板';
  return `${t.name} · 余 ${t.remainingStock ?? '—'} 张`;
});

const createPreview = computed(() => {
  const f = createForm.value;
  const days = Number(f.validDays) || 7;
  const stock = Number(f.totalStock) || 0;
  if (f.benefitType === 'ITEM') {
    const item = f.itemName.trim() || '（请填写物品）';
    return `本次将发放 ${stock} 张「${item}」兑换券（有效期${days}天）`;
  }
  const face = Number(f.faceValue) || 0;
  const thr = Number(f.thresholdAmount) || 0;
  const thrText = thr > 0 ? `满${thr}减${face}` : `${face}元无门槛`;
  return `本次将发放 ${stock} 张 ${thrText}券（有效期${days}天）`;
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
    scopeMode.value = 'one';

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
    // 附属快速建的附属券也要能看到：再拉一份自己的已上架券
    if (!opts.onlyMainCoupons || opts.canQuickCreate) {
      try {
        const own = await request<{ list?: TemplateRow[] }>({
          url: '/coupon-templates?page=1&pageSize=100&status=PUBLISHED',
          redirectOn401: false,
        });
        const map = new Map(rows.map((r) => [r.id, r]));
        for (const r of own?.list || []) map.set(r.id, r);
        rows = [...map.values()];
      } catch {
        /* ignore */
      }
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

function openTemplateSheet() {
  sheetOpen.value = true;
}

function selectTemplate(row: TemplateRow) {
  templateId.value = row.id;
  sheetOpen.value = false;
}

function openCreateDrawer() {
  if (!canQuickCreate.value) {
    uni.showToast({ title: '暂无建券权限', icon: 'none' });
    return;
  }
  sheetOpen.value = false;
  createForm.value = {
    benefitType: 'VOUCHER',
    itemName: '',
    faceValue: 15,
    thresholdAmount: 0,
    validDays: 7,
    totalStock: 100,
  };
  createOpen.value = true;
}

function setBenefitType(kind: 'VOUCHER' | 'ITEM') {
  createForm.value.benefitType = kind;
  if (kind === 'ITEM' && !createForm.value.itemName) {
    createForm.value.faceValue = 0;
    createForm.value.thresholdAmount = 0;
  }
  if (kind === 'VOUCHER' && !(Number(createForm.value.faceValue) > 0)) {
    createForm.value.faceValue = 15;
  }
}

function stepQty(delta: number) {
  const next = Math.min(50, Math.max(1, (Number(quantity.value) || 1) + delta));
  quantity.value = next;
}

async function onQuickCreate() {
  const f = createForm.value;
  const days = Number(f.validDays);
  const stock = Number(f.totalStock);
  const itemName = f.itemName.trim();
  const face = Number(f.faceValue) || 0;
  const thr = Number(f.thresholdAmount) || 0;

  if (f.benefitType === 'ITEM') {
    if (!itemName) {
      uni.showToast({ title: '请填写兑换物品', icon: 'none' });
      return;
    }
    if (face < 0 || face > FACE_MAX) {
      uni.showToast({ title: `参考价值需在 0–${FACE_MAX} 元`, icon: 'none' });
      return;
    }
  } else {
    if (!(face > 0) || face > FACE_MAX) {
      uni.showToast({ title: `面值需在 0.01–${FACE_MAX} 元`, icon: 'none' });
      return;
    }
    if (thr < 0) {
      uni.showToast({ title: '门槛不能为负', icon: 'none' });
      return;
    }
  }
  if (!(days >= 1)) {
    uni.showToast({ title: '有效期至少 1 天', icon: 'none' });
    return;
  }
  if (!(stock >= 1 && stock <= 5000)) {
    uni.showToast({ title: '发放数量 1–5000', icon: 'none' });
    return;
  }

  creating.value = true;
  try {
    const scope =
      scopeMode.value === 'all'
        ? { allMerchants: true as const }
        : { targetMerchantIds: [...selectedIds.value], allMerchants: false as const };

    const payload: Parameters<typeof quickIssueCoupon>[0] = {
      name: f.benefitType === 'ITEM' ? `兑换：${itemName}` : '自定义发放',
      benefitType: f.benefitType,
      validDays: days,
      totalStock: stock,
      quantity: Math.min(50, Math.max(1, Number(quantity.value) || 1)),
      ...scope,
    };
    if (f.benefitType === 'ITEM') {
      payload.itemName = itemName;
      payload.faceValue = face;
      payload.thresholdAmount = 0;
    } else {
      payload.faceValue = face;
      payload.thresholdAmount = thr;
    }

    // 有明确会员则发个人；否则按所选商家到店会员发放（与「确认生成并发券」一致）
    if (audience.value === 'USER' && targetType.value === 'phone' && /^1[3-9]\d{9}$/.test(phone.value.trim())) {
      const uid = await findUserIdByPhone(phone.value.trim()).catch(() => null);
      payload.audience = 'USER';
      if (uid) payload.userId = uid;
      else payload.phone = phone.value.trim();
    } else if (audience.value === 'USER' && targetType.value === 'userId' && Number(userId.value)) {
      payload.audience = 'USER';
      payload.userId = Number(userId.value);
    } else {
      payload.audience = 'MERCHANT_VISITORS';
      if (!payload.targetMerchantIds?.length && !payload.allMerchants) {
        payload.targetMerchantIds = [options.value!.merchantId];
      }
    }

    const res = await quickIssueCoupon(payload);
    createOpen.value = false;
    uni.showToast({ title: res.issued ? '生成并发放成功' : '券已生成', icon: 'success' });
    resultText.value = res.message + (res.issueError ? `（${res.issueError}）` : '');
    issued.value = [];
    await load();
    if (res.templateId) templateId.value = res.templateId;
  } catch (error) {
    uni.showToast({ title: friendlyMessage(error, '建券失败'), icon: 'none' });
  } finally {
    creating.value = false;
  }
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
  <view class="pm-page">
    <network-banner />

    <view class="pm-hero pm-hero--short">
      <view class="pm-hero__glow" />
      <view class="pm-hero__glow2" />
      <view class="pm-hero__inner">
        <view class="iss-head">
          <text class="pm-eyebrow">代金券发放</text>
          <view class="pm-hero__chip">
            <view class="pm-hero__dot" />
            {{ isMain ? '主体商家' : canQuickCreate ? '附属 · 可自建' : '附属商家' }}
          </view>
        </view>

        <view class="pm-bignum iss-num">
          <text class="pm-bignum__v">{{ heroFace.v }}</text>
          <text class="pm-bignum__u">{{ heroFace.u }}</text>
        </view>
        <text class="iss-sub">{{ heroSub }}</text>

        <view class="iss-chips">
          <view class="pm-hero__chip">可选 {{ merchants.length }} 家</view>
          <view class="pm-hero__chip">本次 {{ quantity }} 张</view>
          <view class="pm-hero__chip">{{ audience === 'USER' ? '指定会员' : '到店会员' }}</view>
        </view>
      </view>
    </view>

    <view class="pm-body">
      <view v-if="loading" class="pm-card">
        <view class="pm-skel skel-line" />
        <view class="pm-skel skel-line" style="width: 60%" />
        <view class="pm-skel skel-block" />
      </view>

      <view v-else-if="errorText" class="pm-card">
        <view class="pm-empty">
          <view class="pm-empty__t">加载失败</view>
          <view class="pm-empty__d">{{ errorText }}</view>
        </view>
      </view>

      <template v-else>
        <!-- 券模板 -->
        <view class="pm-card pm-rise">
          <view class="pick" @tap="openTemplateSheet">
            <view class="pick__main">
              <text class="pick__t">{{ current ? current.name : '选择已上架券模板' }}</text>
              <text class="pick__d">
                {{
                  current
                    ? `面值 ¥${current.faceValue ?? 0} · 余 ${current.remainingStock ?? '—'} 张`
                    : '点此选择，或立即新建一张'
                }}
              </text>
            </view>
            <text class="pick__arrow">›</text>
          </view>
        </view>

        <!-- 发放商家 -->
        <view class="pm-section">
          <text class="pm-section__t">发放商家</text>
          <text class="pm-section__more ellipsis">{{ selectedLabel }}</text>
        </view>
        <view class="pm-card pm-card--flush pm-rise">
          <view class="segwrap">
            <view class="pm-seg seg">
              <view class="pm-seg__i" :class="{ 'is-on': scopeMode === 'one' }" @tap="setScope('one')">某家</view>
              <view class="pm-seg__i" :class="{ 'is-on': scopeMode === 'multi', off: !isMain }" @tap="setScope('multi')">多选</view>
              <view class="pm-seg__i" :class="{ 'is-on': scopeMode === 'all', off: !isMain }" @tap="setScope('all')">全体</view>
            </view>
          </view>
          <view class="m-list">
            <view
              v-for="m in merchants"
              :key="m.id"
              class="pm-row m-row"
              :class="{ on: scopeMode === 'all' || selectedIds.includes(m.id) }"
              @tap="toggleMerchant(m)"
            >
              <view class="m-check" :class="{ on: scopeMode === 'all' || selectedIds.includes(m.id) }">✓</view>
              <view class="pm-row__main">
                <text class="pm-row__t ellipsis">{{ m.name }}</text>
              </view>
              <text class="pm-pill" :class="m.role === 'MAIN' ? 'pm-pill--teal' : 'pm-pill--muted'">
                {{ m.role === 'MAIN' ? '主体' : '附属' }}
              </text>
            </view>
            <view v-if="!merchants.length" class="pm-empty">
              <view class="pm-empty__d">当前账号暂无可发放商家</view>
            </view>
          </view>
        </view>

        <!-- 发放对象 -->
        <view class="pm-section">
          <text class="pm-section__t">发给谁</text>
        </view>
        <view class="pm-card pm-rise">
          <view class="pm-seg seg">
            <view class="pm-seg__i" :class="{ 'is-on': audience === 'USER' }" @tap="setAudience('USER')">指定会员</view>
            <view
              class="pm-seg__i"
              :class="{ 'is-on': audience === 'MERCHANT_VISITORS' }"
              @tap="setAudience('MERCHANT_VISITORS')"
            >到店会员</view>
          </view>

          <template v-if="audience === 'USER'">
            <view class="pm-seg seg seg--sm">
              <view class="pm-seg__i" :class="{ 'is-on': targetType === 'phone' }" @tap="setTarget('phone')">手机号</view>
              <view class="pm-seg__i" :class="{ 'is-on': targetType === 'userId' }" @tap="setTarget('userId')">用户 id</view>
            </view>
            <input
              v-if="targetType === 'phone'"
              v-model="phone"
              class="inp"
              type="number"
              maxlength="11"
              placeholder="会员手机号"
            />
            <input v-else v-model="userId" class="inp" type="number" placeholder="用户 id" />
          </template>
          <view v-else class="note">
            将向所选商家近到店会员各发 {{ quantity }} 张（最多 100 人）
          </view>

          <view class="qty">
            <view class="qty__main">
              <text class="qty__t">每人数量</text>
              <text class="qty__d">单次 1–50 张</text>
            </view>
            <view class="qty__ctl">
              <view class="qty__b" :class="{ off: quantity <= 1 }" @tap="stepQty(-1)">−</view>
              <input v-model.number="quantity" class="qty__inp" type="number" />
              <view class="qty__b" :class="{ off: quantity >= 50 }" @tap="stepQty(1)">+</view>
            </view>
          </view>
        </view>

        <!-- 发放结果 -->
        <view v-if="resultText" class="pm-card result pm-rise">
          <view class="result__hd">
            <text class="result__t">已提交</text>
            <text class="pm-pill pm-pill--teal">成功</text>
          </view>
          <text class="result__d">{{ resultText }}</text>
          <view v-for="row in issued" :key="row.id" class="code-row">
            <text class="code">{{ row.code || `#${row.id}` }}</text>
            <text class="exp">{{ row.expireAt || '' }}</text>
          </view>
        </view>

        <text class="foot">
          {{
            isMain
              ? '支持选某家 / 多家 / 全体联盟商家发放，立即生效'
              : canQuickCreate
                ? '可发放授权主体券，或快速新建本店附属券'
                : '附属商家仅可发放已授权的主体商家代金券'
          }}
        </text>
      </template>
    </view>

    <!-- 底部固定操作栏 -->
    <view class="pm-dock">
      <button
        class="pm-btn pm-btn--primary dock-btn"
        :class="{ 'is-off': !canSubmit }"
        :disabled="!canSubmit"
        :loading="submitting"
        @tap="onIssue"
      >
        {{ submitting ? '发放中…' : `确认发放 ${quantity} 张` }}
      </button>
    </view>

    <!-- 模板选择底部面板 -->
    <view v-if="sheetOpen" class="mask" @tap="sheetOpen = false">
      <view class="sheet" @tap.stop>
        <view class="sheet__hd">
          <view class="sheet__hmain">
            <text class="sheet__t">选择券模板</text>
            <text class="sheet__d">已上架 {{ templates.length }} 张</text>
          </view>
          <text class="sheet__x" @tap="sheetOpen = false">关闭</text>
        </view>

        <view v-if="canQuickCreate" class="create-entry" @tap="openCreateDrawer">
          <view class="create-entry__plus">+</view>
          <view class="create-entry__main">
            <text class="create-entry__t">立即新建一张券</text>
            <text class="create-entry__d">金额减免或兑换物品，生成后可立刻发放</text>
          </view>
          <text class="pick__arrow">›</text>
        </view>

        <scroll-view scroll-y class="sheet__list">
          <view
            v-for="t in templates"
            :key="t.id"
            class="tpl-row"
            :class="{ on: t.id === templateId }"
            @tap="selectTemplate(t)"
          >
            <view class="tpl-main">
              <text class="tpl-name ellipsis">{{ t.name }}</text>
              <text class="tpl-meta">
                ¥{{ t.faceValue ?? 0 }}
                <text v-if="(t.thresholdAmount || 0) > 0"> · 满{{ t.thresholdAmount }}</text>
                <text v-else> · 无门槛</text>
                · 余 {{ t.remainingStock ?? '—' }}
              </text>
            </view>
            <text v-if="t.id === templateId" class="tpl-check">✓</text>
          </view>
          <view v-if="!templates.length" class="pm-empty">
            <view class="pm-empty__d">暂无已上架模板，请先新建</view>
          </view>
        </scroll-view>
      </view>
    </view>

    <!-- 新建券抽屉 -->
    <view v-if="createOpen" class="mask" @tap="createOpen = false">
      <view class="sheet" @tap.stop>
        <view class="sheet__hd">
          <view class="sheet__hmain">
            <text class="sheet__t">立即新建一张券</text>
            <text class="sheet__d">生成后按所选商家立即发放</text>
          </view>
          <text class="sheet__x" @tap="createOpen = false">关闭</text>
        </view>

        <scroll-view scroll-y class="sheet__form">
          <text class="label">券类型</text>
          <view class="pm-seg seg seg--sm">
            <view
              class="pm-seg__i"
              :class="{ 'is-on': createForm.benefitType === 'VOUCHER' }"
              @tap="setBenefitType('VOUCHER')"
            >金额减免</view>
            <view
              class="pm-seg__i"
              :class="{ 'is-on': createForm.benefitType === 'ITEM' }"
              @tap="setBenefitType('ITEM')"
            >兑换物品</view>
          </view>

          <template v-if="createForm.benefitType === 'ITEM'">
            <text class="label">兑换物品（商家填写）</text>
            <input
              v-model="createForm.itemName"
              class="inp"
              maxlength="50"
              placeholder="例如：拿铁一杯 / 洗车一次 / 甜品一份"
            />
            <text class="label">参考价值（元，选填，最大 {{ FACE_MAX }}）</text>
            <input v-model.number="createForm.faceValue" class="inp" type="digit" placeholder="0" />
          </template>
          <template v-else>
            <text class="label">面值（元，最大 {{ FACE_MAX }}）</text>
            <input v-model.number="createForm.faceValue" class="inp" type="digit" />
            <text class="label">门槛（元，0 = 无门槛）</text>
            <input v-model.number="createForm.thresholdAmount" class="inp" type="digit" />
          </template>

          <view class="pair">
            <view class="pair__i">
              <text class="label">有效期（天）</text>
              <input v-model.number="createForm.validDays" class="inp" type="number" />
            </view>
            <view class="pair__i">
              <text class="label">发放数量（库存）</text>
              <input v-model.number="createForm.totalStock" class="inp" type="number" />
            </view>
          </view>

          <view class="preview">{{ createPreview }}</view>
          <button class="pm-btn pm-btn--primary" :loading="creating" @tap="onQuickCreate">
            {{ creating ? '生成中…' : '确认生成并发券' }}
          </button>
          <text class="foot foot--sheet">将按上方所选商家立即发放；若已填指定会员则优先发该会员</text>
        </scroll-view>
      </view>
    </view>
  </view>
</template>

<style scoped>
/* ---------- 首屏 ---------- */
.iss-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 22rpx;
}
.iss-num {
  margin-bottom: 10rpx;
}
.iss-sub {
  display: block;
  font-size: 24rpx;
  color: rgba(255, 255, 255, 0.62);
  line-height: 1.4;
}
.iss-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 12rpx;
  margin-top: 22rpx;
}

/* ---------- 券模板选择 ---------- */
.pick {
  display: flex;
  align-items: center;
  gap: 16rpx;
  padding: 24rpx 26rpx;
  border-radius: 24rpx;
  background: #f3f7f8;
  border: 1rpx solid #eaf0f2;
}
.pick__main {
  flex: 1;
  min-width: 0;
}
.pick__t {
  display: block;
  font-size: 30rpx;
  font-weight: 700;
  color: #0e1f26;
}
.pick__d {
  display: block;
  margin-top: 6rpx;
  font-size: 22rpx;
  color: #8a9aa3;
}
.pick__arrow {
  font-size: 36rpx;
  color: #a8b6bd;
  flex-shrink: 0;
}

/* ---------- 分段控件（卡内浅底版） ---------- */
.segwrap {
  padding: 24rpx 30rpx 4rpx;
}
.seg .pm-seg__i {
  background: #f3f7f8;
  border-color: #eaf0f2;
  font-size: 26rpx;
  font-weight: 600;
  padding: 18rpx 0;
}
.seg--sm {
  margin-top: 18rpx;
}
.seg--sm .pm-seg__i {
  font-size: 24rpx;
  padding: 14rpx 0;
}
.seg .pm-seg__i.is-on {
  background: #07262f;
  border-color: #07262f;
  color: #ffffff;
  font-weight: 700;
}
.seg .pm-seg__i.off {
  opacity: 0.42;
}

/* ---------- 商家列表 ---------- */
.m-list {
  padding: 6rpx 0 10rpx;
}
.m-row.on {
  background: #f7fdfc;
}
.m-check {
  width: 44rpx;
  height: 44rpx;
  border-radius: 14rpx;
  border: 2rpx solid #d3dee3;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 22rpx;
  font-weight: 800;
  color: transparent;
  flex-shrink: 0;
  transition: background 0.16s ease, border-color 0.16s ease;
}
.m-check.on {
  background: #00b8a0;
  border-color: #00b8a0;
  color: #ffffff;
}

/* ---------- 输入 ---------- */
.inp {
  height: 88rpx;
  padding: 0 24rpx;
  margin-top: 18rpx;
  border-radius: 20rpx;
  background: #f3f7f8;
  border: 1rpx solid #eaf0f2;
  font-size: 28rpx;
  color: #0e1f26;
  box-sizing: border-box;
}
.note {
  margin-top: 20rpx;
  padding: 20rpx 22rpx;
  border-radius: 20rpx;
  background: #f3f7f8;
  font-size: 24rpx;
  color: #556670;
  line-height: 1.5;
}

/* ---------- 数量步进 ---------- */
.qty {
  display: flex;
  align-items: center;
  gap: 20rpx;
  margin-top: 22rpx;
  padding-top: 22rpx;
  border-top: 1rpx solid #f2f6f7;
}
.qty__main {
  flex: 1;
  min-width: 0;
}
.qty__t {
  display: block;
  font-size: 28rpx;
  font-weight: 600;
  color: #0e1f26;
}
.qty__d {
  display: block;
  margin-top: 6rpx;
  font-size: 22rpx;
  color: #8a9aa3;
}
.qty__ctl {
  display: flex;
  align-items: center;
  gap: 6rpx;
  padding: 6rpx;
  border-radius: 999rpx;
  background: #f3f7f8;
  border: 1rpx solid #eaf0f2;
}
.qty__b {
  width: 60rpx;
  height: 60rpx;
  border-radius: 50%;
  background: #ffffff;
  color: #07262f;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 34rpx;
  font-weight: 700;
  line-height: 1;
}
.qty__b.off {
  color: #c3cfd4;
}
.qty__inp {
  width: 78rpx;
  height: 60rpx;
  text-align: center;
  font-size: 30rpx;
  font-weight: 800;
  color: #0e1f26;
  font-variant-numeric: tabular-nums;
}

/* ---------- 结果 ---------- */
.result__hd {
  display: flex;
  align-items: center;
  gap: 12rpx;
  margin-bottom: 10rpx;
}
.result__t {
  font-size: 28rpx;
  font-weight: 700;
  color: #0e1f26;
}
.result__d {
  display: block;
  font-size: 26rpx;
  color: #00766a;
  font-weight: 600;
  line-height: 1.5;
}
.code-row {
  display: flex;
  justify-content: space-between;
  gap: 12rpx;
  padding: 16rpx 0;
  margin-top: 4rpx;
  border-top: 1rpx solid #f2f6f7;
  font-size: 24rpx;
}
.code {
  font-weight: 700;
  color: #0e1f26;
  font-family: ui-monospace, monospace;
}
.exp {
  color: #8a9aa3;
}

/* ---------- 脚注 ---------- */
.foot {
  display: block;
  margin: 26rpx 12rpx 0;
  font-size: 22rpx;
  color: #9aa9b0;
  line-height: 1.6;
  text-align: center;
}
.foot--sheet {
  margin: 20rpx 0 8rpx;
}

/* ---------- 骨架 ---------- */
.skel-line {
  height: 32rpx;
  margin-bottom: 18rpx;
}
.skel-block {
  height: 220rpx;
  margin-top: 26rpx;
}

/* ---------- 底部操作栏 ---------- */
.dock-btn {
  flex: 1;
}

/* ---------- 抽屉 ---------- */
.mask {
  position: fixed;
  inset: 0;
  background: rgba(8, 24, 32, 0.48);
  z-index: 100;
  display: flex;
  align-items: flex-end;
}
.sheet {
  width: 100%;
  max-height: 82vh;
  background: #ffffff;
  border-radius: 36rpx 36rpx 0 0;
  padding: 28rpx 32rpx calc(28rpx + env(safe-area-inset-bottom));
  box-sizing: border-box;
}
.sheet__hd {
  display: flex;
  align-items: flex-start;
  gap: 16rpx;
  margin-bottom: 20rpx;
}
.sheet__hmain {
  flex: 1;
  min-width: 0;
}
.sheet__t {
  display: block;
  font-size: 34rpx;
  font-weight: 800;
  color: #0e1f26;
}
.sheet__d {
  display: block;
  margin-top: 6rpx;
  font-size: 22rpx;
  color: #8a9aa3;
}
.sheet__x {
  font-size: 26rpx;
  color: #8a9aa3;
  padding: 8rpx 0 8rpx 12rpx;
  flex-shrink: 0;
}
.sheet__list {
  max-height: 54vh;
}
.sheet__form {
  max-height: 64vh;
}

/* 新建入口 */
.create-entry {
  display: flex;
  align-items: center;
  gap: 20rpx;
  padding: 24rpx 22rpx;
  margin-bottom: 16rpx;
  border-radius: 26rpx;
  background: linear-gradient(135deg, #e8fbf7, #e8f4ff);
  border: 1rpx solid rgba(0, 184, 160, 0.32);
}
.create-entry__plus {
  width: 64rpx;
  height: 64rpx;
  border-radius: 20rpx;
  background: linear-gradient(135deg, #00d6b2, #19a7f8);
  color: #ffffff;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 40rpx;
  font-weight: 700;
  flex-shrink: 0;
}
.create-entry__main {
  flex: 1;
  min-width: 0;
}
.create-entry__t {
  display: block;
  font-size: 30rpx;
  font-weight: 800;
  color: #00766a;
}
.create-entry__d {
  display: block;
  margin-top: 4rpx;
  font-size: 22rpx;
  color: #556670;
}

/* 模板行 */
.tpl-row {
  display: flex;
  align-items: center;
  gap: 16rpx;
  padding: 24rpx 20rpx;
  margin-bottom: 8rpx;
  border-radius: 24rpx;
  border: 1rpx solid #eef3f4;
}
.tpl-row.on {
  background: #f3fbf9;
  border-color: rgba(0, 184, 160, 0.4);
}
.tpl-main {
  flex: 1;
  min-width: 0;
}
.tpl-name {
  display: block;
  font-size: 28rpx;
  font-weight: 700;
  color: #0e1f26;
}
.tpl-meta {
  display: block;
  margin-top: 6rpx;
  font-size: 22rpx;
  color: #8a9aa3;
}
.tpl-check {
  color: #00b8a0;
  font-weight: 800;
  font-size: 32rpx;
  flex-shrink: 0;
}

/* 表单 */
.label {
  display: block;
  margin: 22rpx 0 12rpx;
  font-size: 24rpx;
  color: #8a9aa3;
  font-weight: 600;
}
.pair {
  display: flex;
  gap: 16rpx;
}
.pair__i {
  flex: 1;
  min-width: 0;
}
.preview {
  margin: 24rpx 0 20rpx;
  padding: 22rpx 24rpx;
  border-radius: 20rpx;
  background: #fff8e8;
  color: #9a6b00;
  font-size: 25rpx;
  font-weight: 700;
  line-height: 1.5;
}

/* 通用 */
.ellipsis {
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.pm-section__more.ellipsis {
  max-width: 56%;
  text-align: right;
}
</style>
