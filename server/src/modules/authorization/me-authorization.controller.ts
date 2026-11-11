import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtPayload } from '../auth/jwt-payload';
import { AuthorizationService } from './authorization.service';
import { QueryMeAuthorizationsDto } from './dto/authorization.dto';

/**
 * 附属商家视角：查「我自己的」授权状态
 *
 * 这是 S2 发券链路的**热路径**：发券前要判断「我能不能发这张券」。
 * 设计要点：
 *  1. **单次调用返回全量状态** —— 有没有授权、范围、模板清单、撤销信息一次给全，
 *     调用方不必「先查授权、再查模板清单」来回跑。
 *  2. **不加 @Permissions** —— 附属商家角色没有 `authorization:view` 权限码，
 *     这里是「查自己的东西」，归属由 JWT 里的 merchantId 决定就够了。
 *  3. **不做缓存** —— 撤销授权必须立刻反映到这里，缓存延迟 = 撤了权还能发券。
 *  4. **越权显式 403** —— 试图用 query 传别人的 merchantId，返回 403 而不是静默忽略。
 */
@ApiTags('me')
@ApiBearerAuth()
@Controller('me')
export class MeAuthorizationController {
  constructor(private readonly authorizations: AuthorizationService) {}

  @Get('authorizations')
  @ApiOperation({ summary: '我（附属商家）的授权状态 —— 单次返回全量，S2 发券前直接读' })
  myAuthorizations(@CurrentUser() user: JwtPayload, @Query() query: QueryMeAuthorizationsDto) {
    return this.authorizations.me(user, query);
  }
}
