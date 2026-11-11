import { Body, Controller, Headers, Ip, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Permissions } from '../../../common/decorators/roles.decorator';
import { CurrentUser } from '../../auth/current-user.decorator';
import { JwtPayload } from '../../auth/jwt-payload';
import { EarnConfirmDto, EarnProposalDto } from './dto/earn-assist.dto';
import { EarnAssistService } from './earn-assist.service';

/**
 * AI 协同：收银台发积分。
 *
 * 两段式，刻意不合并成一个接口：
 * 1. propose —— 只读，把「该发多少分 + 有什么风险」摆给店员看；
 * 2. confirm —— 带签名票据，店员确认后才真正入账。
 *
 * 权限与 /points/earn 一致（point:earn），因为这最终就是一次发分，不该出现「AI 通道能发、正常通道不能发」的口子。
 */
@ApiTags('ai')
@ApiBearerAuth()
@Controller('ai/assist')
export class EarnAssistController {
  constructor(private readonly assist: EarnAssistService) {}

  @Post('earn/propose')
  @Permissions('point:earn')
  @ApiOperation({
    summary: 'AI 协同发分：生成建议（只读）',
    description:
      '用与 /points/earn 完全相同的规则引擎算出应发积分，并附风险提示（未达起送、大额、疑似重复录单、当日多次发分）。' +
      '返回的 token 为服务端签名票据，10 分钟有效。',
  })
  propose(@Body() dto: EarnProposalDto, @CurrentUser() user: JwtPayload) {
    return this.assist.propose(dto, user);
  }

  @Post('earn/confirm')
  @Permissions('point:earn')
  @ApiOperation({
    summary: 'AI 协同发分：确认入账',
    description:
      '校验签名票据 → 用最新规则重算 → 复用 /points/earn 落库。' +
      '金额以票据锁定值为准，前端无法篡改分值；同一票据重复确认返回首次结果（idempotent），不会重复入账。',
  })
  confirm(
    @Body() dto: EarnConfirmDto,
    @CurrentUser() user: JwtPayload,
    @Ip() ip: string,
    @Headers('user-agent') ua: string,
  ) {
    return this.assist.confirm(dto, user, ip, ua);
  }
}
