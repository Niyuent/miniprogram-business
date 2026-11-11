import { Body, Controller, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Permissions } from '../../../common/decorators/roles.decorator';
import { CurrentUser } from '../../auth/current-user.decorator';
import { JwtPayload } from '../../auth/jwt-payload';
import { ChatDto } from '../dto/chat.dto';
import { ChatService } from './chat.service';

@ApiTags('ai')
@ApiBearerAuth()
@Controller('ai')
export class ChatController {
  constructor(private readonly chat: ChatService) {}

  @Post('chat')
  @Permissions('ai:chat')
  @ApiOperation({
    summary: '经营问数对话',
    description:
      '两段式：意图 JSON → 只读工具取数 → 模板优先写答案。merchantId 仅来自 JWT。超限返回 200 + 限额话术。',
  })
  chatEndpoint(@Body() dto: ChatDto, @CurrentUser() user: JwtPayload) {
    return this.chat.chat(user, dto.message, dto.sessionId);
  }
}
