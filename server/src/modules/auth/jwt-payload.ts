/** JWT 载荷（S1 登录接口复用同一结构） */
export interface JwtPayload {
  /** 后台账号 admin_users.id */
  sub: number;
  username: string;
  /** 所属商家；平台管理员可为 null */
  merchantId: number | null;
  /** 店员账号绑定的门店 */
  storeId: number | null;
  userType: 'PLATFORM' | 'MERCHANT' | 'STORE';
  roles?: string[];
  /** S1：登录时一次性灌入的权限码（配合 @Permissions 做纯内存比对） */
  permissions?: string[];
}
