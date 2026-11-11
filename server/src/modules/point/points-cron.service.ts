import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PointService } from './point.service';

/**
 * 积分定时任务（S3.3）
 *
 * 每天 01:00（Asia/Shanghai = UTC+8）执行积分过期清零。
 * 用 `@Cron` 的 `timeZone` 选项锁定时区，避免 S2.4 那种「容器 TZ 与业务时区不一致导致定时错峰」的坑：
 * 表达式 `0 1 * * *` + `timeZone: 'Asia/Shanghai'` 即「北京时间每天凌晨 1 点」，与容器实际时区无关。
 */
@Injectable()
export class PointsCronService implements OnModuleInit {
  private readonly logger = new Logger('PointsCron');

  constructor(private readonly points: PointService) {}

  onModuleInit() {
    this.logger.log('积分过期清零定时任务已注册：每天 01:00（Asia/Shanghai）执行');
  }

  @Cron('0 1 * * *', { timeZone: 'Asia/Shanghai' })
  async handlePointsExpire() {
    this.logger.log('积分过期清零定时任务开始');
    try {
      const res = await this.points.expirePoints({ triggeredBy: 'cron' });
      this.logger.log(
        `积分过期清零定时任务完成：处理 ${res.processed} 笔，过期 ${res.expiredAmount} 分` +
          (res.skipped ? '（本次被跳过：已有任务在执行）' : ''),
      );
    } catch (e) {
      this.logger.error(`积分过期清零定时任务失败：${(e as Error).message}`);
    }
  }
}
