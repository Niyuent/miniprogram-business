import { Injectable, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { compareSync, hashSync } from 'bcryptjs';
import { BizException, ReasonCode } from '../../common/exceptions/biz.exception';
import { PrismaService } from '../../common/prisma/prisma.service';
import { parseUserInviteCode } from '../../common/utils/invite-code';
import { UpdatePasswordDto } from './dto/update-password.dto';
import { JwtPayload } from './jwt-payload';
import { UserJwtPayload } from './user-jwt-payload';
import { WxService } from './wx.service';

const BCRYPT_ROUNDS = 10;

/** 登录成功后返回给前端的账号上下文 */
export interface LoginResult {
  accessToken: string;
  expiresIn: string;
  user: {
    id: number;
    username: string;
    realName: string | null;
    phone: string | null;
    userType: string;
    merchantId: number | null;
    merchantName: string | null;
    storeId: number | null;
    storeName: string | null;
    lastLoginAt: Date | null;
  };
  roles: string[];
  permissions: string[];
  /**
   * true = 系统生成的初始账号还没改过密。
   * 前端看到这个值要强制跳改密页——未改密前除 PUT /auth/password 外的接口都会 403。
   */
  mustChangePassword: boolean;
}

/**
 * 认证服务：账号密码登录 / 资料 / 改密 / 权限码
 *
 * 安全性：
 *  - 登录失败一律返回同一句话 + 401，不区分「账号不存在」与「密码错误」，避免账号枚举。
 *  - bcrypt 比对；改密后旧密码立即失效（password_hash 全量覆盖）。
 *  - 账号停用 / 所属商家暂停时拒绝登录。
 */
@Injectable()
export class AuthService {
  private readonly logger = new Logger('Auth');

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly wx: WxService,
  ) {}

  /**
   * C 端登录（S5.1）：微信 code → openid/unionid → 找到/创建 users → 签发 C 端 JWT。
   *
   * 与后台登录**分离**：payload 带 `kind:'USER'`，只能访问 `/h5/**`。
   * 用户不存在则按 openid 自动创建（phone 用确定性占位，保证唯一）。
   * inviterCode：会员分享带来的邀请码（U{userId}），仅在**新用户创建时**记录（首触归因，不覆盖）。
   */
  async userLogin(code: string, ip?: string, inviterCode?: string) {
    const session = await this.wx.code2session(code, ip);

    // 邀请人前置校验：码不存在 / 邀请人不存在都按无邀请处理。
    // 邀请码是可选归因信息，不能因为它让登录失败；新用户 id 自增，不可能自邀请。
    let inviterId: number | null = null;
    const parsedInviter = parseUserInviteCode(inviterCode);
    if (parsedInviter) {
      const inviter = await this.prisma.user.findUnique({
        where: { id: parsedInviter },
        select: { id: true },
      });
      inviterId = inviter ? parsedInviter : null;
    }

    let user = await this.prisma.user.findFirst({ where: { openid: session.openid } });
    if (!user) {
      user = await this.prisma.user.create({
        data: {
          phone: `wx_${session.openid.slice(-16)}`,
          nickname: '微信用户',
          openid: session.openid,
          unionid: session.unionid ?? null,
          registeredAt: new Date(),
          inviterId,
        },
      });
    } else if (session.unionid && user.unionid !== session.unionid) {
      user = await this.prisma.user.update({ where: { id: user.id }, data: { unionid: session.unionid } });
    }

    if (user.status !== 'ACTIVE') {
      throw BizException.forbidden(ReasonCode.ACCOUNT_DISABLED, '用户已被禁用');
    }

    // 开积分账户（幂等）：默认挂靠星链商盟（allianceId=1），避免 H5「我的积分」因无账户而 404
    await this.prisma.pointAccount.upsert({
      where: { userId_allianceId: { userId: user.id, allianceId: 1 } },
      create: { userId: user.id, allianceId: 1 },
      update: {},
    });

    const payload: UserJwtPayload = {
      kind: 'USER',
      sub: user.id,
      userId: user.id,
      openid: session.openid,
      unionid: user.unionid ?? null,
    };

    this.logger.log(`C 端登录成功 userId=${user.id} openid=${session.openid}`);

    return {
      accessToken: this.jwt.sign(payload),
      expiresIn: process.env.JWT_EXPIRES_IN ?? '2h',
      user: {
        id: user.id,
        nickname: user.nickname,
        phone: user.phone,
        openid: user.openid,
        unionid: user.unionid,
      },
    };
  }

  /**
   * 手机号登录（会员与商家共用入口，短信验证码上线前的过渡方案）。
   *
   * 判定顺序：
   *  1. 手机号命中后台账号（ACTIVE、已挂商家且商家 APPROVED）→ 签发后台令牌，直接进商家端；
   *  2. 否则按会员处理：users 有记录就复用，没有就按手机号创建（昵称取后 4 位）。
   *
   * 安全提示：当前没有验证码，知道手机号即可登录他人账号。
   * TODO(短信验证码)：接入后在签发令牌前强制校验 code，并删除本注释。
   */
  async phoneLogin(phone: string, ip?: string) {
    const normalized = String(phone || '').trim();

    const admin = await this.prisma.adminUser.findFirst({
      where: {
        phone: normalized,
        status: 'ACTIVE',
        merchantId: { not: null },
        merchant: { status: 'APPROVED' },
      },
      select: { id: true },
    });
    if (admin) {
      const session = await this.issueAdminSession(admin.id, ip);
      this.logger.log(`手机号登录命中商家账号 adminId=${admin.id}`);
      return session;
    }

    let user = await this.prisma.user.findUnique({ where: { phone: normalized } });
    if (!user) {
      user = await this.prisma.user.create({
        data: {
          phone: normalized,
          nickname: `用户${normalized.slice(-4)}`,
          registeredAt: new Date(),
        },
      });
    }
    if (user.status !== 'ACTIVE') {
      throw BizException.forbidden(ReasonCode.ACCOUNT_DISABLED, '用户已被禁用');
    }

    // 与微信登录保持一致：开积分账户（幂等），避免「我的积分」因无账户 404
    await this.prisma.pointAccount.upsert({
      where: { userId_allianceId: { userId: user.id, allianceId: 1 } },
      create: { userId: user.id, allianceId: 1 },
      update: {},
    });

    const payload: UserJwtPayload = {
      kind: 'USER',
      sub: user.id,
      userId: user.id,
      openid: user.openid ?? '',
      unionid: user.unionid ?? null,
    };
    this.logger.log(`手机号登录成功 userId=${user.id}`);

    return {
      accessToken: this.jwt.sign(payload),
      expiresIn: process.env.JWT_EXPIRES_IN ?? '2h',
      role: 'member' as const,
      user: {
        id: user.id,
        nickname: user.nickname,
        phone: user.phone,
        openid: user.openid,
        unionid: user.unionid,
      },
    };
  }

  /**
   * 会员端 ↔ 商家端切换。
   *
   * 两侧靠手机号对齐（users.phone ↔ admin_users.phone）：
   *  - 切商家：手机号必须存在 ACTIVE 且商家已通过的后台账号，否则 403；
   *  - 切会员：复用/创建 users 记录，令牌写入 view:'member'，
   *    否则 bootstrap 会按手机号把商家又自动转回商家端。
   */
  async switchMode(user: UserJwtPayload | JwtPayload, mode: 'member' | 'merchant') {
    const isUser = (user as UserJwtPayload).kind === 'USER';
    const phone = isUser
      ? (
          await this.prisma.user.findUnique({
            where: { id: (user as UserJwtPayload).userId },
            select: { phone: true },
          })
        )?.phone
      : (
          await this.prisma.adminUser.findUnique({
            where: { id: (user as JwtPayload).sub },
            select: { phone: true },
          })
        )?.phone;

    if (!phone) {
      throw BizException.badRequest(ReasonCode.FORBIDDEN_SCOPE, '当前账号没有绑定手机号，无法切换身份');
    }

    if (mode === 'merchant') {
      const admin = await this.prisma.adminUser.findFirst({
        where: {
          phone,
          status: 'ACTIVE',
          merchantId: { not: null },
          merchant: { status: 'APPROVED' },
        },
        select: { id: true },
      });
      if (!admin) {
        throw BizException.forbidden(ReasonCode.FORBIDDEN_SCOPE, `手机号 ${phone} 没有可用的商家账号`);
      }
      const session = await this.issueAdminSession(admin.id);
      return {
        accessToken: session.accessToken,
        expiresIn: session.expiresIn,
        role: 'merchant' as const,
      };
    }

    let account = await this.prisma.user.findUnique({ where: { phone } });
    if (!account) {
      account = await this.prisma.user.create({
        data: {
          phone,
          nickname: `用户${phone.slice(-4)}`,
          registeredAt: new Date(),
        },
      });
    }
    if (account.status !== 'ACTIVE') {
      throw BizException.forbidden(ReasonCode.ACCOUNT_DISABLED, '用户已被禁用');
    }
    await this.prisma.pointAccount.upsert({
      where: { userId_allianceId: { userId: account.id, allianceId: 1 } },
      create: { userId: account.id, allianceId: 1 },
      update: {},
    });

    const payload: UserJwtPayload = {
      kind: 'USER',
      sub: account.id,
      userId: account.id,
      openid: account.openid ?? '',
      unionid: account.unionid ?? null,
      view: 'member',
    };
    return {
      accessToken: this.jwt.sign(payload),
      expiresIn: process.env.JWT_EXPIRES_IN ?? '2h',
      role: 'member' as const,
    };
  }

  /**
   * 按后台账号签发令牌。手机号登录 / 角色切换共用，
   * 载荷与 `/auth/login` 完全一致（含 roles/permissions），
   * 否则商家端调后台鉴权接口会被 RolesGuard 拦下。
   */
  private async issueAdminSession(accountId: number, ip?: string): Promise<LoginResult> {
    const account = await this.prisma.adminUser.findUnique({
      where: { id: accountId },
      include: { merchant: { select: { id: true, name: true, status: true } } },
    });
    if (!account) {
      throw BizException.unauthorized(ReasonCode.INVALID_CREDENTIALS, '账号不存在');
    }
    if (account.status !== 'ACTIVE') {
      throw BizException.forbidden(ReasonCode.ACCOUNT_DISABLED, '账号已停用');
    }
    if (account.merchant && account.merchant.status !== 'APPROVED') {
      throw BizException.forbidden(
        ReasonCode.MERCHANT_SUSPENDED,
        `所属商家状态为 ${account.merchant.status}，暂不可登录`,
      );
    }

    const { roles, permissions } = await this.loadGrants(account.id);
    const payload: JwtPayload = {
      sub: account.id,
      username: account.username,
      merchantId: account.merchantId ?? null,
      storeId: account.storeId ?? null,
      userType: account.userType,
      roles,
      permissions,
    };

    await this.prisma.adminUser.update({
      where: { id: account.id },
      data: { lastLoginAt: new Date(), lastLoginIp: ip ?? null },
    });

    return {
      accessToken: this.jwt.sign(payload),
      expiresIn: process.env.JWT_EXPIRES_IN ?? '2h',
      user: {
        id: account.id,
        username: account.username,
        realName: account.realName,
        phone: account.phone,
        userType: account.userType,
        merchantId: account.merchantId ?? null,
        merchantName: account.merchant?.name ?? null,
        storeId: account.storeId ?? null,
        storeName: null,
        lastLoginAt: account.lastLoginAt,
      },
      roles,
      permissions,
      mustChangePassword: account.mustChangePassword,
    };
  }

  async login(username: string, password: string, ip?: string): Promise<LoginResult> {
    const account = await this.prisma.adminUser.findUnique({
      where: { username },
      include: { merchant: { select: { id: true, name: true, status: true } } },
    });

    if (!account || !compareSync(password, account.passwordHash)) {
      throw BizException.unauthorized(
        ReasonCode.INVALID_CREDENTIALS,
        '账号或密码错误',
      );
    }

    if (account.status !== 'ACTIVE') {
      throw BizException.forbidden(ReasonCode.ACCOUNT_DISABLED, '账号已停用');
    }

    if (account.merchant && account.merchant.status !== 'APPROVED') {
      throw BizException.forbidden(
        ReasonCode.MERCHANT_SUSPENDED,
        `所属商家状态为 ${account.merchant.status}，暂不可登录`,
      );
    }

    const { roles, permissions } = await this.loadGrants(account.id);

    const payload: JwtPayload = {
      sub: account.id,
      username: account.username,
      merchantId: account.merchantId ?? null,
      storeId: account.storeId ?? null,
      userType: account.userType,
      roles,
      permissions,
    };

    await this.prisma.adminUser.update({
      where: { id: account.id },
      data: { lastLoginAt: new Date(), lastLoginIp: ip ?? null },
    });

    this.logger.log(`登录成功 ${account.username}(id=${account.id}) roles=[${roles.join(',')}]`);

    return {
      accessToken: this.jwt.sign(payload),
      expiresIn: process.env.JWT_EXPIRES_IN ?? '2h',
      user: {
        id: account.id,
        username: account.username,
        realName: account.realName,
        phone: account.phone,
        userType: account.userType,
        merchantId: account.merchantId ?? null,
        merchantName: account.merchant?.name ?? null,
        storeId: account.storeId ?? null,
        storeName: null,
        lastLoginAt: account.lastLoginAt,
      },
      roles,
      permissions,
      mustChangePassword: account.mustChangePassword,
    };
  }

  async profile(userId: number) {
    const account = await this.prisma.adminUser.findUnique({
      where: { id: userId },
      include: {
        merchant: { select: { id: true, name: true, code: true, type: true, status: true } },
      },
    });
    if (!account) {
      throw BizException.notFound(ReasonCode.RESOURCE_NOT_FOUND, '账号不存在');
    }

    const store = account.storeId
      ? await this.prisma.store.findUnique({
          where: { id: account.storeId },
          select: { id: true, name: true },
        })
      : null;

    const { roles, permissions } = await this.loadGrants(account.id);

    return {
      id: account.id,
      username: account.username,
      realName: account.realName,
      phone: account.phone,
      userType: account.userType,
      status: account.status,
      lastLoginAt: account.lastLoginAt,
      merchant: account.merchant,
      store,
      roles,
      permissions,
    };
  }

  async permissions(userId: number) {
    const { roles, permissions } = await this.loadGrants(userId);
    return { roles, permissions };
  }

  async updatePassword(userId: number, dto: UpdatePasswordDto) {
    const account = await this.prisma.adminUser.findUnique({ where: { id: userId } });
    if (!account) {
      throw BizException.notFound(ReasonCode.RESOURCE_NOT_FOUND, '账号不存在');
    }
    if (!compareSync(dto.oldPassword, account.passwordHash)) {
      throw BizException.badRequest(ReasonCode.PASSWORD_MISMATCH, '原密码不正确');
    }
    if (dto.oldPassword === dto.newPassword) {
      throw BizException.badRequest(ReasonCode.PASSWORD_TOO_WEAK, '新密码不能与原密码相同');
    }

    await this.prisma.adminUser.update({
      where: { id: userId },
      data: {
        passwordHash: hashSync(dto.newPassword, BCRYPT_ROUNDS),
        // 改密成功即解除「首次登录必须改密」的限制，后续接口恢复正常访问
        mustChangePassword: false,
      },
    });

    this.logger.log(`账号 ${account.username}(id=${userId}) 修改密码成功`);
    return { updated: true, mustChangePassword: false };
  }

  /** 角色码 + 去重后的权限码（登录时一次性组装进 JWT） */
  private async loadGrants(userId: number): Promise<{ roles: string[]; permissions: string[] }> {
    const links = await this.prisma.adminUserRole.findMany({
      where: { adminUserId: userId },
      include: {
        role: {
          include: {
            permissions: { include: { permission: { select: { code: true } } } },
          },
        },
      },
    });

    const roles = links.map((l) => l.role.code);
    const permissions = Array.from(
      new Set(
        links.flatMap((l) => l.role.permissions.map((rp) => rp.permission.code)),
      ),
    ).sort();

    return { roles, permissions };
  }
}
