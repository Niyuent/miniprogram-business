import type { Directive, DirectiveBinding } from 'vue';
import { useUserStore } from '@/stores/user';

/** v-permission="'coupon:create'" —— 无权限时移除元素（后端仍有硬校验） */
export const permission: Directive = {
  mounted(el: HTMLElement, binding: DirectiveBinding<string | string[]>) {
    const userStore = useUserStore();
    const codes = Array.isArray(binding.value) ? binding.value : [binding.value];
    const ok = codes.some((c) => userStore.hasPermission(c));
    if (!ok) {
      el.parentNode?.removeChild(el);
    }
  },
};
