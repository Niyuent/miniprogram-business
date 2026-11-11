<template>
  <el-form :model="form" label-width="132px" class="coupon-form">
    <el-divider content-position="left">基本信息</el-divider>

    <el-form-item label="券归属类型">
      <el-radio-group v-model="form.ownerType" :disabled="isEdit">
        <el-radio-button label="MAIN_COUPON">主体券</el-radio-button>
        <el-radio-button label="SUB_COUPON">附属商家券</el-radio-button>
      </el-radio-group>
      <div class="coupon-form__hint">
        主体券可被授权给附属商家发放；附属商家券只能由该商家自己使用。归属在创建后不可修改。
      </div>
    </el-form-item>

    <el-form-item v-if="form.ownerType === 'SUB_COUPON'" label="归属商家" required>
      <el-select v-model="form.ownerMerchantId" placeholder="选择附属商家" style="width: 260px" :disabled="isEdit">
        <el-option
          v-for="m in subMerchants"
          :key="m.id"
          :label="`${m.name}（${m.code}）`"
          :value="m.id"
        />
      </el-select>
    </el-form-item>

    <el-form-item label="券名称" required>
      <el-input v-model="form.name" maxlength="100" placeholder="如：春日无门槛礼遇券" style="width: 320px" />
    </el-form-item>
    <el-form-item label="副标题">
      <el-input v-model="form.subtitle" maxlength="100" placeholder="如：全场通用 · 新客专享" style="width: 320px" />
    </el-form-item>

    <el-divider content-position="left">面额与库存</el-divider>

    <el-form-item label="面值（元）" required>
      <el-input-number v-model="form.faceValue" :min="0.01" :precision="2" :step="1" />
    </el-form-item>
    <el-form-item label="使用门槛（元）">
      <div class="coupon-form__row">
        <el-input-number v-model="form.thresholdAmount" :min="0" :precision="2" :step="10" />
        <el-tag v-if="form.thresholdAmount === 0" type="success" effect="plain" round>无门槛券</el-tag>
        <el-tag
          v-else-if="form.faceValue > form.thresholdAmount"
          type="warning"
          effect="plain"
          round
        >
          面值高于门槛（允许）
        </el-tag>
      </div>
      <div class="coupon-form__hint">填 0 即为无门槛；平台不再强制「面值 ≤ 门槛」，请自行评估让利风险。</div>
    </el-form-item>
    <el-form-item label="兑换所需积分">
      <el-input-number v-model="form.pointsCost" :min="0" :step="1" />
    </el-form-item>
    <el-form-item label="参与积分兑换">
      <el-switch v-model="form.exchangeEnabled" />
      <span class="coupon-form__hint">
        关掉即从顾客的兑换商城下架，已发出去的券不受影响；只有「已上架 + 填了积分 + 打开这里」的券才会出现
      </span>
    </el-form-item>
    <el-form-item label="采购结算价">
      <el-input-number v-model="form.purchasePrice" :min="0" :precision="2" :step="1" />
    </el-form-item>
    <el-form-item label="发行总量" required>
      <el-input-number v-model="form.totalStock" :min="1" :step="10" />
      <span v-if="isEdit" class="coupon-form__hint">
        已发放 {{ value?.issuedCount ?? 0 }} 张，下调后不得低于该数量
      </span>
    </el-form-item>

    <el-divider content-position="left">有效期</el-divider>

    <el-form-item label="有效期类型">
      <el-radio-group v-model="form.validType">
        <el-radio-button label="AFTER_RECEIVE_DAYS">领取后 N 天</el-radio-button>
        <el-radio-button label="FIXED">固定有效期</el-radio-button>
      </el-radio-group>
    </el-form-item>
    <el-form-item v-if="form.validType === 'FIXED'" label="有效期区间" required>
      <el-date-picker
        v-model="form.validRange"
        type="daterange"
        value-format="YYYY-MM-DD"
        start-placeholder="开始日期"
        end-placeholder="结束日期"
      />
    </el-form-item>
    <el-form-item v-else label="有效天数">
      <el-input-number v-model="form.validDays" :min="1" :max="3650" />
      <span class="coupon-form__hint">自用户获得该券当天起算</span>
    </el-form-item>

    <el-divider content-position="left">适用门店</el-divider>

    <el-form-item label="适用门店">
      <el-radio-group v-model="form.applyScope">
        <el-radio-button label="ALL_STORES">全部门店</el-radio-button>
        <el-radio-button label="SPECIFIED_STORES">指定门店</el-radio-button>
      </el-radio-group>
    </el-form-item>
    <el-form-item v-if="form.applyScope === 'SPECIFIED_STORES'" label="选择门店" required>
      <el-select
        v-model="form.storeIds"
        multiple
        filterable
        placeholder="选择门店（属于该券的归属商家）"
        style="width: 420px"
        :loading="storeLoading"
        @focus="loadStores"
      >
        <el-option v-for="s in stores" :key="s.id" :label="`${s.name}（${s.code}）`" :value="s.id" />
      </el-select>
    </el-form-item>

    <!-- —— 高级设置 —— -->
    <el-collapse v-model="advancedOpen" class="coupon-form__advanced">
      <el-collapse-item name="adv">
        <template #title>
          <div class="coupon-form__adv-title">
            <span>高级设置</span>
            <el-tag size="small" type="info" effect="plain">营销决策完全由商家掌控</el-tag>
          </div>
        </template>

        <el-form-item label="领取限制">
          <el-radio-group v-model="advanced.claimLimitMode" class="coupon-form__stack-radio">
            <el-radio label="UNLIMITED">不限</el-radio>
            <el-radio label="PER_USER">
              每人限领
              <el-input-number
                v-model="advanced.perUserLimitN"
                :min="1"
                :max="99"
                size="small"
                :disabled="advanced.claimLimitMode !== 'PER_USER'"
                class="coupon-form__inline-num"
              />
              张
            </el-radio>
            <el-radio label="NEW_CUSTOMER">
              仅限新客首单
              <span class="coupon-form__hint">勾选后，核销/领取时校验用户是否有历史成功订单</span>
            </el-radio>
          </el-radio-group>
        </el-form-item>

        <el-form-item label="适用商品">
          <el-radio-group v-model="advanced.productScope" class="coupon-form__stack-radio">
            <el-radio label="ALL">全场通用</el-radio>
            <el-radio label="SPECIFIED">
              指定商品可用
              <el-button
                size="small"
                :disabled="advanced.productScope !== 'SPECIFIED'"
                class="coupon-form__inline-btn"
                @click="productDialogVisible = true"
              >
                选择商品 ID（已选 {{ advanced.productIds.length }}）
              </el-button>
            </el-radio>
            <el-radio label="EXCLUDE_SALE">排除特价商品</el-radio>
          </el-radio-group>
          <div
            v-if="advanced.productScope === 'SPECIFIED' && advanced.productIds.length"
            class="coupon-form__chips"
          >
            <el-tag
              v-for="id in advanced.productIds"
              :key="id"
              closable
              size="small"
              @close="removeProductId(id)"
            >
              {{ id }}
            </el-tag>
          </div>
        </el-form-item>

        <el-form-item label="发放总量">
          <el-input-number v-model="form.totalStock" :min="1" :step="10" />
          <span class="coupon-form__hint">与上方「发行总量」同步，例如只发 100 张</span>
        </el-form-item>

        <el-form-item label="发放截止">
          <el-radio-group v-model="advanced.issueDeadlineType">
            <el-radio-button label="PERMANENT">永久可发</el-radio-button>
            <el-radio-button label="DATE">指定日期截止</el-radio-button>
          </el-radio-group>
          <el-date-picker
            v-if="advanced.issueDeadlineType === 'DATE'"
            v-model="advanced.issueDeadline"
            type="date"
            value-format="YYYY-MM-DD"
            placeholder="选择截止日期"
            class="coupon-form__inline-date"
          />
        </el-form-item>

        <el-form-item label="核销实付约束">
          <el-switch
            v-model="advanced.requirePaidGreaterThanFace"
            active-text="必须实付大于面值"
            inactive-text="不限制（默认）"
          />
          <div class="coupon-form__hint">
            开启后核销端会校验订单实付 &gt; 面值；关闭则即使实付 1 元、面值 15 元也可核销（商家自负）。
          </div>
        </el-form-item>
      </el-collapse-item>
    </el-collapse>

    <el-divider content-position="left">其他</el-divider>

    <el-form-item label="使用说明">
      <el-input v-model="form.description" type="textarea" :rows="2" maxlength="500" style="width: 420px" />
    </el-form-item>
    <el-form-item label="规则备注">
      <el-input v-model="form.rulesText" type="textarea" :rows="2" maxlength="500" style="width: 420px" />
    </el-form-item>

    <el-alert
      v-if="woolWarning"
      type="warning"
      show-icon
      :closable="false"
      class="coupon-form__wool"
      title="提示：无门槛大额券极易被羊毛党刷单套现。建议设置「仅限新客」或「指定商品可用」以保护您的利润。确认无误请点击保存。"
    />

    <el-form-item>
      <el-button type="primary" :loading="submitting" @click="onSubmit">
        {{ isEdit ? '保存修改' : '创建（草稿）' }}
      </el-button>
      <el-button @click="$emit('cancel')">取消</el-button>
      <span v-if="!isEdit" class="coupon-form__hint">
        创建后为草稿状态，需上架后才能被发放 / 兑换
      </span>
    </el-form-item>
  </el-form>

  <el-dialog v-model="productDialogVisible" title="指定可用商品" width="480px" destroy-on-close>
    <p class="coupon-form__dialog-tip">输入本店商品 ID，回车添加（暂无商品库对接，先支持手工录入）。</p>
    <el-select
      v-model="advanced.productIds"
      multiple
      filterable
      allow-create
      default-first-option
      placeholder="输入商品 ID 后回车"
      style="width: 100%"
    />
    <template #footer>
      <el-button type="primary" @click="productDialogVisible = false">完成</el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import { ElMessage } from 'element-plus';
