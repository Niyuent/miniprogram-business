<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import { storeToRefs } from 'pinia';
import { useSessionStore } from '@/stores/session';
import { fetchFinance, fetchWorkbench } from '@/services/merchant';
import {
  localMorningCopy,
  zeroChat,
  zeroCreatePoster,
  zeroGenerateCopy,
  zeroParseExpense,
  zeroRecognizeMenu,
} from '@/services/xiao-z';
import { friendlyMessage } from '@/utils/errors';
import { useDeskStore } from '@/stores/desk';
import { useAiChatStore } from '@/stores/ai-chat';

const props = defineProps<{ active?: boolean }>();
const session = useSessionStore();
const chat = useAiChatStore();
const {
  messages,
  statusHint,
  storeName,
  storeId,
  input,
  posterProduct,
  sending,
} = storeToRefs(chat);

const scrollInto = ref('');
const chips = ['今天核销多少', '今天发了多少积分', '写个促销文案', '健康分怎么样'];

const lastAnchor = computed(() => `msg-${messages.value.length - 1}`);

async function scrollBottom() {
  await nextTick();
  scrollInto.value = '';
  await nextTick();
  scrollInto.value = lastAnchor.value;
}

function pushAi(text: string, imageUrl?: string) {
  chat.push('ai', text, imageUrl);
  scrollBottom();
}

function pushUser(text: string) {
  chat.push('user', text);
  scrollBottom();
}

async function prepare(forceWelcome = false) {
  statusHint.value = '读取中';
  try {
    const [wb, finance] = await Promise.all([
      fetchWorkbench(),
      fetchFinance().catch(() => null),
    ]);
    storeName.value = wb.storeName || wb.merchantName;
    storeId.value = wb.storeId;
    const copy = localMorningCopy({
      greeting: wb.greeting,
      bossName: wb.bossName,
      redemptions: wb.today.redemptions,
      pointsIssued: wb.today.pointsIssued,
      score: finance?.has_data ? finance.score : null,
      hasData: !!finance?.has_data || wb.today.redemptions > 0 || wb.today.pointsIssued > 0,
    });
    if (forceWelcome || !chat.seeded) {
      chat.seedWelcome(
        `${copy.headline}\n${copy.advice}\n\n需要我帮你看今日核销，写促销文案，或生成一张 AI 海报吗？`,
      );
    }
    statusHint.value = '在线';
  } catch (error) {
    statusHint.value = '离线摘要';
    if (forceWelcome || !chat.seeded) {
      chat.seedWelcome(
        `你好，我是小Z。\n${friendlyMessage(error, '经营数据暂时读不到')}。四大金刚仍可尝试调用 Zero（需本机 8001 已启动）。`,
      );
    }
  } finally {
    uni.stopPullDownRefresh();
    scrollBottom();
  }
}

async function ask(text: string) {
  const message = text.trim();
  if (!message || sending.value) return;
  sending.value = true;
  pushUser(message);
  input.value = '';
  try {
    if (/促销文案|写个文案|文案/.test(message)) {
      const copy = await zeroGenerateCopy(message);
      if (copy.ok) {
        pushAi(copy.reply);
        return;
      }
    }
    const result = await zeroChat(message, storeId.value);
    if (result.ok) {
      pushAi(result.reply);
    } else {
      const wb = await fetchWorkbench().catch(() => null);
      const finance = await fetchFinance().catch(() => null);
      if (wb) {
        const copy = localMorningCopy({
          greeting: wb.greeting,
          bossName: wb.bossName,
          redemptions: wb.today.redemptions,
          pointsIssued: wb.today.pointsIssued,
          score: finance?.has_data ? finance.score : null,
          hasData: !!finance?.has_data || wb.today.redemptions > 0 || wb.today.pointsIssued > 0,
        });
        pushAi(`（本地降级）${copy.headline}\n${copy.advice}\n\n关于「${message}」：Zero 未接通时用商盟今日数字回答。`);
      } else {
        pushAi('暂时连不上后端。请确认商盟 API 与 Zero（8001）后重试。');
      }
    }
  } catch (error) {
    pushAi(friendlyMessage(error, '回答失败，请稍后再试'));
  } finally {
    sending.value = false;
  }
}

function onChip(text: string) {
  ask(text);
}

function submit() {
  ask(input.value);
}

