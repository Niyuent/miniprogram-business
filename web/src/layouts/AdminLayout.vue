<template>
  <div class="layout" :class="{ 'layout--sky': route.path === '/dashboard' && !isSubSide }">
    <el-aside :width="appStore.sidebarCollapsed ? '72px' : '232px'" class="layout__aside">
      <div class="layout__logo">
        <span v-if="!appStore.sidebarCollapsed" class="layout__brand">商盟系统</span>
        <span v-else class="layout__brand layout__brand--mark">商</span>
      </div>

      <el-menu
        ref="menuRef"
        class="layout__menu"
        :default-active="activeMenu"
        :default-openeds="initialOpen"
        :collapse="appStore.sidebarCollapsed"
        :collapse-transition="true"
        popper-class="layout-menu-pop"
        router
        background-color="transparent"
        text-color="#e2e8f0"
        active-text-color="#60a5fa"
        @open="onMenuOpen"
      >
        <template v-for="item in menuTree" :key="item.index">
          <el-sub-menu v-if="item.children?.length" :index="item.index">
            <template #title>
              <el-icon><component :is="item.icon" /></el-icon>
              <span>{{ item.title }}</span>
            </template>
            <template v-for="child in item.children" :key="child.index">
              <el-sub-menu v-if="child.children?.length" :index="child.index">
                <template #title>{{ child.title }}</template>
                <el-menu-item v-for="leaf in child.children" :key="leaf.index" :index="leaf.index">
                  {{ leaf.title }}
                </el-menu-item>
              </el-sub-menu>
              <el-menu-item v-else :index="child.index">{{ child.title }}</el-menu-item>
            </template>
          </el-sub-menu>
          <el-menu-item v-else :index="item.index">
            <el-icon><component :is="item.icon" /></el-icon>
            <template #title>{{ item.title }}</template>
          </el-menu-item>
        </template>
      </el-menu>

      <button class="layout__collapse" type="button" title="折叠侧边栏" @click="appStore.toggleSidebar()">
        <el-icon :size="18">
          <Fold v-if="!appStore.sidebarCollapsed" />
          <Expand v-else />
        </el-icon>
      </button>
    </el-aside>

    <div class="layout__main">
      <header class="layout__header">
        <div class="layout__header-left">
          <el-breadcrumb separator="/">
            <el-breadcrumb-item :to="{ path: '/dashboard' }">首页</el-breadcrumb-item>
            <el-breadcrumb-item v-if="route.meta.title">{{ route.meta.title }}</el-breadcrumb-item>
          </el-breadcrumb>
        </div>

        <div class="layout__header-right">
          <NotificationBell />
          <el-tag size="small" :type="userStore.isMainMerchant ? 'warning' : 'success'">
            {{ userStore.isMainMerchant ? '主体商家' : userStore.profile?.store?.name || userStore.profile?.merchant?.name || '附属商家' }}
          </el-tag>
          <el-dropdown @command="onCommand">
            <span class="layout__user">
              {{ userStore.profile?.realName || userStore.profile?.username }}
              <el-icon><ArrowDown /></el-icon>
            </span>
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item command="profile">个人中心</el-dropdown-item>
                <el-dropdown-item command="logout" divided>退出登录</el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
        </div>
      </header>

      <main class="layout__content">
        <router-view />
      </main>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import { useRoute, useRouter, type RouteRecordRaw } from 'vue-router';
import { ElMessageBox } from 'element-plus';
import { ArrowDown, Bell, DataLine, Document, Expand, Fold, Odometer, Shop, Ticket, User } from '@element-plus/icons-vue';
import { useAppStore } from '@/stores/app';
import { useUserStore } from '@/stores/user';
import NotificationBell from '@/components/NotificationBell.vue';

interface MenuNode {
  index: string;
  title: string;
  icon?: unknown;
  children?: MenuNode[];
}

interface GroupDef {
  index: string;
  title: string;
  icon: unknown;
  /** 按这个顺序收录已有路由。只有一项且没有下级时，渲染成一级菜单。 */
  paths: string[];
}

