<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import NetworkBanner from '@/components/NetworkBanner.vue';
import { MERCHANT_TEST_ACCOUNTS, phoneLoginAndRoute } from '@/services/auth';
import { friendlyMessage, isDomainListError } from '@/utils/errors';
import { apiBaseUrl, apiHost, DEV_LAN_HOST, HttpError, probeApi, setApiHost } from '@/utils/request';
import { IS_DEV } from '@/utils/env';

const status = ref('输入手机号即可进入');
const detail = ref('');
const phone = ref('');
/** 正在登录的手机号；空串表示空闲 */
const pending = ref('');
const PHONE_RE = /^1[3-9]\d{9}$/;
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
      '① 详情 → 本地设置 勾选「不校验合法域名」；② 本机后端 3000 端口需在运行；③ 真机预览用局域网 IP。'
    );
  }
  return base;
}

type ProbeResult = { ok: boolean; ms: number; detail: string };

/**
 * 给探活加硬超时兜底。
 * probeApi 自身已有 8s timeout，但真机弱网/丢包场景下 fail 回调可能不触发，
 * 界面就会永远停在「正在检测接口…」。这里保证无论底层如何，到点必有结论。
 */
function withHardTimeout(task: Promise<ProbeResult>, ms: number): Promise<ProbeResult> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result: ProbeResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    const timer = setTimeout(() => finish({ ok: false, ms, detail: `超时 ${ms}ms 无响应` }), ms);
    void task.then(finish).catch(() => finish({ ok: false, ms, detail: '请求异常' }));
  });
}

