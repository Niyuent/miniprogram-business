import { Body, Controller, Headers, Ip, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Permissions } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtPayload } from '../auth/jwt-payload';
import { QuickIssueDto } from './dto/quick-issue.dto';
import { QuickIssueService } from './quick-issue.service';

@ApiTags('coupons')
@ApiBearerAuth()
@Controller('coupons')
export class QuickIssueController {
  constructor(private readonly quick: QuickIssueService) {}

  @Post('quick-issue')
  @Permissions('coupon:issue-main', 'coupon:issue', 'coupon:create')
  @ApiOperation({
    summary: '快速建券并发放（小程序）',
    description:
      '自动创建券模板并上架、预生成券码；可选立刻按 audience 发放。面值上限 500。附属需有启用中的发券授权。',
  })
  quickIssue(
    @Body() dto: QuickIssueDto,
    @CurrentUser() user: JwtPayload,
    @Ip() ip: string,
    @Headers('user-agent') ua: string,
  ) {
    return this.quick.quickIssue(dto, user, ip, ua);
  }
}
