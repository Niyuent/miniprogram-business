<template>
  <el-card shadow="never" class="forbidden">
    <el-result icon="warning" title="403 · 无访问权限" :sub-title="subTitle">
      <template #extra>
        <el-button type="primary" plain @click="$router.push('/dashboard')">返回工作台</el-button>
        <el-button @click="$router.back()">返回上一页</el-button>
      </template>
    </el-result>
    <el-alert
      type="info"
      show-icon
      :closable="false"
      title="为什么看到这一页？"
      description="当前账号的角色不含访问该页面所需的权限码。菜单已按权限隐藏，如果你是在地址栏手输 URL 进来的，说明前端路由守卫已拦下；即便绕过前端，后端 RolesGuard 仍会返回 403。"
    />
  </el-card>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useRoute } from 'vue-router';
import { useUserStore } from '@/stores/user';

const route = useRoute();
const userStore = useUserStore();

const need = computed(() => (route.query.need as string) || '该页面所需权限码');
const from = computed(() => (route.query.from as string) || '');

const subTitle = computed(() => {
  const who = `${userStore.profile?.realName || userStore.profile?.username || '当前账号'}`;
  const roles = userStore.roles.join(' / ') || '无角色';
  return `${who}（角色：${roles}）缺少权限码「${need.value}」${from.value ? `，无法访问 ${from.value}` : ''}`;
});
</script>

<style scoped>
.forbidden {
  max-width: 760px;
  margin: 40px auto;
}
</style>
