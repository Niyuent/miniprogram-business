import { Module } from '@nestjs/common';
import { AuditLogModule } from '../audit-log/audit-log.module';
import { StoreChangeService } from './store-change.service';
import { StoreChangeController } from './store.controller';

/**
 * 门店变更申请（S5.3）
 *
 * 依赖 AuditLogModule：提交 / 通过 / 驳回 / 作废均写审计。
 * PrismaModule 为 @Global，无需显式 import。
 */
@Module({
  imports: [AuditLogModule],
  controllers: [StoreChangeController],
  providers: [StoreChangeService],
})
export class StoreModule {}
