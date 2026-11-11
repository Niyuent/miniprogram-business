import { Module } from '@nestjs/common';
import { AuditLogModule } from '../audit-log/audit-log.module';
import { SseModule } from '../sse/sse.module';
import { NotificationController } from './notification.controller';
import { NotificationService } from './notification.service';

/**
 * 站内信（S5.4-A）
 *
 * 依赖 AuditLogModule：发布通知写审计。
 * 依赖 SseModule（S7）：发布后实时推送给在线客户端（`notification:new`）。
 * PrismaModule 为 @Global，无需显式 import。
 */
@Module({
  imports: [AuditLogModule, SseModule],
  controllers: [NotificationController],
  providers: [NotificationService],
  exports: [NotificationService],
})
export class NotificationModule {}
