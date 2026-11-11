<template>
  <div class="page">
    <el-card shadow="never">
      <div class="page__toolbar">
        <el-button type="primary" @click="inviteOpen = true">
          <el-icon class="el-icon--left"><UserPlusIcon /></el-icon>
          + 邀请商家入驻
        </el-button>
      </div>
      <el-form :inline="true" class="page__filter">
        <el-form-item label="状态">
          <el-select v-model="query.status" clearable placeholder="全部" style="width: 130px" @change="onSearch">
            <el-option label="待审核" value="PENDING" />
            <el-option label="已通过" value="APPROVED" />
            <el-option label="已暂停" value="SUSPENDED" />
            <el-option label="已驳回" value="REJECTED" />
          </el-select>
        </el-form-item>
        <el-form-item label="类型">
          <el-select v-model="query.type" clearable placeholder="全部" style="width: 130px" @change="onSearch">
            <el-option label="主体商家" value="MAIN" />
            <el-option label="附属商家" value="SUB" />
          </el-select>
        </el-form-item>
        <el-form-item label="关键词">
          <el-input
            v-model="query.keyword"
            clearable
            placeholder="商家名称 / 编码"
            style="width: 200px"
            @keyup.enter="onSearch"
          />
        </el-form-item>
        <el-form-item>
          <el-button type="primary" :loading="loading" @click="onSearch">查询</el-button>
        </el-form-item>
      </el-form>

      <el-table v-loading="loading" :data="list" border stripe>
        <el-table-column prop="id" label="id" width="80" />
        <el-table-column prop="code" label="商家编码" width="130" />
        <el-table-column prop="name" label="商家名称" min-width="180" />
        <el-table-column label="类型" width="100">
          <template #default="{ row }">{{ typeLabel(row.type) }}</template>
        </el-table-column>
        <el-table-column label="上级主体" min-width="160">
          <template #default="{ row }">{{ row.parent?.name || '—' }}</template>
        </el-table-column>
        <el-table-column prop="contactName" label="联系人" width="110" />
        <el-table-column prop="contactPhone" label="联系电话" width="130" />
        <el-table-column label="门店 / 账号" width="120">
          <template #default="{ row }">{{ row._count.stores }} / {{ row._count.adminUsers }}</template>
        </el-table-column>
        <el-table-column label="状态" width="100">
          <template #default="{ row }">
            <el-tag :type="statusTagType(row.status)" size="small">
              {{ statusLabel(row.status) }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="200" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" @click="openDetail(row)">详情</el-button>
            <!-- 按钮级权限：merchant:manage -->
            <el-button
              v-if="row.status === 'APPROVED'"
              v-permission="'merchant:manage'"
              link
              type="danger"
              @click="onToggle(row, 'SUSPENDED')"
            >
              暂停
            </el-button>
            <el-button
              v-else-if="row.status === 'SUSPENDED'"
              v-permission="'merchant:manage'"
              link
              type="success"
              @click="onToggle(row, 'APPROVED')"
            >
              启用
            </el-button>
          </template>
        </el-table-column>
        <template #empty>
          <el-empty description="没有符合条件的商家" />
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
    </el-card>

    <!-- 商家详情 -->
    <el-drawer v-model="detailVisible" :title="`商家详情 · ${current?.name ?? ''}`" size="640px" @closed="onDrawerClosed">
      <el-descriptions :column="2" border size="small">
        <el-descriptions-item label="商家编码">{{ current?.code }}</el-descriptions-item>
        <el-descriptions-item label="类型">{{ current ? typeLabel(current.type) : '-' }}</el-descriptions-item>
        <el-descriptions-item label="上级主体">{{ current?.parent?.name || '—' }}</el-descriptions-item>
        <el-descriptions-item label="状态">
          <el-tag v-if="current" :type="statusTagType(current.status)" size="small">
            {{ statusLabel(current.status) }}
          </el-tag>
        </el-descriptions-item>
        <el-descriptions-item label="联系人">{{ current?.contactName || '-' }}</el-descriptions-item>
        <el-descriptions-item label="联系电话">{{ current?.contactPhone || '-' }}</el-descriptions-item>
        <el-descriptions-item label="地区" :span="2">
          {{ [current?.province, current?.city, current?.district].filter(Boolean).join(' ') || '-' }}
        </el-descriptions-item>
        <el-descriptions-item label="详细地址" :span="2">{{ current?.address || '-' }}</el-descriptions-item>
        <el-descriptions-item label="营业执照号" :span="2">{{ current?.licenseNo || '-' }}</el-descriptions-item>
        <el-descriptions-item label="结算联系人" :span="2">{{ current?.settleContact || '-' }}</el-descriptions-item>
        <el-descriptions-item label="审核备注" :span="2">{{ current?.auditRemark || '-' }}</el-descriptions-item>
        <el-descriptions-item label="入驻时间" :span="2">{{ formatDateTime(current?.createdAt) }}</el-descriptions-item>
      </el-descriptions>

      <el-divider content-position="left">门店（{{ current?.stores.length ?? 0 }}）</el-divider>
      <el-table :data="current?.stores ?? []" size="small" border>
        <el-table-column prop="id" label="id" width="70" />
        <el-table-column prop="code" label="门店编码" width="110" />
        <el-table-column prop="name" label="门店名称" min-width="140" />
        <el-table-column prop="status" label="状态" width="90" />
      </el-table>

      <el-divider content-position="left">账号（{{ current?.adminUsers.length ?? 0 }}）</el-divider>
      <el-table :data="current?.adminUsers ?? []" size="small" border>
        <el-table-column prop="id" label="id" width="70" />
        <el-table-column prop="username" label="账号" width="140" />
        <el-table-column prop="realName" label="姓名" width="120" />
        <el-table-column prop="userType" label="类型" width="100" />
        <el-table-column prop="status" label="状态" width="90" />
      </el-table>
    </el-drawer>
    <InviteMerchantDialog v-model="inviteOpen" />
  </div>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ElMessage, ElMessageBox } from 'element-plus';
