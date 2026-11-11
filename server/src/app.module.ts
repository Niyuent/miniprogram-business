import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { PrismaModule } from './common/prisma/prisma.module';
import { TraceMiddleware } from './common/middleware/trace.middleware';
import { RolesGuard } from './common/guards/roles.guard';
import { AuthModule } from './modules/auth/auth.module';
import { JwtAuthGuard } from './modules/auth/jwt-auth.guard';
import { HealthModule } from './modules/health/health.module';
import { SseModule } from './modules/sse/sse.module';
import { SubModule } from './modules/sub/sub.module';
import { MerchantModule } from './modules/merchant/merchant.module';
import { UploadModule } from './modules/upload/upload.module';
import { AuthorizationModule } from './modules/authorization/authorization.module';
import { AuditLogModule } from './modules/audit-log/audit-log.module';
import { CouponModule } from './modules/coupon/coupon.module';
import { PointModule } from './modules/point/point.module';
import { OrderModule } from './modules/order/order.module';
import { PurchaseModule } from './modules/purchase/purchase.module';
import { SettlementModule } from './modules/settlement/settlement.module';
import { ClearingModule } from './modules/clearing/clearing.module';
import { MerchantAllianceModule } from './modules/merchant-alliance/merchant-alliance.module';
import { SubscriptionModule } from './modules/subscription/subscription.module';
import { ReportModule } from './modules/report/report.module';
import { H5Module } from './modules/h5/h5.module';
import { UserModule } from './modules/user/user.module';
import { StoreModule } from './modules/store/store.module';
import { NotificationModule } from './modules/notification/notification.module';
import { AiModule } from './modules/ai/ai.module';
import { MiniModule } from './modules/mini/mini.module';

/**
 * 全站默认鉴权策略：**拒绝未声明的**。
 *
 * JwtAuthGuard → RolesGuard 依次执行：
 *  - 没打 `@Public()` 的接口必须先登录；
 *  - 打了 `@Roles()` / `@Permissions()` 的接口还需角色或权限码命中。
 * 新增 Controller 若忘记挂守卫，默认是「需要登录」，不会裸奔。
 *
 * MerchantScopeGuard 不做全局，因为它只认 `/sub/**` 这类需要按商家隔离的接口，
 * 由对应 Controller 显式 `@UseGuards(MerchantScopeGuard)`。
 */
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, envFilePath: '.env' }),
    // S3.3：积分过期清零定时任务（@Cron 需要在根模块 forRoot）
    ScheduleModule.forRoot(),
    PrismaModule,
    AuthModule,
    HealthModule,
    SseModule,
    SubModule,
    MerchantModule,
    UploadModule,
    AuthorizationModule,
    // S1.4：AuditLogModule 既提供写入（各业务模块依赖），也提供查询控制器
    AuditLogModule,
    // S2.1：券模板管理（券码生成 / 发放 / 核销在 S2.2-S2.4 继续加进这个模块）
    CouponModule,
    // S3.1：积分账户 / 积分流水 / 消费录单送积分 / 人工调整（S3.2-S3.4 继续加进这个模块）
    PointModule,
    // S3.4：订单管理 + 异常订单处理
    OrderModule,
    // S4.1：采购记录
    PurchaseModule,
    // S4.2：对账账单
    SettlementModule,
    // 商家互结清分：按商家兑换 → 跨商家核销 → 月度轧差（独立于平台对账单）
    ClearingModule,
    // 商家端「我的联盟」：已加入联盟的成员/门店、本店经营、清分与对账
    MerchantAllianceModule,
    // 计费：附属档位（2/10 个联盟）与主体会员（38.8/109/209/418）
    SubscriptionModule,
    // S4.3：报表中心（六张报表 + CSV 导出）与工作台（stats / trend / todo）
    ReportModule,
    // S5.1：C 端 / H5（微信登录、我的积分/券/兑换，仅 C 端令牌可访问）
    H5Module,
    // S5.2：用户管理（主体后台，附属/店员按「本商家/门店消费过的」隔离）
    UserModule,
    // S5.3：门店变更申请（附属提交 → 主体审核 → 生效，白名单字段）
    StoreModule,
    // S5.4-A：站内信（列表 / 未读数 / 已读 / 主体发布）
    NotificationModule,
    // AI：Laya 判断 + DeepSeek 文案 + 经营日报
    AiModule,
    MiniModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(TraceMiddleware).forRoutes('*');
  }
}
