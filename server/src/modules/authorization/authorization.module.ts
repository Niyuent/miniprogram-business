import { Module } from '@nestjs/common';
import { AuditLogModule } from '../audit-log/audit-log.module';
import { AuthorizationController } from './authorization.controller';
import { AuthorizationService } from './authorization.service';
import { MeAuthorizationController } from './me-authorization.controller';

/**
 * 授权管理模块
 *
 * export AuthorizationService：S2 的 coupon 模块要用它的
 * `checkAuthorization(subMerchantId, templateId)` 做发券前的授权校验。
 */
@Module({
  imports: [AuditLogModule],
  controllers: [AuthorizationController, MeAuthorizationController],
  providers: [AuthorizationService],
  exports: [AuthorizationService],
})
export class AuthorizationModule {}
