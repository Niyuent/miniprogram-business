<template>
  <div class="inbox">
    <el-form :inline="true" class="inbox__filter">
      <el-form-item label="状态">
        <el-radio-group v-model="query.readStatus" @change="onSearch">
          <el-radio-button value="">全部</el-radio-button>
          <el-radio-button value="UNREAD">未读</el-radio-button>
          <el-radio-button value="READ">已读</el-radio-button>
        </el-radio-group>
      </el-form-item>
      <el-form-item label="类型">
        <el-select v-model="query.type" clearable placeholder="全部类型" style="width: 160px" @change="onSearch">
          <el-option v-for="(label, value) in NOTIFICATION_TYPE_LABELS" :key="value" :label="label" :value="value" />
        </el-select>
      </el-form-item>
      <el-form-item>
        <el-button :loading="loading" @click="load">刷新</el-button>
        <el-button :disabled="unreadCount === 0" :loading="markingAll" @click="onMarkAllRead">全部已读</el-button>
      </el-form-item>
    </el-form>

    <el-table v-loading="loading" :data="list" border stripe class="inbox__table--clickable" @row-click="onRowClick">
      <el-table-column label="级别" width="90">
        <template #default="{ row }">
          <el-tag :type="levelTagType(row.level)" size="small">{{ levelLabel(row.level) }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="标题" min-width="220">
        <template #default="{ row }">
          <span v-if="!row.alreadyRead" class="inbox__dot" />
          <span class="inbox__title">{{ row.title }}</span>
        </template>
      </el-table-column>
      <el-table-column label="内容" min-width="260">
        <template #default="{ row }">
          <div class="inbox__summary">{{ row.content }}</div>
        </template>
      </el-table-column>
      <el-table-column label="类型" width="110">
        <template #default="{ row }">{{ typeLabel(row.type) }}</template>
      </el-table-column>
      <el-table-column label="时间" width="170">
        <template #default="{ row }">{{ formatDateTime(row.createdAt) }}</template>
      </el-table-column>
      <el-table-column label="操作" width="100" fixed="right">
        <template #default="{ row }">
          <el-button v-if="!row.alreadyRead" link type="primary" @click.stop="onMarkRead(row)">标记已读</el-button>
          <span v-else class="inbox__dim">已读</span>
        </template>
      </el-table-column>
      <template #empty>
        <el-empty :description="emptyText" />
      </template>
    </el-table>

    <el-pagination
      class="inbox__pager"
      background
      layout="total, sizes, prev, pager, next"
      :total="total"
      v-model:current-page="query.page"
      v-model:page-size="query.pageSize"
      :page-sizes="[10, 20, 50]"
      @size-change="load"
      @current-change="load"
    />
    <div class="inbox__hint">点击任意一行可查看全文并自动标记已读</div>

    <!-- 通知全文（点行打开；打开即标记已读） -->
    <el-drawer v-model="detailVisible" title="通知详情" size="640px">
      <template v-if="detail">
        <div class="inbox__detail-head">
          <el-tag :type="levelTagType(detail.level)" size="small">{{ levelLabel(detail.level) }}</el-tag>
          <span class="inbox__detail-title">{{ detail.title }}</span>
        </div>
        <div class="inbox__detail-meta">
          {{ typeLabel(detail.type) }} · {{ formatDateTime(detail.createdAt) }}
          <el-tag v-if="detail.alreadyRead" size="small" type="success" class="inbox__detail-read">已读</el-tag>
          <el-tag v-else size="small" type="warning">未读</el-tag>
        </div>
        <el-divider content-position="left">正文</el-divider>
        <div class="inbox__detail-content">{{ detail.content }}</div>
      </template>
    </el-drawer>
  </div>
</template>

<script setup lang="ts">
import { computed, defineExpose, onMounted, reactive, ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import {
  NOTIFICATION_TYPE_LABELS,
  NOTIFY_LEVEL_LABELS,
  notificationApi,
  type NotificationItem,
  type NotificationType,
  type NotifyLevel,
  type ReadStatus,
} from '@/api/notification';
import { useNotificationStore } from '@/stores/notification';
import { formatDateTime } from '@/utils/dict';

/**
 * 站内信收件箱（S5.5-1 从 `/main/notifications` 抽出，主体与附属共用）
 *
 * 自身完整负责：筛选 / 列表 / 分页 / 标记已读 / 全部已读 / 全文抽屉，
 * 未读数统一读写 `stores/notification.ts`（与铃铛、工作台同一口径）。
 * 父页面只负责「放在哪个 Tab / 哪张卡片里」，不掺和数据逻辑。
 */
const store = useNotificationStore();

const loading = ref(false);
const markingAll = ref(false);
const list = ref<NotificationItem[]>([]);
const total = ref(0);
const detailVisible = ref(false);
const detail = ref<NotificationItem | null>(null);
const query = reactive({
  page: 1,
  pageSize: 10,
  readStatus: '' as ReadStatus | '',
  type: '' as NotificationType | '',
});

const unreadCount = computed(() => store.unreadCount);

const emptyText = computed(() => {
  if (query.readStatus === 'UNREAD') return '没有未读通知';
  if (query.readStatus === 'READ') return '没有已读通知';
  return '暂无通知';
});

async function load() {
  loading.value = true;
  try {
    const res = await notificationApi.list({
      page: query.page,
      pageSize: query.pageSize,
      readStatus: query.readStatus || undefined,
      type: query.type || undefined,
    });
    list.value = res.list;
    total.value = res.total;
    store.setCount(res.unreadCount);
  } finally {
    loading.value = false;
  }
}

function onSearch() {
  query.page = 1;
  load();
}

/** 标记单条已读；在「未读」筛选下该行会消失，因此重新拉列表 */
async function onMarkRead(row: NotificationItem) {
  if (row.alreadyRead) return;
  try {
    await notificationApi.markRead(row.id);
    row.alreadyRead = true;
    store.decrement();
    // 注意：这里**不调** store.bumpReadState() —— 本组件自己刚刷新过列表，
    // 再 bump 会让监听版本号的父页面重复拉一次。bump 只应由「外部操作方」（铃铛）触发。
    if (query.readStatus === 'UNREAD') {
      if (list.value.length === 1 && query.page > 1) query.page -= 1;
      await load();
    }
    ElMessage.success('已标记为已读');
  } catch (e) {
    ElMessage.error((e as Error).message || '标记已读失败');
  }
}

async function onMarkAllRead() {
  try {
    await ElMessageBox.confirm(`确认将 ${unreadCount.value} 条未读通知全部标记为已读？`, '提示', { type: 'warning' });
  } catch {
    return; // 用户取消
  }
  markingAll.value = true;
  try {
    const res = await notificationApi.markAllRead();
    ElMessage.success(`已标记 ${res.updated} 条为已读`);
    store.clear();
    // 同 onMarkRead：自身操作不 bump，避免父页面重复请求
    if (query.readStatus === 'READ' || query.readStatus === '') {
      await load();
    } else {
      list.value = [];
      total.value = 0;
    }
  } catch (e) {
    ElMessage.error((e as Error).message || '全部已读失败');
  } finally {
    markingAll.value = false;
  }
}

async function onRowClick(row: NotificationItem) {
  detail.value = row;
  detailVisible.value = true;
  await onMarkRead(row);
}

function levelTagType(level: string) {
  if (level === 'URGENT') return 'danger';
  if (level === 'IMPORTANT') return 'warning';
  return 'info';
}

/**
 * el-table 插槽的 row 是 any，直接 `NOTIFY_LEVEL_LABELS[row.level]` 会被判为隐式 any 索引，
 * 统一走这两个辅助函数收敛（未知值原样返回，避免页面出现 undefined）。
 */
function levelLabel(level: string) {
  return NOTIFY_LEVEL_LABELS[level as NotifyLevel] ?? level;
}
function typeLabel(type: string) {
  return NOTIFICATION_TYPE_LABELS[type as NotificationType] ?? type;
}

onMounted(load);

/**
 * 暴露给父页面：铃铛（挂在 AdminLayout，任何页面都能点）标记已读后，
 * 父页面通过 store 的 readStateVersion 感知并调用本方法刷新列表。
 */
defineExpose({ reload: load });
</script>

<style scoped>
.inbox__filter {
  margin-bottom: 4px;
}
.inbox__pager {
  margin-top: 16px;
  justify-content: flex-end;
}
.inbox__hint {
  margin-top: 8px;
  font-size: 12px;
  color: #94a3b8;
}
.inbox__table--clickable :deep(.el-table__row) {
  cursor: pointer;
}
.inbox__dot {
  display: inline-block;
  width: 8px;
  height: 8px;
  margin-right: 6px;
  border-radius: 50%;
  background: #f56c6c;
  vertical-align: middle;
}
.inbox__title {
  font-weight: 500;
}
.inbox__summary {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  color: #64748b;
  font-size: 12px;
  line-height: 1.5;
}
.inbox__dim {
  color: #94a3b8;
}
.inbox__detail-head {
  display: flex;
  align-items: center;
  gap: 8px;
}
.inbox__detail-title {
  font-size: 16px;
  font-weight: 600;
}
.inbox__detail-meta {
  margin-top: 8px;
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  color: #64748b;
}
.inbox__detail-read {
  font-weight: 400;
}
.inbox__detail-content {
  white-space: pre-wrap;
  word-break: break-all;
  line-height: 1.7;
  font-size: 14px;
}
</style>
