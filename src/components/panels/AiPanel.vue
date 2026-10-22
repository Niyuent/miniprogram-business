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
  zeroListTemplates,
  zeroParseExpense,
  type CreativeTemplate,
} from '@/services/xiao-z';
import { friendlyMessage } from '@/utils/errors';
import { useDeskStore } from '@/stores/desk';
import { useAiChatStore } from '@/stores/ai-chat';
import SlideSheet from '@/components/SlideSheet.vue';

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

const posterSheetOpen = ref(false);
const posterLoadingTpl = ref(false);
const posterTemplates = ref<CreativeTemplate[]>([]);
const posterTplError = ref('');
const selectedTplId = ref('');
const posterSize = ref<'1:1' | '9:16' | '16:9'>('1:1');
const posterLighting = ref('');
const posterTone = ref('');

const selectedTpl = computed(
  () => posterTemplates.value.find((t) => t.id === selectedTplId.value) || null,
);
const lightingOptions = computed(() => {
  const group = selectedTpl.value?.features.find((f) => f.key === 'lighting');
  return group?.options || [];
});
const toneOptions = computed(() => {
  const group = selectedTpl.value?.features.find((f) => f.key === 'tone');
  return group?.options || [];
});

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
        `你好，我是小Z。\n${friendlyMessage(error, '经营数据暂时读不到')}。拍照记账与 AI 海报仍可尝试（需本机 8001 已启动）。`,
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

async function openPosterStyles() {
  if (sending.value) return;
  posterSheetOpen.value = true;
  posterTplError.value = '';
  if (posterTemplates.value.length) return;
  posterLoadingTpl.value = true;
  try {
    const list = await zeroListTemplates();
    posterTemplates.value = list;
    if (!selectedTplId.value) {
      selectedTplId.value = list.find((t) => t.id === 't2')?.id || list[0]?.id || '';
    }
    pickPosterTpl(selectedTplId.value);
  } catch (error) {
    posterTplError.value = friendlyMessage(error, '风格列表加载失败，请确认 Zero 已在 8001 启动');
  } finally {
    posterLoadingTpl.value = false;
  }
}

function pickPosterTpl(id: string) {
  selectedTplId.value = id;
  const tpl = posterTemplates.value.find((t) => t.id === id);
  const light = tpl?.features.find((f) => f.key === 'lighting')?.options?.[0];
  const tone = tpl?.features.find((f) => f.key === 'tone')?.options?.[0];
  posterLighting.value = light?.prompt_value || light?.label || '';
  posterTone.value = tone?.prompt_value || tone?.label || '';
}

function closePosterSheet() {
  posterSheetOpen.value = false;
}

async function runPoster() {
  await openPosterStyles();
}

