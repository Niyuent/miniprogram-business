<template>
  <div class="page" v-loading="loading">
    <el-page-header content="用户详情" @back="router.back()" />

    <el-card shadow="never" class="detail__card">
      <template #header>
        <div class="page__header">
          <span>基本信息</span>
          <div>
            <el-button v-permission="'user:edit'" :type="profile?.status === 'ACTIVE' ? 'danger' : 'success'" size="small" @click="onToggle">
              {{ profile?.status === 'ACTIVE' ? '禁用' : '启用' }}
            </el-button>
            <el-button v-permission="'user:edit'" size="small" @click="onBindPhone">绑定/修改手机号</el-button>
          </div>
        </div>
      </template>
      <el-descriptions :column="3" border>
        <el-descriptions-item label="ID">{{ profile?.id }}</el-descriptions-item>
        <el-descriptions-item label="手机号">{{ profile?.phone }}</el-descriptions-item>
        <el-descriptions-item label="昵称">{{ profile?.nickname || '—' }}</el-descriptions-item>
        <el-descriptions-item label="状态">
          <el-tag :type="profile?.status === 'ACTIVE' ? 'success' : 'info'">{{ profile?.status === 'ACTIVE' ? '启用' : '禁用' }}</el-tag>
        </el-descriptions-item>
        <el-descriptions-item label="微信绑定">{{ profile?.openid ? '已绑定' : '未绑定' }}</el-descriptions-item>
        <el-descriptions-item label="注册时间">{{ formatDateTime(profile?.registeredAt) }}</el-descriptions-item>
      </el-descriptions>
      <div class="detail__merchants">
        <span class="page__dim">来源商家：</span>
        <template v-if="sourceMerchants.length">
          <el-tag v-for="m in sourceMerchants" :key="m.id" class="detail__tag" size="small">{{ m.name }}</el-tag>
        </template>
        <span v-else class="page__dim">无</span>
      </div>
    </el-card>

    <el-card shadow="never" class="detail__card">
      <template #header>积分账户</template>
      <div class="detail__stats">
        <el-statistic title="当前余额" :value="account.balance" />
        <el-statistic title="累计获得" :value="account.totalEarned" />
        <el-statistic title="累计消耗" :value="account.totalSpent" />
      </div>
    </el-card>

    <el-card shadow="never" class="detail__card">
      <template #header>代金券（{{ coupons.length }}）</template>
      <el-table :data="coupons" size="small" stripe>
        <el-table-column prop="code" label="券码" width="180" />
        <el-table-column prop="templateId" label="模板ID" width="90" />
        <el-table-column label="状态" width="110">
          <template #default="{ row }"><el-tag size="small">{{ row.status }}</el-tag></template>
        </el-table-column>
        <el-table-column label="获得时间" width="170">
          <template #default="{ row }">{{ formatDateTime(row.obtainedAt) }}</template>
        </el-table-column>
        <el-table-column label="有效期至" min-width="170">
          <template #default="{ row }">{{ row.expireAt ? formatDateTime(row.expireAt) : '长期有效' }}</template>
        </el-table-column>
      </el-table>
      <el-empty v-if="!coupons.length" description="暂无代金券" :image-size="60" />
    </el-card>

    <el-card shadow="never" class="detail__card">
      <template #header>消费记录（{{ orders.length }}）</template>
      <el-table :data="orders" size="small" stripe>
        <el-table-column prop="orderNo" label="订单号" min-width="180" />
        <el-table-column prop="merchantId" label="商家" width="80" />
        <el-table-column prop="payAmount" label="金额" width="100" align="right" />
        <el-table-column label="状态" width="110">
          <template #default="{ row }"><el-tag size="small">{{ row.status }}</el-tag></template>
        </el-table-column>
        <el-table-column label="消费时间" min-width="170">
          <template #default="{ row }">{{ formatDateTime(row.consumeTime) }}</template>
        </el-table-column>
      </el-table>
      <el-empty v-if="!orders.length" description="暂无消费记录" :image-size="60" />
    </el-card>

    <el-card shadow="never" class="detail__card">
      <template #header>核销记录（{{ redemptions.length }}）</template>
      <el-table :data="redemptions" size="small" stripe>
        <el-table-column prop="code" label="券码" width="180" />
        <el-table-column prop="merchantId" label="商家" width="80" />
        <el-table-column label="状态" width="110">
          <template #default="{ row }"><el-tag size="small">{{ row.status }}</el-tag></template>
        </el-table-column>
        <el-table-column label="核销时间" min-width="170">
          <template #default="{ row }">{{ formatDateTime(row.redeemedAt) }}</template>
        </el-table-column>
      </el-table>
      <el-empty v-if="!redemptions.length" description="暂无核销记录" :image-size="60" />
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ElMessage, ElMessageBox } from 'element-plus';
import { userApi, type UserDetail } from '@/api/user';
import { formatDateTime } from '@/utils/dict';

const route = useRoute();
const router = useRouter();
const loading = ref(false);
const data = ref<UserDetail | null>(null);

const profile = computed(() => data.value?.profile);
const account = computed(() => data.value?.account ?? { balance: 0, totalEarned: 0, totalSpent: 0 });
const coupons = computed(() => data.value?.coupons ?? []);
const orders = computed(() => data.value?.orders ?? []);
const redemptions = computed(() => data.value?.redemptions ?? []);
const sourceMerchants = computed(() => data.value?.sourceMerchants ?? []);

const userId = computed(() => Number(route.params.id));

async function load() {
  loading.value = true;
  try {
    data.value = await userApi.detail(userId.value);
  } finally {
    loading.value = false;
  }
}

async function onToggle() {
  const p = profile.value;
  if (!p) return;
  const next = p.status === 'ACTIVE' ? 'DISABLED' : 'ACTIVE';
  const verb = next === 'DISABLED' ? '禁用' : '启用';
  try {
    await ElMessageBox.confirm(`确认${verb}用户「${p.nickname || p.phone}」？`, '提示', { type: 'warning' });
  } catch {
    return;
  }
  await userApi.updateStatus(p.id, next);
  ElMessage.success(`${verb}成功`);
  load();
}

async function onBindPhone() {
  const p = profile.value;
  if (!p) return;
  try {
    const { value } = await ElMessageBox.prompt('请输入要绑定的手机号', '绑定手机号', {
      inputPattern: /^1[3-9]\d{9}$/,
      inputErrorMessage: '手机号格式不正确',
      inputValue: p.phone,
    });
    await userApi.bindPhone(p.id, value);
    ElMessage.success('绑定成功');
    load();
  } catch {
    /* 取消 */
  }
}

onMounted(load);
</script>

<style scoped>
.detail__card {
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
.detail__merchants {
  margin-top: 12px;
}
.detail__tag {
  margin-right: 6px;
}
.detail__stats {
  display: flex;
  gap: 48px;
}
</style>
