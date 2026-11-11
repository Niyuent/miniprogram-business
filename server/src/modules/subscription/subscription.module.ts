import { Module } from '@nestjs/common';
import { AuditLogModule } from '../audit-log/audit-log.module';
import { SubscriptionController } from './subscription.controller';
import { SubscriptionService } from './subscription.service';

/**
 * 商家计费（档位 / 会员）。
 *
 * 导出 SubscriptionService 供 PointModule（发分闸门）与 MerchantModule（加盟上限）复用，
 * 价格与上限只此一份，不在调用方重复判断。
 */
@Module({
  imports: [AuditLogModule],
  controllers: [SubscriptionController],
  providers: [SubscriptionService],
  exports: [SubscriptionService],
})
export class SubscriptionModule {}
