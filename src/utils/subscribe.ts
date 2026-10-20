import { TMPL_MEMBER_EXCHANGE, TMPL_MERCHANT_REDEEM } from '@/config';

export type SubscribeScene = 'redeem' | 'exchange';

function templateOf(scene: SubscribeScene): string {
  return scene === 'redeem' ? TMPL_MERCHANT_REDEEM : TMPL_MEMBER_EXCHANGE;
}

/** 用户已经点了「允许接收通知」之后，向微信发起订阅。 */
export function grantSubscribe(scene: SubscribeScene) {
  const tmplId = templateOf(scene);
  if (typeof uni.requestSubscribeMessage !== 'function') {
    uni.showToast({ title: '请在微信里打开通知授权', icon: 'none' });
    return;
  }
  if (!tmplId) {
    uni.showToast({ title: '订阅模板还未配置', icon: 'none' });
    return;
  }
  uni.requestSubscribeMessage({
    tmplIds: [tmplId],
    success(res) {
      const accepted = (res as Record<string, string>)[tmplId] === 'accept';
      uni.showToast({ title: accepted ? '已允许接收通知' : '未打开通知', icon: 'none' });
    },
    fail() {
      uni.showToast({ title: '没有打开通知', icon: 'none' });
    },
  });
}

export function promptSubscribe(scene: SubscribeScene) {
  const merchant = scene === 'redeem';
  uni.showModal({
    title: merchant ? '接收核销通知' : '接收券和积分通知',
    content: merchant
      ? '允许后，核销结果会通过微信服务通知发给你。'
      : '允许后，发券或快过期时会通过微信服务通知提醒你。',
    confirmText: '允许接收通知',
    success(res) {
      if (res.confirm) grantSubscribe(scene);
    },
  });
}