const MAIN_GROUPS: GroupDef[] = [
  { index: 'group:dashboard', title: '工作台', icon: Odometer, paths: ['/dashboard'] },
  {
    index: 'group:merchant',
    title: '商家与授权',
    icon: Shop,
    paths: ['/main/merchant-applications', '/main/merchants', '/main/authorizations', '/main/store-change-requests', '/main/subscriptions'],
  },
  {
    index: 'group:coupon',
    title: '券与核销',
    icon: Ticket,
    paths: ['/main/coupons', '/main/coupons/issue', '/main/coupon-instances', '/main/redemptions'],
  },
  {
    index: 'group:member',
    title: '积分与会员',
    icon: User,
    paths: ['/main/point-rules', '/main/points', '/main/point-accounts', '/main/users'],
  },
  {
    index: 'group:finance',
    title: '订单与财务',
    icon: Document,
    paths: ['/main/orders', '/main/orders/abnormal', '/main/purchases', '/main/settlements'],
  },
  {
    index: 'group:data',
    title: '数据中心',
    icon: DataLine,
    paths: ['/main/reports', '/main/notifications', '/main/audit-logs'],
  },
];

const SUB_GROUPS: GroupDef[] = [
  { index: 'group:dashboard', title: '工作台', icon: Odometer, paths: ['/dashboard'] },
  {
    index: 'group:store-biz',
    title: '本店业务',
    icon: Ticket,
    paths: ['/sub/orders', '/sub/redeem', '/sub/coupons/issue', '/sub/redemptions', '/sub/purchases', '/sub/settlements'],
  },
  { index: 'group:store', title: '门店信息', icon: Shop, paths: ['/sub/store'] },
  { index: 'group:notice', title: '通知', icon: Bell, paths: ['/sub/notifications'] },
];

const TITLE: Record<string, string> = {
  '/main/coupons': '代金券管理',
  '/main/coupons/issue': '发放代金券',
  '/main/coupon-instances': '券实例',
  '/main/point-rules': '积分规则',
  '/main/orders/abnormal': '异常订单',
  '/main/reports': '报表中心',
};

const route = useRoute();
const router = useRouter();
const appStore = useAppStore();
const userStore = useUserStore();
const menuRef = ref<{ open: (index: string) => void; close: (index: string) => void }>();

const isSubSide = computed(() => {
  const owned = new Set(userStore.roles);
  const sub = ['SUB_ADMIN', 'SUB_ADMIN_BASIC', 'STORE_CLERK'].some((role) => owned.has(role));
  const main = ['MAIN_ADMIN', 'PLATFORM_ADMIN'].some((role) => owned.has(role));
  return sub && !main;
});

function canSee(record: RouteRecordRaw) {
  if (record.meta?.hidden) return false;
  const permission = record.meta?.permission as string | undefined;
  if (permission && !userStore.hasPermission(permission)) return false;
  const roles = record.meta?.roles as string[] | undefined;
  if (roles?.length && !roles.some((role) => userStore.roles.includes(role))) return false;
  return true;
}

const menuTree = computed((): MenuNode[] => {
  const root = router.options.routes.find((item) => item.path === '/');
  const list = (root?.children ?? []) as RouteRecordRaw[];
  const byPath = new Map(list.filter(canSee).map((item) => [item.path, item]));
  const groups = isSubSide.value ? SUB_GROUPS : MAIN_GROUPS;

  return groups.flatMap((group) => {
    const children: MenuNode[] = [];
    for (const path of group.paths) {
      const record = byPath.get(path);
      if (!record) continue;
      const nested = (record.children ?? []).filter(canSee);
      if (nested.length) {
        children.push({
          index: path,
          title: TITLE[path] ?? String(record.meta?.title ?? path),
          children: nested.map((child) => ({
            index: `${path}/${child.path}`,
            title: String(child.meta?.title ?? child.path),
          })),
        });
      } else {
        children.push({
          index: path,
          title: TITLE[path] ?? String(record.meta?.title ?? path),
        });
      }
    }
    if (!children.length) return [];
    if (children.length === 1 && !children[0].children?.length) {
      return [{ index: children[0].index, title: group.title, icon: group.icon }];
    }
    return [{ index: group.index, title: group.title, icon: group.icon, children }];
  });
});

function activeChain(nodes: MenuNode[], path: string): { chain: string[]; leaf: string } | null {
  let best: { chain: string[]; leaf: string } | null = null;
  for (const node of nodes) {
    if (node.children?.length) {
      const sub = activeChain(node.children, path);
      if (sub && (!best || sub.leaf.length >= best.leaf.length)) {
        best = { chain: [node.index, ...sub.chain], leaf: sub.leaf };
      }
    } else if (path === node.index || path.startsWith(`${node.index}/`)) {
      if (!best || node.index.length >= best.leaf.length) best = { chain: [], leaf: node.index };
    }
  }
  return best;
}

const activeMenu = computed(() => activeChain(menuTree.value, route.path)?.leaf ?? route.path);
const initialOpen = computed(() => activeChain(menuTree.value, route.path)?.chain ?? []);

