import { Module } from '@nestjs/common';
import { AuditLogModule } from '../audit-log/audit-log.module';
import { AuthorizationModule } from '../authorization/authorization.module';
import { SubscriptionModule } from '../subscription/subscription.module';
import { CouponCodeController } from './coupon-code.controller';
import { CouponCodeService } from './coupon-code.service';
import { CouponInstanceController } from './coupon-instance.controller';
import { CouponInstanceService } from './coupon-instance.service';
import { CouponTemplateController } from './coupon-template.controller';
import { CouponTemplateService } from './coupon-template.service';
import { QuickIssueController } from './quick-issue.controller';
import { QuickIssueService } from './quick-issue.service';
import { RedemptionController } from './redemption.controller';
import { RedemptionService } from './redemption.service';

/**
 * 代金券模块
 *
 * - S2.1 券模板管理（`CouponTemplate*`）
 * - S2.2 券码预生成（`CouponCode*`）+ 券实例发放与冻结（`CouponInstance*`）
 * - S2.3 核销与冲正（`Redemption*`）
 * - S2.4 记录与实例管理也会继续加进这个模块
 *
 * **不要再新建并列模块** —— 券的业务大量共享同一个事务边界（模板库存、券码、实例、审计），
 * 拆模块只会把事务和审计打散。
 *
 * `AuthorizationModule` 是 S1.3 的依赖：发券走它的 `checkAuthorization()`（H2 三重校验）。
 */
@Module({
  imports: [AuditLogModule, AuthorizationModule, SubscriptionModule],
  controllers: [
    CouponTemplateController,
    CouponCodeController,
    CouponInstanceController,
    RedemptionController,
    QuickIssueController,
  ],
  providers: [
    CouponTemplateService,
    CouponCodeService,
    CouponInstanceService,
    RedemptionService,
    QuickIssueService,
  ],
  exports: [
    CouponTemplateService,
    CouponCodeService,
    CouponInstanceService,
    RedemptionService,
    QuickIssueService,
  ],
})
export class CouponModule {}
