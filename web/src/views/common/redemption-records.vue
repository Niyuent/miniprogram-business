<template>
  <div>
    <el-form :inline="true" class="rr__filter">
      <el-form-item label="券码">
        <el-input v-model="q.code" clearable placeholder="券码片段" style="width: 150px" @keyup.enter="onSearch" />
      </el-form-item>
      <el-form-item label="模板">
        <el-input v-model.number="q.templateId" clearable placeholder="模板 id" style="width: 110px" @keyup.enter="onSearch" />
      </el-form-item>
      <el-form-item label="用户">
        <el-input v-model.number="q.userId" clearable placeholder="C 端用户 id" style="width: 110px" @keyup.enter="onSearch" />
      </el-form-item>
      <el-form-item v-if="scope === 'main'" label="商家">
        <el-input v-model.number="q.merchantId" clearable placeholder="商家 id" style="width: 110px" @keyup.enter="onSearch" />
      </el-form-item>
      <el-form-item label="门店">
        <el-input v-model.number="q.storeId" clearable placeholder="门店 id" style="width: 110px" @keyup.enter="onSearch" />
      </el-form-item>
      <el-form-item label="状态">
        <el-select v-model="q.status" clearable placeholder="全部" style="width: 120px" @change="onSearch">
          <el-option v-for="o in REDEMPTION_STATUS_OPTIONS" :key="o.value" :label="o.label" :value="o.value" />
        </el-select>
      </el-form-item>
      <el-form-item label="核销时间">
        <el-date-picker
          v-model="q.range"
          type="daterange"
          value-format="YYYY-MM-DD"
          start-placeholder="开始"
          end-placeholder="结束"
          style="width: 240px"
          @change="onSearch"
        />
      </el-form-item>
      <el-form-item>
        <el-button type="primary" :loading="loading" @click="onSearch">查询</el-button>
        <el-button :disabled="!list.length" @click="onExport">导出 CSV</el-button>
      </el-form-item>
    </el-form>

    <!-- 主体视角：按商家维度分组合计 -->
    <el-table v-if="scope === 'main' && summary.length" :data="summary" border size="small" class="rr__summary">
      <el-table-column prop="merchantName" label="商家" min-width="180" />
      <el-table-column prop="count" label="核销笔数" width="100" />
      <el-table-column label="面值合计" width="120">
        <template #default="{ row }">¥{{ row.faceValueTotal }}</template>
      </el-table-column>
      <el-table-column label="实际抵扣合计" width="130">
        <template #default="{ row }">¥{{ row.discountTotal }}</template>
      </el-table-column>
    </el-table>

    <el-table v-loading="loading" :data="list" border stripe>
      <el-table-column prop="id" label="记录 id" width="90" />
      <el-table-column label="券码" min-width="150">
        <template #default="{ row }"><span class="rr__code">{{ row.code }}</span></template>
      </el-table-column>
      <el-table-column label="券模板" min-width="160">
        <template #default="{ row }">#{{ row.templateId }} {{ row.templateName }}</template>
      </el-table-column>
      <el-table-column label="持有用户" min-width="140">
        <template #default="{ row }">
          {{ row.userName || '-' }}<span class="rr__muted">（{{ row.userPhone }}）</span>
        </template>
      </el-table-column>
      <el-table-column v-if="scope === 'main'" label="核销商家" min-width="150">
        <template #default="{ row }">{{ row.merchantName || '-' }}</template>
      </el-table-column>
      <el-table-column label="核销门店" min-width="140">
        <template #default="{ row }">{{ row.storeName || '-' }}</template>
      </el-table-column>
      <el-table-column label="面值" width="90">
        <template #default="{ row }">¥{{ row.faceValue }}</template>
      </el-table-column>
      <el-table-column label="抵扣" width="90">
        <template #default="{ row }">¥{{ row.discountAmount }}</template>
      </el-table-column>
      <el-table-column label="渠道" width="100">
        <template #default="{ row }">{{ REDEMPTION_CHANNEL[row.channel as RedemptionChannel] }}</template>
      </el-table-column>
      <el-table-column label="状态" width="110">
        <template #default="{ row }">
          <el-tag size="small" :type="redemptionStatusTagType(row.status)">
            {{ redemptionStatusLabel(row.status) }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column label="核销时间" min-width="165">
        <template #default="{ row }">{{ formatDateTime(row.redeemedAt) }}</template>
      </el-table-column>
      <el-table-column label="冲正原因" min-width="180">
        <template #default="{ row }">
          <span v-if="row.status === 'REVERSED'">{{ row.reverseReason || '-' }}</span>
          <span v-else class="rr__muted">—</span>
        </template>
      </el-table-column>
      <el-table-column label="操作" width="110" fixed="right">
        <template #default="{ row }">
          <el-button
            v-if="row.status === 'SUCCESS'"
            v-permission="'redemption:reverse'"
            link
            type="danger"
            @click="onReverse(row.id)"
          >
            冲正
          </el-button>
          <span v-else class="rr__muted">—</span>
        </template>
      </el-table-column>
      <template #empty><el-empty description="暂无核销记录" /></template>
    </el-table>

    <el-pagination
      class="rr__pager"
      background
      layout="total, sizes, prev, pager, next"
      :total="total"
      v-model:current-page="q.page"
      v-model:page-size="q.pageSize"
      :page-sizes="[10, 20, 50]"
      @size-change="load"
      @current-change="load"
    />
  </div>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { redemptionApi } from '@/api/redemption';
import type {
  RedemptionChannel,
  RedemptionRecord,
  RedemptionStatus,
  RedemptionSummary,
} from '@/types/business';
import {
  REDEMPTION_CHANNEL,
  REDEMPTION_STATUS_OPTIONS,
  formatDateTime,
  redemptionStatusLabel,
  redemptionStatusTagType,
} from '@/utils/dict';

/**
 * 核销记录表格（S2.3）
 *
 * `/main/redemptions` 与 `/sub/redemptions` 共用：
 * 数据隔离完全由后端按 JWT 收敛（主体＝自己门店 + 自己模板的核销；附属 / 店员＝本店），
 * 前端不做任何本地过滤，只决定「要不要显示商家列与分组合计」——
 * 附属视角下 summary 永远只有一组，展示了也没意义，故只在主体视角显示。
 */
const props = defineProps<{ scope: 'main' | 'sub' }>();

const list = ref<RedemptionRecord[]>([]);
const summary = ref<RedemptionSummary[]>([]);
const total = ref(0);
const loading = ref(false);

const q = reactive({
  page: 1,
  pageSize: 10,
  code: '',
  templateId: undefined as number | undefined,
  userId: undefined as number | undefined,
  merchantId: undefined as number | undefined,
  storeId: undefined as number | undefined,
  status: '' as RedemptionStatus | '',
  range: [] as string[],
});

async function load() {
  loading.value = true;
  try {
    const res = await redemptionApi.list({
      page: q.page,
      pageSize: q.pageSize,
      code: q.code.trim() || undefined,
      templateId: q.templateId || undefined,
      userId: q.userId || undefined,
      merchantId: props.scope === 'main' ? q.merchantId || undefined : undefined,
      storeId: q.storeId || undefined,
      status: q.status || undefined,
      redeemedFrom: q.range[0] ? `${q.range[0]}T00:00:00.000Z` : undefined,
      redeemedTo: q.range[1] ? `${q.range[1]}T23:59:59.000Z` : undefined,
    });
    list.value = res.list;
    summary.value = res.summary;
    total.value = res.total;
  } finally {
    loading.value = false;
  }
}

function onSearch() {
  q.page = 1;
  load();
}

/**
 * 导出 CSV（**纯前端实现**，不依赖后端 Excel）
 *
 * 导出的是**当前筛选条件下的全部结果**（不受分页限制）：按 pageSize=200（后端分页上限）翻页拉全。
 * 为什么不只导当前页：分页量只有 10 条，导出还按页来会让运营以为自己导出了全部，
 * 结果只拿到第一页——这种「看起来对、其实漏了」的坑比少一个导出功能更糟。
 * 2000 条是刻意的上限：再多就该走后端流式导出了（v2 计划）。
 */
async function onExport() {
  const filters = () => ({
    code: q.code.trim() || undefined,
    templateId: q.templateId || undefined,
    userId: q.userId || undefined,
    merchantId: props.scope === 'main' ? q.merchantId || undefined : undefined,
    storeId: q.storeId || undefined,
    status: q.status || undefined,
    redeemedFrom: q.range[0] ? `${q.range[0]}T00:00:00.000Z` : undefined,
    redeemedTo: q.range[1] ? `${q.range[1]}T23:59:59.000Z` : undefined,
  });

  const EXPORT_LIMIT = 2000;
  const rows: RedemptionRecord[] = [];
  let total = Infinity;
  for (let page = 1; rows.length < total && rows.length < EXPORT_LIMIT; page++) {
    const res = await redemptionApi.list({ page, pageSize: 200, ...filters() });
    rows.push(...res.list);
    total = res.total;
  }

  const header = [
    '记录id', '券码', '券模板id', '券模板', '用户id', '用户', '手机号',
    '核销商家', '核销门店', '面值', '抵扣', '订单号', '渠道', '状态', '冲正原因', '核销时间',
  ];
  const csvRows = rows.map((r) => [
    r.id, r.code, r.templateId, r.templateName ?? '', r.userId, r.userName ?? '', r.userPhone ?? '',
    r.merchantName ?? '', r.storeName ?? '', r.faceValue, r.discountAmount, r.orderNo ?? '',
    REDEMPTION_CHANNEL[r.channel as RedemptionChannel] ?? r.channel,
    redemptionStatusLabel(r.status), r.reverseReason ?? '', formatDateTime(r.redeemedAt),
  ]);

  // CSV 转义：字段里有逗号 / 引号 / 换行时必须包起来并把引号翻倍，否则会串列
  const escape = (v: unknown) => {
    const s = String(v ?? '');
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  // \uFEFF：Excel 打开 UTF-8 CSV 不加 BOM 会乱码，这是踩过的坑
  const csv = '\uFEFF' + [header, ...csvRows].map((row) => row.map(escape).join(',')).join('\r\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `核销记录_${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
  ElMessage.success(`已导出 ${rows.length} 条核销记录`);
}

async function onReverse(id: number) {
  try {
    const { value } = await ElMessageBox.prompt(
      '冲正后券会退回用户（状态回到未使用），订单解绑，记录保留为「已冲正」以便对账。\n原因必填（≥5 字符），会写入核销记录与操作日志。\n超时（24 小时）或跨店的记录需联系主体商家操作。',
      '核销冲正',
      {
        inputPlaceholder: '如：用户取消订单，券退回',
        inputType: 'textarea',
        inputValidator: (v: string) => (v.trim().length >= 5 ? true : '原因必填，且不少于 5 个字符'),
      },
    );
    await redemptionApi.reverse(id, value.trim());
    ElMessage.success('冲正成功，券已退回用户');
    load();
  } catch {
    /* 用户取消 */
  }
}

onMounted(load);
</script>

<style scoped>
.rr__filter {
  margin-bottom: 4px;
}
.rr__summary {
  margin-bottom: 14px;
}
.rr__pager {
  margin-top: 16px;
  justify-content: flex-end;
}
.rr__muted {
  color: #94a3b8;
}
.rr__code {
  font-family: 'SFMono-Regular', Consolas, monospace;
  letter-spacing: 1px;
}
</style>