async function confirmPoster(withRef: boolean) {
  if (sending.value) return;
  const tpl = selectedTpl.value;
  if (!tpl) {
    uni.showToast({ title: '请先选一个风格', icon: 'none' });
    return;
  }
  const product = (posterProduct.value || storeName.value || input.value || '今日主推').trim();
  posterSheetOpen.value = false;
  sending.value = true;
  pushUser(`AI 海报 · ${tpl.name} · ${product}`);
  try {
    let filePath = '';
    if (withRef) {
      try {
        filePath = await chooseImage();
      } catch (error) {
        if (error instanceof Error && error.message === '已取消') {
          sending.value = false;
          posterSheetOpen.value = true;
          return;
        }
        throw error;
      }
    }
    pushAi(`正在用「${tpl.name}」生成海报，可能需要几十秒…`);
    const result = await zeroCreatePoster({
      productName: product,
      templateId: tpl.id,
      filePath: filePath || undefined,
      lighting: posterLighting.value,
      tone: posterTone.value,
      size: posterSize.value,
    });
    if (!result.ok) {
      pushAi(`海报失败：${result.message}\n请确认小Z经营助手已在 8001 启动，且生图引擎（Liblib）可用。`);
      return;
    }
    pushAi(`「${tpl.name}」海报已生成，可长按预览图保存。`, result.imageUrl);
  } catch (error) {
    pushAi(friendlyMessage(error, '海报生成失败'));
  } finally {
    sending.value = false;
  }
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

      <text class="section-title">快捷能力</text>
      <view class="gang">
        <view class="g-btn" @tap="runExpense">
          <view class="gi teal"><text>拍</text></view>
          <text class="gt">拍照记账</text>
          <text class="gd">拍小票，AI 帮你记</text>
        </view>
        <view class="g-btn" @tap="onChip('今天卖了多少')">
          <view class="gi blue"><text>问</text></view>
          <text class="gt">问经营</text>
          <text class="gd">今日核销与积分</text>
        </view>
        <view class="g-btn" @tap="runPoster">
          <view class="gi warm"><text>海</text></view>
          <text class="gt">AI 海报</text>
          <text class="gd">先选风格再生成</text>
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

    <slide-sheet :visible="posterSheetOpen" @close="closePosterSheet">
      <view class="ps">
        <view class="ps__title">选择海报风格</view>
        <view class="ps__sub">与小Z一致 · 共 {{ posterTemplates.length || '—' }} 种，点选后生成</view>
        <view v-if="posterLoadingTpl" class="ps__hint">正在加载风格…</view>
        <view v-else-if="posterTplError" class="ps__err">{{ posterTplError }}</view>
        <scroll-view v-else class="ps__list" scroll-y :show-scrollbar="false">
          <view
            v-for="tpl in posterTemplates"
            :key="tpl.id"
            class="ps__card"
            :class="{ on: selectedTplId === tpl.id }"
            @tap="pickPosterTpl(tpl.id)"
          >
            <view class="ps__thumb" :style="{ background: tpl.thumbColor }">
              <image v-if="tpl.thumbnail" class="ps__img" :src="tpl.thumbnail" mode="aspectFill" />
              <text v-else class="ps__thumb-t">{{ tpl.name.slice(0, 1) }}</text>
            </view>
            <view class="ps__meta">
              <text class="ps__name">{{ tpl.name }}</text>
              <text class="ps__cat">{{ tpl.category }}</text>
              <text class="ps__desc">{{ tpl.description }}</text>
            </view>
            <view v-if="selectedTplId === tpl.id" class="ps__check">✓</view>
          </view>
        </scroll-view>

        <view v-if="selectedTpl" class="ps__opts">
          <text class="ps__opt-label">画幅</text>
          <view class="ps__chips">
            <text
              v-for="size in (['1:1', '9:16', '16:9'] as const)"
              :key="size"
              class="ps__chip"
              :class="{ on: posterSize === size }"
              @tap="posterSize = size"
            >{{ size }}</text>
          </view>
          <text v-if="lightingOptions.length" class="ps__opt-label">光影</text>
          <view v-if="lightingOptions.length" class="ps__chips">
            <text
              v-for="opt in lightingOptions"
              :key="opt.label"
              class="ps__chip"
              :class="{ on: posterLighting === (opt.prompt_value || opt.label) }"
              @tap="posterLighting = opt.prompt_value || opt.label"
            >{{ opt.label }}</text>
          </view>
          <text v-if="toneOptions.length" class="ps__opt-label">色调</text>
          <view v-if="toneOptions.length" class="ps__chips">
            <text
              v-for="opt in toneOptions"
              :key="opt.label"
              class="ps__chip"
              :class="{ on: posterTone === (opt.prompt_value || opt.label) }"
              @tap="posterTone = opt.prompt_value || opt.label"
            >{{ opt.label }}</text>
          </view>
        </view>

        <view class="ps__actions">
          <button class="ps__btn ghost" hover-class="press" :disabled="sending || !selectedTpl" @tap="confirmPoster(true)">
            选参考图生成
          </button>
          <button class="ps__btn primary" hover-class="press" :disabled="sending || !selectedTpl" @tap="confirmPoster(false)">
            直接生成
          </button>
        </view>
      </view>
    </slide-sheet>
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
.ps {
  display: flex;
  flex-direction: column;
  max-height: 78vh;
}
.ps__title {
  font-size: 34rpx;
  font-weight: 800;
  color: #0e1f26;
}
.ps__sub {
  margin-top: 8rpx;
  font-size: 22rpx;
  color: #8a9aa3;
}
.ps__hint,
.ps__err {
  margin-top: 24rpx;
  font-size: 26rpx;
  color: #8a9aa3;
}
.ps__err { color: #c22a2e; }
.ps__list {
  margin-top: 20rpx;
  max-height: 42vh;
  height: 42vh;
}
.ps__card {
  display: flex;
  align-items: flex-start;
  gap: 16rpx;
  padding: 16rpx;
  border-radius: 20rpx;
  border: 1px solid #eaf0f2;
  background: #fff;
  margin-bottom: 12rpx;
  position: relative;
}
.ps__card.on {
  border-color: #00b8a0;
  background: #f0fffb;
  box-shadow: 0 8rpx 24rpx rgba(0, 184, 160, 0.12);
}
.ps__thumb {
  width: 96rpx;
  height: 96rpx;
  border-radius: 16rpx;
  overflow: hidden;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
}
.ps__img { width: 100%; height: 100%; }
.ps__thumb-t { color: #fff; font-size: 36rpx; font-weight: 800; }
.ps__meta { flex: 1; min-width: 0; padding-right: 40rpx; }
.ps__name { display: block; font-size: 28rpx; font-weight: 700; color: #0e1f26; }
.ps__cat {
  display: inline-block;
  margin-top: 6rpx;
  font-size: 20rpx;
  color: #00766a;
  background: #e6f7f4;
  padding: 2rpx 10rpx;
  border-radius: 999rpx;
}
.ps__desc {
  display: block;
  margin-top: 8rpx;
  font-size: 22rpx;
  color: #8a9aa3;
  line-height: 1.4;
}
.ps__check {
  position: absolute;
  right: 16rpx;
  top: 16rpx;
  width: 36rpx;
  height: 36rpx;
  border-radius: 50%;
  background: #00b8a0;
  color: #fff;
  font-size: 22rpx;
  display: flex;
  align-items: center;
  justify-content: center;
}
.ps__opts { margin-top: 8rpx; }
.ps__opt-label {
  display: block;
  margin-top: 12rpx;
  font-size: 22rpx;
  color: #8a9aa3;
}
.ps__chips {
  display: flex;
  flex-wrap: wrap;
  gap: 10rpx;
  margin-top: 8rpx;
}
.ps__chip {
  padding: 8rpx 16rpx;
  border-radius: 999rpx;
  background: #f3f7f8;
  color: #5b6b73;
  font-size: 22rpx;
  border: 1px solid transparent;
}
.ps__chip.on {
  background: #e6f7f4;
  color: #00766a;
  border-color: #99e0d4;
  font-weight: 600;
}
.ps__actions {
  margin-top: 20rpx;
  display: flex;
  gap: 16rpx;
}
.ps__btn {
  flex: 1;
  margin: 0;
  border-radius: 999rpx;
  font-weight: 700;
  font-size: 26rpx;
}
.ps__btn.ghost {
  background: #fff;
  color: #00766a;
  border: 1px solid #eaf0f2;
}
.ps__btn.primary {
  background: linear-gradient(135deg, #00d6b2, #19a7f8);
  color: #fff;
}
</style>