function chooseImage(): Promise<string> {
  return new Promise((resolve, reject) => {
    uni.chooseImage({
      count: 1,
      sizeType: ['compressed'],
      sourceType: ['album', 'camera'],
      success(res) {
        const path = res.tempFilePaths?.[0];
        if (!path) reject(new Error('没有选到图片'));
        else resolve(path);
      },
      fail(err) {
        if (/cancel/i.test(err.errMsg || '')) reject(new Error('已取消'));
        else reject(new Error(err.errMsg || '选图失败'));
      },
    });
  });
}

async function runExpense() {
  if (sending.value) return;
  sending.value = true;
  pushUser('拍照记账');
  try {
    const path = await chooseImage();
    pushAi('正在识别小票…');
    const result = await zeroParseExpense(path);
    if (!result.ok) {
      pushAi(`记账识别失败：${result.message}\n请确认 Zero 已启动，并使用 content_demo 账号可登录。`);
      return;
    }
    if (!result.items.length) {
      pushAi(result.message);
      return;
    }
    const lines = result.items.slice(0, 8).map((item, i) => {
      const amount = item.amount != null ? `¥${item.amount}` : '';
      const cat = item.category || item.type || '支出';
      const note = item.note || '';
      return `${i + 1}. ${cat} ${amount} ${note}`.trim();
    });
    pushAi(`${result.message}\n${lines.join('\n')}\n\n（预览结果，未自动入账；可在 Zero Web 端确认提交）`);
  } catch (error) {
    if (!(error instanceof Error && error.message === '已取消')) {
      pushAi(friendlyMessage(error, '拍照记账失败'));
    }
  } finally {
    sending.value = false;
  }
}

async function runMenu() {
  if (sending.value) return;
  sending.value = true;
  pushUser('拍菜单录入');
  try {
    const path = await chooseImage();
    pushAi('正在识别菜单…');
    const result = await zeroRecognizeMenu(path);
    if (!result.ok) {
      pushAi(`菜单识别失败：${result.message}`);
      return;
    }
    if (!result.dishes.length) {
      pushAi(result.message);
      return;
    }
    const lines = result.dishes.slice(0, 12).map((d, i) => {
      const price = d.price != null ? `¥${d.price}` : '';
      return `${i + 1}. ${d.name || '菜品'} ${price}`.trim();
    });
    pushAi(`${result.message}\n${lines.join('\n')}\n\n（仅预填，未写入菜品库）`);
  } catch (error) {
    if (!(error instanceof Error && error.message === '已取消')) {
      pushAi(friendlyMessage(error, '拍菜单失败'));
    }
  } finally {
    sending.value = false;
  }
}

async function runPoster() {
  if (sending.value) return;
  const product = (posterProduct.value || storeName.value || '今日主推').trim();
  uni.showModal({
    title: 'AI 海报',
    content: `将为「${product}」生成海报。可先在下方输入框改产品名再点海报；也可选一张参考图。`,
    confirmText: '直接生成',
    cancelText: '选参考图',
    success: async (res) => {
      if (sending.value) return;
      sending.value = true;
      pushUser(`AI 海报 · ${product}`);
      try {
        let filePath = '';
        if (!res.confirm) {
          try {
            filePath = await chooseImage();
          } catch (error) {
            if (error instanceof Error && error.message === '已取消') {
              sending.value = false;
              return;
            }
            throw error;
          }
        }
        pushAi('正在生成海报，可能需要几十秒…');
        const result = await zeroCreatePoster({
          productName: product,
          filePath: filePath || undefined,
        });
        if (!result.ok) {
          pushAi(`海报失败：${result.message}\n请确认小Z经营助手已在 8001 启动，且生图引擎（Liblib）可用。`);
          return;
        }
        pushAi('海报已生成，可长按预览图保存。', result.imageUrl);
      } catch (error) {
        pushAi(friendlyMessage(error, '海报生成失败'));
      } finally {
        sending.value = false;
      }
    },
  });
}

function previewImage(url: string) {
  if (!url) return;
  uni.previewImage({ urls: [url], current: url });
}

function goVerify() {
  useDeskStore().merchant = 'verify';
}

const desk = useDeskStore();
watch(() => desk.pull, () => {
  if (props.active) prepare(true);
});

watch(
  () => props.active,
  (on) => {
    if (!on) return;
    session.hydrate();
    prepare(false);
    scrollBottom();
  },
  { immediate: true },
);
</script>

