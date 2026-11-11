import type { RouteRecordRaw } from 'vue-router';

const P = (stage: string) => () => import('@/views/common/placeholder.vue');

/**
 * 菜单即路由：meta.permission / meta.roles 控制可见性（后端仍会二次校验）
 * stage 标记该页面计划在哪个 Sprint 实现
 */
export const dashboardRoute: RouteRecordRaw = {
  path: '/dashboard',
  name: 'Dashboard',
  component: () => import('@/views/main/dashboard.vue'),
  meta: { title: '工作台', icon: 'Odometer', permission: 'dashboard:view' },
};

/**
 * S1.4 已落地的四个页面（真实接口，非 Mock）：
 *   /main/merchant-applications  入驻审核
 *   /main/merchants             商家管理
 *   /main/authorizations        授权管理
 *   /main/audit-logs            操作日志（权限码 audit:view）
 * S2.1 追加：
 *   /main/coupons               券模板列表（coupon:view）
 *   /main/coupons/create        创建券模板（coupon:create）
 *   /main/coupons/issue         主体发放自有券（coupon:issue）
 *   /main/coupons/:id           券模板详情 + 编辑 / 上下架（coupon:edit / coupon:publish）
 * 其余条目仍是 P(stage) 占位，随 S2.2–S5 推进替换。
 */
