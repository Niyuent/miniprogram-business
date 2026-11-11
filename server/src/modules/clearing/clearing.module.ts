import { Module } from '@nestjs/common';
import { AuditLogModule } from '../audit-log/audit-log.module';
import { ClearingController } from './clearing.controller';
import { ClearingCronService } from './clearing-cron.service';
import { ClearingService } from './clearing.service';

/** 商家互结（清分）：账期 → 商家对净额账单 → 逐券明细 */
@Module({
  imports: [AuditLogModule],
  controllers: [ClearingController],
  providers: [ClearingService, ClearingCronService],
  exports: [ClearingService],
})
export class ClearingModule {}
