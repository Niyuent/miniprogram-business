/**
 * C 端（H5 / 小程序）JWT 载荷（S5.1）
 *
 * 与后台 `JwtPayload` **严格区分**（用 `kind` 标记）：后台令牌的 sub 是 admin_users.id，
 * C 端令牌的 sub 是 users.id。两者签名密钥相同，但靠 `kind` 在守卫层互斥，
 * 避免「C 端 userId 恰好等于某个 admin id」被误当成后台账号。
 */
export interface UserJwtPayload {
  kind: 'USER';
  /** users.id */
  sub: number;
  /** 便于业务读取（等于 sub） */
  userId: number;
  openid: string;
  unionid: string | null;
  /**
   * 商家主动「切到会员端」时写入 member。
   *
   * 手机号同时存在于 users 与 admin_users 的账号，bootstrap 默认会把会员自动升级成商家；
   * 带上这个标记后强制按会员身份进入，避免切换按钮点了却被弹回商家端。
   */
  view?: 'member';
}
