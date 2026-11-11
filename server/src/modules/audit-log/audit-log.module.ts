import { Module } from '@nestjs/common';
import { PrismaModule } from '../../common/prisma/prisma.module';
import { AuditLogController } from './audit-log.controller';
import { AuditService } from './audit.service';

/**
 * 审计日志模块
 *
 * - S1.2 起提供 `AuditService.record()` 写入能力，被 merchant / authorization / auth 复用
 * - S1.4 补查询能力：`GET /audit-logs`（列表 + 筛选 + 分页）、`GET /audit-logs/:id`（详情，脱敏对比）
 */
@Module({
  imports: [PrismaModule],
  controllers: [AuditLogController],
  providers: [AuditService],
  exports: [AuditService],
})
export class AuditLogModule {}
