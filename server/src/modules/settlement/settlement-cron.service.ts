import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { MerchantType } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { SettlementService } from './settlement.service';

/**
 * 对账单定时任务（S4.2）
 *
 * 每月 1 日 00:00（Asia/Shanghai）自动生成上月对账单（每个附属商家一份）。
 * 幂等：generate 内部按 (merchantId, period) 去重，重复执行返回已存在、不重复创建。
 */
@Injectable()
export class SettlementCronService implements OnModuleInit {
  private readonly logger = new Logger('SettlementCron');

  constructor(
    private readonly prisma: PrismaService,
    private readonly settlements: SettlementService,
  ) {}

  onModuleInit() {
    this.logger.log('对账单定时任务已注册：每月 1 日 00:00（Asia/Shanghai）生成上月对账单');
  }

  @Cron('0 0 1 * *', { timeZone: 'Asia/Shanghai' })
  async handleMonthly() {
    this.logger.log('对账单定时任务开始：生成上月对账单');
    const now = new Date();
    // 上月 1 日 ~ 本月 1 日（UTC 边界，与业务用 UTC 一致）
    const periodStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
    const periodEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

    const subs = await this.prisma.merchant.findMany({
      where: { type: MerchantType.SUB },
      select: { id: true, name: true },
    });

    let generated = 0;
    let skipped = 0;
    for (const sub of subs) {
      try {
        const res = await this.settlements.generate(
          { merchantId: sub.id, periodStart: periodStart.toISOString(), periodEnd: periodEnd.toISOString() },
        );
        if ((res as { idempotent?: boolean }).idempotent) skipped++;
        else generated++;
      } catch (e) {
        this.logger.error(`生成 ${sub.name}(#${sub.id}) 对账单失败：${(e as Error).message}`);
      }
    }
    this.logger.log(`对账单定时任务完成：新建 ${generated} 份，已存在跳过 ${skipped} 份`);
  }
}
