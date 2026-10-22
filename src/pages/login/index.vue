<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import NetworkBanner from '@/components/NetworkBanner.vue';
import { loginAndRoute, loginMerchantAndRoute, MERCHANT_TEST_ACCOUNTS } from '@/services/auth';
import { friendlyMessage, isDomainListError } from '@/utils/errors';
import { apiBaseUrl, apiHost, DEV_LAN_HOST, HttpError, probeApi, setApiHost } from '@/utils/request';

const status = ref('点下方账号进入即可');
const detail = ref('');
const pending = ref('');
const hostDraft = ref(apiHost());
const probeText = ref('正在检测接口…');
const probeOk = ref<boolean | null>(null);
const domainBlocked = ref(false);
const showNet = ref(false);

const DOMAIN_TIP =
  '微信拦截了本地接口（url not in domain list）。\n' +
  '开发者工具 → 详情 → 本地设置 → 勾选「不校验合法域名…」→ 编译。';

const netSummary = computed(() => {
  if (probeOk.value === true) return `接口正常 · ${apiHost()}`;
  if (domainBlocked.value) return '被域名校验拦截，先勾选不校验合法域名';
  if (probeOk.value === false) return `接口不通 · ${apiHost()}`;
  return '正在检测接口…';
});

function explain(error: unknown, fallback: string) {
  if (isDomainListError(error)) {
    domainBlocked.value = true;
    showNet.value = true;
    return `${friendlyMessage(error, fallback)}\n当前 ${apiBaseUrl()}\n\n${DOMAIN_TIP}`;
  }
  const base = friendlyMessage(error, fallback);
  if (error instanceof HttpError && error.status === 0) {
    showNet.value = true;
    return (
      `${base}\n当前 ${apiBaseUrl()}\n` +
      '① 详情里勾选「不校验合法域名」；② 模拟器用 127.0.0.1；③ 真机预览用局域网 IP。'
    );
  }
  return base;
}

async function runProbe() {
  probeText.value = '正在检测接口…';
  probeOk.value = null;
  const result = await probeApi();
  probeOk.value = result.ok;
  domainBlocked.value = !result.ok && /url not in domain list|合法域名/i.test(result.detail);
  if (result.ok) {
    probeText.value = `通 ${result.detail.replace(/^通\s*/, '')}`;
    return;
  }
  showNet.value = true;
  if (domainBlocked.value) {
    probeText.value = '域名校验拦截 → 勾选「不校验合法域名」后编译';
    return;
  }
  probeText.value = `${result.detail}；可试局域网 ${DEV_LAN_HOST}`;
}

function applyHost(host: string) {
  const value = String(host || '').trim();
  if (!value) return;
  setApiHost(value);
  hostDraft.value = apiHost();
  void runProbe();
}

function clearHostOverride() {
  setApiHost('');
  hostDraft.value = apiHost();
  void runProbe();
}

async function enterMember() {
  if (pending.value) return;
  status.value = '正在通过微信登录…';
  detail.value = '';
  pending.value = 'member';
  try {
    await loginAndRoute();
  } catch (error) {
    status.value = '登录失败';
    detail.value = explain(error, '微信登录没有成功，可改用下方商家测试账号');
  } finally {
    pending.value = '';
  }
}

async function enterMerchant(username: string) {
  if (pending.value) return;
  status.value = '正在登录商家账号…';
  detail.value = '';
  pending.value = username;
  try {
    await loginMerchantAndRoute(username);
  } catch (error) {
    status.value = '商家登录失败';
    detail.value = explain(error, '商家账号没有登录成功');
  } finally {
    pending.value = '';
  }
}

onMounted(() => {
  void runProbe();
});
</script>

<template>
  <view class="login">
    <network-banner />
    <view class="login__badge">Z</view>
    <view class="login__mark">小Z 随身版</view>
    <view class="login__sub">经营助手 · 会员码 · 核销发积分</view>

    <view class="login__net" :class="probeOk === false ? 'is-bad' : probeOk ? 'is-ok' : ''" @tap="showNet = !showNet">
      <text>{{ netSummary }}</text>
      <text class="login__net-link">{{ showNet ? '收起' : '网络设置' }}</text>
    </view>

    <view v-if="showNet" class="login__host">
      <view class="login__probe">{{ probeText }}</view>
      <view v-if="domainBlocked" class="login__domain">{{ DOMAIN_TIP }}</view>
      <view class="login__host-row">
        <button class="login__chip" size="mini" hover-class="press" @tap.stop="applyHost('127.0.0.1')">
          127.0.0.1
        </button>
        <button class="login__chip" size="mini" hover-class="press" @tap.stop="applyHost(DEV_LAN_HOST)">
          局域网 {{ DEV_LAN_HOST }}
        </button>
        <button class="login__chip login__chip--ghost" size="mini" hover-class="press" @tap.stop="clearHostOverride">
          恢复默认
        </button>
      </view>
      <view class="login__host-row">
        <input v-model="hostDraft" class="login__input" placeholder="自定义 IP" @tap.stop />
        <button class="login__chip" size="mini" hover-class="press" @tap.stop="applyHost(hostDraft)">应用</button>
        <button class="login__chip login__chip--ghost" size="mini" hover-class="press" @tap.stop="runProbe">重测</button>
      </view>
    </view>

    <view class="login__status">{{ status }}</view>
    <view v-if="detail" class="login__detail">{{ detail }}</view>

    <button
      class="login__member"
      hover-class="press"
      :loading="pending === 'member'"
      :disabled="!!pending"
      @tap="enterMember"
    >
      {{ pending === 'member' ? '正在登录…' : '微信登录（会员）' }}
    </button>

    <view class="login__label">商家测试账号（点一项即可进入）</view>
    <button
      v-for="item in MERCHANT_TEST_ACCOUNTS"
      :key="item.username"
      class="login__merchant"
      hover-class="press"
      :loading="pending === item.username"
      :disabled="!!pending"
      @tap="enterMerchant(item.username)"
    >
      {{ pending === item.username ? '正在登录…' : `${item.label} · ${item.hint}` }}
    </button>
  </view>
