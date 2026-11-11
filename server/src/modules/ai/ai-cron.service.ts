import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { AiService } from './ai.service';
import { AiInspectionService } from './chat/ai-inspection.service';

/**
 * 经营日报 + 平台巡检
 *
 * 北京时间每天 22:00 共用同一时间点。Laya / DeepSeek 失败只降级文案，不让定时任务抛到进程外。
 */
@Injectable()
export class AiCronService implements OnModuleInit {
  private readonly logger = new Logger('AiCron');

  constructor(
    private readonly ai: AiService,
    private readonly inspection: AiInspectionService,
  ) {}

  onModuleInit() {
    this.logger.log('经营日报与平台巡检定时任务已注册：每天 22:00（Asia/Shanghai）');
  }

  @Cron('0 22 * * *', { timeZone: 'Asia/Shanghai' })
  async handleDailyReport() {
    this.logger.log('经营日报开始');
    try {
      const res = await this.ai.runAll();
      const sent = res.reports.filter((r) => !r.skipped).length;
      this.logger.log(`经营日报完成：发送 ${sent} 家` + (res.skipped ? '（本次被跳过：已有任务在执行）' : ''));
    } catch (e) {
      this.logger.error(`经营日报失败：${(e as Error).message}`);
    }

    this.logger.log('平台巡检开始');
    try {
      const res = await this.inspection.run();
      this.logger.log(
        `平台巡检完成：异常 ${res.alertCount} 家` + (res.skipped ? '（已有任务在执行）' : ''),
      );
    } catch (e) {
      this.logger.error(`平台巡检失败：${(e as Error).message}`);
    }
  }
}
