import { Module } from '@nestjs/common';
import { AuditLogModule } from '../audit-log/audit-log.module';
import { SettlementController } from './settlement.controller';
import { SettlementCronService } from './settlement-cron.service';
import { SettlementService } from './settlement.service';

/**
 * 对账账单（S4.2）
 *
 * 依赖 AuditLogModule：生成 / 重新生成 / 确认 / 异议写审计。
 * SettlementCronService 跑每月 1 日自动生成上月对账单。
 */
@Module({
  imports: [AuditLogModule],
  controllers: [SettlementController],
  providers: [SettlementService, SettlementCronService],
  // 供 AI 结算助手复用：detail() 内已含可见性校验，避免两处各写一套权限判断
  exports: [SettlementService],
})
export class SettlementModule {}
