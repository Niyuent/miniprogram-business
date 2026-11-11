<template>
  <el-dialog v-model="visible" title="邀请附属商家入驻" width="600px" align-center @open="drawQr">
    <div class="invite">
      <div class="invite__qr">
        <img v-if="qrUrl" :src="qrUrl" width="200" height="200" alt="入驻申请二维码" />
      </div>
      <div class="invite__side">
        <p class="invite__lead">发送以下链接给商家，或让商家扫码填写入驻资料。</p>
        <el-input :model-value="applyUrl" readonly />
        <el-button type="primary" @click="copyLink">复制链接</el-button>
        <p class="invite__note">商家提交后，会自动出现在您的「入驻审核」列表中。</p>
      </div>
    </div>
  </el-dialog>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { ElMessage } from 'element-plus';
import QRCode from 'qrcode';

const visible = defineModel<boolean>({ default: false });
const qrUrl = ref('');

const applyUrl = computed(() => `${window.location.origin}/apply`);

async function drawQr() {
  qrUrl.value = await QRCode.toDataURL(applyUrl.value, {
    width: 200,
    margin: 1,
    color: { dark: '#0f172a', light: '#ffffff' },
  });
}

async function copyLink() {
  try {
    await navigator.clipboard.writeText(applyUrl.value);
    ElMessage.success('链接已复制');
  } catch {
    ElMessage.error('复制失败，请手动选择链接');
  }
}
</script>

<style scoped>
.invite {
  display: flex;
  gap: 28px;
  align-items: center;
}
.invite__qr {
  flex: none;
  padding: 16px;
  background: #fff;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  line-height: 0;
}
.invite__qr img {
  display: block;
  width: 200px;
  height: 200px;
}
.invite__side {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 12px;
  align-items: flex-start;
}
.invite__lead {
  margin: 0;
  color: #1e293b;
  line-height: 1.6;
}
.invite__note {
  margin: 0;
  color: #64748b;
  font-size: 13px;
  line-height: 1.6;
}
</style>
