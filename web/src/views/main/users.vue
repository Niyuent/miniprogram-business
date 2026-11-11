<template>
  <div class="page">
    <el-card shadow="never">
      <template #header>
        <div class="page__header">
          <span>用户管理</span>
          <span class="page__dim">共 {{ total }} 位用户（附属/店员仅可见本商家/门店消费过的用户）</span>
        </div>
      </template>

      <el-form :inline="true" :model="query" class="page__filters">
        <el-form-item label="手机号">
          <el-input v-model="query.phone" placeholder="手机号" clearable style="width: 150px" @keyup.enter="onSearch" />
        </el-form-item>
        <el-form-item label="关键词">
          <el-input v-model="query.keyword" placeholder="昵称/手机号" clearable style="width: 150px" @keyup.enter="onSearch" />
        </el-form-item>
        <el-form-item label="状态">
          <el-select v-model="query.status" placeholder="全部" clearable style="width: 110px">
            <el-option label="启用" value="ACTIVE" />
            <el-option label="禁用" value="DISABLED" />
          </el-select>
        </el-form-item>
        <el-form-item label="注册时间">
          <el-date-picker
            v-model="range"
            type="daterange"
            value-format="YYYY-MM-DD"
            start-placeholder="起"
            end-placeholder="止"
            style="width: 240px"
          />
        </el-form-item>
        <el-form-item>
          <el-button type="primary" :icon="Search" @click="onSearch">查询</el-button>
          <el-button :icon="Refresh" @click="onReset">重置</el-button>
        </el-form-item>
      </el-form>

      <el-table v-loading="loading" :data="list" stripe>
        <el-table-column prop="id" label="ID" width="80" />
        <el-table-column prop="phone" label="手机号" width="140" />
        <el-table-column prop="nickname" label="昵称" min-width="140" />
        <el-table-column label="状态" width="90">
          <template #default="{ row }">
            <el-tag :type="row.status === 'ACTIVE' ? 'success' : 'info'">
              {{ row.status === 'ACTIVE' ? '启用' : '禁用' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="微信" width="90">
          <template #default="{ row }">
            <el-tag v-if="row.bound" size="small" type="success">已绑定</el-tag>
            <span v-else class="page__dim">—</span>
          </template>
        </el-table-column>
        <el-table-column prop="balance" label="积分" width="90" align="right" />
        <el-table-column prop="orderCount" label="订单" width="80" align="right" />
        <el-table-column prop="couponCount" label="券" width="70" align="right" />
        <el-table-column prop="redemptionCount" label="核销" width="70" align="right" />
        <el-table-column label="邀请人" width="140">
          <template #default="{ row }">
            <span v-if="row.inviterName">{{ row.inviterName }}</span>
            <span v-else class="page__dim">—</span>
          </template>
        </el-table-column>
        <el-table-column label="注册时间" width="170">
          <template #default="{ row }">{{ formatDateTime(row.registeredAt) }}</template>
        </el-table-column>
        <el-table-column label="操作" width="230" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" @click="goDetail(row.id)">详情</el-button>
            <el-button
              v-permission="'user:edit'"
              link
              :type="row.status === 'ACTIVE' ? 'danger' : 'success'"
              @click="onToggle(row)"
            >
              {{ row.status === 'ACTIVE' ? '禁用' : '启用' }}
            </el-button>
            <el-button v-permission="'user:edit'" link type="primary" @click="onBindPhone(row)">绑手机号</el-button>
          </template>
        </el-table-column>
      </el-table>

      <el-pagination
        class="page__pager"
        background
        layout="total, sizes, prev, pager, next"
        :total="total"
        v-model:current-page="query.page"
        v-model:page-size="query.pageSize"
        :page-sizes="[10, 20, 50, 100]"
        @current-change="load"
        @size-change="load"
      />
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import { ElMessage, ElMessageBox } from 'element-plus';
import { Refresh, Search } from '@element-plus/icons-vue';
import { userApi, type QueryUsers, type UserListItem, type UserStatus } from '@/api/user';
import { formatDateTime } from '@/utils/dict';

const router = useRouter();
const loading = ref(false);
const list = ref<UserListItem[]>([]);
const total = ref(0);
const range = ref<[string, string] | null>(null);
const query = reactive<QueryUsers>({ page: 1, pageSize: 20, phone: '', keyword: '', status: undefined });

async function load() {
  loading.value = true;
  try {
    const res = await userApi.list({
      ...query,
      registeredFrom: range.value?.[0],
      registeredTo: range.value?.[1],
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

function onReset() {
  query.phone = '';
  query.keyword = '';
  query.status = undefined;
  range.value = null;
  query.page = 1;
  load();
}

function goDetail(id: number) {
  router.push(`/main/users/${id}`);
}

async function onToggle(row: UserListItem) {
  const next: UserStatus = row.status === 'ACTIVE' ? 'DISABLED' : 'ACTIVE';
  const verb = next === 'DISABLED' ? '禁用' : '启用';
  try {
    await ElMessageBox.confirm(`确认${verb}用户「${row.nickname || row.phone}」？`, '提示', { type: 'warning' });
  } catch {
    return;
  }
  await userApi.updateStatus(row.id, next);
  ElMessage.success(`${verb}成功`);
  load();
}

async function onBindPhone(row: UserListItem) {
  try {
    const { value } = await ElMessageBox.prompt('请输入要绑定的手机号', '绑定手机号', {
      inputPattern: /^1[3-9]\d{9}$/,
      inputErrorMessage: '手机号格式不正确',
      inputValue: row.phone,
    });
    await userApi.bindPhone(row.id, value);
    ElMessage.success('绑定成功');
    load();
  } catch {
    /* 取消 */
  }
}

onMounted(load);
</script>

<style scoped>
.page__header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.page__dim {
  color: #94a3b8;
  font-size: 12px;
}
.page__filters {
  margin-bottom: 8px;
}
.page__pager {
  margin-top: 12px;
  display: flex;
  justify-content: flex-end;
}
</style>
