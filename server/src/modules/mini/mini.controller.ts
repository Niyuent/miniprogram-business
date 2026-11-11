import { Body, Controller, Get, ParseIntPipe, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../../common/decorators/public.decorator';
import { AuthService } from '../auth/auth.service';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtPayload } from '../auth/jwt-payload';
import { SwitchModeDto } from '../auth/dto/switch-mode.dto';
import { UserJwtPayload } from '../auth/user-jwt-payload';
import { MiniBootstrapGuard } from './mini-bootstrap.guard';
import { MiniService } from './mini.service';

@ApiTags('mini')
@ApiBearerAuth()
@Controller('mini')
@Public()
@UseGuards(MiniBootstrapGuard)
export class MiniController {
  constructor(
    private readonly mini: MiniService,
    private readonly auth: AuthService,
  ) {}

  @Get('bootstrap')
  @ApiOperation({ summary: '小程序启动身份：商家（AdminUser 且有 merchantId）或会员' })
  bootstrap(@CurrentUser() user: UserJwtPayload | JwtPayload) {
    return this.mini.bootstrap(user);
  }

  @Post('switch-mode')
  @ApiOperation({
    summary: '会员端 ↔ 商家端切换：按手机号对齐两侧账号，换发另一侧令牌',
  })
  switchMode(@CurrentUser() user: UserJwtPayload | JwtPayload, @Body() dto: SwitchModeDto) {
    return this.auth.switchMode(user, dto.mode);
  }

  @Get('workbench')
  @ApiOperation({ summary: '商家工作台：问候、门店、今日核销笔数与发放积分' })
  workbench(@CurrentUser() user: UserJwtPayload | JwtPayload) {
    return this.mini.workbench(user);
  }

  @Get('finance/checkup')
  @ApiOperation({ summary: '财务诊断：近 30 天实收与核销让利算出的健康分和现金支撑月数' })
  checkup(@CurrentUser() user: UserJwtPayload | JwtPayload) {
    return this.mini.financeCheckup(user);
  }

  @Get('galaxy')
  @ApiOperation({ summary: '商家星系：主体看附属，附属看本店到店客人' })
  galaxy(@CurrentUser() user: UserJwtPayload | JwtPayload) {
    return this.mini.merchantGalaxy(user);
  }

  @Get('places')
  @ApiOperation({ summary: '会员可查看的门店：去过的排在前面，其余为可到店' })
  places(@CurrentUser() user: UserJwtPayload | JwtPayload) {
    return this.mini.memberPlaces(user);
  }

  @Get('alliances')
  @ApiOperation({ summary: '会员查看周边可用联盟：每个联盟下列出主体与附属商家' })
  alliances(@CurrentUser() user: UserJwtPayload | JwtPayload) {
    return this.mini.memberAlliances(user);
  }

  @Get('issue-options')
  @ApiOperation({ summary: '商家发券选项：主体可选联盟商家；附属仅本店且只能发主体券' })
  issueOptions(@CurrentUser() user: UserJwtPayload | JwtPayload) {
    return this.mini.issueOptions(user);
  }

  @Get('member-qr')
  @ApiOperation({ summary: '会员码票据：5 分钟有效，仅供店员扫 member-desk 解析' })
  issueMemberQr(@CurrentUser() user: UserJwtPayload | JwtPayload) {
    return this.mini.issueMemberQr(user);
  }

  @Get('member-desk')
  @ApiOperation({ summary: '扫会员码后的收银台：会员信息、可用券、本店可兑券、积分余额' })
  memberDesk(
    @CurrentUser() user: UserJwtPayload | JwtPayload,
    @Query('ticket') ticket?: string,
    @Query('userId', new ParseIntPipe({ optional: true })) userId?: number,
  ) {
    return this.mini.memberDesk(user, { ticket, userId });
  }

  @Get('galaxy/public')
  @ApiOperation({ summary: '会员查看某商家所在联盟的星系，用于选店消费' })
  publicGalaxy(
    @CurrentUser() user: UserJwtPayload | JwtPayload,
    @Query('merchantId', ParseIntPipe) merchantId: number,
  ) {
    return this.mini.publicGalaxy(user, merchantId);
  }
}
