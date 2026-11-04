import { defineStore } from 'pinia';
import { dropSticky, readSticky, writeSticky } from '@/utils/sticky';

export type AiChatMsg = { role: 'ai' | 'user'; text: string };

const CHAT_KEY = 'mini_ai_chat';
const MAX_MESSAGES = 50;

/** 商家 AI 面板会话：切底栏不丢消息，杀进程后也能恢复最近 50 条。 */
export const useAiChatStore = defineStore('ai-chat', {
  state: () => ({
    messages: [] as AiChatMsg[],
    seeded: false,
    statusHint: '准备中',
    storeName: '',
    sessionId: null as string | null,
    input: '',
    sending: false,
  }),
  actions: {
    push(role: 'ai' | 'user', text: string) {
      this.messages = [...this.messages, { role, text }].slice(-MAX_MESSAGES);
      this.persist();
    },
    seedWelcome(text: string) {
      this.messages = [{ role: 'ai', text }];
      this.seeded = true;
      this.persist();
    },
    /** 从本地存储恢复历史对话（幂等，重复调用无副作用）。 */
    hydrate() {
      const saved = readSticky<AiChatMsg[]>(CHAT_KEY);
      if (Array.isArray(saved) && saved.length && !this.messages.length) {
        this.messages = saved.slice(-MAX_MESSAGES);
        this.seeded = true;
      }
    },
    persist() {
      writeSticky(CHAT_KEY, this.messages.slice(-MAX_MESSAGES));
    },
    reset() {
      this.messages = [];
      this.seeded = false;
      this.statusHint = '准备中';
      this.storeName = '';
      this.sessionId = null;
      this.input = '';
      this.sending = false;
      dropSticky(CHAT_KEY);
    },
  },
});
