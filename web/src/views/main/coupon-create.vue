<template>
  <div class="page">
    <el-card shadow="never">
      <template #header>
        <div class="page__head">
          <span>创建券模板</span>
          <el-button link @click="$router.push('/main/coupons')">返回列表</el-button>
        </div>
      </template>

      <el-alert
        type="info"
        show-icon
        :closable="false"
        title="H1：仅主体商家可创建券模板 · 营销规则由商家自主配置"
        description="平台不再强制「面值 ≤ 门槛」。创建后为草稿（DRAFT），上架后才能发放。高级设置中的领取限制 / 商品范围 / 实付约束会随模板保存，核销端按您的配置执行。"
        class="page__alert"
      />

      <CouponForm :submitting="submitting" @submit="onCreate" @cancel="$router.push('/main/coupons')" />
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import { ElMessage } from 'element-plus';
import CouponForm from './coupon-form.vue';
import { couponTemplateApi } from '@/api/coupon-template';
import type { CreateCouponTemplatePayload } from '@/types/business';

const router = useRouter();
const submitting = ref(false);

async function onCreate(payload: CreateCouponTemplatePayload) {
  submitting.value = true;
  try {
    const res = await couponTemplateApi.create(payload);
    ElMessage.success(`券模板 #${res.template.id} 已创建（草稿）`);
    router.push(`/main/coupons/${res.template.id}`);
  } finally {
    submitting.value = false;
  }
}
</script>

<style scoped>
.page__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.page__alert {
  margin-bottom: 20px;
}
</style>
