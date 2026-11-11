import { Module } from '@nestjs/common';
import { AuditLogModule } from '../audit-log/audit-log.module';
import { PointModule } from '../point/point.module';
import { OrderController } from './order.controller';
import { OrderService } from './order.service';

/**
 * 订单管理 + 异常订单处理（S3.4）
 *
 * 依赖 PointModule：补录订单送积分（PointService.earn）、异常处理回退积分
 * （refundExchangePoints / adjustInTx 都在 PointService，且 PointModule 已 exports）。
 */
@Module({
  imports: [AuditLogModule, PointModule],
  controllers: [OrderController],
  providers: [OrderService],
})
export class OrderModule {}