import { merchantApi } from '@/api/merchant';
import type {
  ApplyScope,
  CouponOwnerType,
  CouponTemplate,
  CreateCouponTemplatePayload,
  Merchant,
  ValidType,
} from '@/types/business';
import {
  DEFAULT_ADVANCED,
  parseAdvancedFromRules,
  serializeRules,
  showWoolWarning,
  type CouponAdvancedConfig,
} from './coupon-advanced';

const props = defineProps<{
  value?: CouponTemplate | null;
  submitting?: boolean;
}>();

const emit = defineEmits<{
  (e: 'submit', payload: CreateCouponTemplatePayload): void;
  (e: 'cancel'): void;
}>();

const isEdit = computed(() => !!props.value);
const advancedOpen = ref<string[]>(['adv']);
const productDialogVisible = ref(false);

const form = reactive({
  ownerType: 'MAIN_COUPON' as CouponOwnerType,
  ownerMerchantId: undefined as number | undefined,
  name: '',
  subtitle: '',
  faceValue: 20,
  thresholdAmount: 100,
  pointsCost: 20,
  exchangeEnabled: true,
  purchasePrice: 15,
  totalStock: 500,
  validType: 'AFTER_RECEIVE_DAYS' as ValidType,
  validRange: [] as string[],
  validDays: 30,
  applyScope: 'ALL_STORES' as ApplyScope,
  storeIds: [] as number[],
  description: '',
  rulesText: '',
});

