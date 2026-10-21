<script setup lang="ts">
import { onMounted, ref } from 'vue';
import NetworkBanner from '@/components/NetworkBanner.vue';
import { loginAndRoute, loginMerchantAndRoute, MERCHANT_TEST_ACCOUNTS } from '@/services/auth';
import { friendlyMessage } from '@/utils/errors';
import { apiBaseUrl, apiHost, DEV_LAN_HOST, HttpError, probeApi, setApiHost } from '@/utils/request';

const status = ref('选择要测试的身份');
const detail = ref('');
const pending = ref('');
const apiHint = ref(apiBaseUrl());
const hostDraft = ref(apiHost());
const probeText = ref('正在检测接口…');
const probeOk = ref<boolean | null>(null);

function explain(error: unknown, fallback: string) {
  const base = friendlyMessage(error, fallback);
  if (error instanceof HttpError && error.status === 0) {
    return (
      `${base}\n当前接口 ${apiBaseUrl()}\n` +
      '校园网常禁手机访问电脑。请改用：① 开发者工具「真机调试」并把接口切成 127.0.0.1；' +
      '② 或手机开热点给电脑后改局域网 IP 再编译预览。'
    );
  }
  return base;
}

async function runProbe() {
  probeText.value = '正在检测接口…';
  probeOk.value = null;
  apiHint.value = apiBaseUrl();
  const result = await probeApi();
  probeOk.value = result.ok;
  probeText.value = result.ok
    ? `接口可达（${result.detail}）`
    : `接口不通：${result.detail}。校园网请用真机调试+127.0.0.1，或手机热点`;
}

function applyHost(host: string) {
  setApiHost(host);
  hostDraft.value = apiHost();
  apiHint.value = apiBaseUrl();
  void runProbe();
}

function clearHostOverride() {
  setApiHost('');
  hostDraft.value = apiHost();
  apiHint.value = apiBaseUrl();
  void runProbe();
}

async function enterMember() {
  if (pending.value) return;
  status.value = '正在通过微信登录…';
  detail.value = '';
  apiHint.value = apiBaseUrl();
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
  apiHint.value = apiBaseUrl();
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
    <view class="login__api">接口 {{ apiHost() }}</view>
    <view class="login__probe" :class="probeOk === false ? 'is-bad' : probeOk ? 'is-ok' : ''">
      {{ probeText }}
    </view>

    <view class="login__host">
      <view class="login__host-label">接口主机（打不通时切换）</view>
      <view class="login__host-row">
        <button class="login__chip" size="mini" hover-class="press" @tap="applyHost('127.0.0.1')">
          真机调试 127.0.0.1
        </button>
        <button class="login__chip" size="mini" hover-class="press" @tap="applyHost(DEV_LAN_HOST)">
          局域网 {{ DEV_LAN_HOST }}
        </button>
        <button class="login__chip login__chip--ghost" size="mini" hover-class="press" @tap="clearHostOverride">
          恢复默认
        </button>
      </view>
      <view class="login__host-row">
        <input v-model="hostDraft" class="login__input" placeholder="自定义 IP，如 10.x.x.x" />
        <button class="login__chip" size="mini" hover-class="press" @tap="applyHost(hostDraft)">应用</button>
        <button class="login__chip login__chip--ghost" size="mini" hover-class="press" @tap="runProbe">重测</button>
      </view>
    </view>

    <view class="login__status">{{ status }}</view>
    <view v-if="detail" class="login__detail">{{ detail }}</view>

    <button class="login__member" hover-class="press" :loading="pending === 'member'" :disabled="!!pending" @tap="enterMember">
      {{ pending === 'member' ? '正在登录…' : '微信登录（会员）' }}
    </button>

    <view class="login__label">商家测试账号</view>
    <button
      v-for="item in MERCHANT_TEST_ACCOUNTS"
      :key="item.username"
      class="login__merchant"
      hover-class="press"
      :loading="pending === item.username"
      :disabled="!!pending"
      @tap="enterMerchant(item.username)"
    >
      {{ item.label }} · {{ item.hint }}
    </button>
  </view>
</template>

<style scoped>
.login {
  min-height: 100vh;
  padding: 120rpx 48rpx 48rpx;
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
.login__api {
  margin-top: 16rpx;
  font-size: 22rpx;
  color: #8a9aa3;
  font-family: ui-monospace, monospace;
}
.login__probe {
  margin-top: 10rpx;
  font-size: 22rpx;
  color: #8a9aa3;
  line-height: 1.45;
}
.login__probe.is-ok {
  color: #0f766e;
}
.login__probe.is-bad {
  color: #c22a2e;
}
.login__host {
  margin-top: 24rpx;
  padding: 20rpx;
  background: rgba(255, 255, 255, 0.72);
  border-radius: 20rpx;
  border: 1px solid #eaf0f2;
}
.login__host-label {
  font-size: 22rpx;
  color: #8a9aa3;
  margin-bottom: 12rpx;
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
}
.login__detail {
  margin-top: 16rpx;
  color: #c22a2e;
  line-height: 1.55;
  white-space: pre-wrap;
  font-size: 26rpx;
}
.login__member {
  margin-top: 48rpx;
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
