import { Body, Controller, Get, Ip, Post, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AllowPasswordChangeRequired } from '../../common/decorators/allow-password-change.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { RateLimitService } from '../../common/services/rate-limit.service';
import { CurrentUser } from './current-user.decorator';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { PhoneLoginDto } from './dto/phone-login.dto';
import { UpdatePasswordDto } from './dto/update-password.dto';
import { UserLoginDto } from './dto/user-login.dto';
import { JwtPayload } from './jwt-payload';

/**
 * 认证与账号
 *
 * 除 login 外全部依赖全局 JwtAuthGuard（见 app.module.ts 的 APP_GUARD），
 * `profile` 的资料一律从 JWT 里的 sub 反查，不信任何前端传入的 userId。
 *
 * S1 收口（docs/06 S1-C1）：原 `POST /auth/dev-token` 调试端点已随登录页上线删除，
 * 调试一律走真实 `/auth/login`，不再存在「绕过口令直接签发 token」的后门。
 */
@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly rateLimit: RateLimitService,
  ) {}

  @Post('login')
  @Public()
  @ApiOperation({ summary: '账号密码登录，返回 token + 角色 + 权限码 + 商家上下文' })
  login(@Body() dto: LoginDto, @Ip() ip: string) {
    return this.auth.login(dto.username, dto.password, ip);
  }

  @Post('user-login')
  @Public()
  @ApiOperation({ summary: 'C 端登录（微信 code2session → 签发 C 端 JWT，仅可访问 /h5/**）' })
  userLogin(@Body() dto: UserLoginDto, @Ip() ip: string) {
    // 公开登录接口限流：同 IP 每分钟最多 20 次（防爆破 / 灌水）
    this.rateLimit.check(`user-login:${ip ?? 'unknown'}`, 20, 60 * 1000);
    return this.auth.userLogin(dto.code, ip, dto.inviterCode);
  }

  @Post('phone-login')
  @Public()
  @ApiOperation({
    summary: '手机号登录（会员与商家共用）：命中商家账号进商家端，否则按会员处理',
    description: '短信验证码上线前的过渡方案；当前无验证码，请勿在公网环境开放。',
  })
  phoneLogin(@Body() dto: PhoneLoginDto, @Ip() ip: string) {
    this.rateLimit.check(`phone-login:${ip ?? 'unknown'}`, 20, 60 * 1000);
    return this.auth.phoneLogin(dto.phone, ip);
  }

  @Get('profile')
  @ApiBearerAuth()
  @ApiOperation({ summary: '当前登录账号信息（含商家、门店、角色、权限码）' })
  profile(@CurrentUser() user: JwtPayload) {
    return this.auth.profile(user.sub);
  }

  @Get('permissions')
  @ApiBearerAuth()
  @ApiOperation({ summary: '当前账号的角色码与权限码列表' })
  permissions(@CurrentUser() user: JwtPayload) {
    return this.auth.permissions(user.sub);
  }

  @Put('password')
  @ApiBearerAuth()
  // 必须放开：否则 must_change_password=true 的账号会被自己的强制改密策略锁死
  @AllowPasswordChangeRequired()
  @ApiOperation({
    summary: '修改当前账号密码（需校验原密码）',
    description: '这是 must_change_password=true 的账号唯一能调用的接口，改密成功后自动解除限制。',
  })
  updatePassword(@CurrentUser() user: JwtPayload, @Body() dto: UpdatePasswordDto) {
    return this.auth.updatePassword(user.sub, dto);
  }
}
