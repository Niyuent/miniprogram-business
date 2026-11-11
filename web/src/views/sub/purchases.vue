<template>
  <div class="page">
    <el-card shadow="never">
      <el-form :inline="true" class="page__filter">
        <el-form-item label="结算状态">
          <el-select v-model="query.settleStatus" clearable placeholder="全部" style="width: 130px" @change="onSearch">
            <el-option label="未结算" value="UNSETTLED" />
            <el-option label="已结算" value="SETTLED" />
          </el-select>
        </el-form-item>
        <el-form-item label="采购时间">
          <el-date-picker
            v-model="range"
            type="daterange"
            value-format="YYYY-MM-DD"
            start-placeholder="开始日期"
            end-placeholder="结束日期"
            style="width: 250px"
            @change="onSearch"
          />
        </el-form-item>
        <el-form-item>
          <el-button type="primary" :loading="loading" @click="onSearch">查询</el-button>
          <el-button @click="resetFilter">重置</el-button>
        </el-form-item>
      </el-form>

      <el-table v-loading="loading" :data="list" border stripe>
        <el-table-column prop="purchaseNo" label="采购单号" min-width="200" />
        <el-table-column label="券模板" min-width="140">
          <template #default="{ row }">{{ row.templateName || `模板 #${row.templateId}` }}</template>
        </el-table-column>
        <el-table-column prop="quantity" label="采购数量" width="90" align="right" />
        <el-table-column prop="unitPrice" label="单价" width="90" align="right" />
        <el-table-column prop="totalAmount" label="总金额" width="100" align="right" />
        <el-table-column label="结算状态" width="100">
          <template #default="{ row }">
            <el-tag size="small" :type="row.settleStatus === 'SETTLED' ? 'success' : 'warning'">
              {{ row.settleStatus === 'SETTLED' ? '已结算' : '未结算' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="采购时间" width="170">
          <template #default="{ row }">{{ formatDateTime(row.purchasedAt) }}</template>
        </el-table-column>
        <el-table-column label="操作" width="100" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" size="small" @click="openDetail(row)">查看详情</el-button>
          </template>
        </el-table-column>
        <template #empty>
          <el-empty description="没有符合条件的采购记录" />
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
        这里展示你向主体商家采购的代金券记录；<b>结算由主体操作</b>，本页只读。数据范围由后端按登录身份隔离，前端不传
        subMerchantId。
      </div>
    </el-card>

    <!-- 采购详情：后端无独立详情接口，抽屉展示该记录全字段（含结算备注） -->
    <el-drawer v-model="detailVisible" title="采购记录详情" size="520px">
      <el-descriptions v-if="detail" :column="1" border size="small">
        <el-descriptions-item label="采购单号">{{ detail.purchaseNo }}</el-descriptions-item>
        <el-descriptions-item label="主体商家">{{ detail.mainMerchantName || `#${detail.mainMerchantId}` }}</el-descriptions-item>
        <el-descriptions-item label="券模板">
          {{ detail.templateName || '—' }}
          <span class="page__dim">（模板 #{{ detail.templateId }}）</span>
        </el-descriptions-item>
        <el-descriptions-item label="采购数量">{{ detail.quantity }}</el-descriptions-item>
        <el-descriptions-item label="单价">{{ detail.unitPrice }}</el-descriptions-item>
        <el-descriptions-item label="总金额">
          <b class="page__amount">{{ detail.totalAmount }}</b>
        </el-descriptions-item>
        <el-descriptions-item label="结算状态">
          <el-tag size="small" :type="detail.settleStatus === 'SETTLED' ? 'success' : 'warning'">
            {{ detail.settleStatus === 'SETTLED' ? '已结算' : '未结算' }}
          </el-tag>
        </el-descriptions-item>
        <el-descriptions-item label="结算备注">{{ detail.settleRemark || '—' }}</el-descriptions-item>
        <el-descriptions-item label="采购时间">{{ formatDateTime(detail.purchasedAt) }}</el-descriptions-item>
        <el-descriptions-item label="录入时间">{{ formatDateTime(detail.createdAt) }}</el-descriptions-item>
      </el-descriptions>
      <el-alert
        type="info"
        show-icon
        :closable="false"
        title="结算状态由主体商家在后台标记，本页不支持修改。"
        style="margin-top: 12px"
      />
    </el-drawer>
  </div>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
import { purchaseApi, type PurchaseItem } from '@/api/purchase';
import { formatDateTime, toIso } from '@/utils/dict';

/**
 * 附属 · 本店采购记录（S5.5-2）
 *
 * 复用 `GET /purchases`（S4.1）。后端 scope：附属 = 自己作为 subMerchantId 的记录，
 * 店员账号后端直接返回空（采购是商家级行为）。本页**只读** —— 结算权归主体（purchase:settle）。
 */
const list = ref<PurchaseItem[]>([]);
const total = ref(0);
const loading = ref(false);
const query = reactive({ page: 1, pageSize: 10, settleStatus: '' as string });
/** el-date-picker 的 [开始, 结束]，转 ISO 后再发给后端 */
const range = ref<[string, string] | null>(null);

async function load() {
  loading.value = true;
  try {
    const res = await purchaseApi.list({
      page: query.page,
      pageSize: query.pageSize,
      settleStatus: query.settleStatus || undefined,
      from: range.value?.[0] ? toIso(range.value[0]) : undefined,
      // 结束日期按当天 23:59:59.999 处理，否则当天记录会被漏掉
      to: range.value?.[1] ? toIso(range.value[1], true) : undefined,
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
  query.settleStatus = '';
  range.value = null;
  onSearch();
}

// ---------------------------------------------------------------- 详情抽屉
const detailVisible = ref(false);
const detail = ref<PurchaseItem | null>(null);

function openDetail(row: PurchaseItem) {
  detail.value = row;
  detailVisible.value = true;
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
.page__dim {
  color: #94a3b8;
  font-size: 12px;
}
.page__amount {
  font-weight: 600;
}
</style>