<template>
  <view class="page">
    <scroll-view
      class="scroll"
      scroll-y
      :show-scrollbar="false"
      :scroll-into-view="scrollInto"
      scroll-with-animation
    >
      <view class="ai-head">
        <view class="top">
          <view class="orb"><text class="orb__t">Z</text></view>
          <view class="meta">
            <text class="n">小Z 智能助手</text>
            <view class="s">
              <view class="online"></view>
              <text>{{ statusHint }} · {{ storeName || '本店' }}</text>
            </view>
          </view>
        </view>
        <view class="caps">
          <text class="cap">看得懂经营</text>
          <text class="cap">算得清核销</text>
        </view>
      </view>

      <view class="chat">
        <view
          v-for="(msg, idx) in messages"
          :id="`msg-${idx}`"
          :key="idx"
          class="msg"
          :class="msg.role === 'user' ? 'is-user' : 'is-ai'"
        >
          <view v-if="msg.role === 'ai'" class="ai-avatar"><text>Z</text></view>
          <view class="bubble-wrap">
            <text class="bubble">{{ msg.text }}</text>
            <image
              v-if="msg.imageUrl"
              class="poster"
              :src="msg.imageUrl"
              mode="widthFix"
              @tap="previewImage(msg.imageUrl)"
            />
          </view>
        </view>
        <view v-if="sending" id="msg-typing" class="msg is-ai">
          <view class="ai-avatar"><text>Z</text></view>
          <text class="bubble typing">小Z 处理中…</text>
        </view>
      </view>

      <view class="ask-chips">
        <text v-for="chip in chips" :key="chip" class="chip" @tap="onChip(chip)">{{ chip }}</text>
      </view>

      <text class="section-title">四大金刚 · 一句话搞定</text>
      <view class="gang">
        <view class="g-btn" @tap="runExpense">
          <view class="gi teal"><text>拍</text></view>
          <text class="gt">拍照记账</text>
          <text class="gd">拍小票，AI 帮你记</text>
        </view>
        <view class="g-btn" @tap="runMenu">
          <view class="gi blue"><text>菜</text></view>
          <text class="gt">拍菜单录入</text>
          <text class="gd">一键识别菜品</text>
        </view>
        <view class="g-btn" @tap="onChip('今天卖了多少')">
          <view class="gi purple"><text>问</text></view>
          <text class="gt">语音问数</text>
          <text class="gd">先用快捷提问</text>
        </view>
        <view class="g-btn" @tap="runPoster">
          <view class="gi warm"><text>海</text></view>
          <text class="gt">AI 海报</text>
          <text class="gd">接小Z海报引擎</text>
        </view>
      </view>
      <view class="scroll-pad"></view>
    </scroll-view>

    <view class="composer">
      <view class="input-bar">
        <input
          v-model="input"
          class="input"
          confirm-type="send"
          placeholder="问小Z，或输入海报产品名"
          :disabled="sending"
          @confirm="submit"
          @blur="posterProduct = input"
        />
        <view class="send" :class="{ on: !!input.trim() && !sending }" @tap="submit"><text>发</text></view>
        <view class="cam" @tap="goVerify"><text>核</text></view>
      </view>
    </view>
  </view>
</template>

