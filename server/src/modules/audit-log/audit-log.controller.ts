import { Controller, Get, Param, ParseIntPipe, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Permissions } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtPayload } from '../auth/jwt-payload';
import { AuditService } from './audit.service';
import { QueryAuditLogsDto } from './dto/audit-log.dto';

/**
 * 操作日志查询（S1.4）
 *
 * 只读模块：没有任何写接口，日志一律由各业务模块通过 `AuditService.record()` 写，
 * 保证「写了就一定落库」，不会因为这里少凋一个接口而丢。
 *
 * 权限码 `audit:view`：**默认只有平台管理员与主体商家角色持有**（见 seed 的 permissionDefs），
 * 附属商家角色即使知道 URL 也会被 RolesGuard 拦成 403 `PERMISSION_DENIED`；
 * 即便拿到接口，可见范围仍然被 `AuditService.visibilityWhere()` 按 JWT 归属二次收敛。
 */
@ApiTags('audit-logs')
@ApiBearerAuth()
@Controller('audit-logs')
export class AuditLogController {
  constructor(private readonly audits: AuditService) {}

  @Get()
  @Permissions('audit:view')
  @ApiOperation({
    summary: '操作日志列表（分页）',
    description:
      '支持 module / operatorId / operatorKeyword / action / targetType / targetId / result / from~to 组合筛选；' +
      '列表不含 before/after（体积），详情接口才返回脱敏后的变更对比。',
  })
  list(@Query() query: QueryAuditLogsDto, @CurrentUser() user: JwtPayload) {
    return this.audits.list(query, user);
  }

  @Get(':id')
  @Permissions('audit:view')
  @ApiOperation({
    summary: '操作日志详情',
    description: '返回 before / after（口令等敏感字段已替换为 `******`），供前端做变更对比。',
  })
  detail(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: JwtPayload) {
    return this.audits.detail(id, user);
  }
}