import { merchantApi } from '@/api/merchant';
import InviteMerchantDialog from '@/components/InviteMerchantDialog.vue';
import UserPlusIcon from '@/components/UserPlusIcon.vue';
import type { Merchant, MerchantDetail, MerchantStatus, MerchantType } from '@/types/business';
import { formatDateTime, statusLabel, statusTagType, typeLabel } from '@/utils/dict';

const route = useRoute();
const router = useRouter();
const list = ref<Merchant[]>([]);
const total = ref(0);
const loading = ref(false);
const detailVisible = ref(false);
const inviteOpen = ref(false);
const current = ref<MerchantDetail | null>(null);
/** 避免 replace query 时和 watch 互相打架 */
let syncingQuery = false;

const query = reactive({
  page: 1,
  pageSize: 10,
  status: '' as MerchantStatus | '',
  type: '' as MerchantType | '',
  keyword: '',
});

async function load() {
  loading.value = true;
  try {
    const res = await merchantApi.list({
      page: query.page,
      pageSize: query.pageSize,
      status: query.status || undefined,
      type: query.type || undefined,
      keyword: query.keyword.trim() || undefined,
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

async function openDetailById(id: number, syncUrl: boolean) {
  try {
    current.value = await merchantApi.detail(id);
    detailVisible.value = true;
    if (syncUrl && String(route.query.id ?? '') !== String(id)) {
      syncingQuery = true;
      await router.replace({ query: { ...route.query, id: String(id) } });
      syncingQuery = false;
    }
  } catch {
    current.value = null;
    detailVisible.value = false;
  }
}

async function openDetail(row: Merchant) {
  await openDetailById(row.id, true);
}

function clearQueryId() {
  if (route.query.id == null) return;
  const next = { ...route.query };
  delete next.id;
  syncingQuery = true;
  void router.replace({ query: next }).finally(() => {
    syncingQuery = false;
  });
}

function onDrawerClosed() {
  clearQueryId();
}

watch(
  () => route.query.id,
  (raw) => {
    if (syncingQuery) return;
    if (raw == null || raw === '') return;
    const id = Number(Array.isArray(raw) ? raw[0] : raw);
    if (!Number.isFinite(id) || id <= 0) return;
    if (current.value?.id === id && detailVisible.value) return;
    void openDetailById(id, false);
  },
  { immediate: true },
);

/** 启停：APPROVED ↔ SUSPENDED，暂停时建议填原因（写进 audit_logs） */
async function onToggle(row: Merchant, target: 'APPROVED' | 'SUSPENDED') {
  const suspend = target === 'SUSPENDED';
  const prompt = await ElMessageBox.prompt(
    suspend
      ? `暂停后「${row.name}」的所有账号将无法登录，确认继续？`
      : `确认恢复「${row.name}」为正常营业状态？`,
    suspend ? '暂停商家' : '启用商家',
    {
      inputPlaceholder: suspend ? '暂停原因（可选，建议填写便于追溯）' : '恢复说明（可选）',
      inputValue: '',
      confirmButtonText: suspend ? '确认暂停' : '确认启用',
      cancelButtonText: '取消',
      type: suspend ? 'warning' : 'success',
    },
  ).catch(() => null);

  if (!prompt) return;

  await merchantApi.updateStatus(row.id, {
    status: target,
    remark: (prompt.value || '').trim() || undefined,
  });
  ElMessage.success(suspend ? '已暂停' : '已启用');
  load();
}

onMounted(load);
</script>

<style scoped>
.page__toolbar {
  display: flex;
  justify-content: flex-end;
  margin-bottom: 12px;
}
.page__filter {
  margin-bottom: 4px;
}
.page__pager {
  margin-top: 16px;
  justify-content: flex-end;
}
</style>
