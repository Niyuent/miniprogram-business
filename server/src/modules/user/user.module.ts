import { Module } from '@nestjs/common';
import { AuditLogModule } from '../audit-log/audit-log.module';
import { UserController } from './user.controller';
import { UserService } from './user.service';

/**
 * 用户管理（S5.2）
 *
 * 依赖 AuditLogModule：启用/禁用、绑定手机号写审计。
 * PrismaModule 为 @Global，无需显式 import。
 */
@Module({
  imports: [AuditLogModule],
  controllers: [UserController],
  providers: [UserService],
})
export class UserModule {}