export const mainRoutes: RouteRecordRaw[] = [
  {
    path: '/main/merchant-applications',
    name: 'MerchantApplications',
    component: () => import('@/views/main/merchant-applications.vue'),
    meta: { title: '入驻审核', icon: 'Stamp', permission: 'merchant:audit', stage: 'S1' },
  },
  {
    path: '/main/merchants',
    name: 'MainMerchants',
    component: () => import('@/views/main/merchants.vue'),
    meta: { title: '商家管理', icon: 'Shop', permission: 'merchant:view', stage: 'S1' },
  },
  {
    path: '/main/authorizations',
    name: 'Authorizations',
    component: () => import('@/views/main/authorizations.vue'),
    meta: { title: '授权管理', icon: 'Key', permission: 'authorization:view', stage: 'S1' },
  },
  {
    path: '/main/subscriptions',
    name: 'MainSubscriptions',
    component: () => import('@/views/main/subscriptions.vue'),
    meta: { title: '档位与充值', icon: 'Wallet', permission: 'subscription:view', stage: 'S6' },
  },
  {
    path: '/main/coupons',
    name: 'MainCoupons',
    component: () => import('@/views/main/coupons.vue'),
    meta: { title: '代金券管理', icon: 'Ticket', permission: 'coupon:view', stage: 'S2.1' },
  },
  {
    path: '/main/coupons/create',
    name: 'CouponCreate',
    component: () => import('@/views/main/coupon-create.vue'),
    meta: { title: '创建代金券', hidden: true, permission: 'coupon:create', stage: 'S2.1' },
  },
  {
    path: '/main/coupons/issue',
    name: 'MainCouponsIssue',
    component: () => import('@/views/main/coupons-issue.vue'),
    meta: { title: '发放代金券', icon: 'Present', permission: 'coupon:issue', stage: 'S2.2' },
  },
  {
    path: '/main/coupons/:id',
    name: 'CouponDetail',
    component: () => import('@/views/main/coupon-detail.vue'),
    meta: { title: '代金券详情', hidden: true, permission: 'coupon:view', stage: 'S2.1' },
  },
  {
    path: '/main/coupon-instances',
    name: 'MainCouponInstances',
    component: () => import('@/views/main/coupon-instances.vue'),
    meta: { title: '券实例管理', icon: 'Postcard', permission: 'coupon:instance:view', stage: 'S2.2' },
  },
  {
    path: '/main/point-rules',
    name: 'PointRules',
    component: P('S3'),
    meta: { title: '积分规则配置', icon: 'Coin', permission: 'point:rule:edit', stage: 'S3' },
  },
  {
    path: '/main/orders',
    name: 'MainOrders',
    component: () => import('@/views/main/orders.vue'),
    meta: { title: '订单管理', icon: 'Tickets', permission: 'order:view', stage: 'S3.4' },
  },
  {
    path: '/main/orders/abnormal',
    name: 'AbnormalOrders',
    component: () => import('@/views/main/orders-abnormal.vue'),
    meta: { title: '异常订单处理', icon: 'Warning', permission: 'order:handle', stage: 'S3.4' },
  },
  {
    path: '/main/orders/:id',
    name: 'OrderDetail',
    component: () => import('@/views/main/order-detail.vue'),
    meta: { title: '订单详情', hidden: true, permission: 'order:view', stage: 'S3.4' },
  },
  {
    path: '/main/redemptions',
    name: 'MainRedemptions',
    component: () => import('@/views/main/redemptions.vue'),
    meta: { title: '核销记录', icon: 'CircleCheck', permission: 'redemption:view', stage: 'S2.3' },
  },
  {
    path: '/main/points',
    name: 'MainPoints',
    component: () => import('@/views/main/points.vue'),
    meta: { title: '积分流水', icon: 'DataLine', permission: 'point:view', stage: 'S3.1' },
  },
  {
    path: '/main/point-accounts',
    name: 'MainPointAccounts',
    component: () => import('@/views/main/point-accounts.vue'),
    meta: { title: '积分账户', icon: 'Coin', permission: 'point:view', stage: 'S3.1' },
  },
  {
    path: '/main/users',
    name: 'MainUsers',
    component: () => import('@/views/main/users.vue'),
    meta: { title: '用户管理', icon: 'User', permission: 'user:view', stage: 'S5.2' },
  },
  {
    path: '/main/users/:id',
    name: 'UserDetail',
    component: () => import('@/views/main/users-detail.vue'),
    meta: { title: '用户详情', hidden: true, permission: 'user:view', stage: 'S5.2' },
  },
  {
    path: '/main/purchases',
    name: 'MainPurchases',
    component: () => import('@/views/main/purchases.vue'),
    meta: { title: '采购记录', icon: 'ShoppingCart', permission: 'purchase:view', stage: 'S4.1' },
  },
  {
    path: '/main/settlements',
    name: 'MainSettlements',
    component: () => import('@/views/main/settlements.vue'),
    meta: { title: '对账账单', icon: 'Wallet', permission: 'settlement:view', stage: 'S4.2' },
  },
  {
    path: '/main/settlements/:id',
    name: 'SettlementDetail',
    component: () => import('@/views/main/settlement-detail.vue'),
    meta: { title: '对账账单详情', hidden: true, permission: 'settlement:view', stage: 'S4.2' },
  },
  {
    path: '/main/merchant-clearing',
    name: 'MainMerchantClearing',
    component: () => import('@/views/main/merchant-clearing.vue'),
    meta: { title: '商家互结', icon: 'Sort', permission: 'settlement:view', stage: '清分' },
  },
  {
    path: '/main/reports',
    redirect: '/main/reports/onboarding',
    meta: { title: '报表中心', icon: 'Histogram', permission: 'report:view' },
    children: [
      {
        path: 'onboarding',
        name: 'ReportOnboarding',
        component: () => import('@/views/main/report-onboarding.vue'),
        meta: { title: '商户入驻报表', permission: 'report:view' },
      },
      {
        path: 'orders',
        name: 'ReportOrders',
        component: () => import('@/views/main/report-orders.vue'),
        meta: { title: '全平台订单汇总', permission: 'report:view' },
      },
      {
        path: 'coupons',
        name: 'ReportCoupons',
        component: () => import('@/views/main/report-coupons.vue'),
        meta: { title: '代金券汇总', permission: 'report:view' },
      },
      {
        path: 'points',
        name: 'ReportPoints',
        component: () => import('@/views/main/report-points.vue'),
        meta: { title: '积分流水汇总', permission: 'report:view' },
      },
      {
        path: 'settlements',
        name: 'ReportSettlements',
        component: () => import('@/views/main/report-settlements.vue'),
        meta: { title: '采购核销对账汇总', permission: 'report:view' },
      },
      {
        path: 'authorizations',
        name: 'ReportAuthorizations',
        component: () => import('@/views/main/report-authorizations.vue'),
        meta: { title: '授权记录', permission: 'report:view' },
      },
    ],
  },
  {
    path: '/main/store-change-requests',
    name: 'StoreChangeRequests',
    component: () => import('@/views/main/store-change-requests.vue'),
    meta: { title: '门店变更审核', icon: 'EditPen', permission: 'store:change:review', stage: 'S5.3' },
  },
  {
    path: '/main/notifications',
    name: 'MainNotifications',
    component: () => import('@/views/main/notifications.vue'),
    meta: { title: '通知管理', icon: 'Bell', permission: 'notification:view', stage: 'S5.4' },
  },
  {
    path: '/main/audit-logs',
    name: 'AuditLogs',
    component: () => import('@/views/main/audit-logs.vue'),
    meta: { title: '操作日志', icon: 'Document', permission: 'audit:view', stage: 'S1' },
  },
];

