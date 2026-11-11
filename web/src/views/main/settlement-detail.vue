<template>
  <div class="page">
    <el-card v-loading="loading" shadow="never">
      <template #header>
        <div class="detail__head">
          <span class="detail__title">对账单详情 · {{ detail?.reportNo }}</span>
          <div>
            <el-button v-if="canConfirm && detail?.status === 'GENERATED'" type="success" @click="actionForm.confirm = true; actionVisible = true">确认对账</el-button>
            <el-button v-if="canConfirm && detail?.status === 'GENERATED'" type="warning" @click="actionForm.confirm = false; actionVisible = true">提出异议</el-button>
            <el-button @click="onExport">导出 CSV</el-button>
            <el-button @click="$router.push('/main/settlements')">返回列表</el-button>
          </div>
        </div>
      </template>

      <el-descriptions :column="3" border>
        <el-descriptions-item label="对账单号">{{ detail?.reportNo }}</el-descriptions-item>
        <el-descriptions-item label="商家">{{ detail?.merchantName || '全平台' }}</el-descriptions-item>
        <el-descriptions-item label="状态">
          <el-tag size="small" :type="settlementStatusTagType(detail?.status ?? '')">
            {{ settlementStatusLabel(detail?.status ?? '') }}
          </el-tag>
        </el-descriptions-item>
        <el-descriptions-item label="账期">{{ periodText }}</el-descriptions-item>
        <el-descriptions-item label="核销金额">{{ detail?.totalAmount }}</el-descriptions-item>
        <el-descriptions-item label="核销笔数">{{ detail?.totalCount }}</el-descriptions-item>
        <el-descriptions-item label="生成时间">{{ formatDateTime(detail?.generatedAt) }}</el-descriptions-item>
        <el-descriptions-item label="确认时间">{{ detail?.confirmedAt ? formatDateTime(detail.confirmedAt) : '—' }}</el-descriptions-item>
        <el-descriptions-item v-if="detail?.disputeReason" label="异议原因">
          <el-text type="danger">{{ detail.disputeReason }}</el-text>
        </el-descriptions-item>
        <el-descriptions-item label="快照说明">生成时固化，后续核销/采购变化不影响本账单</el-descriptions-item>
      </el-descriptions>

      <el-tabs v-model="activeTab" class="detail__tabs">
        <el-tab-pane label="采购明细" name="purchases">
          <el-table :data="detail?.purchases ?? []" border stripe size="small">
            <el-table-column prop="purchaseNo" label="采购单号" min-width="190" />
            <el-table-column label="券模板" min-width="140">
              <template #default="{ row }">{{ row.templateName || '—' }}</template>
            </el-table-column>
            <el-table-column prop="quantity" label="数量" width="90" align="right" />
            <el-table-column prop="totalAmount" label="金额" width="100" align="right" />
            <el-table-column label="结算状态" width="100">
              <template #default="{ row }">
                <el-tag size="small" :type="row.settleStatus === 'SETTLED' ? 'success' : 'warning'">
                  {{ row.settleStatus === 'SETTLED' ? '已结算' : '未结算' }}
                </el-tag>
              </template>
            </el-table-column>
            <el-table-column label="采购时间" width="160">
              <template #default="{ row }">{{ formatDateTime(row.purchasedAt) }}</template>
            </el-table-column>
            <template #empty><el-empty description="本账期无采购明细" /></template>
          </el-table>
        </el-tab-pane>

        <el-tab-pane label="核销明细" name="redemptions">
          <el-table :data="detail?.redemptions ?? []" border stripe size="small">
            <el-table-column prop="code" label="券码" min-width="150" />
            <el-table-column prop="userId" label="用户" width="100" />
            <el-table-column label="门店" min-width="130">
              <template #default="{ row }">{{ row.storeName || '—' }}</template>
            </el-table-column>
            <el-table-column prop="faceValue" label="面值" width="90" align="right" />
            <el-table-column prop="discountAmount" label="抵扣" width="90" align="right" />
            <el-table-column label="核销时间" width="170">
              <template #default="{ row }">{{ formatDateTime(row.redeemedAt) }}</template>
            </el-table-column>
            <template #empty><el-empty description="本账期无核销明细" /></template>
          </el-table>
        </el-tab-pane>
      </el-tabs>
    </el-card>

    <el-dialog v-model="actionVisible" :title="actionForm.confirm ? '确认对账单' : '提出异议'" width="440px">
      <el-alert
        v-if="actionForm.confirm"
        type="warning"
        :closable="false"
        show-icon
        title="确认后该对账单冻结，不可再提出异议。"
        style="margin-bottom: 12px"
      />
      <el-form label-width="92px">
        <el-form-item v-if="!actionForm.confirm" label="异议原因" required>
          <el-input v-model="actionForm.disputeReason" type="textarea" :rows="3" placeholder="请说明异议原因（不少于 5 个字符）" />
        </el-form-item>
        <el-form-item v-else label="对账单号">{{ detail?.reportNo }}</el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="actionVisible = false">取消</el-button>
        <el-button :type="actionForm.confirm ? 'success' : 'warning'" :loading="submitting" @click="submitAction">
          {{ actionForm.confirm ? '确认对账' : '提交异议' }}
        </el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { useRoute } from 'vue-router';
import { ElMessage } from 'element-plus';
import { settlementApi, type SettlementDetail as SettlementDetailType } from '@/api/settlement';
import { useUserStore } from '@/stores/user';
import { formatDateTime, settlementStatusLabel, settlementStatusTagType } from '@/utils/dict';

const route = useRoute();
const userStore = useUserStore();
const canConfirm = computed(() => userStore.permissions.includes('settlement:confirm'));

const id = Number(route.params.id);
const detail = ref<SettlementDetailType | null>(null);
const loading = ref(false);
const activeTab = ref('purchases');

const periodText = computed(() =>
  detail.value ? `${detail.value.periodStart.slice(0, 10)} ~ ${detail.value.periodEnd.slice(0, 10)}` : '-',
);

async function load() {
  loading.value = true;
  try {
    detail.value = await settlementApi.detail(id);
    // 默认展示有内容的 Tab：采购为空而核销非空时切到核销，避免首屏就是空表
    if (!detail.value.purchases.length && detail.value.redemptions.length) {
      activeTab.value = 'redemptions';
    }
  } finally {
    loading.value = false;
  }
}

// ---------------------------------------------------------------- 确认 / 异议
const actionVisible = ref(false);
const submitting = ref(false);
const actionForm = reactive({ confirm: true, disputeReason: '' });

async function submitAction() {
  if (!actionForm.confirm && actionForm.disputeReason.trim().length < 5) {
    ElMessage.warning('异议原因不少于 5 个字符');
    return;
  }
  submitting.value = true;
  try {
    await settlementApi.confirm(id, {
      confirm: actionForm.confirm,
      ...(actionForm.confirm ? {} : { disputeReason: actionForm.disputeReason.trim() }),
    });
    ElMessage.success(actionForm.confirm ? '已确认，对账单冻结' : '已提交异议');
    actionVisible.value = false;
    await load();
  } finally {
    submitting.value = false;
  }
}

/** 导出 CSV：走**后端** export 接口（带 UTF-8 BOM，Excel 中文不乱码） */
async function onExport() {
  await settlementApi.exportCsv(id);
  ElMessage.success('已导出核销明细');
}

onMounted(load);
</script>

<style scoped>
.detail__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.detail__title {
  font-weight: 600;
}
.detail__tabs {
  margin-top: 16px;
}
</style>
