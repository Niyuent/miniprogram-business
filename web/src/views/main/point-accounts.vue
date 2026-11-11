<template>
  <div class="page">
    <el-card shadow="never">
      <el-form :inline="true" class="page__filter">
        <el-form-item label="用户">
          <el-input
            v-model="query.keyword"
            clearable
            placeholder="昵称 / 手机号"
            style="width: 180px"
            @keyup.enter="onSearch"
          />
        </el-form-item>
        <el-form-item label="余额≥">
          <el-input v-model="minBalanceInput" clearable placeholder="0" style="width: 110px" @keyup.enter="onSearch" />
        </el-form-item>
        <el-form-item>
          <el-checkbox v-model="query.expiringSoon" @change="onSearch">仅看有临期积分（30 天内过期）</el-checkbox>
        </el-form-item>
        <el-form-item>
          <el-button type="primary" :loading="loading" @click="onSearch">查询</el-button>
          <el-button @click="resetFilter">重置</el-button>
        </el-form-item>
      </el-form>

      <el-alert
        type="info"
        show-icon
        :closable="false"
        class="page__tip"
        title="「余额」是账户累计口径，「可用」才是未过期批次能真正花掉的积分——两者不等说明有批次已过期待 S3.3 的过期任务清理。"
      />

      <el-table v-loading="loading" :data="list" border stripe>
        <el-table-column label="用户" min-width="160">
          <template #default="{ row }">
            {{ row.userName || `用户 #${row.userId}` }}
            <span class="page__dim">{{ row.userPhone }}</span>
          </template>
        </el-table-column>
        <el-table-column label="余额" width="110" align="right">
          <template #default="{ row }"><span class="page__strong">{{ row.balance }}</span></template>
        </el-table-column>
        <el-table-column label="临期(30天)" width="110" align="right">
          <template #default="{ row }">
            <el-tag v-if="row.expiringSoon > 0" size="small" type="warning">{{ row.expiringSoon }}</el-tag>
            <span v-else class="page__dim">0</span>
          </template>
        </el-table-column>
        <el-table-column prop="totalEarned" label="累计获得" width="100" align="right" />
        <el-table-column prop="totalSpent" label="累计消耗" width="100" align="right" />
        <el-table-column prop="totalExpired" label="累计过期" width="100" align="right" />
        <el-table-column prop="version" label="版本" width="80" align="right">
          <template #default="{ row }"><span class="page__dim">{{ row.version }}</span></template>
        </el-table-column>
        <el-table-column label="更新时间" width="170">
          <template #default="{ row }">{{ formatDateTime(row.updatedAt) }}</template>
        </el-table-column>
        <el-table-column label="操作" width="160" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" @click="openDetail(row)">批次明细</el-button>
            <el-button v-permission="'point:adjust'" link type="warning" @click="openAdjust(row)">人工调整</el-button>
          </template>
        </el-table-column>
        <template #empty><el-empty description="没有符合条件的积分账户" /></template>
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
    </el-card>

    <!-- 批次明细：把「余额由哪些批次构成」摊开，FIFO 顺序一目了然 -->
    <el-drawer v-model="detailVisible" title="积分账户明细" size="820px">
      <template v-if="detail">
        <el-descriptions :column="3" border size="small">
          <el-descriptions-item label="用户">
            {{ detail.account.userName || '-' }}（{{ detail.account.userPhone }}）
          </el-descriptions-item>
          <el-descriptions-item label="账户余额">{{ detail.account.balance }}</el-descriptions-item>
          <el-descriptions-item label="可用积分">
            <span class="page__strong">{{ detail.summary.available }}</span>
          </el-descriptions-item>
          <el-descriptions-item label="30 天内过期">{{ detail.summary.expiringSoon }}</el-descriptions-item>
          <el-descriptions-item label="已过期待清理">{{ detail.summary.expiredPending }}</el-descriptions-item>
          <el-descriptions-item label="有效批次数">{{ detail.summary.batchCount }}</el-descriptions-item>
        </el-descriptions>

        <el-divider content-position="left">批次明细（按 expireAt 升序 = FIFO 消耗顺序）</el-divider>
        <el-table :data="detail.batches" border size="small">
          <el-table-column prop="id" label="流水 id" width="90" />
          <el-table-column label="类型" width="110">
            <template #default="{ row }">
              <el-tag size="small" :type="pointTxnTypeTagType(row.type)">{{ pointTxnTypeLabel(row.type) }}</el-tag>
            </template>
          </el-table-column>
          <el-table-column prop="amount" label="原始" width="80" align="right" />
          <el-table-column label="剩余" width="80" align="right">
            <template #default="{ row }">
              <span :class="{ 'page__dim': !row.usable }">{{ row.remainingAmount }}</span>
            </template>
          </el-table-column>
          <el-table-column label="有效期" width="120">
            <template #default="{ row }">
              {{ row.expireAt ? formatDateTime(row.expireAt).slice(0, 10) : '永久' }}
            </template>
          </el-table-column>
          <el-table-column label="状态" width="90">
            <template #default="{ row }">
              <el-tag size="small" :type="row.usable ? 'success' : 'info'">
                {{ row.usable ? '可用' : '已过期' }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column label="来源商家" min-width="130">
            <template #default="{ row }">{{ row.merchantName || '—' }}</template>
          </el-table-column>
          <el-table-column prop="remark" label="备注" min-width="160" show-overflow-tooltip />
          <template #empty><el-empty description="该账户没有积分批次" /></template>
        </el-table>
      </template>
    </el-drawer>

    <!-- 人工调整：原因必填（后端 ≥5 字符），负向调整按 FIFO 扣减且不能用过期积分 -->
    <el-dialog v-model="adjustVisible" title="人工调整积分" width="480px">
      <el-form :model="adjustForm" label-width="90px">
        <el-form-item label="用户">
          <span>{{ adjustTarget?.userName || `用户 #${adjustTarget?.userId}` }}（当前余额 {{ adjustTarget?.balance }}）</span>
        </el-form-item>
        <el-form-item label="调整积分">
          <el-input-number v-model="adjustForm.amount" :step="10" />
          <span class="page__hint">正数增加、负数扣减；扣减走 FIFO，过期批次不可用</span>
        </el-form-item>
        <el-form-item label="原因" required>
          <el-input
            v-model="adjustForm.reason"
            type="textarea"
            :rows="3"
            maxlength="255"
            show-word-limit
            placeholder="至少 5 个字符，如：客诉补偿——系统故障导致少算积分"
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="adjustVisible = false">取消</el-button>
        <el-button type="primary" :loading="adjusting" @click="submitAdjust">确认调整</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
import { ElMessage } from 'element-plus';
import { pointApi } from '@/api/point';
import type { PointAccount, PointAccountDetail } from '@/types/business';
import { formatDateTime, pointTxnTypeLabel, pointTxnTypeTagType } from '@/utils/dict';

const list = ref<PointAccount[]>([]);
const total = ref(0);
const loading = ref(false);
const detailVisible = ref(false);
const detail = ref<PointAccountDetail | null>(null);

const query = reactive({ page: 1, pageSize: 10, keyword: '', expiringSoon: false, minBalance: undefined as number | undefined });
const minBalanceInput = ref('');

const adjustVisible = ref(false);
const adjusting = ref(false);
const adjustTarget = ref<PointAccount | null>(null);
const adjustForm = reactive({ amount: 10, reason: '' });

async function load() {
  loading.value = true;
  try {
    const res = await pointApi.accounts({
      page: query.page,
      pageSize: query.pageSize,
      keyword: query.keyword.trim() || undefined,
      minBalance: query.minBalance,
      expiringSoon: query.expiringSoon || undefined,
    });
    list.value = res.list;
    total.value = res.total;
  } finally {
    loading.value = false;
  }
}

function onSearch() {
  const parsed = Number(minBalanceInput.value.trim());
  query.minBalance = minBalanceInput.value.trim() && !Number.isNaN(parsed) ? parsed : undefined;
  query.page = 1;
  load();
}

function resetFilter() {
  query.keyword = '';
  query.expiringSoon = false;
  minBalanceInput.value = '';
  query.minBalance = undefined;
  onSearch();
}

async function openDetail(row: PointAccount) {
  try {
    detail.value = await pointApi.accountDetail(row.userId);
    detailVisible.value = true;
  } catch (e) {
    ElMessage.error((e as Error).message || '加载账户明细失败');
  }
}

function openAdjust(row: PointAccount) {
  adjustTarget.value = row;
  adjustForm.amount = 10;
  adjustForm.reason = '';
  adjustVisible.value = true;
}

async function submitAdjust() {
  if (!adjustTarget.value) return;
  if (adjustForm.reason.trim().length < 5) {
    ElMessage.warning('调整原因至少 5 个字符（会写入流水与操作日志）');
    return;
  }
  adjusting.value = true;
  try {
    const res = await pointApi.adjust({
      userId: adjustTarget.value.userId,
      amount: adjustForm.amount,
      reason: adjustForm.reason.trim(),
    });
    ElMessage.success(`已调整 ${res.amount > 0 ? '+' : ''}${res.amount} 积分，当前余额 ${res.balance}`);
    adjustVisible.value = false;
    await load();
  } catch (e) {
    ElMessage.error((e as Error).message || '调整失败');
  } finally {
    adjusting.value = false;
  }
}

onMounted(load);
</script>

<style scoped>
.page__filter {
  margin-bottom: 4px;
}
.page__tip {
  margin-bottom: 12px;
}
.page__pager {
  margin-top: 16px;
  justify-content: flex-end;
}
.page__dim {
  color: #94a3b8;
}
.page__strong {
  font-weight: 600;
  color: #16a34a;
}
.page__hint {
  margin-left: 10px;
  font-size: 12px;
  color: #94a3b8;
}
</style>
