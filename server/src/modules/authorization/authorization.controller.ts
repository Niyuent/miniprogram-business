import {
  Body,
  Controller,
  Get,
  Headers,
  Ip,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Permissions } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtPayload } from '../auth/jwt-payload';
import { AuthorizationService } from './authorization.service';
import {
  CreateAuthorizationDto,
  DisableAuthorizationDto,
  QueryAuthorizationLogsDto,
  QueryAuthorizationsDto,
} from './dto/authorization.dto';

/**
 * 授权管理（**主体视角**）
 *
 * 全部接口都「以调用账号所属的主体身份」操作：普通主体管理员只能管自己的授权，
 * 平台管理员可通过 `mainMerchantId` 指定别家主体。越权一律 403。
 *
 * 附属商家查自己的授权请走 `GET /me/authorizations`。
 *
 * 路由顺序：`available-templates` / `logs` 这类字面量子路由排在 `:id` 之前，
 * 避免将来加 `GET /:id` 时被抢先匹配（`:id/disable` 带后缀不会冲突，但保持习惯更安全）。
 */
@ApiTags('authorizations')
@ApiBearerAuth()
@Controller('authorizations')
export class AuthorizationController {
  constructor(private readonly authorizations: AuthorizationService) {}

  @Get('available-templates')
  @Permissions('authorization:view')
  @ApiOperation({ summary: '可选主体券模板（本主体拥有、已上架、MAIN_COUPON）' })
  availableTemplates(@CurrentUser() user: JwtPayload) {
    return this.authorizations.availableTemplates(user);
  }

  @Get('logs')
  @Permissions('authorization:view')
  @ApiOperation({
    summary: '授权记录（报表用）：谁开的、谁关的、时间、原因',
    description: '读 audit_logs（module=authorization），已按主体做数据隔离。',
  })
  logs(@Query() query: QueryAuthorizationLogsDto, @CurrentUser() user: JwtPayload) {
    return this.authorizations.logs(query, user);
  }

  @Get()
  @Permissions('authorization:view')
  @ApiOperation({ summary: '授权列表（主体视角，含模板清单）' })
  list(@Query() query: QueryAuthorizationsDto, @CurrentUser() user: JwtPayload) {
    return this.authorizations.list(query, user);
  }

  @Post()
  @Permissions('authorization:manage')
  @ApiOperation({
    summary: '开启授权',
    description:
      '已授权 → 409 AUTHORIZATION_EXISTS；曾关闭过 → 重新启用同一条记录（reactivated=true）。',
  })
  create(
    @Body() dto: CreateAuthorizationDto,
    @CurrentUser() user: JwtPayload,
    @Ip() ip: string,
    @Headers('user-agent') ua: string,
  ) {
    return this.authorizations.create(dto, user, ip, ua);
  }

  @Patch(':id/disable')
  @Permissions('authorization:manage')
  @ApiOperation({
    summary: '关闭授权（幂等）',
    description:
      '重复关闭返回 200 + alreadyDisabled:true，不报 409/500。revokeReason 写入 revoke_reason 用于追溯。',
  })
  disable(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: DisableAuthorizationDto,
    @CurrentUser() user: JwtPayload,
    @Ip() ip: string,
    @Headers('user-agent') ua: string,
  ) {
    return this.authorizations.disable(id, dto, user, ip, ua);
  }
}
