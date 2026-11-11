<template>
  <div class="page">
    <el-card shadow="never">
      <!-- 附属侧纯收件箱：无发件箱 Tab、无发布按钮（发布权 notification:send 只给主体/平台） -->
      <div class="page__toolbar">
        <div class="page__toolbar-title">
          接收通知
          <el-tag v-if="unreadCount > 0" size="small" type="danger" class="page__badge">
            {{ unreadCount }} 条未读
          </el-tag>
        </div>
      </div>

      <NotificationInbox ref="inboxRef" />
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useNotificationStore } from '@/stores/notification';
import NotificationInbox from '@/components/NotificationInbox.vue';

/**
 * 附属通知中心（S5.5-1）
 *
 * 纯收件箱：直接复用主体/附属共用的 `<NotificationInbox>` 组件，
 * 不套 el-tabs、不放「发布通知」按钮（附属无 `notification:send`）。
 * 数据范围由后端按 JWT 推导（附属 = 本商家 + 其门店），前端不传任何 receiverId。
 */
const notificationStore = useNotificationStore();
const unreadCount = computed(() => notificationStore.unreadCount);
const inboxRef = ref<InstanceType<typeof NotificationInbox> | null>(null);

/** 与主端一致：铃铛在别处标记已读后，此处同步刷新列表 */
watch(
  () => notificationStore.readStateVersion,
  () => inboxRef.value?.reload(),
);
</script>

<style scoped>
.page__toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}
.page__toolbar-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 16px;
  font-weight: 600;
}
.page__badge {
  font-weight: 400;
}
</style>
