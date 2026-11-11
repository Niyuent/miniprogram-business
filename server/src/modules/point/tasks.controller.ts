import { Controller, Headers, Ip, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Permissions } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtPayload } from '../auth/jwt-payload';
import { PointService } from './point.service';

/**
 * 积分定时任务（S3.3）
 *
 * 路径刻意放在 `/tasks/points` 下，与业务写接口（`/points`）区分开。
 * 手动触发需 `point:expire:trigger` 权限并写审计；定时任务（每天 01:00 Asia/Shanghai）无需权限，
 * 由 `PointsCronService` 的 `@Cron` 驱动，共用 `PointService.expirePoints`。
 */
@ApiTags('tasks')
@ApiBearerAuth()
@Controller('tasks/points')
export class TasksController {
  constructor(private readonly points: PointService) {}

  @Post('expire')
  @Permissions('point:expire:trigger')
  @ApiOperation({
    summary: '手动触发积分过期清零（S3.3）',
    description:
      '扫描 `type=EARN AND remainingAmount>0 AND expireAt<NOW()` 的批次并清零：幂等（同一批次只会清零一次）+ ' +
      '分批（单次最多 500 条，避免大事务锁表）。需 `point:expire:trigger`，操作写审计日志。' +
      '定时任务每天 01:00（Asia/Shanghai）自动跑，无需权限。',
  })
  expire(@CurrentUser() user: JwtPayload, @Ip() ip: string, @Headers('user-agent') ua: string) {
    return this.points.expirePoints({
      operatorId: user.sub,
      operatorType: user.userType,
      ip,
      userAgent: ua,
      triggeredBy: 'manual',
    });
  }
}
