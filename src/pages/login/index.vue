<script setup lang="ts">
import { ref } from 'vue';
import NetworkBanner from '@/components/NetworkBanner.vue';
import { loginAndRoute, loginMerchantAndRoute, MERCHANT_TEST_ACCOUNTS } from '@/services/auth';
import { friendlyMessage } from '@/utils/errors';

const status = ref('选择要测试的身份');
const detail = ref('');
const pending = ref('');

async function enterMember() {
  if (pending.value) return;
  status.value = '正在通过微信登录…';
  detail.value = '';
  pending.value = 'member';
  try {
    await loginAndRoute();
  } catch (error) {
    status.value = '登录失败';
    detail.value = friendlyMessage(error, '微信登录没有成功，可改用下方商家测试账号');
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
    detail.value = friendlyMessage(error, '商家账号没有登录成功');
  } finally {
    pending.value = '';
  }
}
</script>

<template>
  <view class="login">
    <network-banner />
    <view class="login__mark">商盟</view>
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
}
.login__mark { font-size: 64rpx; font-weight: 700; }
.login__status { margin-top: 24rpx; font-size: 32rpx; }
.login__detail { margin-top: 16rpx; color: #9a3412; line-height: 1.6; }
.login__member {
  margin-top: 48rpx;
  background: #0f766e;
  color: #fff;
  border-radius: 12rpx;
}
.login__label { margin: 40rpx 0 12rpx; color: #64748b; font-size: 24rpx; }
.login__merchant {
  margin-top: 16rpx;
  background: #fff;
  color: #1d4ed8;
  border-radius: 12rpx;
}
</style>
