<template>
  <div class="page">
    <el-card shadow="never">
      <el-form :inline="true" class="page__filter">
        <el-form-item label="账期月份">
          <el-date-picker
            v-model="query.month"
            type="month"
            value-format="YYYY-MM"
            placeholder="全部月份"
            style="width: 150px"
            clearable
            @change="onSearch"
          />
        </el-form-item>
        <el-form-item label="状态">
          <el-select v-model="query.status" clearable placeholder="全部" style="width: 130px" @change="onSearch">
            <el-option v-for="o in SETTLEMENT_STATUS_OPTIONS" :key="o.value" :label="o.label" :value="o.value" />
          </el-select>
        </el-form-item>
        <el-form-item>
          <el-button type="primary" :loading="loading" @click="onSearch">查询</el-button>
          <el-button @click="resetFilter">重置</el-button>
        </el-form-item>
      </el-form>

      <el-table v-loading="loading" :data="list" border stripe>
        <el-table-column label="账单编号" min-width="200">
          <template #default="{ row }">
            <span class="page__nowrap">{{ row.reportNo }}</span>
          </template>
        </el-table-column>
        <el-table-column label="账期" min-width="190">
          <template #default="{ row }">
            <span class="page__nowrap">{{ dateOnly(row.periodStart) }} ~ {{ dateOnly(row.periodEnd) }}</span>
          </template>
        </el-table-column>
        <el-table-column label="应结金额" width="110" align="right">
          <template #default="{ row }">
            <b class="page__amount">{{ row.totalAmount }}</b>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="90">
          <template #default="{ row }">
            <el-tag size="small" :type="settlementStatusTagType(row.status)">
              {{ settlementStatusLabel(row.status) }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="生成时间" min-width="165">
          <template #default="{ row }">{{ formatDateTime(row.generatedAt) }}</template>
        </el-table-column>
        <el-table-column label="操作" width="190" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" size="small" @click="openDetail(row)">查看详情</el-button>
            <template v-if="row.status === 'GENERATED'">
              <el-button v-permission="'settlement:confirm'" link type="success" size="small" @click="openAction(row, true)">
                确认
              </el-button>
              <el-button v-permission="'settlement:confirm'" link type="warning" size="small" @click="openAction(row, false)">
                提异议
              </el-button>
            </template>
          </template>
        </el-table-column>
        <template #empty>
          <el-empty description="没有符合条件的对账单" />
        </template>
      </el-table>

      <el-pagination
        class="page__pager"
        background
        layout="total, sizes, prev, pager, next"
        :total="total"
        v-model:current-page="query.page"
        v-model:page-size="query.pageSize"
        :page-sizes="[10, 20, 50]"
        @size-change="load"
        @current-change="load"
      />
      <div class="page__hint">
        对账单由主体商家生成并推送给你核对：<b>GENERATED（待确认）</b>时可「确认」或「提异议」；
        CONFIRMED 已冻结、DISPUTED 需主体重新生成。数据范围由后端按登录身份隔离，前端不传 merchantId。
      </div>
    </el-card>

    <!-- 账单详情：上半汇总 + 下半明细 Tab + 底部操作 -->
    <el-drawer v-model="detailVisible" title="对账单详情" size="820px">
      <div v-loading="detailLoading">
        <template v-if="detail">
          <el-descriptions :column="3" border size="small">
            <el-descriptions-item label="账单编号">{{ detail.reportNo }}</el-descriptions-item>
            <el-descriptions-item label="账期">{{ periodText }}</el-descriptions-item>
            <el-descriptions-item label="状态">
              <el-tag size="small" :type="settlementStatusTagType(detail.status)">
                {{ settlementStatusLabel(detail.status) }}
              </el-tag>
            </el-descriptions-item>
            <el-descriptions-item label="核销总额">{{ detail.totalAmount }}</el-descriptions-item>
            <el-descriptions-item label="核销笔数">{{ detail.redemptionCount }}</el-descriptions-item>
            <el-descriptions-item label="采购笔数">{{ detail.purchaseCount }}</el-descriptions-item>
            <el-descriptions-item label="生成时间">{{ formatDateTime(detail.generatedAt) }}</el-descriptions-item>
            <el-descriptions-item label="确认时间">
              {{ detail.confirmedAt ? formatDateTime(detail.confirmedAt) : '—' }}
            </el-descriptions-item>
            <el-descriptions-item v-if="detail.disputeReason" label="异议原因">
              <el-text type="danger">{{ detail.disputeReason }}</el-text>
            </el-descriptions-item>
          </el-descriptions>

          <el-tabs v-model="activeTab" class="detail__tabs">
            <el-tab-pane label="核销明细" name="redemptions">
              <el-table :data="detail.redemptions" border stripe size="small">
                <el-table-column prop="code" label="券码" min-width="150" />
                <el-table-column prop="userId" label="用户" width="90" />
                <el-table-column label="门店" min-width="130">
                  <template #default="{ row }">{{ row.storeName || '—' }}</template>
                </el-table-column>
                <el-table-column prop="faceValue" label="面值" width="90" align="right" />
                <el-table-column prop="discountAmount" label="抵扣" width="90" align="right" />
                <el-table-column label="核销时间" width="170">
                  <template #default="{ row }">{{ formatDateTime(row.redeemedAt) }}</template>
                </el-table-column>
                <template #empty>
                  <el-empty description="本账期无核销明细" />
                </template>
              </el-table>
            </el-tab-pane>

            <el-tab-pane label="采购明细" name="purchases">
              <el-table :data="detail.purchases" border stripe size="small">
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
                <template #empty>
                  <el-empty description="本账期无采购明细" />
                </template>
              </el-table>
            </el-tab-pane>
          </el-tabs>
        </template>
      </div>

      <!-- 操作条放抽屉自带 footer：普通流式布局会被明细表格的单元格盖住（点不到），footer 插槽不会 -->
      <template #footer>
        <div class="detail__footer">
          <el-alert
            type="info"
            show-icon
            :closable="false"
            title="明细为生成账单时的快照，后续核销 / 采购变化不影响本账单。"
            style="flex: 1; margin-right: 12px"
          />
          <template v-if="detail?.status === 'GENERATED'">
            <el-button v-permission="'settlement:confirm'" type="success" @click="detail && openAction(detail, true)">
              确认对账
            </el-button>
            <el-button v-permission="'settlement:confirm'" type="warning" @click="detail && openAction(detail, false)">
              提出异议
            </el-button>
          </template>
        </div>
      </template>
    </el-drawer>

    <!-- 确认 / 提异议 -->
    <el-dialog v-model="actionVisible" :title="actionForm.confirm ? '确认对账单' : '提出异议'" width="440px">
      <el-alert
        v-if="actionForm.confirm"
        type="warning"
        :closable="false"
        show-icon
        title="确认后将冻结该对账单，不可再提出异议；如需修改必须由主体重新生成。"
        style="margin-bottom: 12px"
      />
      <el-form label-width="92px">
        <el-form-item label="账单编号">
          <span>{{ actionForm.reportNo }}</span>
        </el-form-item>
        <el-form-item v-if="!actionForm.confirm" label="异议原因" required>
          <el-input
            v-model="actionForm.disputeReason"
            type="textarea"
            :rows="3"
            maxlength="200"
            show-word-limit
            placeholder="请说明异议原因（不少于 5 个字符）"
          />
        </el-form-item>
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
import { ElMessage } from 'element-plus';
import { settlementApi, type SettlementDetail as SettlementDetailType, type SettlementItem } from '@/api/settlement';
import { useUserStore } from '@/stores/user';
import { SETTLEMENT_STATUS_OPTIONS, formatDateTime, settlementStatusLabel, settlementStatusTagType } from '@/utils/dict';

/**
 * 附属 · 本店对账账单（S5.5-2）
 *
 * 复用 `GET /settlements` / `GET /settlements/:id` / `PATCH /settlements/:id/confirm`（S4.2）。
 * 后端 scope：附属只看自己（merchantId = 登录商家）；生成权归主体，确认/异议权归附属。
 */
const userStore = useUserStore();
const canConfirm = computed(() => userStore.hasPermission('settlement:confirm'));

const list = ref<SettlementItem[]>([]);
const total = ref(0);
const loading = ref(false);
const query = reactive({
  page: 1,
  pageSize: 10,
  month: '' as string,
  status: '' as string,
});

/** 'YYYY-MM' → 账期起止（UTC）。Prisma DateTime 存 UTC，必须在 UTC 边界上比对 */
function monthRange(month: string) {
  const [y, m] = month.split('-').map(Number);
  return {
    periodStart: new Date(Date.UTC(y, m - 1, 1)).toISOString(),
    periodEnd: new Date(Date.UTC(y, m, 1)).toISOString(),
  };
}

function dateOnly(v: string) {
  return v ? v.slice(0, 10) : '-';
}

async function load() {
  loading.value = true;
  try {
    const res = await settlementApi.list({
      page: query.page,
      pageSize: query.pageSize,
      status: query.status || undefined,
      ...(query.month ? monthRange(query.month) : {}),
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

function resetFilter() {
  query.month = '';
  query.status = '';
  onSearch();
}

// ---------------------------------------------------------------- 详情抽屉
const detailVisible = ref(false);
const detailLoading = ref(false);
const detail = ref<SettlementDetailType | null>(null);
const activeTab = ref('redemptions');

const periodText = computed(() =>
  detail.value ? `${dateOnly(detail.value.periodStart)} ~ ${dateOnly(detail.value.periodEnd)}` : '-',
);

async function openDetail(row: SettlementItem) {
  detailVisible.value = true;
  detailLoading.value = true;
  detail.value = null;
  activeTab.value = 'redemptions';
  try {
    detail.value = await settlementApi.detail(row.id);
  } catch (e) {
    ElMessage.error((e as Error).message || '加载账单详情失败');
    detailVisible.value = false;
  } finally {
    detailLoading.value = false;
  }
}

// ---------------------------------------------------------------- 确认 / 异议
const actionVisible = ref(false);
const submitting = ref(false);
const actionForm = reactive({ id: 0, reportNo: '', confirm: true, disputeReason: '' });

function openAction(row: { id: number; reportNo: string }, confirm: boolean) {
  actionForm.id = row.id;
  actionForm.reportNo = row.reportNo;
  actionForm.confirm = confirm;
  actionForm.disputeReason = '';
  actionVisible.value = true;
}

async function submitAction() {
  if (!actionForm.confirm && actionForm.disputeReason.trim().length < 5) {
    ElMessage.warning('异议原因不少于 5 个字符');
    return;
  }
  submitting.value = true;
  try {
    await settlementApi.confirm(actionForm.id, {
      confirm: actionForm.confirm,
      ...(actionForm.confirm ? {} : { disputeReason: actionForm.disputeReason.trim() }),
    });
    ElMessage.success(actionForm.confirm ? '已确认，对账单已冻结' : '已提交异议，等待主体重新生成');
    actionVisible.value = false;
    await load();
    // 抽屉开着的话同步刷新详情，避免「列表已变、抽屉还是旧状态」
    if (detailVisible.value && detail.value?.id === actionForm.id) {
      detail.value = await settlementApi.detail(actionForm.id);
    }
  } catch (e) {
    ElMessage.error((e as Error).message || '操作失败');
  } finally {
    submitting.value = false;
  }
}

onMounted(load);
</script>

<style scoped>
.page__filter {
  margin-bottom: 4px;
}
.page__pager {
  margin-top: 16px;
  justify-content: flex-end;
}
.page__hint {
  margin-top: 8px;
  font-size: 12px;
  color: #94a3b8;
  line-height: 1.6;
}
.page__amount {
  font-weight: 600;
}
.page__nowrap {
  white-space: nowrap;
}
.detail__tabs {
  margin-top: 12px;
}
/* 抽屉底部操作条（在 el-drawer 的 #footer 插槽里，不会被明细表格遮挡） */
.detail__footer {
  display: flex;
  align-items: center;
}
</style>
