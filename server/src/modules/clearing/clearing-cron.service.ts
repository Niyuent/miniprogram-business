import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { ClearingService } from './clearing.service';

/**
 * 商家互结清分定时任务。
 *
 * 每月 1 日 00:05（Asia/Shanghai）自动汇总上月的商家互结账单。
 * 错开 00:00：现有 SettlementCronService 在整点跑「平台→商家」对账单，
 * 两者都会读 redemption_records，错峰避免同一瞬间抢库。
 * generate 内部按 periodKey 幂等，重复执行直接返回已有账期。
 */
@Injectable()
export class ClearingCronService implements OnModuleInit {
  private readonly logger = new Logger('MerchantClearingCron');

  constructor(private readonly clearing: ClearingService) {}

  onModuleInit() {
    this.logger.log('商家互结定时任务已注册：每月 1 日 00:05（Asia/Shanghai）汇总上月');
  }

  @Cron('5 0 1 * *', { timeZone: 'Asia/Shanghai' })
  async handleMonthly() {
    try {
      const res = await this.clearing.generateLastMonth();
      this.logger.log(
        `上月清分完成：账期 ${res.periodKey}，净额账单 ${res.billCount} 张` +
          (res.idempotent ? '（已存在，跳过）' : ''),
      );
    } catch (e) {
      // 定时任务失败不能影响服务本身，下一轮或后台手动重算可补
      this.logger.error(`上月清分失败：${(e as Error).message}`);
    }
  }
}
