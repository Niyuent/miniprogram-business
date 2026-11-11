<template>
  <div class="page">
    <el-card shadow="never">
      <template #header>
        <div class="page__header">
          <span>本商家门店</span>
          <span class="page__dim">门店信息变更需提交主体审核，通过后生效</span>
        </div>
      </template>

      <el-table v-loading="loading" :data="stores" stripe>
        <el-table-column prop="id" label="ID" width="80" />
        <el-table-column prop="name" label="门店名称" min-width="160" />
        <el-table-column prop="code" label="编码" width="110" />
        <el-table-column prop="contactName" label="联系人" width="110" />
        <el-table-column prop="contactPhone" label="联系电话" width="140" />
        <el-table-column prop="address" label="地址" min-width="180" />
        <el-table-column label="状态" width="90">
          <template #default="{ row }">
            <el-tag :type="row.status === 'OPEN' ? 'success' : 'info'">{{ row.status }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="200" fixed="right">
          <template #default="{ row }">
            <el-button v-permission="'store:change:submit'" link type="primary" @click="openSubmit(row.id)">提交变更</el-button>
            <el-button link @click="loadChanges(row.id)">查看申请</el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <el-card v-if="currentStoreId" shadow="never" class="page__card">
      <template #header>
        <div class="page__header">
          <span>变更申请（门店 #{{ currentStoreId }}）</span>
          <el-button link @click="loadChanges(currentStoreId)">刷新</el-button>
        </div>
      </template>
      <el-table v-loading="changesLoading" :data="changes" stripe>
        <el-table-column prop="id" label="申请ID" width="90" />
        <el-table-column label="变更内容" min-width="240">
          <template #default="{ row }">
            <span v-for="(v, k) in row.changes" :key="k" class="page__change">
              {{ CHANGE_FIELD_LABELS[String(k)] || k }}: {{ v.old ?? '—' }} → <b>{{ v.new ?? '—' }}</b>
            </span>
          </template>
        </el-table-column>
        <el-table-column prop="reason" label="说明" width="140" />
        <el-table-column label="状态" width="100">
          <template #default="{ row }">
            <el-tag :type="statusType(row.status)">{{ statusText(row.status) }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="reviewRemark" label="审核备注" width="160" />
        <el-table-column label="提交时间" width="170">
          <template #default="{ row }">{{ formatDateTime(row.createdAt) }}</template>
        </el-table-column>
        <el-table-column label="操作" width="100" fixed="right">
          <template #default="{ row }">
            <el-button v-if="row.status === 'PENDING'" v-permission="'store:change:submit'" link type="danger" @click="onCancel(row)">作废</el-button>
          </template>
        </el-table-column>
      </el-table>
      <el-empty v-if="!changesLoading && !changes.length" description="暂无变更申请" :image-size="60" />
    </el-card>

    <!-- 提交变更 -->
    <el-dialog v-model="submitVisible" title="提交门店变更申请" width="640px">
      <el-alert type="info" :closable="false" class="page__alert"
        title="仅可变更：名称、联系人、电话、省市区、地址、经纬度、营业时间、Logo；门店编码 / 所属商家 / 门店状态不可变更。" />
      <el-form ref="formRef" :model="form" :rules="rules" label-width="90px">
        <el-row :gutter="12">
          <el-col :span="12"><el-form-item label="门店编码"><el-input :model-value="base?.code || '—'" disabled /></el-form-item></el-col>
          <el-col :span="12"><el-form-item label="所属商家"><el-input :model-value="String(base?.merchantId ?? '—')" disabled /></el-form-item></el-col>
        </el-row>
        <el-form-item label="门店名称" prop="name"><el-input v-model="form.name" maxlength="100" /></el-form-item>
        <el-row :gutter="12">
          <el-col :span="12"><el-form-item label="联系人" prop="contactName"><el-input v-model="form.contactName" maxlength="50" /></el-form-item></el-col>
          <el-col :span="12"><el-form-item label="联系电话" prop="contactPhone"><el-input v-model="form.contactPhone" maxlength="20" /></el-form-item></el-col>
        </el-row>
        <el-row :gutter="12">
          <el-col :span="8"><el-form-item label="省" prop="province"><el-input v-model="form.province" maxlength="32" /></el-form-item></el-col>
          <el-col :span="8"><el-form-item label="市" prop="city"><el-input v-model="form.city" maxlength="32" /></el-form-item></el-col>
          <el-col :span="8"><el-form-item label="区" prop="district"><el-input v-model="form.district" maxlength="32" /></el-form-item></el-col>
        </el-row>
        <el-form-item label="地址" prop="address"><el-input v-model="form.address" maxlength="255" /></el-form-item>
        <el-row :gutter="12">
          <el-col :span="12"><el-form-item label="经度" prop="lng"><el-input-number v-model="form.lng" :min="-180" :max="180" :precision="6" controls-position="right" style="width: 100%" /></el-form-item></el-col>
          <el-col :span="12"><el-form-item label="纬度" prop="lat"><el-input-number v-model="form.lat" :min="-90" :max="90" :precision="6" controls-position="right" style="width: 100%" /></el-form-item></el-col>
        </el-row>
        <el-form-item label="营业时间" prop="businessHours"><el-input v-model="form.businessHours" placeholder="如 09:00-22:00" maxlength="100" /></el-form-item>
        <el-form-item label="Logo" prop="logo"><el-input v-model="form.logo" placeholder="图片 URL" maxlength="255" /></el-form-item>
        <el-form-item label="申请说明"><el-input v-model="form.reason" type="textarea" :rows="2" maxlength="200" /></el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="submitVisible = false">取消</el-button>
        <el-button type="primary" :loading="submitting" @click="onSubmit">提交</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
import { ElMessage, ElMessageBox, type FormInstance, type FormRules } from 'element-plus';
import { storeApi, CHANGE_FIELD_LABELS, type ChangeStatus, type StoreBrief, type StoreChangeRequest, type StoreChangePayload } from '@/api/store';
import { formatDateTime } from '@/utils/dict';

const loading = ref(false);
const stores = ref<StoreBrief[]>([]);
const changes = ref<StoreChangeRequest[]>([]);
const changesLoading = ref(false);
const currentStoreId = ref<number | null>(null);

const submitVisible = ref(false);
const submitting = ref(false);
const base = ref<StoreBrief | null>(null);
const formRef = ref<FormInstance>();
const form = reactive<StoreChangePayload>({});

const rules: FormRules = {
  name: [{ max: 100, message: '名称过长', trigger: 'blur' }],
  contactPhone: [{ pattern: /^[0-9+\-() ]{6,20}$/, message: '联系电话格式不正确', trigger: 'blur' }],
};

const statusText = (s: ChangeStatus) => (s === 'PENDING' ? '待审核' : s === 'APPROVED' ? '已通过' : '已驳回');
const statusType = (s: ChangeStatus) => (s === 'PENDING' ? 'warning' : s === 'APPROVED' ? 'success' : 'danger');

async function loadStores() {
  loading.value = true;
  try {
    stores.value = await storeApi.listMyStores();
  } finally {
    loading.value = false;
  }
}

async function loadChanges(storeId: number) {
  currentStoreId.value = storeId;
  changesLoading.value = true;
  try {
    changes.value = await storeApi.listStoreChanges(storeId);
  } finally {
    changesLoading.value = false;
  }
}

async function openSubmit(storeId: number) {
  const detail = await storeApi.getStore(storeId);
  base.value = detail as StoreBrief;
  Object.assign(form, {
    name: detail.name ?? '',
    contactName: detail.contactName ?? '',
    contactPhone: detail.contactPhone ?? '',
    province: (detail as unknown as Record<string, string>)?.province ?? '',
    city: (detail as unknown as Record<string, string>)?.city ?? '',
    district: (detail as unknown as Record<string, string>)?.district ?? '',
    address: detail.address ?? '',
    lng: (detail as unknown as Record<string, number | null>)?.lng != null ? Number((detail as unknown as Record<string, unknown>).lng) : undefined,
    lat: (detail as unknown as Record<string, number | null>)?.lat != null ? Number((detail as unknown as Record<string, unknown>).lat) : undefined,
    businessHours: detail.businessHours ?? '',
    logo: (detail as unknown as Record<string, string>)?.logo ?? '',
    reason: '',
  });
  submitVisible.value = true;
}

async function onSubmit() {
  if (!formRef.value || !base.value) return;
  await formRef.value.validate();
  submitting.value = true;
  try {
    await storeApi.submitChange(base.value.id, { ...form });
    ElMessage.success('已提交，等待主体审核');
    submitVisible.value = false;
    await loadChanges(base.value.id);
  } finally {
    submitting.value = false;
  }
}

async function onCancel(row: StoreChangeRequest) {
  try {
    await ElMessageBox.confirm(`确认作废申请 #${row.id}？作废后可重新提交。`, '提示', { type: 'warning' });
  } catch {
    return;
  }
  await storeApi.cancelChange(row.id);
  ElMessage.success('已作废');
  if (currentStoreId.value) await loadChanges(currentStoreId.value);
}

onMounted(loadStores);
</script>

<style scoped>
.page__card {
  margin-top: 12px;
}
.page__header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.page__dim {
  color: #94a3b8;
  font-size: 12px;
}
.page__alert {
  margin-bottom: 12px;
}
.page__change {
  display: inline-block;
  margin-right: 12px;
  font-size: 12px;
  color: #475569;
}
</style>
