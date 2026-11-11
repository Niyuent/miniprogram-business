<template>
  <el-popover
    v-model:visible="panelVisible"
    placement="bottom-end"
    :width="360"
    trigger="click"
    :offset="8"
    popper-class="bell__popover"
    @show="onPanelShow"
  >
    <template #reference>
      <el-badge :value="badgeValue" :max="99" :hidden="badgeValue === 0" class="bell__badge">
        <el-button class="bell__trigger" text :aria-label="badgeValue > 0 ? `通知，${badgeValue} 条未读` : '通知'">
          <el-icon :size="20" :class="{ 'bell__ring': ringing }"><Bell /></el-icon>
        </el-button>
      </el-badge>
    </template>

    <!-- 标题栏 -->
    <div class="bell__header">
      <span class="bell__title">通知</span>
      <el-button
        v-if="list.length > 0"
        text
        type="primary"
        size="small"
        :loading="markingAll"
        @click="onMarkAllRead"
      >
        全部已读
      </el-button>
    </div>

    <!-- 列表区：最近 5 条未读 -->
    <div v-loading="listLoading" class="bell__body">
      <ul v-if="list.length > 0" class="bell__list">
        <li v-for="item in list" :key="item.id" class="bell__item" @click="onItemClick(item)">
          <span class="bell__dot" :class="`bell__dot--${item.level.toLowerCase()}`" />
          <div class="bell__item-main">
            <div class="bell__item-title">{{ item.title }}</div>
            <div class="bell__item-time">{{ formatDateTime(item.createdAt) }}</div>
          </div>
        </li>
      </ul>
      <el-empty v-else-if="!listLoading" description="暂无未读通知" :image-size="60" />
    </div>

    <!-- 底部栏 -->
    <div class="bell__footer">
      <el-button text type="primary" size="small" @click="onViewAll">查看全部</el-button>
    </div>
  </el-popover>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { ElMessage, ElNotification } from 'element-plus';
import { Bell } from '@element-plus/icons-vue';
import {
  SSE_CONNECTED,
  SSE_NOTIFICATION_NEW,
  notificationApi,
  notificationSse,
  type NotificationItem,
} from '@/api/notification';
import { useNotificationStore } from '@/stores/notification';
import { useUserStore } from '@/stores/user';
import { formatDateTime } from '@/utils/dict';

const router = useRouter();
const store = useNotificationStore();
const userStore = useUserStore();

const panelVisible = ref(false);
const listLoading = ref(false);
const markingAll = ref(false);
const list = ref<NotificationItem[]>([]);

/** 徽标数字：未读 > 99 显示 99+（由 el-badge 的 max 处理） */
const badgeValue = computed(() => store.unreadCount);

/** 通知中心入口：主体 / 平台 → 后台页；附属 / 店员 → 附属侧页 */
const inboxPath = computed(() =>
  userStore.hasPermission('notification:send') ? '/main/notifications?tab=inbox' : '/sub/notifications',
);

// ---------------------------------------------------------------- 面板数据

/** 每次打开面板都重新拉最近 5 条未读（面板是"即时快照"，不做缓存） */
async function onPanelShow() {
  listLoading.value = true;
  try {
    const res = await notificationApi.list({ readStatus: 'UNREAD', page: 1, pageSize: 5 });
    list.value = res.list;
  } catch {
    list.value = []; // 静默：铃铛不该为一次失败弹 toast
  } finally {
    listLoading.value = false;
  }
}

/** 点击单条：标记已读 → 关闭面板 → 跳通知中心 */
async function onItemClick(item: NotificationItem) {
  if (item.alreadyRead) return;
  try {
    await notificationApi.markRead(item.id);
    store.decrement();
    store.bumpReadState(); // 让可能打开着的通知中心页同步刷新
    list.value = list.value.filter((n) => n.id !== item.id);
  } catch {
    ElMessage.error('标记已读失败');
    return;
  }
  panelVisible.value = false;
  void router.push(inboxPath.value);
}

async function onMarkAllRead() {
  markingAll.value = true;
  try {
    const res = await notificationApi.markAllRead();
    store.clear();
    store.bumpReadState();
    list.value = [];
    ElMessage.success(`已标记 ${res.updated} 条为已读`);
  } catch (e) {
    ElMessage.error((e as Error).message || '全部已读失败');
  } finally {
    markingAll.value = false;
  }
}

function onViewAll() {
  panelVisible.value = false;
  void router.push(inboxPath.value);
}

// ---------------------------------------------------------------- SSE 实时推送（S7，替换 60s 轮询）

/** 断线重连的指数退避：3s → 6s → 12s → 24s → 48s → 60s（封顶） */
const RETRY_BASE_MS = 3000;
const RETRY_MAX_MS = 60_000;

let es: EventSource | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
let retryDelay = RETRY_BASE_MS;
/** 组件已卸载：阻止卸载后仍排队重连 */
let disposed = false;
/** 铃铛抖动（收到新通知时给个视觉反馈） */
const ringing = ref(false);
let ringTimer: ReturnType<typeof setTimeout> | undefined;