const advanced = reactive<CouponAdvancedConfig>({ ...DEFAULT_ADVANCED });

const woolWarning = computed(() => showWoolWarning(form.faceValue, form.thresholdAmount));

function fillFrom(row: CouponTemplate) {
  form.ownerType = row.ownerType;
  form.ownerMerchantId = row.ownerMerchantId;
  form.name = row.name;
  form.subtitle = row.subtitle ?? '';
  form.faceValue = row.faceValue;
  form.thresholdAmount = row.thresholdAmount;
  form.pointsCost = row.pointsCost;
  form.exchangeEnabled = row.exchangeEnabled !== false;
  form.purchasePrice = row.purchasePrice;
  form.totalStock = row.totalStock;
  form.validType = row.validType;
  form.validRange =
    row.validType === 'FIXED' && row.validStart && row.validEnd
      ? [row.validStart.slice(0, 10), row.validEnd.slice(0, 10)]
      : [];
  form.validDays = row.validDays || 30;
  form.applyScope = row.applyScope;
  form.storeIds = [...row.storeIds];
  form.description = row.description ?? '';
  const parsed = parseAdvancedFromRules(row.rules);
  form.rulesText = parsed.humanRules;
  Object.assign(advanced, parsed.advanced);
  // 优先用后端独立字段（落库后的权威数据）
  if (row.applicableScope) {
    advanced.claimLimitMode = row.applicableScope.claimLimitMode || advanced.claimLimitMode;
    advanced.productScope = row.applicableScope.productScope || advanced.productScope;
    advanced.productIds = [...(row.applicableScope.productIds || [])];
    advanced.issueDeadlineType = row.applicableScope.issueDeadlineType || advanced.issueDeadlineType;
    advanced.issueDeadline = row.applicableScope.issueDeadline ?? null;
  }
  if (typeof row.requireGreaterThanFace === 'boolean') {
    advanced.requirePaidGreaterThanFace = row.requireGreaterThanFace;
  }
  if (typeof row.perUserLimit === 'number') {
    if (row.perUserLimit === 0) advanced.claimLimitMode = 'UNLIMITED';
    else if (row.applicableScope?.claimLimitMode === 'NEW_CUSTOMER') advanced.claimLimitMode = 'NEW_CUSTOMER';
    else {
      advanced.claimLimitMode = advanced.claimLimitMode === 'NEW_CUSTOMER' ? 'NEW_CUSTOMER' : 'PER_USER';
      advanced.perUserLimitN = Math.max(1, row.perUserLimit);
    }
  } else if (!row.rules?.includes('[ADV]')) {
    advanced.claimLimitMode = 'PER_USER';
    advanced.perUserLimitN = 1;
  }
}