function submenuIndexes(nodes: MenuNode[]): string[] {
  const ids: string[] = [];
  for (const node of nodes) {
    if (!node.children?.length) continue;
    ids.push(node.index);
    ids.push(...submenuIndexes(node.children));
  }
  return ids;
}

async function syncOpen() {
  await nextTick();
  const menu = menuRef.value;
  if (!menu || appStore.sidebarCollapsed) return;
  const keep = new Set(initialOpen.value);
  for (const id of submenuIndexes(menuTree.value)) {
    if (keep.has(id)) menu.open(id);
    else menu.close(id);
  }
}

function onMenuOpen(index: string) {
  const tops = menuTree.value.filter((item) => item.children?.length).map((item) => item.index);
  if (!tops.includes(index)) return;
  for (const id of tops) {
    if (id !== index) menuRef.value?.close(id);
  }
}

watch(() => route.path, syncOpen);

function onCommand(cmd: string) {
  if (cmd === 'profile') {
    router.push('/profile');
  } else if (cmd === 'logout') {
    ElMessageBox.confirm('确认退出登录？', '提示', { type: 'warning' }).then(() => {
      userStore.logout();
      router.push('/login');
    });
  }
}
</script>

<style scoped>
.layout {
  display: flex;
  height: 100vh;
  overflow: hidden;
  background: #f5f7fa;
}
.layout--sky {
  background: radial-gradient(ellipse at 28% 42%, #1e293b 0%, #0f172a 52%, #0b1220 100%);
}
.layout__aside {
  display: flex;
  flex-direction: column;
  background: rgba(15, 23, 42, 0.6);
  backdrop-filter: blur(12px);
  border-right: none;
  transition: width 0.28s ease;
  overflow: hidden;
}
.layout__logo {
  height: 72px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  flex-shrink: 0;
}
.layout__brand {
  color: #f8fafc;
  font-size: 26px;
  font-weight: 700;
  letter-spacing: 6px;
  line-height: 1;
}
.layout__brand--mark {
  font-size: 22px;
  letter-spacing: 0;
}
.layout__menu {
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;
  border-right: none;
}
.layout__aside :deep(.el-menu) {
  border-right: none;
  --el-menu-bg-color: transparent;
  --el-menu-text-color: #e2e8f0;
  --el-menu-active-color: #60a5fa;
  --el-menu-hover-bg-color: rgba(96, 165, 250, 0.14);
  --el-menu-hover-text-color: #f8fafc;
}
.layout__aside :deep(.el-menu-item),
.layout__aside :deep(.el-sub-menu__title) {
  color: #e2e8f0;
}
.layout__aside :deep(.el-menu-item.is-active) {
  color: #60a5fa;
  background: rgba(96, 165, 250, 0.12);
}
.layout__aside :deep(.el-sub-menu.is-active > .el-sub-menu__title) {
  color: #60a5fa;
}
.layout__aside :deep(.el-menu--inline) {
  background: transparent;
}
.layout__collapse {
  height: 48px;
  margin: 8px;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: #e2e8f0;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
.layout__collapse:hover {
  background: rgba(96, 165, 250, 0.14);
  color: #60a5fa;
}
.layout__main {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.layout__header {
  height: 56px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 16px;
  background: rgba(255, 255, 255, 0.92);
  border-bottom: 1px solid rgba(226, 232, 240, 0.8);
}
.layout--sky .layout__header {
  background: rgba(15, 23, 42, 0.35);
  border-bottom-color: transparent;
  color: #e2e8f0;
}
.layout--sky .layout__header :deep(.el-breadcrumb__inner),
.layout--sky .layout__header :deep(.el-breadcrumb__separator) {
  color: #e2e8f0;
}
.layout--sky .layout__user {
  color: #f8fafc;
}
.layout__header-left,
.layout__header-right {
  display: flex;
  align-items: center;
  gap: 16px;
}
.layout__user {
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 4px;
}
.layout__content {
  flex: 1;
  overflow: auto;
  padding: 16px;
  background: #f5f7fa;
}
.layout--sky .layout__content {
  background: transparent;
}
</style>

<style>
.layout-menu-pop.el-menu--popup {
  background: rgba(15, 23, 42, 0.92);
  backdrop-filter: blur(12px);
  border: none;
}
.layout-menu-pop .el-menu-item {
  color: #e2e8f0;
}
.layout-menu-pop .el-menu-item.is-active {
  color: #60a5fa;
}
</style>