export const subRoutes: RouteRecordRaw[] = [
  {
    path: '/sub/orders',
    name: 'SubOrders',
    component: () => import('@/views/sub/orders.vue'),
    meta: { title: '本店订单', icon: 'Tickets', permission: 'order:view', stage: 'S5.5' },
  },
  {
    path: '/sub/redeem',
    name: 'SubRedeem',
    component: () => import('@/views/sub/redeem.vue'),
    meta: { title: '代金券核销', icon: 'CircleCheck', permission: 'redemption:create', stage: 'S2.3' },
  },
  {
    path: '/sub/coupons/issue',
    name: 'SubIssueCoupon',
    component: () => import('@/views/sub/coupons-issue.vue'),
    // 未授权附属商家无此权限码 → 菜单不可见（后端 H2 二次拦截 checkAuthorization）
    meta: {
      title: '发放主体商家代金券',
      icon: 'Promotion',
      permission: 'coupon:issue-main',
      stage: 'S2.2',
    },
  },
  {
    path: '/sub/redemptions',
    name: 'SubRedemptions',
    component: () => import('@/views/sub/redemptions.vue'),
    meta: { title: '本店核销记录', icon: 'Document', permission: 'redemption:view', stage: 'S2.3' },
  },
  {
    path: '/sub/purchases',
    name: 'SubPurchases',
    component: () => import('@/views/sub/purchases.vue'),
    meta: { title: '本店采购记录', icon: 'ShoppingCart', permission: 'purchase:view', stage: 'S5.5' },
  },
  {
    path: '/sub/settlements',
    name: 'SubSettlements',
    component: () => import('@/views/sub/settlements.vue'),
    meta: { title: '门店对账账单', icon: 'Wallet', permission: 'settlement:view', stage: 'S5.5' },
  },
  {
    path: '/sub/store',
    name: 'SubStore',
    component: () => import('@/views/sub/store.vue'),
    meta: { title: '门店信息', icon: 'Shop', permission: 'store:view', stage: 'S5.3' },
  },
  {
    path: '/sub/notifications',
    name: 'SubNotifications',
    component: () => import('@/views/sub/notifications.vue'),
    meta: { title: '接收通知', icon: 'Bell', permission: 'notification:view', stage: 'S5.5' },
  },
];

/**
 * H5 移动端（Vant）：积分兑换 / 积分明细
 * 与后台 AdminLayout 完全独立 —— 没有侧边栏，靠底部 tabbar 切换。
 * MVP 未接入 C 端用户鉴权，页面内用「模拟用户 id」切换身份，接口口径与真实链路一致。
 */
export const h5Routes: RouteRecordRaw[] = [
  {
    path: '/h5',
    component: () => import('@/layouts/H5Layout.vue'),
    children: [
      {
        path: 'exchange',
        name: 'H5Exchange',
        component: () => import('@/views/h5/exchange.vue'),
        meta: { title: '积分兑换', stage: 'S3.2' },
      },
      {
        path: 'point-logs',
        name: 'H5PointLogs',
        component: () => import('@/views/h5/point-logs.vue'),
        meta: { title: '积分明细', stage: 'S3.2' },
      },
      { path: '', redirect: '/h5/exchange' },
    ],
  },
];

/**
 * C 端登录页（S5.1）：独立于 H5Layout（不显示底部 tabbar）。
 * 无后台登录态要求（`public`），登录成功后写 `userToken` 再进 /h5/**。
 */
export const h5LoginRoute: RouteRecordRaw = {
  path: '/h5/login',
  name: 'H5Login',
  component: () => import('@/views/h5/login.vue'),
  meta: { title: '登录', public: true },
};

/** 主体/平台只进 /main，附属/店员只进 /sub。未授权附属是 SUB_ADMIN_BASIC，也要能进本店页面。 */
const MAIN_ROLES = ['MAIN_ADMIN', 'PLATFORM_ADMIN'];
const SUB_ROLES = ['SUB_ADMIN', 'SUB_ADMIN_BASIC', 'STORE_CLERK'];

function stampRoles(routes: RouteRecordRaw[], roles: string[]) {
  for (const route of routes) {
    route.meta = { ...(route.meta ?? {}), roles };
    if (route.children?.length) stampRoles(route.children, roles);
  }
}

stampRoles(mainRoutes, MAIN_ROLES);
stampRoles(subRoutes, SUB_ROLES);

export const profileRoute: RouteRecordRaw = {
  path: '/profile',
  name: 'Profile',
  component: () => import('@/views/profile/index.vue'),
  meta: { title: '个人中心', hidden: true },
};

/**
 * 无权限落地页
 *
 * 定位：**需要登录但不需要任何权限码**（否则未登录用户会被踢去登录页，
 * 登录后再被踢回 403，形成循环）。路由守卫在无权限时重定向到这里。
 */
export const forbiddenRoute: RouteRecordRaw = {
  path: '/403',
  name: 'Forbidden',
  component: () => import('@/views/error/forbidden.vue'),
  meta: { title: '无访问权限', hidden: true },
};

export const notFoundRoute: RouteRecordRaw = {
  path: '/:pathMatch(.*)*',
  name: 'NotFound',
  component: () => import('@/views/error/not-found.vue'),
  meta: { title: '页面不存在', hidden: true },
};
