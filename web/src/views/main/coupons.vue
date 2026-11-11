<template>
  <div class="page">
    <el-card shadow="never">
      <el-form :inline="true" class="page__filter">
        <el-form-item label="券类型">
          <el-select
            v-model="query.ownerType"
            clearable
            placeholder="全部"
            style="width: 140px"
            @change="onSearch"
          >
            <el-option
              v-for="opt in COUPON_OWNER_TYPE_OPTIONS"
              :key="opt.value"
              :label="opt.label"
              :value="opt.value"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="状态">
          <el-select
            v-model="query.status"
            clearable
            placeholder="全部"
            style="width: 130px"
            @change="onSearch"
          >
            <el-option
              v-for="opt in COUPON_TEMPLATE_STATUS_OPTIONS"
              :key="opt.value"
              :label="opt.label"
              :value="opt.value"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="关键词">
          <el-input
            v-model="query.keyword"
            clearable
            placeholder="券名称 / 副标题"
            style="width: 200px"
            @keyup.enter="onSearch"
          />
        </el-form-item>
        <el-form-item>
          <el-button type="primary" :loading="loading" @click="onSearch">查询</el-button>
        </el-form-item>
        <el-form-item v-permission="'coupon:create'">
          <el-button type="primary" plain @click="$router.push('/main/coupons/create')">
            + 新建券模板
          </el-button>
        </el-form-item>
        <el-form-item v-permission="'coupon:issue'">
          <el-button type="success" plain @click="$router.push('/main/coupons/issue')">
            发放代金券
          </el-button>
        </el-form-item>
      </el-form>

      <el-table v-loading="loading" :data="list" border stripe>
        <el-table-column prop="id" label="id" width="80" />
        <el-table-column prop="name" label="券名称" min-width="200" />
        <el-table-column label="归属" width="130">
          <template #default="{ row }">
            <el-tag size="small" :type="row.ownerType === 'MAIN_COUPON' ? 'warning' : 'info'">
              {{ COUPON_OWNER_TYPE[row.ownerType as CouponOwnerType] }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="归属商家" min-width="160">
          <template #default="{ row }">{{ row.ownerMerchantName || '—' }}</template>
        </el-table-column>
        <el-table-column label="面值" width="130">
          <template #default="{ row }">
            {{ row.faceValue }} 元
            <span v-if="row.thresholdAmount > 0" class="page__muted">/ 满{{ row.thresholdAmount }}可用</span>
          </template>
        </el-table-column>
        <el-table-column label="积分兑换" width="130">
          <template #default="{ row }">
            <template v-if="row.pointsCost > 0">
              <b>{{ row.pointsCost }}</b> 分
              <span
                class="page__muted"
                :style="row.exchangeEnabled === false ? { color: '#c0342f' } : undefined"
              >{{ row.exchangeEnabled === false ? '· 已关闭' : '' }}</span>
            </template>
            <span v-else class="page__muted">—</span>
          </template>
        </el-table-column>
        <el-table-column label="已领/库存" width="120">
          <template #default="{ row }">
            <b>{{ row.effectStats?.issuedCount ?? row.issuedCount }}</b>
            <span class="page__muted"> / {{ row.effectStats?.totalStock ?? row.totalStock }}</span>
          </template>
        </el-table-column>
        <el-table-column label="核销数" width="90">
          <template #default="{ row }">
            {{ row.effectStats?.redeemedCount ?? row.usedCount }}
          </template>
        </el-table-column>
        <el-table-column label="带动实付" width="120" align="right">
          <template #default="{ row }">
            <span class="page__money">¥{{ formatMoney(row.effectStats?.drivenPayAmount ?? 0) }}</span>
          </template>
        </el-table-column>
        <el-table-column label="让利总额" width="120" align="right">
          <template #default="{ row }">
            <span class="page__loss">¥{{ formatMoney(row.effectStats?.discountTotal ?? 0) }}</span>
          </template>
        </el-table-column>
        <el-table-column label="有效期" min-width="170">
          <template #default="{ row }">{{ validPeriodText(row) }}</template>
        </el-table-column>
        <el-table-column label="适用范围" width="140">
          <template #default="{ row }">
            {{ COUPON_APPLY_SCOPE[row.applyScope as ApplyScope] }}
            <span v-if="row.applyScope === 'SPECIFIED_STORES'" class="page__muted">
              ({{ row.storeIds.length }})
            </span>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="100">
          <template #default="{ row }">
            <el-tag :type="couponStatusTagType(row.status)" size="small">
              {{ couponStatusLabel(row.status) }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="320" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" @click="$router.push(`/main/coupons/${row.id}`)">
              详情
            </el-button>
            <el-button link type="primary" @click="openEffect(row)">效果明细</el-button>
            <el-button
              v-if="row.status === 'PUBLISHED'"
              v-permission="'coupon:issue'"
              link
              type="success"
              @click="$router.push(`/main/coupons/issue?templateId=${row.id}`)"
            >
              发放
            </el-button>
            <!-- 按钮级权限：编辑只在 DRAFT / UNPUBLISHED 出现（后端 TEMPLATE_NOT_EDITABLE 二次兜底） -->
            <el-button
              v-if="row.editable"
              v-permission="'coupon:edit'"
              link
              type="primary"
              @click="$router.push(`/main/coupons/${row.id}?edit=1`)"
            >
              编辑
            </el-button>
            <el-button
              v-if="row.status !== 'PUBLISHED'"
              v-permission="'coupon:publish'"
              link
              type="success"
              @click="onToggle(row, 'PUBLISHED')"
            >
              上架
            </el-button>
            <el-button
              v-else
              v-permission="'coupon:publish'"
              link
              type="warning"
              @click="onToggle(row, 'UNPUBLISHED')"
            >
              下架
            </el-button>
          </template>
        </el-table-column>
        <template #empty>
          <el-empty description="没有符合条件的券模板" />
        </template>
      </el-table>

      <el-pagination
        class="page__pager"
        background
        layout="total, sizes, prev, pager, next"
        :total="total"
        v-model:current-page="query.page"
        v-model:page-size="query.pageSize"
        :page-sizes="[10, 20, 50]"
        @size-change="load"
        @current-change="load"
      />
    </el-card>

    <el-dialog
      v-model="effectVisible"
      :title="`券效果明细 · ${effectRow?.name ?? ''}`"
      width="860px"
      destroy-on-close
    >
      <div v-if="effectRow?.effectStats" class="page__effect-summary">
        <span>已领 {{ effectRow.effectStats.issuedCount }}/{{ effectRow.effectStats.totalStock }}</span>
        <span>核销 {{ effectRow.effectStats.redeemedCount }}</span>
        <span>带动实付 ¥{{ formatMoney(effectRow.effectStats.drivenPayAmount) }}</span>
        <span>让利 ¥{{ formatMoney(effectRow.effectStats.discountTotal) }}</span>
      </div>
      <el-table v-loading="effectLoading" :data="effectList" border size="small" max-height="420">
        <el-table-column prop="redeemedAt" label="核销时间" min-width="160">
          <template #default="{ row }">{{ formatDt(row.redeemedAt) }}</template>
        </el-table-column>
        <el-table-column label="用户" min-width="140">
          <template #default="{ row }">
            {{ row.userName || '—' }}
            <span class="page__muted">#{{ row.userId }}</span>
          </template>
        </el-table-column>
        <el-table-column prop="code" label="券码" width="140" />
        <el-table-column prop="orderNo" label="订单号" min-width="140" />
        <el-table-column label="订单总额" width="100" align="right">
          <template #default="{ row }">{{ row.totalAmount != null ? `¥${formatMoney(row.totalAmount)}` : '—' }}</template>
        </el-table-column>
        <el-table-column label="实付" width="100" align="right">
          <template #default="{ row }">
            <b v-if="row.payAmount != null">¥{{ formatMoney(row.payAmount) }}</b>
            <span v-else>—</span>
          </template>
        </el-table-column>
        <el-table-column label="让利" width="90" align="right">
          <template #default="{ row }">¥{{ formatMoney(row.discountAmount) }}</template>
        </el-table-column>
        <template #empty>
          <el-empty description="尚无核销记录" :image-size="64" />
        </template>
      </el-table>
      <el-pagination
        class="page__pager"
        background
        layout="total, prev, pager, next"
        :total="effectTotal"
        v-model:current-page="effectPage"
        :page-size="10"
        @current-change="loadEffect"
      />
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { couponTemplateApi } from '@/api/coupon-template';
import type {
  ApplyScope,
  CouponEffectDetailRow,
  CouponOwnerType,
  CouponTemplate,
  CouponTemplateStatus,
} from '@/types/business';
import {
  COUPON_APPLY_SCOPE,
  COUPON_OWNER_TYPE,
  COUPON_OWNER_TYPE_OPTIONS,
  COUPON_TEMPLATE_STATUS_OPTIONS,
  couponStatusLabel,
  couponStatusTagType,
  validPeriodText,
} from '@/utils/dict';

const list = ref<CouponTemplate[]>([]);
const total = ref(0);
const loading = ref(false);

const effectVisible = ref(false);
const effectLoading = ref(false);
const effectRow = ref<CouponTemplate | null>(null);
const effectList = ref<CouponEffectDetailRow[]>([]);
const effectTotal = ref(0);
const effectPage = ref(1);

function formatMoney(n: number) {
  return Number(n || 0).toFixed(2);
}
function formatDt(iso: string) {
  return iso ? iso.replace('T', ' ').slice(0, 19) : '—';
}

async function openEffect(row: CouponTemplate) {
  effectRow.value = row;
  effectPage.value = 1;
  effectVisible.value = true;
  await loadEffect();
}

async function loadEffect() {
  if (!effectRow.value) return;
  effectLoading.value = true;
  try {
    const res = await couponTemplateApi.effectDetails(effectRow.value.id, {
      page: effectPage.value,
      pageSize: 10,
    });
    effectList.value = res.list;
    effectTotal.value = res.total;
  } finally {
    effectLoading.value = false;
  }
}

const query = reactive({
  page: 1,
  pageSize: 10,
  ownerType: '' as CouponOwnerType | '',
  status: '' as CouponTemplateStatus | '',
  keyword: '',
});

async function load() {
  loading.value = true;
  try {
    const res = await couponTemplateApi.list({
      page: query.page,
      pageSize: query.pageSize,
      ownerType: query.ownerType || undefined,
      status: query.status || undefined,
      keyword: query.keyword.trim() || undefined,
    });
    list.value = res.list;
    total.value = res.total;
  } finally {
    loading.value = false;
  }
}

function onSearch() {
  query.page = 1;
  load();
}

/** 上架 / 下架：上架意味着这张券立刻可被发放，所以要有确认 */
async function onToggle(row: CouponTemplate, target: 'PUBLISHED' | 'UNPUBLISHED') {
  const publishing = target === 'PUBLISHED';
  try {
    await ElMessageBox.confirm(
      publishing
        ? `上架后「${row.name}」即可被发放 / 兑换，确认上架？`
        : `下架后「${row.name}」不可再发放，已发放的券不受影响，确认下架？`,
      publishing ? '上架券模板' : '下架券模板',
      { type: publishing ? 'success' : 'warning' },
    );
  } catch {
    return;
  }

  await (publishing ? couponTemplateApi.publish(row.id) : couponTemplateApi.unpublish(row.id));
  ElMessage.success(publishing ? '已上架' : '已下架');
  load();
}

onMounted(load);
</script>

<style scoped>
.page__filter {
  margin-bottom: 4px;
}
.page__pager {
  margin-top: 16px;
  justify-content: flex-end;
}
.page__muted {
  color: #94a3b8;
}
/* 计数与实算不一致：标红，不放过去 */
.page__drift {
  color: #f56c6c;
  font-weight: 600;
}
.page__drift-tag {
  margin-left: 6px;
}
.page__money {
  color: #059669;
  font-variant-numeric: tabular-nums;
}
.page__loss {
  color: #dc2626;
  font-variant-numeric: tabular-nums;
}
.page__effect-summary {
  display: flex;
  flex-wrap: wrap;
  gap: 16px;
  margin-bottom: 12px;
  font-size: 13px;
  color: #475569;
}
</style>