<style scoped>
.page {
  position: relative;
  height: 100vh;
  background: #f3f7f8;
  box-sizing: border-box;
  overflow: hidden;
}
.scroll {
  height: 100%;
  box-sizing: border-box;
}
.ai-head {
  padding: 28rpx 32rpx 36rpx;
  background: linear-gradient(135deg, #09303a 0%, #0b2440 100%);
  border-radius: 0 0 48rpx 48rpx;
  color: #fff;
}
.top { display: flex; align-items: center; }
.orb {
  width: 92rpx;
  height: 92rpx;
  border-radius: 28rpx;
  background: linear-gradient(135deg, #00d6b2, #19a7f8);
  display: flex;
  align-items: center;
  justify-content: center;
  margin-right: 20rpx;
  flex-shrink: 0;
}
.orb__t { color: #fff; font-size: 40rpx; font-weight: 800; }
.meta { flex: 1; min-width: 0; }
.n { font-size: 34rpx; font-weight: 800; color: #fff; }
.s {
  margin-top: 8rpx;
  font-size: 22rpx;
  opacity: 0.9;
  display: flex;
  align-items: center;
}
.online {
  width: 12rpx;
  height: 12rpx;
  border-radius: 50%;
  background: #00b8a0;
  margin-right: 10rpx;
  flex-shrink: 0;
}
.caps { margin-top: 24rpx; display: flex; }
.cap {
  padding: 10rpx 18rpx;
  border-radius: 999rpx;
  font-size: 22rpx;
  background: rgba(255, 255, 255, 0.12);
  border: 1px solid rgba(255, 255, 255, 0.18);
  color: #fff;
  margin-right: 12rpx;
}
.chat { padding: 24rpx 32rpx 8rpx; }
.msg { display: flex; margin-bottom: 20rpx; }
.msg.is-user { justify-content: flex-end; }
.ai-avatar {
  width: 64rpx;
  height: 64rpx;
  border-radius: 20rpx;
  flex-shrink: 0;
  background: linear-gradient(135deg, #00d6b2, #19a7f8);
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 800;
  margin-right: 12rpx;
}
.bubble-wrap { max-width: 78%; }
.bubble {
  display: block;
  background: #fff;
  border-radius: 28rpx;
  padding: 20rpx 24rpx;
  font-size: 26rpx;
  line-height: 1.55;
  color: #0e1f26;
  box-shadow: 0 8rpx 24rpx rgba(10, 60, 58, 0.06);
}
.poster {
  margin-top: 12rpx;
  width: 100%;
  border-radius: 20rpx;
  background: #eaf0f2;
}
.msg.is-user .bubble {
  background: linear-gradient(135deg, #00d6b2, #19a7f8);
  color: #fff;
  border-bottom-right-radius: 8rpx;
}
.msg.is-ai .bubble { border-bottom-left-radius: 8rpx; }
.typing { color: #8a9aa3; }
.ask-chips {
  display: flex;
  flex-wrap: wrap;
  padding: 8rpx 24rpx 16rpx;
}
.chip {
  padding: 14rpx 22rpx;
  border-radius: 999rpx;
  background: #fff;
  border: 1px solid #eaf0f2;
  color: #33454f;
  font-size: 24rpx;
  font-weight: 600;
  margin: 8rpx;
}
.section-title {
  display: block;
  padding: 12rpx 32rpx 16rpx;
  font-size: 30rpx;
  font-weight: 700;
  color: #0e1f26;
}
.gang {
  display: flex;
  flex-wrap: wrap;
  padding: 0 24rpx 20rpx;
  box-sizing: border-box;
}
.g-btn {
  width: calc(50% - 16rpx);
  margin: 8rpx;
  background: #fff;
  border-radius: 32rpx;
  padding: 24rpx 20rpx;
  box-sizing: border-box;
  box-shadow: 0 8rpx 24rpx rgba(10, 60, 58, 0.05);
}
.gi {
  width: 64rpx;
  height: 64rpx;
  border-radius: 20rpx;
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 800;
  font-size: 26rpx;
}
.gi.teal { background: linear-gradient(135deg, #00d6b2, #0fa98f); }
.gi.blue { background: linear-gradient(135deg, #2e90ff, #1c6fe0); }
.gi.purple { background: linear-gradient(135deg, #7c5cff, #5b3ce0); }
.gi.warm { background: linear-gradient(135deg, #ff8a5b, #ff5f6d); }
.gt {
  display: block;
  margin-top: 14rpx;
  font-size: 28rpx;
  font-weight: 700;
  color: #0e1f26;
}
.gd {
  display: block;
  margin-top: 6rpx;
  font-size: 22rpx;
  color: #8a9aa3;
}
/* 为固定输入栏 + 底栏留空，避免最后一条被挡住 */
.scroll-pad { height: 280rpx; }
.composer {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 160rpx;
  z-index: 15;
  padding: 0 32rpx;
  box-sizing: border-box;
  pointer-events: none;
}
.input-bar {
  display: flex;
  align-items: center;
  background: #fff;
  border-radius: 999rpx;
  padding: 12rpx 12rpx 12rpx 28rpx;
  border: 1px solid #eaf0f2;
  box-shadow: 0 8rpx 24rpx rgba(10, 60, 58, 0.12);
  pointer-events: auto;
}
.input { flex: 1; font-size: 26rpx; height: 64rpx; }
.send, .cam {
  width: 64rpx;
  height: 64rpx;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 800;
  font-size: 24rpx;
  margin-left: 12rpx;
  flex-shrink: 0;
}
.send { background: #eaf0f2; color: #8a9aa3; }
.send.on { background: linear-gradient(135deg, #00d6b2, #19a7f8); color: #fff; }
.cam { background: #e8fbf7; color: #00766a; }
</style>
