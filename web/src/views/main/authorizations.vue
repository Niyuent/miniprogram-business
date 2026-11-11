<template>
  <div class="page">
    <el-card shadow="never">
      <el-form :inline="true" class="page__filter">
        <el-form-item label="被授权商家">
          <el-select
            v-model="query.subMerchantId"
            clearable
            filterable
            placeholder="全部附属商家"
            style="width: 200px"
            @change="onSearch"
          >
            <el-option v-for="m in subMerchants" :key="m.id" :label="`${m.name}（${m.code}）`" :value="m.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="状态">
          <el-select v-model="query.status" clearable placeholder="全部" style="width: 130px" @change="onSearch">
            <el-option label="已开启" value="ENABLED" />
            <el-option label="已关闭" value="DISABLED" />
          </el-select>
        </el-form-item>
        <el-form-item>
          <el-button type="primary" :loading="loading" @click="onSearch">查询</el-button>
        </el-form-item>
        <el-form-item class="page__filter-right">
          <!-- 按钮级权限：authorization:manage -->
          <el-button v-permission="'authorization:manage'" type="primary" @click="openCreate">
            开启授权
          </el-button>
          <el-button @click="openLogs">授权记录</el-button>
        </el-form-item>
      </el-form>

      <el-table v-loading="loading" :data="list" border stripe>
        <el-table-column prop="id" label="授权 id" width="90" />
        <el-table-column label="被授权商家" min-width="180">
          <template #default="{ row }">{{ row.subMerchantName || `商家 #${row.subMerchantId}` }}</template>
        </el-table-column>
        <el-table-column label="授权类型" width="160">
          <template #default="{ row }">{{ AUTH_TYPE_LABEL[row.authType] || row.authType }}</template>
        </el-table-column>
        <el-table-column label="范围" min-width="220">
          <template #default="{ row }">
            <el-tag size="small" :type="row.templateScope === 'ALL' ? 'success' : 'warning'">
              {{ row.templateScope === 'ALL' ? '全部主体券' : '指定券模板' }}
            </el-tag>
            <div v-if="row.templateScope === 'SPECIFIED'" class="page__templates">
              {{ row.templateIds.join('、') }}
            </div>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="100">
          <template #default="{ row }">
            <el-tag :type="row.status === 'ENABLED' ? 'success' : 'info'" size="small">
              {{ row.status === 'ENABLED' ? '已开启' : '已关闭' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="开启时间" width="170">
          <template #default="{ row }">{{ formatDateTime(row.grantedAt) }}</template>
        </el-table-column>
        <el-table-column label="关闭时间 / 原因" min-width="220">
          <template #default="{ row }">
            <div v-if="row.revokedAt">
              {{ formatDateTime(row.revokedAt) }}
              <div class="page__reason">{{ row.revokeReason || '未填写原因' }}</div>
            </div>
            <span v-else>—</span>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="240" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" @click="openDetail(row)">详情</el-button>
            <el-button
              v-permission="'authorization:manage'"
              link
              type="warning"
              @click="onAdjustScope"
            >
              调整范围
            </el-button>
            <el-button
              v-permission="'authorization:manage'"
              link
              type="danger"
              :disabled="row.status === 'DISABLED'"
              @click="onDisable(row)"
            >
              关闭
            </el-button>
          </template>
        </el-table-column>
        <template #empty>
          <el-empty description="暂无授权记录" />
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

    <!-- 授权详情 -->
    <el-drawer v-model="detailVisible" title="授权详情" size="560px">
      <el-descriptions v-if="current" :column="1" border size="small">
        <el-descriptions-item label="授权 id">{{ current.id }}</el-descriptions-item>
        <el-descriptions-item label="主体商家">{{ current.mainMerchantName }}</el-descriptions-item>
        <el-descriptions-item label="被授权商家">{{ current.subMerchantName }}</el-descriptions-item>
        <el-descriptions-item label="授权类型">{{ AUTH_TYPE_LABEL[current.authType] || current.authType }}</el-descriptions-item>
        <el-descriptions-item label="状态">
          <el-tag :type="current.status === 'ENABLED' ? 'success' : 'info'" size="small">
            {{ current.status === 'ENABLED' ? '已开启' : '已关闭' }}
          </el-tag>
        </el-descriptions-item>
        <el-descriptions-item label="范围">
          {{ current.templateScope === 'ALL' ? '全部主体券' : `指定模板：${current.templateIds.join('、')}` }}
        </el-descriptions-item>
        <el-descriptions-item label="开启时间">{{ formatDateTime(current.grantedAt) }}</el-descriptions-item>
        <el-descriptions-item label="关闭时间">{{ formatDateTime(current.revokedAt) }}</el-descriptions-item>
        <el-descriptions-item label="关闭原因">{{ current.revokeReason || '—' }}</el-descriptions-item>
      </el-descriptions>
    </el-drawer>

    <!-- 开启授权 -->
    <el-dialog v-model="createVisible" title="开启授权" width="560px" @closed="resetCreate">
      <el-form label-width="110px">
        <el-form-item label="被授权商家" required>
          <el-select v-model="form.subMerchantId" filterable placeholder="选择附属商家" style="width: 100%">
            <el-option
              v-for="m in subMerchants"
              :key="m.id"
              :label="`${m.name}（${m.code}）`"
              :value="m.id"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="授权范围" required>
          <el-radio-group v-model="form.templateScope">
            <el-radio value="ALL">全部主体券</el-radio>
            <el-radio value="SPECIFIED">指定券模板</el-radio>
          </el-radio-group>
        </el-form-item>
        <el-form-item v-if="form.templateScope === 'SPECIFIED'" label="券模板" required>
          <el-select v-model="form.templateIds" multiple style="width: 100%">
            <el-option
              v-for="t in templates"
              :key="t.id"
              :label="`#${t.id} ${t.name}`"
              :value="t.id"
            />
          </el-select>
          <div class="page__hint">
            仅列出本主体已上架的主体券模板（seed 固定：1001 / 1002 / 1003）
          </div>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="createVisible = false">取消</el-button>
        <el-button type="primary" :loading="submitting" @click="submitCreate">确认开启</el-button>
      </template>
    </el-dialog>

    <!-- 授权记录（谁开的 / 谁关的 / 时间 / 原因） -->
    <el-drawer v-model="logsVisible" title="授权记录" size="720px">
      <el-table v-loading="logsLoading" :data="logs" size="small" border>
        <el-table-column label="时间" width="170">
          <template #default="{ row }">{{ formatDateTime(row.createdAt) }}</template>
        </el-table-column>
        <el-table-column label="动作" width="150">
          <template #default="{ row }">
            <el-tag :type="row.action === 'authorization:grant' ? 'success' : 'danger'" size="small">
              {{ row.action === 'authorization:grant' ? '开启授权' : '关闭授权' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="操作人" min-width="140">
          <template #default="{ row }">
            {{ row.operatorName || `账号 #${row.operatorId}` }}
            <el-tag v-if="row.result === 'FAILED'" type="danger" size="small">失败</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="目标 id" width="100">
          <template #default="{ row }">{{ row.targetId ?? '-' }}</template>
        </el-table-column>
        <el-table-column label="说明" min-width="180">
          <template #default="{ row }">
            {{ row.after?.revokeReason || row.after?.subMerchantName || (row.after?.noop ? '幂等重复调用' : '-') }}
          </template>
        </el-table-column>
      </el-table>
      <el-pagination
        class="page__pager"
        small
        layout="total, prev, pager, next"
        :total="logsTotal"
        v-model:current-page="logsPage"
        :page-size="10"
        @current-change="loadLogs"
      />
    </el-drawer>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { authorizationApi } from '@/api/authorization';
import { merchantApi } from '@/api/merchant';
import type {
  AuthorizationItem,
  AuthorizationLogItem,
  AuthStatus,
  AvailableTemplate,
  Merchant,
} from '@/types/business';
import { formatDateTime } from '@/utils/dict';

const AUTH_TYPE_LABEL: Record<string, string> = {
  ISSUE_MAIN_COUPON: '发放主体商家代金券',
};

const list = ref<AuthorizationItem[]>([]);
const total = ref(0);
const loading = ref(false);
const subMerchants = ref<Merchant[]>([]);
const templates = ref<AvailableTemplate[]>([]);

// 日志抽屉
const logs = ref<AuthorizationLogItem[]>([]);
const logsTotal = ref(0);
const logsPage = ref(1);

const query = reactive({
  page: 1,
  pageSize: 10,
  subMerchantId: undefined as number | undefined,
  status: '' as AuthStatus | '',
});

const detailVisible = ref(false);
const createVisible = ref(false);
const logsVisible = ref(false);
const logsLoading = ref(false);
const submitting = ref(false);
const current = ref<AuthorizationItem | null>(null);

const form = reactive({
  subMerchantId: undefined as number | undefined,
  templateScope: 'ALL' as 'ALL' | 'SPECIFIED',
  templateIds: [] as number[],
});

const canSubmit = computed(
  () =>
    !!form.subMerchantId &&
    (form.templateScope === 'ALL' || form.templateIds.length > 0),
);

async function load() {
  loading.value = true;
  try {
    const res = await authorizationApi.list({
      page: query.page,
      pageSize: query.pageSize,
      subMerchantId: query.subMerchantId,
      status: query.status || undefined,
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

function openDetail(row: AuthorizationItem) {
  current.value = row;
  detailVisible.value = true;
}

/** 附属商家候选：必须是已通过审核的 SUB 商家 */
async function loadSubMerchants() {
  const res = await merchantApi.list({ type: 'SUB', status: 'APPROVED', pageSize: 100 });
  subMerchants.value = res.list;
}

async function loadTemplates() {
  const res = await authorizationApi.availableTemplates();
  templates.value = res.templates;
}

async function openCreate() {
  await Promise.all([loadSubMerchants(), loadTemplates()]);
  createVisible.value = true;
}

function resetCreate() {
  form.subMerchantId = undefined;
  form.templateScope = 'ALL';
  form.templateIds = [];
}

async function submitCreate() {
  if (!canSubmit.value) {
    ElMessage.warning('请选择被授权商家，并在「指定券模板」时至少选一个模板');
    return;
  }
  submitting.value = true;
  try {
    const res = await authorizationApi.create({
      subMerchantId: form.subMerchantId!,
      templateScope: form.templateScope,
      templateIds: form.templateScope === 'SPECIFIED' ? form.templateIds : undefined,
    });
    ElMessage.success(res.reactivated ? '已重新启用该授权' : '授权已开启，附属商家立即可用');
    createVisible.value = false;
    load();
  } catch (e) {
    const msg = (e as Error).message || '';
    if (msg.includes('AUTHORIZATION_EXISTS')) {
      ElMessage.warning('该商家已处于授权状态：如需调整范围，请先关闭现有授权再重新开启');
      load();
      return;
    }
    throw e;
  } finally {
    submitting.value = false;
  }
}

/**
 * 「调整授权范围」入口
 *
 * 后端不支持在线改已开启授权的范围（避免出现「改了一半」的中间态），
 * 所以这里**不直接打开编辑框**，而是明确告知必须先关闭。
 */
function onAdjustScope() {
  ElMessageBox.alert(
    '授权范围不支持直接修改。请先<b>关闭现有授权</b>（可填写关闭原因），再重新开启并选择新的范围。',
    '调整授权范围',
    {
      dangerouslyUseHTMLString: true,
      confirmButtonText: '我知道了',
      type: 'warning',
    },
  );
}

/** 关闭授权：必须能填原因（写进 revoke_reason，审计可追溯）；重复关闭后端返回 200 幂等 */
async function onDisable(row: AuthorizationItem) {
  const prompt = await ElMessageBox.prompt(
    `确认关闭对「${row.subMerchantName || `商家 #${row.subMerchantId}`}」的授权？关闭后其立即失去发放主体券的能力。`,
    '关闭授权',
    {
      inputPlaceholder: '关闭原因（建议填写，将进入操作日志）',
      inputType: 'textarea',
      inputValue: '',
      confirmButtonText: '确认关闭',
      cancelButtonText: '取消',
      type: 'warning',
    },
  ).catch(() => null);

  if (!prompt) return;

  const res = await authorizationApi.disable(row.id, {
    revokeReason: (prompt.value || '').trim() || undefined,
  });
  if (res.alreadyDisabled) {
    ElMessage.info('该授权此前已关闭（幂等返回 200，未产生新的状态变更）');
  } else {
    ElMessage.success('授权已关闭，附属商家立即失去发券能力');
  }
  load();
}

async function openLogs() {
  logsVisible.value = true;
  logsPage.value = 1;
  await loadLogs();
}

async function loadLogs() {
  logsLoading.value = true;
  try {
    const res = await authorizationApi.logs({ page: logsPage.value, pageSize: 10 });
    logs.value = res.list;
    logsTotal.value = res.total;
  } finally {
    logsLoading.value = false;
  }
}

onMounted(async () => {
  await load();
  // 列表里要显示「被授权商家」下拉，顺带把候选商家取回来（失败不影响列表展示）
  try {
    await loadSubMerchants();
  } catch {
    subMerchants.value = [];
  }
});
</script>

<style scoped>
.page__filter {
  margin-bottom: 4px;
}
.page__filter-right {
  float: right;
  margin-right: 0;
}
.page__templates {
  margin-top: 4px;
  color: #64748b;
  font-size: 12px;
}
.page__reason {
  color: #94a3b8;
  font-size: 12px;
}
.page__hint {
  margin-top: 6px;
  color: #94a3b8;
  font-size: 12px;
}
.page__pager {
  margin-top: 16px;
  justify-content: flex-end;
}
</style>
