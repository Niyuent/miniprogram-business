<template>
  <div class="apply">
    <div class="apply__card">
      <header class="apply__head">
        <p class="apply__brand">商盟系统</p>
        <h1>附属商家入驻申请</h1>
        <p class="apply__sub">填写资料后提交，由主体商家审核。通过后会为您开通登录账号。</p>
        <p v-if="inviteCode" class="apply__invite">专属邀请码 {{ inviteCode }}</p>
      </header>

      <div v-if="submitted" class="apply__done">
        <h2>等待审核</h2>
        <p>您的申请已提交，请等待平台审核。审核结果将通过短信/电话通知您。</p>
      </div>

      <el-form v-else ref="formRef" :model="form" :rules="rules" label-position="top" size="large" @submit.prevent>
        <el-form-item label="商家名称" prop="name">
          <el-input v-model="form.name" maxlength="100" placeholder="请输入商家名称" />
        </el-form-item>
        <el-form-item label="联系人姓名" prop="contactName">
          <el-input v-model="form.contactName" maxlength="50" placeholder="请输入联系人姓名" />
        </el-form-item>
        <el-form-item label="联系电话" prop="contactPhone">
          <el-input v-model="form.contactPhone" maxlength="11" placeholder="请输入 11 位手机号" />
        </el-form-item>
        <el-form-item label="所在城市" prop="city">
          <el-input v-model="form.city" maxlength="32" placeholder="例如：杭州市" />
        </el-form-item>
        <el-form-item label="详细地址" prop="address">
          <el-input v-model="form.address" maxlength="255" placeholder="选填" />
        </el-form-item>
        <el-form-item label="营业执照号" prop="licenseNo" required>
          <el-input v-model="form.licenseNo" maxlength="64" placeholder="请输入营业执照号" />
        </el-form-item>
        <el-button type="primary" class="apply__submit" :loading="loading" @click="onSubmit">提交申请</el-button>
      </el-form>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, reactive, ref } from 'vue';
import { useRoute } from 'vue-router';
import type { FormInstance, FormRules } from 'element-plus';
import { http } from '@/utils/request';

const route = useRoute();
const inviteCode = computed(() => String(route.query.invite || ''));

const formRef = ref<FormInstance>();
const loading = ref(false);
const submitted = ref(false);

const form = reactive({
  name: '',
  contactName: '',
  contactPhone: '',
  city: '',
  address: '',
  licenseNo: '',
});

const rules: FormRules = {
  name: [{ required: true, message: '请填写商家名称', trigger: 'blur' }, { min: 2, message: '至少 2 个字', trigger: 'blur' }],
  contactName: [{ required: true, message: '请填写联系人姓名', trigger: 'blur' }, { min: 2, message: '至少 2 个字', trigger: 'blur' }],
  contactPhone: [
    { required: true, message: '请填写联系电话', trigger: 'blur' },
    { pattern: /^1[3-9]\d{9}$/, message: '请输入正确的手机号', trigger: 'blur' },
  ],
  city: [{ required: true, message: '请填写所在城市', trigger: 'blur' }, { min: 2, message: '至少 2 个字', trigger: 'blur' }],
  address: [{
    validator: (_rule, value: string, callback) => {
      const text = (value || '').trim();
      if (text && text.length < 2) callback(new Error('详细地址至少 2 个字，或留空'));
      else callback();
    },
    trigger: 'blur',
  }],
  licenseNo: [
    { required: true, message: '请填写营业执照号', trigger: 'blur' },
    { min: 5, max: 64, message: '营业执照号为 5 到 64 位', trigger: 'blur' },
  ],
};

async function onSubmit() {
  const ok = await formRef.value?.validate().catch(() => false);
  if (!ok) return;
  loading.value = true;
  try {
    const address = form.address.trim();
    await http({
      url: '/merchants/applications',
      method: 'POST',
      data: {
        name: form.name.trim(),
        contactName: form.contactName.trim(),
        contactPhone: form.contactPhone.trim(),
        city: form.city.trim(),
        licenseNo: form.licenseNo.trim(),
        ...(address ? { address } : {}),
        ...(inviteCode.value ? { inviteCode: inviteCode.value } : {}),
      },
    });
    submitted.value = true;
  } finally {
    loading.value = false;
  }
}
</script>

<style scoped>
.apply {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 40px 16px;
  background:
    radial-gradient(ellipse at 50% 0%, #1e3a5f 0%, transparent 55%),
    #0b1220;
}
.apply__card {
  width: 480px;
  max-width: 100%;
  padding: 36px 36px 28px;
  background: #fff;
  border-radius: 16px;
  box-shadow: 0 24px 60px rgba(0, 0, 0, 0.28);
}
.apply__brand {
  margin: 0 0 8px;
  color: #2563eb;
  font-size: 13px;
  letter-spacing: 0.18em;
}
.apply__head h1 {
  margin: 0;
  font-size: 26px;
  color: #0f172a;
}
.apply__invite {
  margin: -8px 0 18px;
  color: #0f766e;
  font-weight: 700;
}
.apply__sub {
  margin: 10px 0 22px;
  color: #64748b;
  line-height: 1.6;
  font-size: 14px;
}
.apply__submit {
  width: 100%;
  margin-top: 8px;
}
.apply__done {
  padding: 28px 8px 12px;
  text-align: center;
}
.apply__done h2 {
  margin: 0 0 12px;
  color: #0f172a;
  font-size: 22px;
}
.apply__done p {
  margin: 0;
  color: #475569;
  line-height: 1.7;
}
</style>
