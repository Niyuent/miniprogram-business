<script setup lang="ts">
import { onLaunch } from '@dcloudio/uni-app';

onLaunch(() => {
  console.log('商盟小程序启动');
});
</script>

<style>
page {
  background: #e7eef8;
  color: #0b1220;
  font-size: 28rpx;
}
.press {
  opacity: 0.72;
}
button[disabled] {
  opacity: 0.55;
}
</style>