watch(
  () => props.value,
  (row) => {
    if (row) fillFrom(row);
  },
  { immediate: true },
);

const subMerchants = ref<Merchant[]>([]);
const stores = ref<Array<{ id: number; name: string; code: string }>>([]);
const storeLoading = ref(false);

async function loadSubMerchants() {
  try {
    const res = await merchantApi.list({ type: 'SUB', pageSize: 200 });
    subMerchants.value = res.list;
  } catch {
    subMerchants.value = [];
  }
}
if (isEdit.value) loadSubMerchants();

const storesLoaded = ref(false);
async function loadStores() {
  if (storesLoaded.value) return;
  storeLoading.value = true;
  try {
    const list = subMerchants.value.length
      ? subMerchants.value
      : (await merchantApi.list({ type: 'SUB', pageSize: 200 })).list;
    subMerchants.value = list;
    const all: Array<{ id: number; name: string; code: string }> = [];
    for (const m of list) {
      try {
        const detail = await merchantApi.detail(m.id);
        all.push(...(detail.stores ?? []).map((s: any) => ({ id: s.id, name: s.name, code: s.code })));
      } catch {
        /* skip */
      }
    }
    stores.value = all;
    storesLoaded.value = true;
  } finally {
    storeLoading.value = false;
  }
}
if (isEdit.value && (form.applyScope === 'SPECIFIED_STORES' || form.storeIds.length)) loadStores();

function removeProductId(id: string) {
  advanced.productIds = advanced.productIds.filter((x) => x !== id);
}

function resolvePerUserLimit(): number {
  if (advanced.claimLimitMode === 'UNLIMITED') return 99; // 后端暂 Min(1)，用大数近似「不限」
  if (advanced.claimLimitMode === 'NEW_CUSTOMER') return 1;
  return Math.max(1, advanced.perUserLimitN || 1);
}

