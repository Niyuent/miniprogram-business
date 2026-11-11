import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AuthController } from './auth.controller';
import { ApiTokenGuard } from './api-token.guard';
import { JwtAuthGuard } from './jwt-auth.guard';
import { AuthService } from './auth.service';
import { UserJwtAuthGuard } from './user-jwt-auth.guard';
import { WxService } from './wx.service';
import { RateLimitService } from '../../common/services/rate-limit.service';
import { RolesGuard } from '../../common/guards/roles.guard';
import { MerchantScopeGuard } from '../../common/guards/merchant-scope.guard';

/**
 * 鉴权基础设施
 * - S0：JWT 签发/校验 + 静态令牌守卫
 * - S1：账号密码登录、角色/权限码守卫、数据隔离守卫
 *
 * 三个 Guard 的职责边界：
 *  JwtAuthGuard       —— 全站默认开启（APP_GUARD），「你是谁」
 *  RolesGuard         —— 全站默认开启（APP_GUARD），「你有没有这个权限码」
 *  MerchantScopeGuard —— 按需挂载（/sub/**），「这条数据是不是你的」
 */
@Module({
  imports: [
    JwtModule.registerAsync({
      useFactory: () => ({
        secret: process.env.JWT_SECRET || 'shangmeng-dev-secret',
        signOptions: { expiresIn: process.env.JWT_EXPIRES_IN || '2h' },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtAuthGuard, UserJwtAuthGuard, WxService, RateLimitService, ApiTokenGuard, RolesGuard, MerchantScopeGuard],
  exports: [JwtModule, AuthService, JwtAuthGuard, UserJwtAuthGuard, WxService, ApiTokenGuard, RolesGuard, MerchantScopeGuard],
})
export class AuthModule {}
