<template>
  <div class="page">
    <el-card shadow="never">
      <template #header>
        <div class="page__head">
          <span>发放代金券</span>
          <el-button link @click="$router.push('/main/coupons')">返回券模板</el-button>
        </div>
      </template>

      <el-alert
        type="info"
        show-icon
        :closable="false"
        title="主体商家可发放自己拥有或自己创建、且已上架的券模板"
        description="发券方由登录身份决定；库存与券码池不足时后端会拒绝（409）。附属商家代发请走授权后的「发放主体商家代金券」。"
        class="page__alert"
      />

      <el-form label-width="140px" class="page__form">
        <el-form-item label="选择券模板" required>
          <el-select
            v-model="form.templateId"
            placeholder="请选择已上架的券模板"
            style="width: 420px"
            filterable
            :loading="templateLoading"
            @change="onTemplateChange"
          >
            <el-option
              v-for="t in templates"
              :key="t.id"
              :label="`#${t.id} ${t.name}（面值 ${t.faceValue} 元 · 剩余 ${t.remainingStock}）`"
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

        <el-form-item label="备注">
          <el-input v-model="form.remark" maxlength="200" placeholder="选填，写入审计" style="width: 420px" />
        </el-form-item>

        <el-form-item>
          <el-button type="primary" :loading="submitting" :disabled="!canSubmit" @click="onIssue">
            确认发放
          </el-button>
          <el-button @click="onReset">重置</el-button>
        </el-form-item>
      </el-form>

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
import { useRoute } from 'vue-router';
import { ElMessage } from 'element-plus';
import { couponInstanceApi } from '@/api/coupon-instance';
import { couponTemplateApi } from '@/api/coupon-template';
import type { CouponTemplate, IssueCouponResult } from '@/types/business';
import {
  couponInstanceStatusLabel,
  couponInstanceStatusTagType,
  formatDateTime,
  validPeriodText,
} from '@/utils/dict';

/**
 * 主体商家「发放自有券」（coupon:issue）
 * 与附属 `/sub/coupons/issue` 共用同一后端接口；主体不走授权校验，只发自己拥有/创建的已上架券。
 */

const route = useRoute();
const templates = ref<CouponTemplate[]>([]);
const templateLoading = ref(false);
const submitting = ref(false);
const result = ref<IssueCouponResult | null>(null);

const targetType = ref<'userId' | 'phone'>('userId');
const form = reactive<{
  templateId?: number;
  userId?: number;
  phone: string;
  quantity: number;
  remark: string;
}>({
  templateId: undefined,
  userId: 1001,
  phone: '',
  quantity: 1,
  remark: '',
});

const current = computed(() => templates.value.find((t) => t.id === form.templateId) ?? null);

const canSubmit = computed(() => {
  if (!form.templateId) return false;
  return targetType.value === 'userId' ? !!form.userId : !!form.phone.trim();
});

async function loadTemplates() {
  templateLoading.value = true;
  try {
    const res = await couponTemplateApi.list({
      pageSize: 100,
      status: 'PUBLISHED',
    });
    templates.value = res.list;
    const fromQuery = Number(route.query.templateId || 0);
    if (fromQuery && templates.value.some((t) => t.id === fromQuery)) {
      form.templateId = fromQuery;
    }
  } finally {
    templateLoading.value = false;
  }
}

function onTemplateChange() {
  result.value = null;
}

function onReset() {
  result.value = null;
  form.templateId = undefined;
  form.quantity = 1;
  form.remark = '';
}

async function onIssue() {
  if (!form.templateId) return;
  submitting.value = true;
  try {
    const payload =
      targetType.value === 'userId'
        ? {
            templateId: form.templateId,
            userId: form.userId,
            quantity: form.quantity,
            ...(form.remark.trim() ? { remark: form.remark.trim() } : {}),
          }
        : {
            templateId: form.templateId,
            phone: form.phone.trim(),
            quantity: form.quantity,
            ...(form.remark.trim() ? { remark: form.remark.trim() } : {}),
          };
    const res = await couponInstanceApi.issue(payload);
    result.value = res;
    ElMessage.success(`已发放 ${res.quantity} 张`);
    await loadTemplates();
  } finally {
    submitting.value = false;
  }
}

onMounted(() => {
  loadTemplates();
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
  color: var(--el-text-color-secondary);
  font-size: 13px;
}
.page__result {
  margin-top: 16px;
}
.page__code {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-weight: 600;
}
</style>
