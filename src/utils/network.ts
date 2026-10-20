import { ref } from 'vue';

export const networkOffline = ref(false);
let started = false;

export function watchNetwork() {
  if (started) return;
  started = true;
  uni.getNetworkType({
    success(res) {
      networkOffline.value = res.networkType === 'none';
    },
  });
  uni.onNetworkStatusChange((res) => {
    const wasOffline = networkOffline.value;
    networkOffline.value = !res.isConnected;
    if (wasOffline && res.isConnected) {
      uni.showToast({ title: '网络已恢复', icon: 'none' });
    }
  });
}
