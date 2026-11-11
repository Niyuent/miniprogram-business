import { Module } from '@nestjs/common';
import { NotificationModule } from '../notification/notification.module';
import { PointModule } from '../point/point.module';
import { SettlementModule } from '../settlement/settlement.module';
import { AiController } from './ai.controller';
import { AiCronService } from './ai-cron.service';
import { AiService } from './ai.service';
import { EarnAssistController } from './assist/earn-assist.controller';
import { EarnAssistService } from './assist/earn-assist.service';
import { SettlementAssistController } from './assist/settlement-assist.controller';
import { SettlementAssistService } from './assist/settlement-assist.service';
import { AiInspectionService } from './chat/ai-inspection.service';
import { ChatController } from './chat/chat.controller';
import { ChatService } from './chat/chat.service';
import { QuotaService } from './chat/quota.service';
import { DeepseekService } from './deepseek.service';
import { LayaService } from './laya.service';
import { AiToolsController } from './tools/ai-tools.controller';
import { AiToolsService } from './tools/ai-tools.service';
import { ZeroProxyController } from './zero-proxy.controller';
import { ZeroProxyService } from './zero-proxy.service';

/** 经营日报 + 经营问数对话 + 平台巡检 + Zero 代理 + AI 协同（发分 / 结算） */
@Module({
  imports: [NotificationModule, PointModule, SettlementModule],
  controllers: [
    AiController,
    ChatController,
    AiToolsController,
    ZeroProxyController,
    EarnAssistController,
    SettlementAssistController,
  ],
  providers: [
    LayaService,
    DeepseekService,
    AiService,
    AiCronService,
    AiToolsService,
    QuotaService,
    ChatService,
    AiInspectionService,
    ZeroProxyService,
    EarnAssistService,
    SettlementAssistService,
  ],
})
export class AiModule {}
