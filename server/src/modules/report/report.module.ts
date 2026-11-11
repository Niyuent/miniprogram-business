import { Module } from '@nestjs/common';
import { NotificationModule } from '../notification/notification.module';
import { DashboardController } from './dashboard.controller';
import { ReportController } from './report.controller';
import { ReportService } from './report.service';

/**
 * 报表中心 + 工作台（S4.3）
 *
 * PrismaModule 是 @Global 全局模块（参考 SettlementModule 未显式导入即可注入）。
 * S5.4-B1：注入 NotificationService，工作台待办的「未读通知数」统一走通知模块口径。
 */
@Module({
  imports: [NotificationModule],
  controllers: [ReportController, DashboardController],
  providers: [ReportService],
})
export class ReportModule {}
