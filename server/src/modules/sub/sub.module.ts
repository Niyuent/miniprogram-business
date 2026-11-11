import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AuthModule } from '../auth/auth.module';
import { MerchantScopeGuard } from '../../common/guards/merchant-scope.guard';
import { SubController } from './sub.controller';
import { SubService } from './sub.service';

/**
 * 附属商家端模块
 *
 * `MerchantScopeGuard` 以 **APP_GUARD** 注册为模块级全局守卫：
 * 凡 `/sub/**` 路由（由守卫内部按 Controller 路径判定）一律强制数据隔离，
 * 新增接口忘记写 `@UseGuards(MerchantScopeGuard)` 也不会裸奔。
 * Guard 内部对非 `/sub` 路由与 `@Public()` 接口直接放行，不会影响其他模块。
 */
@Module({
  imports: [AuthModule],
  controllers: [SubController],
  providers: [
    SubService,
    { provide: APP_GUARD, useClass: MerchantScopeGuard },
  ],
})
export class SubModule {}
