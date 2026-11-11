import { Module } from '@nestjs/common';
import { AuditLogModule } from '../audit-log/audit-log.module';
import { SubscriptionModule } from '../subscription/subscription.module';
import { PointAccountController } from './point-account.controller';
import { PointController, PointRuleController } from './point.controller';
import { PointService } from './point.service';
import { PointTransactionController } from './point-transaction.controller';
import { PointsCronService } from './points-cron.service';
import { TasksController } from './tasks.controller';

/**
 * 积分模块（S3.1）
 *
 * 依赖 AuditLogModule：送积分 / 人工调整 / 改规则都要写操作日志，
 * 且日志与业务改动同事务（要么一起提交，要么一起回滚）。
 */
@Module({
  imports: [AuditLogModule, SubscriptionModule],
  controllers: [
    PointAccountController,
    PointTransactionController,
    PointController,
    PointRuleController,
    TasksController,
  ],
  providers: [PointService, PointsCronService],
  exports: [PointService],
})
export class PointModule {}
