import { Module } from '@nestjs/common';
import { MerchantAllianceController } from './merchant-alliance.controller';
import { MerchantAllianceService } from './merchant-alliance.service';

/** 商家端「我的联盟」：只看已加入的联盟，按联盟角色决定数据可见范围。 */
@Module({
  controllers: [MerchantAllianceController],
  providers: [MerchantAllianceService],
  exports: [MerchantAllianceService],
})
export class MerchantAllianceModule {}
