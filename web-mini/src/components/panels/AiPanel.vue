<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import { storeToRefs } from 'pinia';
import { useSessionStore } from '@/stores/session';
import { fetchWorkbench } from '@/services/merchant';
import { chatAi, fetchYesterdaySummary, formatSummaryCard } from '@/services/ai-chat';
import { friendlyMessage } from '@/utils/errors';
import { useDeskStore } from '@/stores/desk';
import { useAiChatStore } from '@/stores/ai-chat';

const props = defineProps<{ active?: boolean }>();
const session = useSessionStore();
const chat = useAiChatStore();
const { messages, statusHint, storeName, sessionId, input, sending } = storeToRefs(chat);

const scrollInto = ref('');
const chips = ['我昨天赚了多少', '本周券核销如何', '哪些老客没来了'];

const lastAnchor = computed(() => {
  if (!messages.value.length) return '';
  return `msg-${messages.value.length - 1}`;
});

async function scrollBottom() {
  await nextTick();
  scrollInto.value = '';
  await nextTick();
  if (lastAnchor.value) scrollInto.value = lastAnchor.value;
}

function pushAi(text: string) {
  chat.push('ai', String(text || '').trim() || '暂时没有结果');
  scrollBottom();
}

function pushUser(text: string) {
  chat.push('user', text);
  scrollBottom();
}

