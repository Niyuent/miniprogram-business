import { Injectable, Logger } from '@nestjs/common';
import { NotificationType, NotifyLevel, ReceiverType } from '@prisma/client';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { NotificationService } from '../../notification/notification.service';
import { shanghaiDay } from '../daily-report';
import { DeepseekService } from '../deepseek.service';
import { AiToolsService } from '../tools/ai-tools.service';
import { detectAbnormalFlags } from './inspection-rules';

/**
 * 平台巡检：与日报同在 22:00 触发。
 * 异常由 SQL 判定，模型只写简报；推送给 PLATFORM 接收方。
 */
@Injectable()
export class AiInspectionService {
  private readonly logger = new Logger('AiInspection');
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly tools: AiToolsService,
    private readonly deepseek: DeepseekService,
    private readonly notifications: NotificationService,
  ) {}

  async run(): Promise<{ skipped: boolean; alertCount: number }> {
    if (this.running) return { skipped: true, alertCount: 0 };
    this.running = true;
    try {
      const merchants = await this.prisma.merchant.findMany({
        where: { status: 'APPROVED' },
        select: { id: true, name: true },
        orderBy: { id: 'asc' },
      });
      const day = shanghaiDay(0);
      const lines: string[] = [];

      for (const m of merchants) {
        const snapshot = await this.tools.buildInspectionSnapshot(m.id, day.from);
        const flags = detectAbnormalFlags(snapshot);
        if (!flags.length) continue;
        lines.push(
          `商家#${m.id} ${m.name}：${flags.map((f) => `${f.rule}（${f.detail}）`).join('；')}`,
        );
      }

      if (!lines.length) {
        this.logger.log('巡检完成：无异常商家');
        return { skipped: false, alertCount: 0 };
      }

      const brief = await this.writeBrief(lines);
      const content = (brief.length > 900 ? `${brief.slice(0, 897)}...` : brief).slice(0, 1000);

      await this.notifications.deliverSystem({
        receiverType: ReceiverType.PLATFORM,
        receiverId: 0,
        title: `AI平台巡检 ${day.ymd}`,
        content,
        level: NotifyLevel.IMPORTANT,
        bizType: 'AI_PLATFORM_ALERT',
        bizId: day.bizId,
        type: NotificationType.AI_PLATFORM_ALERT,
      });

      this.logger.log(`巡检完成：${lines.length} 家异常已推送`);
      return { skipped: false, alertCount: lines.length };
    } finally {
      this.running = false;
    }
  }

  private async writeBrief(lines: string[]): Promise<string> {
    const fallback = `【AI 平台巡检】发现 ${lines.length} 家异常商家：\n${lines.slice(0, 20).join('\n')}`;
    if (!this.deepseek.configured()) return fallback;
    try {
      const raw = await this.deepseek.completeJson(
        '你是平台风控助理。根据异常清单写一份简报，保留商家 ID 与名称。返回 JSON：{"brief":"不超过400字"}。不要编造清单外的商家。',
        JSON.stringify({ alerts: lines.slice(0, 30) }),
      );
      const brief =
        typeof (raw as { brief?: unknown })?.brief === 'string'
          ? (raw as { brief: string }).brief.trim()
          : '';
      return brief || fallback;
    } catch (e) {
      this.logger.warn(`巡检简报降级：${(e as Error).message}`);
      return fallback;
    }
  }
}