function ringBell() {
  ringing.value = true;
  if (ringTimer) clearTimeout(ringTimer);
  ringTimer = setTimeout(() => {
    ringing.value = false;
    ringTimer = undefined;
  }, 600);
}

/** 右下角轻提示：不打断当前操作，5s 自动消失，点击可跳通知中心 */
function popNotice(data: { title?: string; content?: string }) {
  const instance = ElNotification({
    title: data.title || '新通知',
    message: data.content || '',
    type: 'info',
    position: 'bottom-right',
    duration: 5000,
    onClick: () => {
      instance.close();
      void router.push(inboxPath.value);
    },
  });
}

function closeSse() {
  if (es) {
    es.close();
    es = null;
  }
}

function scheduleReconnect() {
  if (disposed || reconnectTimer) return;
  const delay = retryDelay;
  // 先按当前退避值排一次，再把下一次的间隔翻倍（封顶 60s）
  retryDelay = Math.min(retryDelay * 2, RETRY_MAX_MS);
  reconnectTimer = setTimeout(() => {
    reconnectTimer = undefined;
    void connectSse();
  }, delay);
}

async function connectSse() {
  if (disposed) return;
  closeSse();
  try {
    const t = await notificationSse.ticket();
    const source = notificationSse.connect(t.ticket);
    es = source;

    // 握手成功：重置退避，下一次断线从 3s 重新开始
    source.addEventListener(SSE_CONNECTED, () => {
      retryDelay = RETRY_BASE_MS;
    });

    // 收到新站内信：未读数 +1 + 抖动 + 右下角提示（不再拉接口）
    source.addEventListener(SSE_NOTIFICATION_NEW, (ev) => {
      store.increment();
      ringBell();
      let payload: { title?: string; content?: string } = {};
      try {
        payload = JSON.parse((ev as MessageEvent<string>).data);
      } catch {
        /* 数据异常也不影响红点 */
      }
      popNotice(payload);
    });

    // EventSource 自带重连会把 URL（含已消费的一次性 ticket）再打一次 → 必然 403，
    // 所以这里主动关掉再自己退避重连，用**新 ticket**。
    source.onerror = () => {
      if (disposed) return;
      closeSse();
      scheduleReconnect();
    };
  } catch {
    // 换 ticket 失败（网络抖动 / 未登录）→ 静默退避重试，不弹 toast
    scheduleReconnect();
  }
}

onMounted(async () => {
  // 首屏只拉一次未读数（store 未加载时）；之后全靠 SSE 增量更新
  if (!store.loaded) await store.refresh();
  void connectSse();
});

onUnmounted(() => {
  disposed = true;
  closeSse();
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = undefined;
  }
  if (ringTimer) {
    clearTimeout(ringTimer);
    ringTimer = undefined;
  }
});


</script>

<style scoped>
.bell__badge {
  /* 铃铛图标与顶栏其它元素垂直对齐 */
  display: inline-flex;
  align-items: center;
}
.bell__trigger {
  height: 32px;
  padding: 0 6px;
  color: #475569;
}
.bell__trigger:hover {
  color: #1d2129;
}
/* 收到新通知时的抖动（600ms，与 ringBell 的定时器一致） */
.bell__ring {
  animation: bell-shake 0.6s ease-in-out;
}
@keyframes bell-shake {
  0%,
  100% {
    transform: rotate(0deg);
  }
  15% {
    transform: rotate(18deg);
  }
  30% {
    transform: rotate(-16deg);
  }
  45% {
    transform: rotate(12deg);
  }
  60% {
    transform: rotate(-10deg);
  }
  75% {
    transform: rotate(6deg);
  }
}
.bell__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 4px 4px 10px;
  border-bottom: 1px solid #f1f5f9;
}
.bell__title {
  font-size: 14px;
  font-weight: 600;
}
.bell__body {
  max-height: 320px;
  overflow-y: auto;
}
.bell__list {
  margin: 0;
  padding: 0;
  list-style: none;
}
.bell__item {
  display: flex;
  gap: 8px;
  padding: 10px 6px;
  border-radius: 6px;
  cursor: pointer;
}
.bell__item:hover {
  background: #f8fafc;
}
.bell__dot {
  flex: none;
  width: 8px;
  height: 8px;
  margin-top: 6px;
  border-radius: 50%;
}
.bell__dot--urgent {
  background: #f56c6c;
}
.bell__dot--important {
  background: #e6a23c;
}
.bell__dot--normal {
  background: #94a3b8;
}
.bell__item-main {
  min-width: 0;
  flex: 1;
}
.bell__item-title {
  font-size: 13px;
  color: #1d2129;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.bell__item-time {
  margin-top: 2px;
  font-size: 12px;
  color: #94a3b8;
}
.bell__footer {
  padding-top: 8px;
  border-top: 1px solid #f1f5f9;
  text-align: center;
}
</style>
