import { request } from '@/utils/request';

export interface BriefingResult {
  ok: boolean;
  headline: string;
  advice: string;
  source: 'zero' | 'fallback';
}

/**
 * 经营简报。
 *
 * Zero（智店助手）的凭证与地址只配在服务端（server/.env 的 ZERO_*），
 * 前端统一走 `/ai/zero/briefing`；Zero 不可用时返回 source=fallback + 空文案，
 * 由调用方用本地摘要兜底。不再有客户端直连 Zero 的第二套请求层。
 */
export function fetchBriefing(storeName?: string) {
  const query = storeName ? `?storeName=${encodeURIComponent(storeName)}` : '';
  return request<{ source: 'zero' | 'fallback'; headline: string; advice: string }>({
    url: `/ai/zero/briefing${query}`,
  }).then((res) => ({
    ok: res.source === 'zero' && !!res.headline,
    headline: res.headline || '',
    advice: res.advice || '',
    source: res.source,
  }));
}

/** 本地经营摘要：Zero 不可用或未配置时的兜底文案。 */
export function localMorningCopy(input: {
  greeting: string;
  bossName: string;
  redemptions: number;
  pointsIssued: number;
  score: number | null;
  hasData: boolean;
}) {
  const headline = input.hasData
    ? `今日已核销 ${input.redemptions} 笔，发放积分 ${input.pointsIssued}。`
    : '近 30 天经营流水还不多，先从扫码核销和录单发积分开始。';
  const advice =
    input.score != null
      ? `当前健康分 ${input.score}。建议盯紧今日核销与客流高峰，把待用券提醒给常客。`
      : '补齐订单与核销后，小Z 才能给出更准的经营建议。';
  return {
    greet: `${input.greeting}，${input.bossName}`,
    headline,
    advice,
  };
}
