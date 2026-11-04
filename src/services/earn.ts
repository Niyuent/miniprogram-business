import { createConsumeOrder, earnPoints } from '@/services/merchant';
import { genOrderNo, genRequestId } from '@/utils/idem';

export interface EarnParams {
  userId: number;
  amount: number;
  allianceId: number;
  storeId: number | null;
}

export interface EarnOutcome {
  earned: boolean;
  points: number;
  allianceId?: number;
  allianceName?: string;
  message?: string;
  reasonCode?: string;
}

/**
 * 录单发积分的唯一实现：先建消费订单，再按联盟发分（FIFO 由后端保证）。
 *
 * VerifyPanel（核销页收银台）与 earn（独立录单页）都走这里，
 * 避免两处口径分叉——此前 earn 页直接发分不建单，对账报表会少记录。
 */
export async function earnWithOrder(params: EarnParams): Promise<EarnOutcome> {
  const orderNo = genOrderNo();
  const requestId = genRequestId();
  const order = await createConsumeOrder({
    orderNo,
    userId: params.userId,
    storeId: params.storeId,
    totalAmount: params.amount,
  });
  const earned = await earnPoints({
    userId: params.userId,
    amount: params.amount,
    allianceId: params.allianceId,
    orderId: order.order.id,
    requestId,
    storeId: params.storeId,
  });
  return {
    earned: !!earned.earned,
    points: earned.points || 0,
    allianceId: earned.allianceId,
    allianceName: earned.allianceName,
    message: earned.message,
    reasonCode: earned.reasonCode,
  };
}
