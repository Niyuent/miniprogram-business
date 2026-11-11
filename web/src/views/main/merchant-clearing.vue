<template>
  <div class="page">
    <el-alert
      type="info"
      :closable="false"
      show-icon
      class="mc-alert"
      title="商家互结清分"
      description="会员从 A 商家进入、用 A 家攒的积分兑换了 B 商家发的券，券被核销后，A 按券面值补 B。只统计已核销的券，按核销时间归入北京时间自然月；同一商家对双向轧差后只出一条净额，A 与 B 同一家时不产生账单。"
    />

    <el-card shadow="never" class="mc-summary">
      <div class="mc-summary__grid">
        <div class="mc-kpi">
          <div class="mc-kpi__label">当前账期</div>
          <div class="mc-kpi__value">{{ currentPeriod?.periodKey || '暂无账期' }}</div>
        </div>
        <div class="mc-kpi">
          <div class="mc-kpi__label">净额账单</div>
          <div class="mc-kpi__value">{{ currentPeriod?.billCount ?? 0 }} <small>张</small></div>
        </div>
        <div class="mc-kpi">
          <div class="mc-kpi__label">入账券数</div>
          <div class="mc-kpi__value">{{ currentPeriod?.itemCount ?? 0 }} <small>笔</small></div>
        </div>
        <div class="mc-kpi mc-kpi--money">
          <div class="mc-kpi__label">本期净额合计</div>
          <div class="mc-kpi__value">¥{{ money(currentPeriod?.netTotal ?? 0) }}</div>
        </div>
      </div>
    </el-card>

    <el-card shadow="never">
      <el-form :inline="true" class="page__filter">
        <el-form-item label="账期月份">
          <el-select v-model="query.periodKey" clearable placeholder="全部账期" style="width: 150px" @change="onSearch">
            <el-option v-for="p in periods" :key="p.id" :label="p.periodKey" :value="p.periodKey" />
          </el-select>
        </el-form-item>
        <el-form-item label="状态">
          <el-select v-model="query.status" clearable placeholder="全部" style="width: 130px" @change="onSearch">
            <el-option label="待结算" value="UNSETTLED" />
            <el-option label="已结算" value="SETTLED" />
          </el-select>
        </el-form-item>
        <el-form-item label="商家 id">
          <el-input v-model.number="query.merchantId" clearable placeholder="留空=全部" style="width: 130px" />
        </el-form-item>
        <el-form-item>
          <el-button type="primary" :loading="loading" @click="onSearch">查询</el-button>
          <el-button v-if="canManage" @click="genVisible = true">生成 / 重算账期</el-button>
        </el-form-item>
      </el-form>

      <el-table v-loading="loading" :data="list" border stripe>
        <el-table-column prop="periodKey" label="账期" width="100" />
        <el-table-column label="付款方（兑换店 A）" min-width="170">
          <template #default="{ row }">
            {{ row.payerMerchantName }} <span class="mc-id">#{{ row.payerMerchantId }}</span>
          </template>
        </el-table-column>
        <el-table-column label="收款方（发券店 B）" min-width="170">
          <template #default="{ row }">
            {{ row.receiverMerchantName }} <span class="mc-id">#{{ row.receiverMerchantId }}</span>
          </template>
        </el-table-column>
        <el-table-column label="原始 / 抵扣" width="170" align="right">
          <template #default="{ row }">
            <span class="mc-add">+{{ money(row.grossForward) }}</span>
            <span class="mc-off"> −{{ money(row.grossReverse) }}</span>
            <div class="mc-sub">{{ row.forwardCount }} 笔 / {{ row.reverseCount }} 笔抵扣</div>
          </template>
        </el-table-column>
        <el-table-column label="应付净额" width="130" align="right">
          <template #default="{ row }"><b class="mc-net">¥{{ money(row.netAmount) }}</b></template>
        </el-table-column>
        <el-table-column label="打款状态" width="110">
          <template #default="{ row }">
            <el-tag size="small" :type="row.status === 'SETTLED' ? 'success' : 'warning'">
              {{ row.status === 'SETTLED' ? '已结算' : '待结算' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="210" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" size="small" @click="openDetail(row)">查看明细</el-button>
            <el-button v-if="canManage && row.status === 'UNSETTLED'" link type="success" size="small" @click="onSettle(row, true)">标记已结算</el-button>
            <el-button v-if="canManage && row.status === 'SETTLED'" link type="warning" size="small" @click="onSettle(row, false)">撤销</el-button>
          </template>
        </el-table-column>
        <template #empty><el-empty description="这个账期还没有跨商家核销，或还没生成清分账单" /></template>
      </el-table>

      <el-pagination
        class="page__pager"
        background
        layout="total, sizes, prev, pager, next"
        :total="total"
        v-model:current-page="query.page"
        v-model:page-size="query.pageSize"
        :page-sizes="[10, 20, 50]"
        @size-change="onSearch"
        @current-change="load"
      />
    </el-card>

    <!-- 生成 / 重算账期 -->
    <el-dialog v-model="genVisible" title="生成商家互结清分账单" width="460px">
      <el-form label-width="92px">
        <el-form-item label="账期月份" required>
          <el-date-picker v-model="genForm.periodKey" type="month" value-format="YYYY-MM" placeholder="选择月份" style="width: 100%" />
        </el-form-item>
        <el-form-item label="重算">
          <el-switch v-model="genForm.recalculate" />
          <div class="mc-tip">已存在账期默认幂等跳过；勾选重算会按当前核销数据重新汇总。有账单已标记打款时不允许重算。</div>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="genVisible = false">取消</el-button>
        <el-button type="primary" :loading="submitting" @click="submitGenerate">确定</el-button>
      </template>
    </el-dialog>

    <!-- 账单明细：每一张券的 A / B / C -->
    <el-dialog v-model="detailVisible" title="清分账单明细" width="1080px" top="5vh">
      <template v-if="detail">
        <el-descriptions :column="4" border size="small" class="mc-desc">
          <el-descriptions-item label="账期">{{ detail.periodKey }}</el-descriptions-item>
          <el-descriptions-item label="付款方">{{ detail.payerMerchantName }}（#{{ detail.payerMerchantId }}）</el-descriptions-item>
          <el-descriptions-item label="收款方">{{ detail.receiverMerchantName }}（#{{ detail.receiverMerchantId }}）</el-descriptions-item>
          <el-descriptions-item label="应付净额">¥{{ money(detail.netAmount) }}</el-descriptions-item>
          <el-descriptions-item label="原始金额">¥{{ money(detail.grossForward) }}（{{ detail.forwardCount }} 笔）</el-descriptions-item>
          <el-descriptions-item label="抵扣金额">¥{{ money(detail.grossReverse) }}（{{ detail.reverseCount }} 笔）</el-descriptions-item>
          <el-descriptions-item label="打款状态">{{ detail.status === 'SETTLED' ? '已结算' : '待结算' }}</el-descriptions-item>
          <el-descriptions-item label="结算时间">{{ detail.settledAt ? formatDateTime(detail.settledAt) : '—' }}</el-descriptions-item>
        </el-descriptions>

        <div class="mc-legend">
          明细保留每张券的原始方向 A→B；与本账单净额方向相反的即为「抵扣」项。
          A = 兑换进入的商家，B = 发券商家，C = 实际核销门店所属商家（仅追溯）。
        </div>

        <el-table :data="detail.items" border stripe size="small" max-height="420">
          <el-table-column label="计入" width="80">
            <template #default="{ row }">
              <el-tag size="small" :type="row.effect === 'ADD' ? 'danger' : 'info'">
                {{ row.effect === 'ADD' ? '应付' : '抵扣' }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column label="券码" min-width="140">
            <template #default="{ row }">{{ row.code || `核销#${row.redemptionId}` }}</template>
          </el-table-column>
          <el-table-column label="券名" min-width="140">
            <template #default="{ row }">{{ row.templateName || `模板#${row.templateId}` }}</template>
          </el-table-column>
          <el-table-column label="面值" width="90" align="right">
            <template #default="{ row }">¥{{ money(row.faceValue) }}</template>
          </el-table-column>
          <el-table-column label="兑换店 A" min-width="140">
            <template #default="{ row }">{{ row.payerMerchantName }}</template>
          </el-table-column>
          <el-table-column label="发券店 B" min-width="140">
            <template #default="{ row }">{{ row.receiverMerchantName }}</template>
          </el-table-column>
          <el-table-column label="核销店 C" min-width="160">
            <template #default="{ row }">{{ row.redeemMerchantName || '—' }}<span v-if="row.storeName" class="mc-sub"> / {{ row.storeName }}</span></template>
          </el-table-column>
          <el-table-column label="积分" width="80" align="right">
            <template #default="{ row }">{{ row.pointsCost }}</template>
          </el-table-column>
          <el-table-column label="核销时间" width="160">
            <template #default="{ row }">{{ formatDateTime(row.redeemedAt) }}</template>
          </el-table-column>
        </el-table>

        <div v-if="canManage && detail.status === 'UNSETTLED'" class="mc-settle-bar">
          <el-input v-model="settleRemark" placeholder="打款备注 / 流水号（可选）" style="width: 260px" />
          <el-button type="success" :loading="submitting" @click="onSettle(detail, true)">标记已结算</el-button>
        </div>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import {
  clearingApi,
  type ClearingBill,
  type ClearingBillDetail,
  type ClearingPeriod,
} from '@/api/clearing';
import { useUserStore } from '@/stores/user';
import { formatDateTime } from '@/utils/dict';

const userStore = useUserStore();
/** 平台 + 主体商家可生成账期、标记打款（与现有对账单的主体全量口径一致） */
const canManage = computed(
  () => userStore.profile?.userType === 'PLATFORM' || userStore.isMainMerchant,
);

const periods = ref<ClearingPeriod[]>([]);
const list = ref<ClearingBill[]>([]);
const total = ref(0);
const loading = ref(false);
const submitting = ref(false);
const query = reactive({
  page: 1,
  pageSize: 20,
  periodKey: '' as string,
  status: '' as 'UNSETTLED' | 'SETTLED' | '',
  merchantId: undefined as number | undefined,
});

const currentPeriod = computed(() =>
  query.periodKey ? periods.value.find((p) => p.periodKey === query.periodKey) : periods.value[0],
);

function money(v: number) {
  return Number(v ?? 0).toFixed(2);
}

async function loadPeriods() {
  const res = await clearingApi.periods();
  periods.value = res.list;
}

async function load() {
  loading.value = true;
  try {
    const res = await clearingApi.bills({
      page: query.page,
      pageSize: query.pageSize,
      periodKey: query.periodKey || undefined,
      status: query.status || undefined,
      merchantId: query.merchantId || undefined,
    });
    list.value = res.list;
    total.value = res.total;
  } finally {
    loading.value = false;
  }
}

function onSearch() {
  query.page = 1;
  load();
}

// ---------------------------------------------------------------- 生成 / 重算
const genVisible = ref(false);
const genForm = reactive({ periodKey: '' as string, recalculate: false });

async function submitGenerate() {
  if (!genForm.periodKey) {
    ElMessage.warning('请选择账期月份');
    return;
  }
  submitting.value = true;
  try {
    const r = await clearingApi.generate({
      periodKey: genForm.periodKey,
      recalculate: genForm.recalculate,
    });
    ElMessage.success(
      r.idempotent
        ? `账期 ${r.periodKey} 已存在，未重复生成`
        : `账期 ${r.periodKey} 清分完成：${r.billCount} 张净额账单 / ${r.itemCount} 笔券明细`,
    );
    genVisible.value = false;
    query.periodKey = genForm.periodKey;
    await loadPeriods();
    onSearch();
  } finally {
    submitting.value = false;
  }
}

// ---------------------------------------------------------------- 明细 / 打款
const detailVisible = ref(false);
const detail = ref<ClearingBillDetail | null>(null);
const settleRemark = ref('');

async function openDetail(row: ClearingBill) {
  detail.value = await clearingApi.billDetail(row.id);
  settleRemark.value = row.settleRemark ?? '';
  detailVisible.value = true;
}

async function onSettle(row: ClearingBill | ClearingBillDetail, settled: boolean) {
  if (!settled) {
    try {
      await ElMessageBox.confirm('撤销后该账单回到「待结算」，账期可重新汇总。确定撤销？', '撤销打款状态');
    } catch {
      return;
    }
  }
  submitting.value = true;
  try {
    await clearingApi.settle(row.id, { settled, remark: settled ? settleRemark.value : undefined });
    ElMessage.success(settled ? '已标记打款完成' : '已撤销打款状态');
    if (detailVisible.value && detail.value?.id === row.id) {
      detail.value = await clearingApi.billDetail(row.id);
    }
    await Promise.all([loadPeriods(), load()]);
  } finally {
    submitting.value = false;
  }
}

onMounted(async () => {
  await loadPeriods();
  await load();
});
</script>

<style scoped>
.mc-alert { margin-bottom: 16px; }
.mc-summary { margin-bottom: 16px; }
.mc-summary__grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; }
.mc-kpi { padding: 6px 12px; border-left: 3px solid #dcdfe6; }
.mc-kpi--money { border-left-color: #d03050; }
.mc-kpi__label { font-size: 12px; color: #909399; margin-bottom: 6px; }
.mc-kpi__value { font-size: 22px; font-weight: 700; color: #303133; }
.mc-kpi__value small { font-size: 12px; font-weight: 400; color: #909399; }
.mc-kpi--money .mc-kpi__value { color: #d03050; }
.mc-id { color: #a8abb2; font-size: 12px; }
.mc-add { color: #d03050; font-weight: 600; }
.mc-off { color: #18a058; }
.mc-net { color: #d03050; font-size: 14px; }
.mc-sub { color: #a8abb2; font-size: 11px; display: inline; }
.mc-tip { font-size: 12px; color: #909399; line-height: 1.5; margin-top: 4px; }
.mc-desc { margin-bottom: 12px; }
.mc-legend { font-size: 12px; color: #606266; background: #f5f7fa; padding: 8px 12px; margin-bottom: 12px; border-radius: 4px; line-height: 1.6; }
.mc-settle-bar { display: flex; gap: 12px; justify-content: flex-end; margin-top: 14px; }
</style>
