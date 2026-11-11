<template>
  <div class="page">
    <el-card shadow="never">
      <template #header>
        <div class="page__head">
          <span>发放主体商家代金券</span>
          <el-tag v-if="authScope" size="small" type="success">
            授权范围：{{ authScope.allowsAllTemplates ? '全部主体券' : `${authScope.templateIds.length} 张指定券` }}
          </el-tag>
        </div>
      </template>

      <el-alert
        v-if="!authScope"
        type="warning"
        show-icon
        :closable="false"
        title="当前账号没有生效的「发放主体商家代金券」授权"
        description="请联系主体商家管理员开通授权后再来发放；即使页面被绕过，后端也会拒绝（403 SUB_MERCHANT_NOT_AUTHORIZED）。"
        class="page__alert"
      />

      <el-form label-width="140px" class="page__form">
        <el-form-item label="选择券模板" required>
          <el-select
            v-model="form.templateId"
            placeholder="请选择（仅列出授权范围内且已上架的主体券）"
            style="width: 420px"
            :loading="templateLoading"
            @change="onTemplateChange"
          >
            <el-option
              v-for="t in templates"
              :key="t.id"
              :label="`#${t.id} ${t.name}（面值 ${t.faceValue} 元）`"
              :value="t.id"
            />
          </el-select>
          <div v-if="current" class="page__hint">
            剩余库存 {{ current.remainingStock }}/{{ current.totalStock }} · {{ validPeriodText(current) }}
          </div>
        </el-form-item>

        <el-form-item label="发放对象" required>
          <el-radio-group v-model="targetType">
            <el-radio-button label="userId">按用户 id</el-radio-button>
            <el-radio-button label="phone">按手机号</el-radio-button>
          </el-radio-group>
        </el-form-item>
        <el-form-item v-if="targetType === 'userId'" label="用户 id">
          <el-input-number v-model="form.userId" :min="1" :step="1" />
          <span class="page__hint">演示数据：1001 张三 / 1002 李四</span>
        </el-form-item>
        <el-form-item v-else label="手机号">
          <el-input v-model="form.phone" placeholder="13800000001" style="width: 220px" />
        </el-form-item>

        <el-form-item label="发放数量">
          <el-input-number v-model="form.quantity" :min="1" :max="50" />
          <span class="page__hint">单次最多 50 张</span>
        </el-form-item>

        <el-form-item>
          <el-button type="primary" :loading="submitting" :disabled="!canSubmit" @click="onIssue">
            确认发放
          </el-button>
          <el-button @click="onReset">重置</el-button>
        </el-form-item>
      </el-form>

      <!-- 发放结果：券码 + 有效期必须当场给到，便于交付给用户 -->
      <template v-if="result">
        <el-divider content-position="left">发放结果</el-divider>
        <el-alert
          type="success"
          show-icon
          :closable="false"
          :title="`成功发放 ${result.quantity} 张，有效期至 ${formatDateTime(result.expireAt)}`"
        />
        <el-table :data="result.issued" border size="small" class="page__result">
          <el-table-column prop="id" label="券实例 id" width="110" />
          <el-table-column label="券码" min-width="180">
            <template #default="{ row }">
              <span class="page__code">{{ row.code }}</span>
            </template>
          </el-table-column>
          <el-table-column prop="templateName" label="券模板" min-width="180" />
          <el-table-column label="生效时间" min-width="170">
            <template #default="{ row }">{{ formatDateTime(row.obtainedAt) }}</template>
          </el-table-column>
          <el-table-column label="有效期至" min-width="170">
            <template #default="{ row }">{{ formatDateTime(row.expireAt) }}</template>
          </el-table-column>
          <el-table-column label="状态" width="100">
            <template #default="{ row }">
              <el-tag size="small" :type="couponInstanceStatusTagType(row.status)">
                {{ couponInstanceStatusLabel(row.status) }}
              </el-tag>
            </template>
          </el-table-column>
        </el-table>
      </template>
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { ElMessage } from 'element-plus';
import { couponInstanceApi } from '@/api/coupon-instance';
import { couponTemplateApi } from '@/api/coupon-template';
import { meAuthorizationApi } from '@/api/authorization';
import type { CouponInstance, CouponTemplate, IssueCouponResult } from '@/types/business';
import {
  couponInstanceStatusLabel,
  couponInstanceStatusTagType,
  formatDateTime,
  validPeriodText,
} from '@/utils/dict';

/**
 * 附属商家「发放主体商家代金券」（S2.2）
 *
 * 两条硬约束落在这里：
 * 1. **菜单可见性**：路由 meta.permission = `coupon:issue-main`，未授权商家连菜单都没有；
 *    直接输 URL 会被路由守卫拦到 /403。
 * 2. **可选模板只来自后端**：列表接口按身份收敛，附属商家只会拿到「授权范围内 + 已上架」的主体券，
 *    前端不做任何本地过滤（避免前端缓存了已被撤销授权的模板）。
 */

const templates = ref<CouponTemplate[]>([]);
const templateLoading = ref(false);
const submitting = ref(false);
const result = ref<IssueCouponResult | null>(null);
const authScope = ref<{ allowsAllTemplates: boolean; templateIds: number[] } | null>(null);

const targetType = ref<'userId' | 'phone'>('userId');
const form = reactive<{ templateId?: number; userId?: number; phone: string; quantity: number }>({
  templateId: undefined,
  userId: 1001,
  phone: '',
  quantity: 1,
});

const current = computed(() => templates.value.find((t) => t.id === form.templateId) ?? null);

const canSubmit = computed(() => {
  if (!form.templateId || !authScope.value) return false;
  return targetType.value === 'userId' ? !!form.userId : !!form.phone.trim();
});

async function loadTemplates() {
  templateLoading.value = true;
  try {
    // 后端已按授权范围收敛：只返回 MAIN_COUPON + PUBLISHED + 授权内的模板
    const res = await couponTemplateApi.list({
      pageSize: 100,
      ownerType: 'MAIN_COUPON',
      status: 'PUBLISHED',
    });
    templates.value = res.list;
  } finally {
    templateLoading.value = false;
  }
}

async function loadAuth() {
  try {
    const me = await meAuthorizationApi.me();
    authScope.value = me.issueMainCoupon ?? null;
  } catch {
    authScope.value = null;
  }
}

function onTemplateChange() {
  result.value = null;
}

function onReset() {
  result.value = null;
  form.templateId = undefined;
  form.quantity = 1;
}

async function onIssue() {
  if (!form.templateId) return;
  submitting.value = true;
  try {
    const payload =
      targetType.value === 'userId'
        ? { templateId: form.templateId, userId: form.userId, quantity: form.quantity }
        : { templateId: form.templateId, phone: form.phone.trim(), quantity: form.quantity };
    const res = await couponInstanceApi.issue(payload);
    result.value = res;
    ElMessage.success(`已发放 ${res.quantity} 张`);
    // 库存变了，重新拉一次模板列表
    await loadTemplates();
  } finally {
    submitting.value = false;
  }
}

onMounted(async () => {
  await Promise.all([loadAuth(), loadTemplates()]);
});
</script>

<style scoped>
.page__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.page__alert {
  margin-bottom: 18px;
}
.page__form {
  max-width: 720px;
}
.page__hint {
  margin-left: 12px;
  color: #94a3b8;
  font-size: 12px;
}
.page__result {
  margin-top: 12px;
}
.page__code {
  font-family: 'SFMono-Regular', Consolas, monospace;
  letter-spacing: 1px;
}
</style>