</template>

<style scoped>
.login {
  min-height: 100vh;
  padding: 120rpx 48rpx 64rpx;
  box-sizing: border-box;
  background: linear-gradient(160deg, #eafcf8 0%, #e9f3ff 55%, #f3f7f8 100%);
}
.login__badge {
  width: 96rpx;
  height: 96rpx;
  border-radius: 28rpx;
  background: linear-gradient(135deg, #00d6b2, #19a7f8);
  color: #fff;
  font-size: 48rpx;
  font-weight: 800;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 20rpx 56rpx rgba(0, 184, 160, 0.28);
}
.login__mark {
  margin-top: 28rpx;
  font-size: 56rpx;
  font-weight: 800;
  letter-spacing: -1rpx;
  color: #0e1f26;
}
.login__sub {
  margin-top: 12rpx;
  color: #8a9aa3;
  font-size: 26rpx;
}
.login__net {
  margin-top: 24rpx;
  padding: 18rpx 22rpx;
  border-radius: 16rpx;
  background: rgba(255, 255, 255, 0.8);
  border: 1px solid #eaf0f2;
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 16rpx;
  font-size: 24rpx;
  color: #5b6b73;
}
.login__net.is-ok {
  color: #0f766e;
  border-color: #99e0d4;
  background: #eefbf8;
}
.login__net.is-bad {
  color: #c22a2e;
  border-color: #ffccc7;
  background: #fff1f0;
}
.login__net-link {
  flex-shrink: 0;
  color: #00766a;
  font-weight: 600;
}
.login__host {
  margin-top: 12rpx;
  padding: 20rpx;
  background: rgba(255, 255, 255, 0.72);
  border-radius: 20rpx;
  border: 1px solid #eaf0f2;
}
.login__probe {
  font-size: 22rpx;
  color: #8a9aa3;
  line-height: 1.45;
  margin-bottom: 12rpx;
}
.login__domain {
  margin-bottom: 12rpx;
  padding: 16rpx;
  background: #fff1f0;
  border: 1px solid #ffccc7;
  border-radius: 12rpx;
  color: #a8071a;
  font-size: 22rpx;
  line-height: 1.5;
  white-space: pre-wrap;
}
.login__host-row {
  display: flex;
  flex-wrap: wrap;
  gap: 12rpx;
  align-items: center;
  margin-top: 8rpx;
}
.login__chip {
  margin: 0;
  background: #e6f7f4;
  color: #00766a;
  border-radius: 999rpx;
  font-size: 22rpx;
  line-height: 1.4;
  padding: 0 18rpx;
}
.login__chip--ghost {
  background: #f3f7f8;
  color: #5b6b73;
}
.login__input {
  flex: 1;
  min-width: 220rpx;
  height: 56rpx;
  padding: 0 16rpx;
  background: #fff;
  border: 1px solid #eaf0f2;
  border-radius: 12rpx;
  font-size: 24rpx;
}
.login__status {
  margin-top: 36rpx;
  font-size: 30rpx;
  color: #33454f;
  font-weight: 600;
}
.login__detail {
  margin-top: 16rpx;
  color: #c22a2e;
  line-height: 1.55;
  white-space: pre-wrap;
  font-size: 26rpx;
}
.login__member {
  margin-top: 36rpx;
  background: linear-gradient(135deg, #00d6b2, #19a7f8);
  color: #fff;
  border-radius: 999rpx;
  font-weight: 700;
  box-shadow: 0 20rpx 56rpx rgba(0, 184, 160, 0.28);
}
.login__label {
  margin: 40rpx 0 12rpx;
  color: #8a9aa3;
  font-size: 24rpx;
}
.login__merchant {
  margin-top: 16rpx;
  background: #fff;
  color: #00766a;
  border-radius: 999rpx;
  border: 1px solid #eaf0f2;
  font-weight: 600;
}
</style>
