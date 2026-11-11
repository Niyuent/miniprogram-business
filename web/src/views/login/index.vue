<template>
  <div class="login">
    <div class="login__brand">
      <h1>商盟系统</h1>
      <p>代金券 · 积分 · 核销 · 对账 一体化管理平台</p>
      <ul>
        <li>主体商家统一创建与上架代金券</li>
        <li>授权附属商家发放主体商家代金券</li>
        <li>积分兑换、到店核销、采购对账全链路</li>
      </ul>
    </div>

    <div class="login__panel">
      <h2>账号登录</h2>
      <el-form ref="formRef" :model="form" :rules="rules" size="large" @keyup.enter="onSubmit">
        <el-form-item prop="username">
          <el-input v-model="form.username" placeholder="请输入账号" :prefix-icon="User" />
        </el-form-item>
        <el-form-item prop="password">
          <el-input
            v-model="form.password"
            type="password"
            show-password
            placeholder="请输入密码"
            :prefix-icon="Lock"
          />
        </el-form-item>
        <el-button type="primary" class="login__submit" :loading="loading" @click="onSubmit">
          登 录
        </el-button>
      </el-form>

      <el-divider>演示账号（点击填充，口令见后台发放）</el-divider>
      <div class="login__accounts">
        <el-button size="small" @click="fill('admin')">主体商家 · admin</el-button>
        <el-button size="small" @click="fill('sub01')">附属已授权 · sub01</el-button>
        <el-button size="small" @click="fill('sub02')">附属未授权 · sub02</el-button>
        <el-button size="small" @click="fill('clerk01')">店员 · clerk01</el-button>
      </div>
      <div class="login__tip">统一口令 <b>Test@123456</b>（真实后端校验，无 Mock）</div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { reactive, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ElMessage, ElMessageBox, type FormInstance, type FormRules } from 'element-plus';
import { Lock, User } from '@element-plus/icons-vue';
import { useUserStore } from '@/stores/user';

const router = useRouter();
const route = useRoute();
const userStore = useUserStore();

const formRef = ref<FormInstance>();
const loading = ref(false);
const form = reactive({ username: 'admin', password: 'Test@123456' });

const rules: FormRules = {
  username: [{ required: true, message: '请输入账号', trigger: 'blur' }],
  password: [{ required: true, message: '请输入密码', trigger: 'blur' }],
};

function fill(username: string) {
  form.username = username;
  form.password = 'Test@123456';
}

async function onSubmit() {
  await formRef.value?.validate(async (valid) => {
    if (!valid) return;
    loading.value = true;
    try {
      const res = await userStore.login({ ...form });
      ElMessage.success(`欢迎回来，${res.user.realName || res.user.username}`);
      if (res.mustChangePassword) {
        await ElMessageBox.alert(
          '该账号由审核流程自动生成，首次登录请到「个人中心」修改密码；未改密前其余接口会被后端拒绝（403 PASSWORD_CHANGE_REQUIRED）。',
          '请修改初始口令',
          { type: 'warning', confirmButtonText: '我知道了' },
        );
      }
      const redirect = (route.query.redirect as string) || '/dashboard';
      router.push(redirect);
    } finally {
      loading.value = false;
    }
  });
}
</script>

<style scoped>
.login {
  height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(135deg, #1e3a8a 0%, #0f766e 100%);
  gap: 80px;
}
.login__brand {
  color: #fff;
  max-width: 420px;
}
.login__brand h1 {
  font-size: 40px;
  margin-bottom: 12px;
  letter-spacing: 4px;
}
.login__brand p {
  opacity: 0.85;
  margin-bottom: 24px;
}
.login__brand ul {
  list-style: none;
  padding: 0;
  line-height: 2;
  opacity: 0.8;
  font-size: 14px;
}
.login__brand li::before {
  content: '✓ ';
}
.login__panel {
  width: 380px;
  padding: 32px;
  background: #fff;
  border-radius: 12px;
  box-shadow: 0 20px 40px rgba(0, 0, 0, 0.18);
}
.login__panel h2 {
  margin: 0 0 24px;
  font-size: 20px;
}
.login__submit {
  width: 100%;
}
.login__accounts {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}
.login__tip {
  margin-top: 12px;
  text-align: center;
  font-size: 12px;
  color: #94a3b8;
}
@media (max-width: 900px) {
  .login__brand {
    display: none;
  }
}
</style>
