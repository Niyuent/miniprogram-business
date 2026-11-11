import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PointModule } from '../point/point.module';
import { H5Controller } from './h5.controller';
import { H5Service } from './h5.service';

/**
 * C 端 / H5 模块（S5.1）
 *
 * 依赖 AuthModule（UserJwtAuthGuard 用到 JwtService）与 PointModule（复用积分服务）。
 */
@Module({
  imports: [AuthModule, PointModule],
  controllers: [H5Controller],
  providers: [H5Service],
})
export class H5Module {}
