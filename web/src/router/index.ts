import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router';
import { useUserStore } from '@/stores/user';
import {
  dashboardRoute,
  forbiddenRoute,
  h5LoginRoute,
  h5Routes,
  mainRoutes,
  notFoundRoute,
  profileRoute,
  subRoutes,
} from './routes';
import { h5Auth } from '@/utils/h5Request';

const routes: RouteRecordRaw[] = [
  {
    path: '/apply',
    name: 'MerchantApply',
    component: () => import('@/views/apply/index.vue'),
    meta: { title: '商家入驻申请', public: true },
  },
  {
    path: '/login',
    name: 'Login',
    component: () => import('@/views/login/index.vue'),
    meta: { title: '登录', public: true },
  },
  // 需要登录、但不需要任何权限码 —— 否则会「登录页 → 403 → 登录页」死循环
  forbiddenRoute,
  {
    path: '/',
    component: () => import('@/layouts/AdminLayout.vue'),
    redirect: '/dashboard',
    children: [dashboardRoute, profileRoute, ...mainRoutes, ...subRoutes],
  },
  // H5 移动端（积分兑换 / 积分明细）：独立布局，顶部 /h5 前缀，与后台互不干扰
  h5LoginRoute,
  ...h5Routes,
  notFoundRoute,
];

const router = createRouter({
  history: createWebHistory(),
  routes,
});

/**
 * 全局前置守卫
 *
 * 三层拦截，缺一不可：
 *  1. 未登录 → 跳登录页（带 redirect 便于登录后回到原页面）
 *  2. profile 未加载（典型场景：**刷新页面**）→ 用 localStorage 里的 token 重新拉资料
 *  3. 路由 meta.permission 未命中 → **跳 403 页**，绝不放行到页面里去发请求
 *
 * 说明：这只是「菜单/页面级」的体验优化，**真正的权限边界在后端**
 * （JwtAuthGuard + RolesGuard + 数据可见范围），前端拦不住不代表能拿到数据。
 */
router.beforeEach(async (to) => {
  // C 端 /h5/**：与后台登录态**无关**，单独用 C 端令牌（userToken）判定（S5.1）
  if (to.path.startsWith('/h5')) {
    if (to.path === '/h5/login') return true;
    if (!h5Auth.isLogin()) {
      return { path: '/h5/login', query: { redirect: to.fullPath } };
    }
    return true;
  }

  const userStore = useUserStore();

  if (to.meta.public) return true;

  if (!userStore.isLogin) {
    return { name: 'Login', query: { redirect: to.fullPath } };
  }

  // 首次进入/刷新后补齐用户信息
  if (!userStore.profile) {
    try {
      await userStore.fetchProfile();
    } catch {
      userStore.logout();
      return { name: 'Login', query: { redirect: to.fullPath } };
    }
  }

  const permission = to.meta.permission as string | undefined;
  if (permission && !userStore.hasPermission(permission)) {
    return { name: 'Forbidden', query: { from: to.fullPath, need: permission } };
  }

  const roles = to.meta.roles as string[] | undefined;
  if (roles?.length && !roles.some((role) => userStore.roles.includes(role))) {
    return { name: 'Forbidden', query: { from: to.fullPath } };
  }

  return true;
});

router.afterEach((to) => {
  document.title = to.meta.title ? `${to.meta.title} · 商盟系统` : '商盟系统';
});

export default router;