function onSubmit() {
  if (!form.name.trim()) {
    ElMessage.warning('请填写券名称');
    return;
  }
  if (form.ownerType === 'SUB_COUPON' && !form.ownerMerchantId) {
    ElMessage.warning('附属商家券必须选择归属商家');
    return;
  }
  if (form.validType === 'FIXED' && form.validRange.length !== 2) {
    ElMessage.warning('固定有效期必须选择开始与结束日期');
    return;
  }
  if (form.applyScope === 'SPECIFIED_STORES' && !form.storeIds.length) {
    ElMessage.warning('指定门店范围时必须选择至少 1 家门店');
    return;
  }
  if (advanced.productScope === 'SPECIFIED' && !advanced.productIds.length) {
    ElMessage.warning('指定商品可用时请至少添加 1 个商品 ID');
    return;
  }
  if (advanced.issueDeadlineType === 'DATE' && !advanced.issueDeadline) {
    ElMessage.warning('请选择发放截止日期');
    return;
  }
  // 面值 > 门槛：仅温和提示，不拦截
  if (form.faceValue > form.thresholdAmount && form.thresholdAmount > 0) {
    ElMessage.info('面值高于门槛：已允许保存，请确认营销策略无误');
  }

  const validStart = form.validType === 'FIXED' ? `${form.validRange[0]}T00:00:00.000Z` : undefined;
  const validEnd =
    form.validType === 'FIXED' ? `${form.validRange[1]}T23:59:59.000Z` : undefined;

  const payload: CreateCouponTemplatePayload = {
    ownerType: form.ownerType,
    ...(form.ownerType === 'SUB_COUPON' ? { ownerMerchantId: form.ownerMerchantId } : {}),
    name: form.name.trim(),
    subtitle: form.subtitle.trim() || undefined,
    faceValue: form.faceValue,
    thresholdAmount: form.thresholdAmount,
    pointsCost: form.pointsCost,
    exchangeEnabled: form.exchangeEnabled,
    purchasePrice: form.purchasePrice,
    totalStock: form.totalStock,
    validType: form.validType,
    ...(validStart ? { validStart } : {}),
    ...(validEnd ? { validEnd } : {}),
    ...(form.validType === 'AFTER_RECEIVE_DAYS' ? { validDays: form.validDays } : {}),
    applyScope: form.applyScope,
    ...(form.applyScope === 'SPECIFIED_STORES' ? { storeIds: form.storeIds } : {}),
    perUserLimit: resolvePerUserLimit(),
    description: form.description.trim() || undefined,
    rules: serializeRules(form.rulesText, { ...advanced }),
  };

  emit('submit', payload);
}

watch(
  () => form.ownerType,
  (v) => {
    if (v === 'SUB_COUPON' && !subMerchants.value.length) loadSubMerchants();
  },
);
</script>

<style scoped>
.coupon-form__hint {
  margin-left: 12px;
  color: #94a3b8;
  font-size: 12px;
}
.coupon-form__row {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}
.coupon-form__advanced {
  margin: 8px 0 20px;
  border: 1px solid #e2e8f0;
  border-radius: 10px;
  overflow: hidden;
  background: #f8fafc;
}
.coupon-form__advanced :deep(.el-collapse-item__header) {
  padding: 0 16px;
  height: 48px;
  background: #f8fafc;
  font-weight: 600;
}
.coupon-form__advanced :deep(.el-collapse-item__wrap) {
  background: #fff;
  border-top: 1px solid #e2e8f0;
}
.coupon-form__advanced :deep(.el-collapse-item__content) {
  padding: 16px 12px 4px;
}
.coupon-form__adv-title {
  display: flex;
  align-items: center;
  gap: 10px;
}
.coupon-form__stack-radio {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 10px;
}
.coupon-form__inline-num {
  margin: 0 6px;
  width: 100px;
}
.coupon-form__inline-btn {
  margin-left: 8px;
}
.coupon-form__inline-date {
  margin-left: 12px;
  vertical-align: middle;
}
.coupon-form__chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 8px;
  max-width: 480px;
}
.coupon-form__wool {
  margin: 0 0 16px 132px;
  max-width: 560px;
}
.coupon-form__wool :deep(.el-alert__title) {
  color: #b45309;
  font-size: 13px;
  line-height: 1.5;
  white-space: normal;
}
.coupon-form__dialog-tip {
  margin: 0 0 12px;
  color: #64748b;
  font-size: 13px;
}
</style>
