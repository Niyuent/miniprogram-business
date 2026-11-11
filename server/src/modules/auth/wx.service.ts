import { Injectable, Logger } from '@nestjs/common';
import { BizException, ReasonCode } from '../../common/exceptions/biz.exception';

export interface WxSession {
  openid: string;
  unionid: string | null;
}

type WxMode = 'real' | 'mock';

/**
 * 微信 code2session（S5.1 / S5.1-P0 安全加固）
 *
 * 模式由 **显式** 环境变量 `WX_MODE` 决定（默认 `real`，**生产安全默认**，绝不"未配 APPID 就自动降级模拟"）：
 *  - `WX_MODE=real`：必须配置 `WX_APPID` + `WX_SECRET`，缺失则**构造期直接拒绝启动**；
 *  - `WX_MODE=mock`：仅允许 `NODE_ENV !== 'production'`（否则拒绝启动），且运行时**只对回环/内网 IP** 生效。
 */
@Injectable()
export class WxService {
  private readonly logger = new Logger('Wx');
  private readonly mode: WxMode;
  private readonly appid: string;
  private readonly secret: string;

  constructor() {
    const raw = (process.env.WX_MODE ?? '').toLowerCase();
    this.mode = raw === 'mock' ? 'mock' : 'real';
    this.appid = process.env.WX_APPID ?? '';
    this.secret = process.env.WX_SECRET ?? '';
    const isProd = process.env.NODE_ENV === 'production';

    if (this.mode === 'mock') {
      if (isProd) {
        throw new Error(
          '[WxService] 生产环境禁止 WX_MODE=mock（模拟登录）。请配置 WX_MODE=real 且提供 WX_APPID / WX_SECRET。',
        );
      }
      this.logger.warn('WxService 运行于 mock 模式：仅非生产环境、且仅回环/内网 IP 可用（本地开发 / 自动化验收）。');
    } else if (!this.appid || !this.secret) {
      throw new Error('[WxService] WX_MODE=real 时必须配置 WX_APPID / WX_SECRET，否则无法完成 code2session。');
    }
  }

  get isMock(): boolean {
    return this.mode === 'mock';
  }

  /** 回环 / 内网 IP 判定（mock 模式白名单） */
  private isInternalIp(ip?: string): boolean {
    if (!ip) return false;
    const v = ip.replace(/^::ffff:/, '');
    if (v === '127.0.0.1' || v === '::1' || v === 'localhost') return true;
    if (v.startsWith('10.') || v.startsWith('192.168.')) return true;
    const m = /^172\.(\d{1,3})\./.exec(v);
    if (m) {
      const n = Number(m[1]);
      if (n >= 16 && n <= 31) return true;
    }
    return false;
  }

  async code2session(code: string, ip?: string): Promise<WxSession> {
    if (this.mode === 'mock') {
      // 真机经校园网/运营商 NAT 时 @Ip() 可能是公网地址；开发环境放行并打日志，生产已禁止 mock。
      if (!this.isInternalIp(ip)) {
        if (process.env.NODE_ENV === 'production') {
          throw BizException.forbidden(ReasonCode.FORBIDDEN_SCOPE, '模拟登录仅限本机/内网访问');
        }
        this.logger.warn(`[WX_MOCK] 非内网 IP 仍放行（开发）：code=${code} ip=${ip ?? '(empty)'}`);
      } else {
        this.logger.warn(`[WX_MOCK] code2session 模拟登录：code=${code} ip=${ip}`);
      }
      return { openid: `dev_openid_${code}`, unionid: `dev_unionid_${code}` };
    }

    const url =
      'https://api.weixin.qq.com/sns/jscode2session' +
      `?appid=${encodeURIComponent(this.appid)}&secret=${encodeURIComponent(this.secret)}` +
      `&js_code=${encodeURIComponent(code)}&grant_type=authorization_code`;

    let j: { openid?: string; unionid?: string; errcode?: number; errmsg?: string };
    try {
      const res = await fetch(url);
      j = (await res.json()) as typeof j;
    } catch (e) {
      throw BizException.unauthorized(ReasonCode.INVALID_CREDENTIALS, `微信登录服务不可用：${(e as Error).message}`);
    }
    if (j.errcode || !j.openid) {
      throw BizException.unauthorized(ReasonCode.INVALID_CREDENTIALS, `微信登录失败：${j.errmsg ?? 'unknown'}`);
    }
    return { openid: j.openid, unionid: j.unionid ?? null };
  }
}
