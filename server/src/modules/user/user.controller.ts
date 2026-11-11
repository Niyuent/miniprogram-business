import { Body, Controller, Get, Headers, Ip, Param, ParseIntPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Permissions } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtPayload } from '../auth/jwt-payload';
import { BindPhoneDto, QueryUsersDto, UpdateUserStatusDto } from './dto/user.dto';
import { UserService } from './user.service';

/**
 * 用户管理（S5.2，主体后台）
 *
 * 权限：`user:view` 查看列表/详情；`user:edit` 启停/绑手机号。
 * 数据隔离：一律由 `UserService.scope()` 按 JWT 推导（附属/店员仅见本商家/门店消费过的用户）。
 */
@ApiTags('users')
@ApiBearerAuth()
@Controller('users')
export class UserController {
  constructor(private readonly users: UserService) {}

  @Get()
  @Permissions('user:view')
  @ApiOperation({ summary: '用户列表（分页 / 手机号 / 昵称 / 状态 / 注册时间筛选）' })
  list(@Query() query: QueryUsersDto, @CurrentUser() user: JwtPayload) {
    return this.users.list(query, user);
  }

  @Get(':id/masked-info')
  @Permissions('point:earn', 'user:view')
  @ApiOperation({ summary: '会员脱敏信息（扫码录单用：昵称 + 打码手机号）' })
  maskedInfo(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: JwtPayload) {
    return this.users.maskedInfo(id, user);
  }

  @Get(':id')
  @Permissions('user:view')
  @ApiOperation({ summary: '用户详情（基本信息 + 积分余额 + 券 + 消费 + 核销 + 来源商家）' })
  detail(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: JwtPayload) {
    return this.users.detail(id, user);
  }

  @Patch(':id/status')
  @Permissions('user:edit')
  @ApiOperation({ summary: '启用 / 禁用用户' })
  updateStatus(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateUserStatusDto,
    @CurrentUser() user: JwtPayload,
    @Ip() ip: string,
    @Headers('user-agent') ua?: string,
  ) {
    return this.users.updateStatus(id, user, dto, ip, ua);
  }

  @Post(':id/bind-phone')
  @Permissions('user:edit')
  @ApiOperation({ summary: '绑定 / 修改用户手机号（手机号全局唯一）' })
  bindPhone(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: BindPhoneDto,
    @CurrentUser() user: JwtPayload,
    @Ip() ip: string,
    @Headers('user-agent') ua?: string,
  ) {
    return this.users.bindPhone(id, user, dto, ip, ua);
  }
}
