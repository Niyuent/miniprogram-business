<template>
  <el-dialog
    :model-value="modelValue"
    title="发布通知"
    width="720px"
    :close-on-click-modal="false"
    :before-close="onBeforeClose"
    @open="onOpen"
    @closed="resetForm"
  >
    <el-form
      ref="formRef"
      :model="form"
      :rules="rules"
      label-width="88px"
      :disabled="submitting"
      @submit.prevent
    >
      <!-- 目标类型：四选一 -->
      <el-form-item label="目标类型" prop="targetType">
        <el-radio-group v-model="form.targetType" :disabled="submitting" @change="onTargetTypeChange">
          <el-radio-button value="MERCHANT">指定商家</el-radio-button>
          <el-radio-button value="STORE">指定门店</el-radio-button>
          <el-radio-button value="ALL_MERCHANTS">全部附属商家</el-radio-button>
          <el-radio-button value="ALL_STORES">全部门店</el-radio-button>
        </el-radio-group>
      </el-form-item>

      <!-- 目标选择：仅「指定」类显示；ALL_* 自动隐藏 -->
      <el-form-item v-if="needTargets" label="选择目标" prop="targetIds">
        <el-select
          v-model="form.targetIds"
          multiple
          filterable
          :loading="targetsLoading"
          :placeholder="form.targetType === 'MERCHANT' ? '请选择附属商家（可多选）' : '请选择门店（可多选，可按商家分组）'"
          style="width: 100%"
        >
          <el-option-group v-if="form.targetType === 'STORE'" v-for="m in storeGroups" :key="m.id" :label="m.name">
            <el-option
              v-for="s in m.stores"
              :key="s.id"
              :label="`${s.name}${s.code ? `（${s.code}）` : ''}`"
              :value="s.id"
            />
          </el-option-group>
          <el-option
            v-for="m in targets.merchants"
            v-else
            :key="m.id"
            :label="`${m.name}${m.code ? `（${m.code}）` : ''}`"
            :value="m.id"
          />
        </el-select>
        <div class="dialog__hint">
          共 {{ targetOptions.length }} 个可选{{ form.targetType === 'MERCHANT' ? '附属商家' : '门店' }}，已选
          {{ form.targetIds.length }} 个（单次最多 200）
        </div>
      </el-form-item>

      <!-- 标题 -->
      <el-form-item label="标题" prop="title">
        <el-input
          v-model="form.title"
          maxlength="50"
          show-word-limit
          placeholder="一句话说明这份通知（≤50 字）"
        />
      </el-form-item>

      <!-- 内容 -->
      <el-form-item label="内容" prop="content">
        <el-input
          v-model="form.content"
          type="textarea"
          :rows="5"
          maxlength="500"
          show-word-limit
          placeholder="正文内容（≤500 字），接收方在通知中心可查看全文"
        />
      </el-form-item>

      <!-- 类型 -->
      <el-form-item label="类型" prop="type">
        <el-select v-model="form.type" style="width: 200px">
          <el-option
            v-for="(label, value) in NOTIFICATION_TYPE_LABELS"
            :key="value"
            :label="label"
            :value="value"
          />
        </el-select>
      </el-form-item>

      <!-- 级别 -->
      <el-form-item label="级别" prop="level">
        <el-select v-model="form.level" style="width: 200px">
          <el-option v-for="(label, value) in NOTIFY_LEVEL_LABELS" :key="value" :label="label" :value="value" />
        </el-select>
        <span class="dialog__level-tip">「紧急」会在接收方列表里以红色标签展示</span>
      </el-form-item>

      <!-- 发送预估 -->
      <el-form-item v-if="previewCount > 0" label="发送预估">
        <el-alert type="info" :closable="false" :title="previewText" />
      </el-form-item>
    </el-form>

    <template #footer>
      <el-button :disabled="submitting" @click="onCancel">取 消</el-button>
      <el-button type="primary" :loading="submitting" @click="onSubmit">发 送</el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { computed, reactive, ref } from 'vue';
import { ElMessage, ElMessageBox, type FormInstance, type FormRules } from 'element-plus';
import {
  NOTIFICATION_TYPE_LABELS,
  NOTIFY_LEVEL_LABELS,
  notificationApi,
  type NotificationTargets,
  type NotificationTargetType,
  type NotificationType,
  type NotifyLevel,
} from '@/api/notification';

const props = defineProps<{ modelValue: boolean }>();
const emit = defineEmits<{
  (e: 'update:modelValue', v: boolean): void;
  /** 发送成功：父组件据此刷新发件箱 / 同步未读数 */
  (e: 'sent', payload: { count: number; sendBatchId: string }): void;
}>();

const formRef = ref<FormInstance>();
const submitting = ref(false);
const targetsLoading = ref(false);
const targets = ref<NotificationTargets>({ merchants: [], stores: [] });

const form = reactive<{
  targetType: NotificationTargetType;
  targetIds: number[];
  title: string;
  content: string;
  type: NotificationType;
  level: NotifyLevel;
}>({
  targetType: 'MERCHANT',
  targetIds: [],
  title: '',
  content: '',
  type: 'SYSTEM',
  level: 'NORMAL',
});

