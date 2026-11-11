import { Module } from '@nestjs/common';
import { AuditLogModule } from '../audit-log/audit-log.module';
import { PurchaseController } from './purchase.controller';
import { PurchaseService } from './purchase.service';

/**
 * 采购记录（S4.1）
 *
 * 依赖 AuditLogModule：新增 / 结算写操作日志。
 */
@Module({
  imports: [AuditLogModule],
  controllers: [PurchaseController],
  providers: [PurchaseService],
})
export class PurchaseModule {}
