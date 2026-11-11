import { Injectable } from '@nestjs/common';
import { BizException, ReasonCode } from '../../common/exceptions/biz.exception';
import { PrismaService } from '../../common/prisma/prisma.service';
import { RequestScope, scopedWhere } from '../../common/guards/merchant-scope.guard';

/**
 * 附属商家侧数据读取（S1.1）
 *
 * 本模块存在的首要目的：**为 MerchantScopeGuard 提供可验证的数据载体**，
 * 让「跨商家越权」能被 curl 真实复现，而不是只写在文档里。
 * S1.2 起门店的完整 CRUD 会并入 merchants 模块，这里保持只读瘦身。
 *
 * 铁律：所有查询必须携带 `scopedWhere(scope)`，禁止裸查。
 */
@Injectable()
export class SubService {
  constructor(private readonly prisma: PrismaService) {}

  listStores(scope: RequestScope, keyword?: string) {
    const base = scopedWhere(scope);
    return this.prisma.store.findMany({
      where: {
        ...base,
        ...(keyword ? { name: { contains: keyword } } : {}),
      },
      select: {
        id: true,
        merchantId: true,
        name: true,
        code: true,
        contactName: true,
        contactPhone: true,
        address: true,
        status: true,
      },
      orderBy: { id: 'asc' },
    });
  }

  async getStore(scope: RequestScope, id: number) {
    const base = scopedWhere(scope);
    const store = await this.prisma.store.findFirst({
      where: { id, ...base },
      select: {
        id: true,
        merchantId: true,
        name: true,
        code: true,
        contactName: true,
        contactPhone: true,
        province: true,
        city: true,
        district: true,
        address: true,
        // S5.3：门店变更表单回填需要经纬度 / 营业时间 / Logo
        lng: true,
        lat: true,
        businessHours: true,
        logo: true,
        status: true,
      },
    });

    if (!store) {
      // 不区分「不存在」与「不属于你」，避免用 404/403 之差探测他人资源是否存在
      throw BizException.notFound(ReasonCode.RESOURCE_NOT_FOUND, '门店不存在或无权查看');
    }
    return store;
  }
}