async function prepare(forceWelcome = false) {
  // 清掉脏输入（热更新/缓存残留）
  input.value = '';
  statusHint.value = '读取中';
  try {
    const wb = await fetchWorkbench();
    storeName.value = wb.storeName || wb.merchantName;
    if (forceWelcome || !chat.seeded) {
      chat.seedWelcome(
        '你好，我是经营助手。\n可以问我昨天营收、本周券核销、流失老客等只读数据。',
      );
    }
    statusHint.value = '在线';
  } catch (error) {
    statusHint.value = '离线';
    if (forceWelcome || !chat.seeded) {
      chat.seedWelcome(
        `你好，我是经营助手。\n${friendlyMessage(error, '门店信息暂时读不到')}。仍可尝试提问经营数据。`,
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
    const result = await chatAi(message, sessionId.value);
    sessionId.value = result.sessionId;
    let answer = String(result.answer || '').trim();
    if (result.card && typeof result.card === 'object' && 'revenue' in result.card) {
      answer = formatSummaryCard(result.card as unknown as Parameters<typeof formatSummaryCard>[0]);
    }
    pushAi(answer);
    statusHint.value = `今日 ${result.quota.usedToday}/${result.quota.limit}`;
  } catch (error) {
    try {
      const summary = await fetchYesterdaySummary();
      const card = summary.items?.[0];
      if (card) {
        pushAi(formatSummaryCard(card));
        statusHint.value = '降级卡片';
        return;
      }
    } catch {
      /* fall through */
    }
    pushAi(friendlyMessage(error, 'AI 暂时不可用，请稍后再试'));
  } finally {
    sending.value = false;
    input.value = '';
  }
}

function onChip(text: string) {
  ask(text);
}

function submit() {
  ask(input.value);
}

const desk = useDeskStore();
watch(
  () => desk.pull,
  () => {
    if (props.active) prepare(true);
  },
);

watch(
  () => props.active,
  (on) => {
    if (!on) return;
    session.hydrate();
    chat.hydrate();
    prepare(false);
    scrollBottom();
  },
  { immediate: true },
);
</script>

<template>
  <view class="page">
    <view class="ai-head">
      <view class="ai-head__glow" />
      <view class="top">
        <view class="orb"><text class="orb__t">AI</text></view>
        <view class="meta">
          <text class="n">经营助手</text>
          <view class="s">
            <view class="online" />
            <text>{{ statusHint }} · {{ storeName || '本店' }}</text>
          </view>
        </view>
      </view>
      <view class="caps">
        <text class="cap">只读问数</text>
        <text class="cap">数字由系统算</text>
      </view>
    </view>

    <scroll-view
      class="scroll"
      scroll-y
      :show-scrollbar="false"
      :scroll-into-view="scrollInto"
      scroll-with-animation
    >
      <view class="chat">
        <view
          v-for="(msg, idx) in messages"
          :id="`msg-${idx}`"
          :key="`m-${idx}-${msg.role}`"
          class="msg"
          :class="msg.role === 'user' ? 'is-user' : 'is-ai'"
        >
          <view v-if="msg.role === 'ai'" class="ai-avatar"><text>AI</text></view>
          <view class="bubble-wrap">
            <text class="bubble">{{ msg.text }}</text>
          </view>
        </view>
        <view v-if="sending" id="msg-typing" class="msg is-ai">
          <view class="ai-avatar"><text>AI</text></view>
          <text class="bubble typing">查询中…</text>
        </view>
      </view>
      <view class="scroll-pad" />
    </scroll-view>

    <view class="ask-chips">
      <text
        v-for="chip in chips"
        :key="chip"
        class="chip"
        @tap="onChip(chip)"
      >{{ chip }}</text>
    </view>

    <view class="composer">
      <input
        v-model="input"
        class="input"
        confirm-type="send"
        placeholder="问经营数据…"
        :disabled="sending"
        maxlength="200"
        @confirm="submit"
      />
      <view
        class="send"
        :class="{ on: !!input.trim() && !sending }"
        @tap="submit"
      ><text>发送</text></view>
    </view>
  </view>
</template>

<style scoped>
.page {
  display: flex;
  flex-direction: column;
  height: 100vh;
  box-sizing: border-box;
  /* 给底部悬浮 TabBar 留空：28 边距 + 108 高 + tag */
  padding-bottom: 180rpx;
  background: #f3f7f8;
  overflow: hidden;
}
.ai-head {
  position: relative;
  overflow: hidden;
  flex-shrink: 0;
  padding: 28rpx 32rpx 30rpx;
  background: linear-gradient(148deg, #07262f 0%, #0a2338 52%, #0d2f4a 100%);
  border-radius: 0 0 44rpx 44rpx;
  color: #fff;
}
.ai-head__glow {
  position: absolute;
  right: -140rpx;
  top: -180rpx;
  width: 400rpx;
  height: 400rpx;
  border-radius: 50%;
  background: radial-gradient(circle, rgba(0, 214, 178, 0.3) 0%, rgba(0, 214, 178, 0) 70%);
}
.top {
  position: relative;
  z-index: 2;
  display: flex;
  align-items: center;
}
.orb {
  width: 80rpx;
  height: 80rpx;
  border-radius: 24rpx;
  background: linear-gradient(135deg, #00d6b2, #19a7f8);
  display: flex;
  align-items: center;
  justify-content: center;
  margin-right: 18rpx;
  flex-shrink: 0;
}
.orb__t {
  color: #fff;
  font-size: 28rpx;
  font-weight: 800;
}
.meta {
  flex: 1;
  min-width: 0;
}
.n {
  font-size: 32rpx;
  font-weight: 800;
  color: #fff;
}
.s {
  margin-top: 6rpx;
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
.caps {
  margin-top: 18rpx;
  display: flex;
}
.cap {
  padding: 8rpx 16rpx;
  border-radius: 999rpx;
  font-size: 20rpx;
  background: rgba(255, 255, 255, 0.12);
  border: 1px solid rgba(255, 255, 255, 0.18);
  color: #fff;
  margin-right: 12rpx;
}
.scroll {
  flex: 1;
  height: 0;
  min-height: 0;
}
.chat {
  padding: 24rpx 32rpx 8rpx;
}
.msg {
  display: flex;
  margin-bottom: 20rpx;
}
.msg.is-user {
  justify-content: flex-end;
}
.ai-avatar {
  width: 56rpx;
  height: 56rpx;
  border-radius: 16rpx;
  flex-shrink: 0;
  background: linear-gradient(135deg, #00d6b2, #19a7f8);
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 800;
  font-size: 20rpx;
  margin-right: 12rpx;
}
.bubble-wrap {
  max-width: 78%;
}
.bubble {
  display: block;
  background: #fff;
  border: 1rpx solid #eef3f4;
  border-radius: 24rpx;
  padding: 18rpx 22rpx;
  font-size: 26rpx;
  line-height: 1.55;
  color: #0e1f26;
  white-space: pre-wrap;
  word-break: break-word;
}
.msg.is-user .bubble {
  background: #07262f;
  border-color: #07262f;
  color: #fff;
  border-bottom-right-radius: 8rpx;
}
.msg.is-ai .bubble {
  border-bottom-left-radius: 8rpx;
}
.typing {
  color: #8a9aa3;
}
.scroll-pad {
  height: 24rpx;
}
.ask-chips {
  flex-shrink: 0;
  display: flex;
  flex-wrap: wrap;
  padding: 8rpx 24rpx 12rpx;
  background: #f3f7f8;
}
.chip {
  padding: 12rpx 20rpx;
  border-radius: 999rpx;
  background: #fff;
  border: 1px solid #eaf0f2;
  color: #33454f;
  font-size: 24rpx;
  font-weight: 600;
  margin: 6rpx;
}
.composer {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 12rpx;
  margin: 0 24rpx 16rpx;
  padding: 12rpx 12rpx 12rpx 16rpx;
  background: #fff;
  border-radius: 999rpx;
  border: 1px solid #eaf0f2;
  box-shadow: 0 8rpx 24rpx rgba(10, 60, 58, 0.1);
}
.input {
  flex: 1;
  min-width: 0;
  font-size: 26rpx;
  height: 64rpx;
}
.send {
  flex-shrink: 0;
  padding: 0 28rpx;
  height: 64rpx;
  border-radius: 999rpx;
  background: #eaf0f2;
  color: #8a9aa3;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 26rpx;
  font-weight: 700;
}
.send.on {
  background: linear-gradient(135deg, #00d6b2, #19a7f8);
  color: #fff;
}
</style>
