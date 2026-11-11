<template>
  <el-card shadow="never">
    <template #header>个人中心</template>
    <el-descriptions :column="2" border>
      <el-descriptions-item label="账号">{{ userStore.profile?.username }}</el-descriptions-item>
      <el-descriptions-item label="姓名">{{ userStore.profile?.realName }}</el-descriptions-item>
      <el-descriptions-item label="手机号">{{ userStore.profile?.phone }}</el-descriptions-item>
      <el-descriptions-item label="所属商家">{{ userStore.profile?.merchant?.name || '-' }}</el-descriptions-item>
      <el-descriptions-item label="商家类型">
        <el-tag :type="userStore.isMainMerchant ? 'warning' : 'success'">
          {{ userStore.isMainMerchant ? '主体商家' : '附属商家' }}
        </el-tag>
      </el-descriptions-item>
      <el-descriptions-item label="所属门店">{{ userStore.profile?.store?.name || '-' }}</el-descriptions-item>
      <el-descriptions-item label="角色">{{ userStore.profile?.roles.join('、') }}</el-descriptions-item>
      <el-descriptions-item label="账号类型">{{ userStore.profile?.userType }}</el-descriptions-item>
      <el-descriptions-item label="账号状态">
        <el-tag :type="userStore.profile?.status === 'ACTIVE' ? 'success' : 'danger'" size="small">
          {{ userStore.profile?.status }}
        </el-tag>
      </el-descriptions-item>
    </el-descriptions>

    <el-divider content-position="left">权限码（{{ userStore.permissions.length }}）</el-divider>
    <el-tag v-for="p in userStore.permissions" :key="p" size="small" class="profile__perm">{{ p }}</el-tag>

    <el-divider content-position="left">修改密码</el-divider>
    <el-alert
      v-if="userStore.mustChangePassword"
      type="warning"
      show-icon
      :closable="false"
      class="profile__alert"
      title="当前账号仍在使用系统生成的初始口令，修改密码后才能正常使用其余功能。"
    />
    <el-form :model="pwd" label-width="110px" class="profile__form">
      <el-form-item label="原密码">
        <el-input v-model="pwd.oldPassword" type="password" show-password style="width: 260px" />
      </el-form-item>
      <el-form-item label="新密码">
        <el-input v-model="pwd.newPassword" type="password" show-password style="width: 260px" />
        <div class="profile__hint">至少 8 位，且不能与原密码相同（后端强校验）</div>
      </el-form-item>
      <el-form-item>
        <el-button type="primary" :loading="submitting" @click="onChangePassword">提交</el-button>
      </el-form-item>
    </el-form>
  </el-card>
</template>

<script setup lang="ts">
import { reactive, ref } from 'vue';
import { ElMessage } from 'element-plus';
import { useUserStore } from '@/stores/user';
import { authApi } from '@/api/auth';

const userStore = useUserStore();
const submitting = ref(false);
const pwd = reactive({ oldPassword: '', newPassword: '' });

async function onChangePassword() {
  if (pwd.newPassword.length < 8) {
    ElMessage.warning('新密码至少 8 位');
    return;
  }
  submitting.value = true;
  try {
    await authApi.updatePassword({ ...pwd });
    userStore.mustChangePassword = false;
    pwd.oldPassword = '';
    pwd.newPassword = '';
    ElMessage.success('密码修改成功，请用新密码重新登录');
  } finally {
    submitting.value = false;
  }
}
</script>

<style scoped>
.profile__perm {
  margin: 0 8px 8px 0;
}
.profile__alert {
  margin-bottom: 12px;
}
.profile__form {
  max-width: 460px;
}
.profile__hint {
  font-size: 12px;
  color: #94a3b8;
  margin-top: 4px;
}
</style>
