<template>
  <div class="page">
    <el-card v-loading="loading" shadow="never">
      <template #header>
        <div class="page__head">
          <span>券模板详情 · {{ detail?.name ?? '-' }}</span>
          <el-button link @click="$router.push('/main/coupons')">返回列表</el-button>
        </div>
      </template>

      <template v-if="detail">
        <el-descriptions :column="3" border size="small">
          <el-descriptions-item label="id">{{ detail.id }}</el-descriptions-item>
          <el-descriptions-item label="状态">
            <el-tag :type="couponStatusTagType(detail.status)" size="small">
              {{ couponStatusLabel(detail.status) }}
            </el-tag>
          </el-descriptions-item>
          <el-descriptions-item label="归属类型">
            {{ COUPON_OWNER_TYPE[detail.ownerType as CouponOwnerType] }}（#{{
              detail.ownerMerchantId
            }}
            {{ detail.ownerMerchantName }}）
          </el-descriptions-item>
          <el-descriptions-item label="面值">{{ detail.faceValue }} 元</el-descriptions-item>
          <el-descriptions-item label="使用门槛">
            {{ detail.thresholdAmount > 0 ? `满 ${detail.thresholdAmount} 元` : '无门槛' }}
          </el-descriptions-item>
          <el-descriptions-item label="兑换积分">{{ detail.pointsCost }}</el-descriptions-item>
          <el-descriptions-item label="采购结算价">{{ detail.purchasePrice }} 元</el-descriptions-item>
          <el-descriptions-item label="库存">
            剩余 {{ detail.remainingStock }} / 总量 {{ detail.totalStock }}（已发
            {{ detail.issuedCount }}，已核销 {{ detail.usedCount }}）
          </el-descriptions-item>
          <el-descriptions-item label="有效期">{{ validPeriodText(detail) }}</el-descriptions-item>
          <el-descriptions-item label="适用范围">
            {{ COUPON_APPLY_SCOPE[detail.applyScope as ApplyScope] }}
            <span v-if="detail.stores.length" class="page__muted">
              ：{{ detail.stores.map((s) => s.name).join('、') }}
            </span>
          </el-descriptions-item>
          <el-descriptions-item label="每人限领">
            {{ detail.perUserLimit === 0 ? '不限' : `${detail.perUserLimit} 张` }}
            <el-tag v-if="detail.applicableScope?.claimLimitMode === 'NEW_CUSTOMER'" size="small" type="warning" class="page__tag">
              仅新客
            </el-tag>
            <el-tag v-if="detail.requireGreaterThanFace" size="small" type="danger" class="page__tag">
              实付&gt;面值
            </el-tag>
          </el-descriptions-item>
          <el-descriptions-item label="副标题">{{ detail.subtitle || '-' }}</el-descriptions-item>
          <el-descriptions-item label="创建时间" :span="2">
            {{ formatDateTime(detail.createdAt) }}
          </el-descriptions-item>
          <el-descriptions-item label="使用说明" :span="3">
            {{ detail.description || '-' }}
          </el-descriptions-item>
          <el-descriptions-item label="规则备注" :span="3">{{ detail.rules || '-' }}</el-descriptions-item>
        </el-descriptions>

        <el-row v-if="detail.effectStats" :gutter="16" class="page__stats">
          <el-col :span="24">
            <el-card shadow="never">
              <template #header>
                <div class="page__effect-head">
                  <span>券效果看板</span>
                  <el-button link type="primary" @click="effectVisible = true">查看核销明细</el-button>
                </div>
              </template>
              <el-descriptions :column="4" size="small" border>
                <el-descriptions-item label="已领/库存">
                  {{ detail.effectStats.issuedCount }} / {{ detail.effectStats.totalStock }}
                </el-descriptions-item>
                <el-descriptions-item label="核销数量">{{ detail.effectStats.redeemedCount }}</el-descriptions-item>
                <el-descriptions-item label="带动实付">
                  ¥{{ Number(detail.effectStats.drivenPayAmount).toFixed(2) }}
                </el-descriptions-item>
                <el-descriptions-item label="让利总额">
                  ¥{{ Number(detail.effectStats.discountTotal).toFixed(2) }}
                </el-descriptions-item>
              </el-descriptions>
            </el-card>
          </el-col>
        </el-row>

        <el-row :gutter="16" class="page__stats">
          <el-col :span="12">
            <el-card shadow="never">
              <template #header>券码统计（coupon_codes）</template>
              <el-descriptions :column="2" size="small">
                <el-descriptions-item v-for="(n, k) in detail.stats.codes" :key="k" :label="String(k)">
                  {{ n }}
                </el-descriptions-item>
                <el-descriptions-item v-if="!Object.keys(detail.stats.codes).length" label="—">
                  尚未预生成券码（S2.2）
                </el-descriptions-item>
              </el-descriptions>
            </el-card>
          </el-col>
          <el-col :span="12">
            <el-card shadow="never">
              <template #header>券实例统计（coupon_instances）</template>
              <el-descriptions :column="2" size="small">
                <el-descriptions-item v-for="(n, k) in detail.stats.instances" :key="k" :label="String(k)">
                  {{ n }}
                </el-descriptions-item>
                <el-descriptions-item v-if="!Object.keys(detail.stats.instances).length" label="—">
                  尚未发放任何券实例（S2.2）
                </el-descriptions-item>
              </el-descriptions>
            </el-card>
          </el-col>
        </el-row>

        <!-- 上架 / 下架：按钮级权限 coupon:publish -->
        <div class="page__actions">
          <el-button
            v-if="detail.status !== 'PUBLISHED'"
            v-permission="'coupon:publish'"
            type="success"
            @click="onToggle('PUBLISHED')"
          >
            上架
          </el-button>
          <el-button v-else v-permission="'coupon:publish'" type="warning" @click="onToggle('UNPUBLISHED')">
            下架
          </el-button>
          <el-button
            v-if="detail.status === 'PUBLISHED'"
            v-permission="'coupon:issue'"
            type="success"
            @click="$router.push(`/main/coupons/issue?templateId=${detail.id}`)"
          >
            发放给用户
          </el-button>
          <el-button
            v-permission="'coupon:edit'"
            type="primary"
            plain
            :disabled="!detail.editable"
            @click="editing = !editing"
          >
            {{ editing ? '收起编辑' : '编辑' }}
          </el-button>
          <span v-if="!detail.editable" class="page__muted">
            已上架的券模板需先下架才能编辑（后端 409 TEMPLATE_NOT_EDITABLE）
          </span>
        </div>

        <el-collapse-transition>
          <div v-if="editing">
            <el-divider content-position="left">编辑（仅草稿 / 已下架可提交）</el-divider>
            <CouponForm :value="detail" :submitting="submitting" @submit="onUpdate" @cancel="editing = false" />
          </div>
        </el-collapse-transition>

        <!-- S2.2：券码预生成 + 券码查询；S2.4：批次列表 + 按批次筛选 -->
        <el-divider content-position="left">券码批次（coupon_code_batches）</el-divider>
        <div class="page__actions">
          <el-button
            v-permission="'coupon:code:generate'"
            type="primary"
            plain
            @click="generateVisible = true"
          >
            生成券码
          </el-button>
          <span class="page__muted">批次号格式：{templateId}-{yyyymmdd}-{seq}，重复批次后端返回 409</span>
        </div>
        <el-table :data="batches" border size="small" class="page__codes">
          <el-table-column prop="id" label="批次 id" width="90" />
          <el-table-column prop="batchNo" label="批次号" min-width="180" />
          <el-table-column label="生成数量" width="110">
            <template #default="{ row }">{{ row.quantity }} / 实际 {{ row.actualCount }}</template>
          </el-table-column>
          <el-table-column label="未发放" width="100">
            <template #default="{ row }">{{ row.stats?.UNISSUED ?? '—' }}</template>
          </el-table-column>
          <el-table-column label="已发放" width="100">
            <template #default="{ row }">{{ row.stats?.ISSUED ?? '—' }}</template>
          </el-table-column>
          <el-table-column label="已核销" width="100">
            <template #default="{ row }">{{ row.stats?.REDEEMED ?? '—' }}</template>
          </el-table-column>
          <el-table-column label="作废" width="90">
            <template #default="{ row }">{{ row.stats?.VOID ?? '—' }}</template>
          </el-table-column>
          <el-table-column label="备注 / 操作人" min-width="160">
            <template #default="{ row }">
              {{ row.remark || '—' }}
              <span class="page__muted">（{{ row.operatorName || row.operatorId || '—' }}）</span>
            </template>
          </el-table-column>
          <el-table-column label="生成时间" min-width="165">
            <template #default="{ row }">{{ formatDateTime(row.createdAt) }}</template>
          </el-table-column>
          <el-table-column label="操作" width="110" fixed="right">
            <template #default="{ row }">
              <el-button link type="primary" @click="onPickBatch(row.batchNo)">只看这批</el-button>
            </template>
          </el-table-column>
          <template #empty><el-empty description="该模板尚未预生成券码" /></template>
        </el-table>

        <el-divider content-position="left">券码（coupon_codes）</el-divider>
        <div class="page__actions">
          <el-select
            v-model="codeBatchNo"
            clearable
            placeholder="全部批次"
            style="width: 220px"
            @change="onFilterCodes"
          >
            <el-option
              v-for="b in batches"
              :key="b.id"
              :label="`${b.batchNo}（${b.actualCount} 张）`"
              :value="b.batchNo"
            />
          </el-select>
          <el-select
            v-model="codeStatus"
            clearable
            placeholder="全部状态"
            style="width: 150px"
            @change="onFilterCodes"
          >
            <el-option
              v-for="opt in COUPON_CODE_STATUS_OPTIONS"
              :key="opt.value"
              :label="opt.label"
              :value="opt.value"
            />
          </el-select>
          <el-input
            v-model="codeKeyword"
            clearable
            placeholder="券码模糊搜索"
            style="width: 180px"
            @keyup.enter="onFilterCodes"
          />
          <el-tag v-if="codeStats" type="info" size="small">
            未发放 {{ codeStats.unused }} · 已发放 {{ codeStats.issued }} · 已核销 {{ codeStats.redeemed }}
          </el-tag>
        </div>

        <el-table v-loading="codeLoading" :data="codes" border size="small" class="page__codes">
          <el-table-column prop="id" label="id" width="80" />
          <el-table-column label="券码" min-width="190">
            <template #default="{ row }">
              <span class="page__code">{{ row.code }}</span>
            </template>
          </el-table-column>
          <el-table-column prop="batchNo" label="批次号" min-width="180" />
          <el-table-column label="状态" width="110">
            <template #default="{ row }">
              <el-tag size="small" :type="couponCodeStatusTagType(row.status)">
                {{ couponCodeStatusLabel(row.status) }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column label="绑定实例" width="110">
            <template #default="{ row }">{{ row.instanceId || '-' }}</template>
          </el-table-column>
          <el-table-column label="生成时间" min-width="165">
            <template #default="{ row }">{{ formatDateTime(row.generatedAt) }}</template>
          </el-table-column>
          <template #empty><el-empty description="该模板尚未预生成券码" /></template>
        </el-table>
        <el-pagination
          class="page__pager"
          background
          layout="total, prev, pager, next"
          :total="codeTotal"
          v-model:current-page="codePage"
          :page-size="codePageSize"
          @current-change="loadCodes"
        />
      </template>
    </el-card>

    <el-dialog v-model="effectVisible" title="核销效果明细" width="860px" destroy-on-close @open="loadEffect">
      <el-table v-loading="effectLoading" :data="effectList" border size="small" max-height="400">
        <el-table-column prop="redeemedAt" label="核销时间" min-width="160">
          <template #default="{ row }">{{ formatDateTime(row.redeemedAt) }}</template>
        </el-table-column>
        <el-table-column label="用户" min-width="140">
          <template #default="{ row }">{{ row.userName || '—' }} #{{ row.userId }}</template>
        </el-table-column>
        <el-table-column prop="code" label="券码" width="140" />
        <el-table-column prop="orderNo" label="订单号" min-width="140" />
        <el-table-column label="实付" width="100" align="right">
          <template #default="{ row }">
            {{ row.payAmount != null ? `¥${Number(row.payAmount).toFixed(2)}` : '—' }}
          </template>
        </el-table-column>
        <el-table-column label="让利" width="90" align="right">
          <template #default="{ row }">¥{{ Number(row.discountAmount).toFixed(2) }}</template>
        </el-table-column>
      </el-table>
      <el-pagination
        class="page__pager"
        background
        layout="total, prev, pager, next"
        :total="effectTotal"
        v-model:current-page="effectPage"
        :page-size="10"
        @current-change="loadEffect"
      />
    </el-dialog>

    <!-- 生成券码弹窗 -->
    <el-dialog v-model="generateVisible" title="预生成券码" width="520px">
      <el-form label-width="110px">
        <el-form-item label="批次号">
          <el-input v-model="gen.batchNo" placeholder="留空自动生成，如 1001-20261007-001" />
        </el-form-item>
        <el-form-item label="生成数量" required>
          <el-input-number v-model="gen.quantity" :min="1" :max="5000" :step="10" />
        </el-form-item>
        <el-form-item label="备注">
          <el-input v-model="gen.remark" placeholder="如：门店开业首批" maxlength="200" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="generateVisible = false">取消</el-button>
        <el-button type="primary" :loading="generating" @click="onGenerate">生成</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
import { useRoute } from 'vue-router';
import { ElMessage } from 'element-plus';
import CouponForm from './coupon-form.vue';
import { couponTemplateApi } from '@/api/coupon-template';
import { couponCodeApi } from '@/api/coupon-code';
import type {
  ApplyScope,
  CouponCode,
  CouponCodeBatch,
  CouponCodeStats,
  CouponCodeStatus,
  CouponEffectDetailRow,
  CouponOwnerType,
  CouponTemplateDetail,
  CreateCouponTemplatePayload,
} from '@/types/business';
import {
  COUPON_APPLY_SCOPE,
  COUPON_CODE_STATUS_OPTIONS,
  COUPON_OWNER_TYPE,
  couponCodeStatusLabel,
  couponCodeStatusTagType,
  couponStatusLabel,
  couponStatusTagType,
  formatDateTime,
  validPeriodText,
} from '@/utils/dict';

const route = useRoute();
const detail = ref<CouponTemplateDetail | null>(null);
const loading = ref(false);
const submitting = ref(false);
const editing = ref(false);

// 券码（S2.2）
const codes = ref<CouponCode[]>([]);
const codeStats = ref<CouponCodeStats | null>(null);
const codeTotal = ref(0);
const codePage = ref(1);
const codePageSize = 10;
const codeLoading = ref(false);
const generateVisible = ref(false);
const generating = ref(false);
const gen = reactive({ batchNo: '', quantity: 100, remark: '' });

const effectVisible = ref(false);
const effectLoading = ref(false);
const effectList = ref<CouponEffectDetailRow[]>([]);
const effectTotal = ref(0);
const effectPage = ref(1);

async function loadEffect() {
  const id = Number(route.params.id);
  if (!id) return;
  effectLoading.value = true;
  try {
    const res = await couponTemplateApi.effectDetails(id, { page: effectPage.value, pageSize: 10 });
    effectList.value = res.list;
    effectTotal.value = res.total;
  } finally {
    effectLoading.value = false;
  }
}

// S2.4：批次列表 + 券码按批次 / 状态 / 券码筛选
const batches = ref<CouponCodeBatch[]>([]);
const codeBatchNo = ref('');
const codeStatus = ref('');
const codeKeyword = ref('');

async function loadBatches() {
  const id = Number(route.params.id);
  try {
    batches.value = (await couponCodeApi.batches(id)).list;
  } catch {
    batches.value = [];
  }
}

async function loadCodes() {
  const id = Number(route.params.id);
  codeLoading.value = true;
  try {
    const res = await couponCodeApi.list(id, {
      page: codePage.value,
      pageSize: codePageSize,
      batchNo: codeBatchNo.value || undefined,
      status: (codeStatus.value || undefined) as CouponCodeStatus | undefined,
      code: codeKeyword.value.trim() || undefined,
    });
    codes.value = res.list;
    codeTotal.value = res.total;
    codeStats.value = res.stats;
  } finally {
    codeLoading.value = false;
  }
}

function onFilterCodes() {
  codePage.value = 1;
  loadCodes();
}

/** 批次表「只看这批」→ 把筛选条件灌进券码区并滚到券码表 */
function onPickBatch(batchNo: string) {
  codeBatchNo.value = batchNo;
  onFilterCodes();
  document.querySelector('.page__codes:last-of-type')?.scrollIntoView({ behavior: 'smooth' });
}

async function onGenerate() {
  const id = Number(route.params.id);
  generating.value = true;
  try {
    const res = await couponCodeApi.generate(id, {
      batchNo: gen.batchNo.trim() || undefined,
      quantity: gen.quantity,
      remark: gen.remark.trim() || undefined,
    });
    ElMessage.success(`批次 ${res.batchNo} 已生成 ${res.quantity} 个券码`);
    generateVisible.value = false;
    gen.batchNo = '';
    gen.remark = '';
    // 生成完直接把新批次选上：刚生成就想看这批是默认动作
    codeBatchNo.value = res.batchNo;
    await Promise.all([loadBatches(), loadCodes(), load()]);
  } finally {
    generating.value = false;
  }
}

async function load() {
  loading.value = true;
  try {
    detail.value = await couponTemplateApi.detail(Number(route.params.id));
    // 列表页「编辑」按钮带 ?edit=1 进来时直接展开表单
    editing.value = route.query.edit === '1';
    await Promise.all([loadBatches(), loadCodes()]);
  } finally {
    loading.value = false;
  }
}

async function onToggle(target: 'PUBLISHED' | 'UNPUBLISHED') {
  const publishing = target === 'PUBLISHED';
  try {
    if (publishing) await couponTemplateApi.publish(Number(route.params.id));
    else await couponTemplateApi.unpublish(Number(route.params.id));
    ElMessage.success(publishing ? '已上架' : '已下架');
    await load();
  } catch {
    /* 错误提示由 request.ts 统一弹出（含后端 reasonCode） */
  }
}

async function onUpdate(payload: CreateCouponTemplatePayload) {
  if (!detail.value) return;
  submitting.value = true;
  try {
    // 编辑不允许改归属，去掉这两个字段，避免后端收到无意义的 owner 字段
    const { ownerType, ownerMerchantId, ...rest } = payload as any;
    const res = await couponTemplateApi.update(detail.value.id, rest);
    ElMessage.success('已保存');
    editing.value = false;
    detail.value = { ...detail.value, ...res.template } as CouponTemplateDetail;
    await load();
  } finally {
    submitting.value = false;
  }
}

onMounted(load);
</script>

<style scoped>
.page__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.page__stats {
  margin-top: 16px;
}
.page__actions {
  margin-top: 16px;
  display: flex;
  align-items: center;
  gap: 12px;
}
.page__tag {
  margin-left: 6px;
}
.page__effect-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.page__muted {
  color: #94a3b8;
  font-size: 12px;
}
.page__codes {
  margin-top: 12px;
}
.page__code {
  font-family: 'SFMono-Regular', Consolas, monospace;
  letter-spacing: 1px;
}
</style>
