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
        <el-form-item>
          <el-button type="primary" :loading="loading" @click="onSearch">查询</el-button>
          <el-button v-if="canCreate" @click="createVisible = true">新增采购</el-button>
        </el-form-item>
      </el-form>

      <el-table v-loading="loading" :data="list" border stripe>
        <el-table-column prop="purchaseNo" label="采购单号" min-width="200" />
        <el-table-column label="主体" min-width="130">
          <template #default="{ row }">{{ row.mainMerchantName || `#${row.mainMerchantId}` }}</template>
        </el-table-column>
        <el-table-column label="附属" min-width="130">
          <template #default="{ row }">{{ row.subMerchantName || `#${row.subMerchantId}` }}</template>
        </el-table-column>
        <el-table-column label="券模板" min-width="130">
          <template #default="{ row }">{{ row.templateName || `#${row.templateId}` }}</template>
        </el-table-column>
        <el-table-column prop="quantity" label="数量" width="80" align="right" />
        <el-table-column prop="unitPrice" label="单价" width="90" align="right" />
        <el-table-column prop="totalAmount" label="总金额" width="100" align="right" />
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
        <el-table-column label="操作" width="100" fixed="right">
          <template #default="{ row }">
            <el-button v-if="row.settleStatus === 'UNSETTLED' && canSettle" link type="primary" size="small" @click="openSettle(row)">结算</el-button>
          </template>
        </el-table-column>
        <template #empty><el-empty description="没有采购记录" /></template>
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

      <el-dialog v-model="createVisible" title="新增采购" width="460px">
        <el-form label-width="90px">
          <el-form-item label="附属商家">
            <el-input v-model.number="createForm.subMerchantId" placeholder="附属商家 id" />
          </el-form-item>
          <el-form-item label="券模板">
            <el-input v-model.number="createForm.templateId" placeholder="券模板 id" />
          </el-form-item>
          <el-form-item label="数量">
            <el-input-number v-model="createForm.quantity" :min="1" />
          </el-form-item>
          <el-form-item label="单价">
            <el-input-number v-model="createForm.unitPrice" :min="0" :precision="2" />
          </el-form-item>
        </el-form>
        <template #footer>
          <el-button @click="createVisible = false">取消</el-button>
          <el-button type="primary" :loading="submitting" @click="submitCreate">确定</el-button>
        </template>
      </el-dialog>

      <el-dialog v-model="settleVisible" title="标记结算" width="420px">
        <el-input v-model="settleForm.settleRemark" type="textarea" :rows="3" placeholder="结算备注（选填）" />
        <template #footer>
          <el-button @click="settleVisible = false">取消</el-button>
          <el-button type="primary" :loading="submitting" @click="submitSettle">确认结算</el-button>
        </template>
      </el-dialog>
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { ElMessage } from 'element-plus';
import { purchaseApi, type PurchaseItem } from '@/api/purchase';
import { useUserStore } from '@/stores/user';
import { formatDateTime } from '@/utils/dict';

const userStore = useUserStore();
const canCreate = computed(() => userStore.permissions.includes('purchase:create'));
const canSettle = computed(() => userStore.permissions.includes('purchase:settle'));

const list = ref<PurchaseItem[]>([]);
const total = ref(0);
const loading = ref(false);
const query = reactive({ page: 1, pageSize: 10, settleStatus: '' as string });

async function load() {
  loading.value = true;
  try {
    const res = await purchaseApi.list({ page: query.page, pageSize: query.pageSize, settleStatus: query.settleStatus || undefined });
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

const createVisible = ref(false);
const submitting = ref(false);
const createForm = reactive({ subMerchantId: undefined as number | undefined, templateId: undefined as number | undefined, quantity: 1, unitPrice: 0 });

async function submitCreate() {
  if (!createForm.subMerchantId || !createForm.templateId) {
    ElMessage.warning('请填写附属商家和券模板');
    return;
  }
  submitting.value = true;
  try {
    const r = await purchaseApi.create({ subMerchantId: createForm.subMerchantId, templateId: createForm.templateId, quantity: createForm.quantity, unitPrice: createForm.unitPrice });
    ElMessage.success(`采购单 ${r.purchaseNo} 已创建`);
    createVisible.value = false;
    load();
  } finally {
    submitting.value = false;
  }
}

const settleVisible = ref(false);
const settleForm = reactive({ id: 0, settleRemark: '' });

function openSettle(row: PurchaseItem) {
  settleForm.id = row.id;
  settleForm.settleRemark = '';
  settleVisible.value = true;
}

async function submitSettle() {
  submitting.value = true;
  try {
    await purchaseApi.settle(settleForm.id, { settleRemark: settleForm.settleRemark || undefined });
    ElMessage.success('已结算');
    settleVisible.value = false;
    load();
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
</style>