const rules: FormRules = {
  targetType: [{ required: true, message: '请选择目标类型', trigger: 'change' }],
  targetIds: [
    {
      validator: (_r, value: number[], cb) => {
        if (!needTargets.value) return cb();
        if (!value?.length) return cb(new Error(needTargets.value ? '请至少选择一个目标' : ''));
        if (value.length > 200) return cb(new Error('单次最多选择 200 个目标'));
        cb();
      },
      trigger: 'change',
    },
  ],
  title: [
    { required: true, message: '请填写标题', trigger: 'blur' },
    { max: 50, message: '标题不能超过 50 字', trigger: 'blur' },
  ],
  content: [
    { required: true, message: '请填写内容', trigger: 'blur' },
    { max: 500, message: '内容不能超过 500 字', trigger: 'blur' },
  ],
};

/** 是否需要展示目标选择器（指定商家 / 指定门店） */
const needTargets = computed(() => form.targetType === 'MERCHANT' || form.targetType === 'STORE');

/** 当前目标类型对应的候选列表 */
const targetOptions = computed(() => (form.targetType === 'STORE' ? targets.value.stores : targets.value.merchants));

/** 门店按所属商家分组（后端 stores 带 merchantId） */
const storeGroups = computed(() => {
  const merchantName = new Map(targets.value.merchants.map((m) => [m.id, m.name]));
  const groups = new Map<number, { id: number; name: string; stores: NotificationTargets['stores'] }>();
  for (const s of targets.value.stores) {
    if (!groups.has(s.merchantId)) {
      groups.set(s.merchantId, { id: s.merchantId, name: merchantName.get(s.merchantId) ?? `商家 #${s.merchantId}`, stores: [] });
    }
    groups.get(s.merchantId)!.stores.push(s);
  }
  return [...groups.values()];
});

/** 预计接收方数量：ALL_* = 候选全集；指定类 = 已选数量 */
const previewCount = computed(() => {
  if (form.targetType === 'ALL_MERCHANTS') return targets.value.merchants.length;
  if (form.targetType === 'ALL_STORES') return targets.value.stores.length;
  return form.targetIds.length;
});

const previewText = computed(() => {
  const label =
    form.targetType === 'ALL_MERCHANTS'
      ? '全部已审核附属商家'
      : form.targetType === 'ALL_STORES'
        ? '全部营业中门店'
        : form.targetType === 'MERCHANT'
          ? '指定附属商家'
          : '指定门店';
  return `将发送给「${label}」下的 ${previewCount.value} 个接收方（每人一条，已读状态各自独立）`;
});

/** 表单是否被改过（用于关闭前确认） */
function isDirty() {
  return (
    form.title.trim() !== '' ||
    form.content.trim() !== '' ||
    form.targetIds.length > 0 ||
    form.targetType !== 'MERCHANT' ||
    form.type !== 'SYSTEM' ||
    form.level !== 'NORMAL'
  );
}

function resetForm() {
  formRef.value?.clearValidate();
  form.targetType = 'MERCHANT';
  form.targetIds = [];
  form.title = '';
  form.content = '';
  form.type = 'SYSTEM';
  form.level = 'NORMAL';
}

/**
 * 每次打开弹窗都重新拉取 targets（**刻意不缓存**）：
 * 可发布范围会随附属停用 / 审核状态实时变化，缓存会出现「前端选得到 → 后端拒绝」。
 */
async function onOpen() {
  resetForm();
  targetsLoading.value = true;
  try {
    targets.value = await notificationApi.targets();
  } catch (e) {
    ElMessage.error((e as Error).message || '加载可发布目标失败');
    targets.value = { merchants: [], stores: [] };
  } finally {
    targetsLoading.value = false;
  }
}

/** 切换目标类型：清空已选（避免把门店 id 当成商家 id 提交） */
function onTargetTypeChange() {
  form.targetIds = [];
  formRef.value?.clearValidate(['targetIds']);
}

/** X / ESC：有填写内容时先确认 */
function onBeforeClose(done: () => void) {
  if (submitting.value) return; // 发送中不允许关闭
  if (!isDirty()) return done();
  ElMessageBox.confirm('确认放弃填写？', '提示', { type: 'warning' })
    .then(() => done())
    .catch(() => undefined);
}

function onCancel() {
  if (submitting.value) return;
  if (!isDirty()) {
    emit('update:modelValue', false);
    return;
  }
  ElMessageBox.confirm('确认放弃填写？', '提示', { type: 'warning' })
    .then(() => emit('update:modelValue', false))
    .catch(() => undefined);
}

async function onSubmit() {
  if (submitting.value) return;
  try {
    await formRef.value?.validate();
  } catch {
    return; // 校验失败：Element 已自动定位到第一个错误项
  }
  if (!previewCount.value) {
    ElMessage.warning('没有符合条件的接收方');
    return;
  }

  submitting.value = true;
  try {
    const res = await notificationApi.send({
      targetType: form.targetType,
      // ALL_* 传空数组（后端对 ALL_* 且 targetIds 非空会 400）
      targetIds: needTargets.value ? form.targetIds : [],
      title: form.title.trim(),
      content: form.content.trim(),
      type: form.type,
      level: form.level,
    });
    ElMessage.success(`发布成功，已发送给 ${res.count} 个接收方`);
    emit('sent', { count: res.count, sendBatchId: res.sendBatchId });
    emit('update:modelValue', false);
  } catch (e) {
    ElMessage.error((e as Error).message || '发布失败');
  } finally {
    submitting.value = false;
  }
}

// 避免 props 未使用的告警（modelValue 由 el-dialog 消费）
void props;
</script>

<style scoped>
.dialog__hint {
  font-size: 12px;
  color: #94a3b8;
  line-height: 1.6;
}
.dialog__level-tip {
  margin-left: 12px;
  font-size: 12px;
  color: #94a3b8;
}
</style>
