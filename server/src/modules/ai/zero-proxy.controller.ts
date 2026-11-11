import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ZeroProxyService } from './zero-proxy.service';

/**
 * Zero 代理入口。
 *
 * 不挂 @Permissions：工作台摘要对所有已登录的商家/会员账号开放（只读文案生成）。
 * 凭证与 Zero 地址只在服务端配置，前端永远拿不到。
 */
@ApiTags('ai')
@ApiBearerAuth()
@Controller('ai/zero')
export class ZeroProxyController {
  constructor(private readonly zero: ZeroProxyService) {}

  @Get('briefing')
  @ApiOperation({
    summary: 'Zero 经营简报代理',
    description: 'Zero 不可用时返回 source=fallback + 空文案，前端走本地摘要。',
  })
  async briefing(@Query('storeName') storeName?: string) {
    const brief = await this.zero.briefing(storeName);
    return {
      source: brief ? 'zero' : 'fallback',
      headline: brief?.headline || '',
      advice: brief?.advice || '',
    };
  }
}