async function runProbe() {
  probeText.value = '正在检测接口…';
  probeOk.value = null;
  const result = await withHardTimeout(probeApi(), 10000);
  probeOk.value = result.ok;
  domainBlocked.value = !result.ok && /url not in domain list|合法域名/i.test(result.detail);
  if (result.ok) {
    probeText.value = `通 ${result.detail.replace(/^通\s*/, '')}`;
    return;
  }
  showNet.value = true;
  if (domainBlocked.value) {
    probeText.value = '域名校验拦截 → 勾选「不校验合法域名」后重新编译';
    return;
  }
  if (/超时|timeout|请求失败|网络请求失败/i.test(result.detail)) {
    probeText.value = `连不上 ${apiHost()}（手机到电脑不通）→ 手机与电脑需同一 WiFi，或改用手机热点`;
    return;
  }
  probeText.value = `${result.detail}；当前 ${apiHost()}，可试局域网 ${DEV_LAN_HOST}`;
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

/**
 * 手机号登录：会员与商家共用入口。
 * 后端按手机号先匹配后台账号（命中进商家端），否则按会员处理，
 * 角色最终由 /mini/bootstrap 决定，这里不做任何角色判断。
 */
async function enterByPhone(target?: string) {
  if (pending.value) return;
  const value = String(target ?? phone.value).trim();
  if (!PHONE_RE.test(value)) {
    status.value = '手机号格式不正确';
    detail.value = '请输入 11 位手机号，例如 13900000001';
    return;
  }
  status.value = '正在登录…';
  detail.value = '';
  pending.value = value;
  try {
    await phoneLoginAndRoute(value);
  } catch (error) {
    status.value = '登录失败';
    detail.value = explain(error, '手机号登录没有成功');
  } finally {
    pending.value = '';
  }
}

onMounted(() => {
  if (IS_DEV) void runProbe();
});
</script>

<template>
  <view class="login">
    <network-banner />
    <view class="login__badge">Z</view>
    <view class="login__mark">小Z 随身版</view>
    <view class="login__sub">经营助手 · 会员码 · 核销发积分</view>

    <view v-if="IS_DEV" class="login__net" :class="probeOk === false ? 'is-bad' : probeOk ? 'is-ok' : ''" @tap="showNet = !showNet">
      <text>{{ netSummary }}</text>
      <text class="login__net-link">{{ showNet ? '收起' : '网络设置' }}</text>
    </view>

    <view v-if="IS_DEV && showNet" class="login__host">
      <view class="login__probe">{{ probeText }}</view>
      <view class="login__probe login__probe--dim">请求 {{ apiBaseUrl() }}</view>
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

    <view class="login__phone">
      <text class="login__phone-cc">+86</text>
      <input
        v-model="phone"
        class="login__phone-inp"
        type="number"
        maxlength="11"
        placeholder="请输入手机号"
        placeholder-class="login__ph"
        :disabled="!!pending"
        @confirm="enterByPhone()"
      />
    </view>

    <button
      class="login__member"
      hover-class="press"
      :loading="!!pending && pending === phone.trim()"
      :disabled="!!pending"
      @tap="enterByPhone()"
    >
      {{ pending && pending === phone.trim() ? '正在登录…' : '登录' }}
    </button>
    <view class="login__tip">会员与商家共用手机号登录 · 短信验证码稍后开放</view>

    <block v-if="IS_DEV">
      <view class="login__label">商家测试账号（点一项直接进入商家端）</view>
      <button
        v-for="item in MERCHANT_TEST_ACCOUNTS"
        :key="item.phone"
        class="login__merchant"
        hover-class="press"
        :loading="pending === item.phone"
        :disabled="!!pending"
        @tap="enterByPhone(item.phone)"
      >
        {{ pending === item.phone ? '正在登录…' : `${item.label} · ${item.hint} · ${item.phone}` }}
      </button>
    </block>
  </view>
</template>

<style scoped>
.login {
  position: relative;
  min-height: 100vh;
  padding: 140rpx 48rpx calc(64rpx + env(safe-area-inset-bottom));
  box-sizing: border-box;
  overflow: hidden;
  background: linear-gradient(160deg, #04161d 0%, #062230 48%, #07262f 100%);
  display: flex;
  flex-direction: column;
}
.login::before {
  content: '';
  position: absolute;
  right: -200rpx;
  top: -180rpx;
  width: 620rpx;
  height: 620rpx;
  border-radius: 50%;
  background: radial-gradient(circle, rgba(0, 214, 178, 0.28) 0%, rgba(0, 214, 178, 0) 70%);
}
.login::after {
  content: '';
  position: absolute;
  left: -220rpx;
  bottom: -260rpx;
  width: 560rpx;
  height: 560rpx;
  border-radius: 50%;
  background: radial-gradient(circle, rgba(46, 144, 255, 0.24) 0%, rgba(46, 144, 255, 0) 70%);
}

.login__badge {
  position: relative;
  z-index: 2;
  width: 104rpx;
  height: 104rpx;
  border-radius: 30rpx;
  background: linear-gradient(135deg, #00d6b2, #19a7f8);
  color: #fff;
  font-size: 50rpx;
  font-weight: 800;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 24rpx 60rpx rgba(0, 214, 178, 0.35);
}
.login__mark {
  position: relative;
  z-index: 2;
  margin-top: 32rpx;
  font-size: 58rpx;
  font-weight: 800;
  letter-spacing: -1rpx;
  color: #fff;
}
.login__sub {
  position: relative;
  z-index: 2;
  margin-top: 14rpx;
  color: rgba(255, 255, 255, 0.5);
  font-size: 26rpx;
  letter-spacing: 1rpx;
}

/* ---- 开发调试块：仅 IS_DEV 渲染 ---- */
.login__net {
  position: relative;
  z-index: 2;
  margin-top: 40rpx;
  padding: 18rpx 22rpx;
  border-radius: 20rpx;
  background: rgba(255, 255, 255, 0.08);
  border: 1rpx solid rgba(255, 255, 255, 0.16);
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 16rpx;
  font-size: 22rpx;
  color: rgba(255, 255, 255, 0.7);
}
.login__net.is-ok { border-color: rgba(0, 214, 178, 0.5); color: #7ff0dd; }
.login__net.is-bad { border-color: rgba(245, 72, 77, 0.5); color: #ff9a9c; }
.login__net-link { color: #7ff0dd; font-weight: 700; flex-shrink: 0; }
.login__host {
  position: relative;
  z-index: 2;
  margin-top: 14rpx;
  padding: 20rpx;
  border-radius: 20rpx;
  background: rgba(255, 255, 255, 0.06);
  border: 1rpx solid rgba(255, 255, 255, 0.12);
}
.login__probe { font-size: 20rpx; color: rgba(255, 255, 255, 0.55); line-height: 1.6; }
.login__probe--dim { font-size: 18rpx; color: rgba(255, 255, 255, 0.34); word-break: break-all; }
.login__domain { margin-top: 8rpx; font-size: 20rpx; color: #ff9a9c; line-height: 1.6; }
.login__host-row { display: flex; align-items: center; gap: 10rpx; margin-top: 14rpx; }
.login__chip {
  flex-shrink: 0;
  margin: 0;
  padding: 0 18rpx;
  height: 56rpx;
  line-height: 56rpx;
  border-radius: 999rpx;
  background: rgba(0, 214, 178, 0.16);
  color: #7ff0dd;
  font-size: 20rpx;
  border: 1rpx solid rgba(0, 214, 178, 0.3);
}
.login__chip::after { border: none; }
.login__chip--ghost { background: rgba(255, 255, 255, 0.08); color: rgba(255, 255, 255, 0.7); border-color: rgba(255, 255, 255, 0.16); }
.login__input {
  flex: 1;
  min-width: 0;
  height: 56rpx;
  padding: 0 16rpx;
  border-radius: 999rpx;
  background: rgba(255, 255, 255, 0.08);
  color: #fff;
  font-size: 22rpx;
}

/* ---- 状态文案 ---- */
.login__status {
  position: relative;
  z-index: 2;
  margin-top: 46rpx;
  font-size: 24rpx;
  color: rgba(255, 255, 255, 0.4);
}
.login__detail {
  position: relative;
  z-index: 2;
  margin-top: 10rpx;
  font-size: 22rpx;
  color: #ff9a9c;
  line-height: 1.6;
}

/* ---- 手机号输入 ---- */
.login__phone {
  position: relative;
  z-index: 2;
  margin-top: 40rpx;
  display: flex;
  align-items: center;
  height: 100rpx;
  padding: 0 28rpx;
  border-radius: 24rpx;
  background: rgba(255, 255, 255, 0.08);
  border: 1rpx solid rgba(255, 255, 255, 0.16);
}
.login__phone-cc {
  flex-shrink: 0;
  margin-right: 18rpx;
  font-size: 28rpx;
  color: rgba(255, 255, 255, 0.75);
  font-variant-numeric: tabular-nums;
}
.login__phone-cc::after {
  content: '';
  display: inline-block;
  width: 1rpx;
  height: 32rpx;
  margin-left: 18rpx;
  vertical-align: middle;
  background: rgba(255, 255, 255, 0.18);
}
.login__phone-inp {
  flex: 1;
  min-width: 0;
  height: 100rpx;
  font-size: 32rpx;
  color: #fff;
  letter-spacing: 1rpx;
  font-variant-numeric: tabular-nums;
}
.login__ph { color: rgba(255, 255, 255, 0.32); font-size: 28rpx; }
.login__tip {
  position: relative;
  z-index: 2;
  margin-top: 18rpx;
  text-align: center;
  font-size: 20rpx;
  color: rgba(255, 255, 255, 0.34);
}

/* ---- 主按钮 ---- */
.login__member {
  position: relative;
  z-index: 2;
  margin-top: 28rpx;
  height: 96rpx;
  line-height: 96rpx;
  border-radius: 999rpx;
  background: linear-gradient(135deg, #00d6b2, #19a7f8);
  color: #fff;
  font-size: 30rpx;
  font-weight: 700;
  box-shadow: 0 20rpx 48rpx rgba(0, 184, 160, 0.3);
}
.login__member::after { border: none; }
.login__member[disabled] { opacity: 0.6; box-shadow: none; }

/* ---- 开发账号 ---- */
.login__label {
  position: relative;
  z-index: 2;
  margin-top: 44rpx;
  font-size: 22rpx;
  color: rgba(255, 255, 255, 0.4);
}
.login__merchant {
  position: relative;
  z-index: 2;
  margin-top: 14rpx;
  height: 84rpx;
  line-height: 84rpx;
  border-radius: 20rpx;
  background: rgba(255, 255, 255, 0.08);
  border: 1rpx solid rgba(255, 255, 255, 0.14);
  color: rgba(255, 255, 255, 0.8);
  font-size: 24rpx;
  text-align: left;
  padding: 0 24rpx;
}
.login__merchant::after { border: none; }
</style>
