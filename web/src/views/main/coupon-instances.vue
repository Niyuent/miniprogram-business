<template>
  <div class="page">
    <el-card shadow="never">
      <el-form :inline="true" class="page__filter">
        <el-form-item label="券模板">
          <el-input
            v-model.number="query.templateId"
            clearable
            placeholder="模板 id"
            style="width: 120px"
            @keyup.enter="onSearch"
          />
        </el-form-item>
        <el-form-item label="用户">
          <el-input
            v-model.number="query.userId"
            clearable
            placeholder="C 端用户 id"
            style="width: 120px"
            @keyup.enter="onSearch"
          />
        </el-form-item>
        <el-form-item label="状态">
          <el-select
            v-model="query.status"
            clearable
            placeholder="全部"
            style="width: 120px"
            @change="onSearch"
          >
            <el-option
              v-for="opt in COUPON_INSTANCE_STATUS_OPTIONS"
              :key="opt.value"
              :label="opt.label"
              :value="opt.value"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="券码">
          <el-input
            v-model="query.code"
            clearable
            placeholder="券码片段"
            style="width: 160px"
            @keyup.enter="onSearch"
          />
        </el-form-item>
        <el-form-item label="有效期">
          <el-date-picker
            v-model="query.expireRange"
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
        </el-form-item>
      </el-form>

      <el-table v-loading="loading" :data="list" border stripe>
        <el-table-column prop="id" label="实例 id" width="90" />
        <el-table-column label="券码" min-width="170">
          <template #default="{ row }">
            <span class="page__code">{{ row.code || '-' }}</span>
          </template>
        </el-table-column>
        <el-table-column label="券模板" min-width="180">
          <template #default="{ row }">
            #{{ row.templateId }} {{ row.templateName }}
          </template>
        </el-table-column>
        <el-table-column label="持有用户" min-width="150">
          <template #default="{ row }">
            {{ row.userName || '-' }}<span class="page__muted">（{{ row.userPhone }}）</span>
          </template>
        </el-table-column>
        <el-table-column label="发放方" min-width="150">
          <template #default="{ row }">{{ row.issuerMerchantName || '-' }}</template>
        </el-table-column>
        <el-table-column label="来源" width="110">
          <template #default="{ row }">{{ COUPON_SOURCE[row.source as CouponSource] }}</template>
        </el-table-column>
        <el-table-column label="状态" width="100">
          <template #default="{ row }">
            <el-tag size="small" :type="couponInstanceStatusTagType(row.status)">
              {{ couponInstanceStatusLabel(row.status) }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="获得时间" min-width="165">
          <template #default="{ row }">{{ formatDateTime(row.obtainedAt) }}</template>
        </el-table-column>
        <el-table-column label="有效期至" min-width="165">
          <template #default="{ row }">{{ formatDateTime(row.expireAt) }}</template>
        </el-table-column>
        <el-table-column label="操作" width="150" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" @click="onDetail(row.id)">详情</el-button>
            <el-button
              v-if="row.status === 'UNUSED'"
              v-permission="'coupon:instance:freeze'"
              link
              type="danger"
              @click="onFreeze(row.id, true)"
            >
              冻结
            </el-button>
            <el-button
              v-if="row.status === 'FROZEN'"
              v-permission="'coupon:instance:freeze'"
              link
              type="success"
              @click="onFreeze(row.id, false)"
            >
              解冻
            </el-button>
          </template>
        </el-table-column>
        <template #empty>
          <el-empty description="没有符合条件的券实例" />
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

    <!-- 详情抽屉 -->
    <el-drawer v-model="detailVisible" title="券实例详情" size="480px">
      <el-descriptions v-if="detail" :column="1" border size="small">
        <el-descriptions-item label="实例 id">{{ detail.instance.id }}</el-descriptions-item>
        <el-descriptions-item label="券码">
          <span class="page__code">{{ detail.instance.code }}</span>
        </el-descriptions-item>
        <el-descriptions-item label="券模板">
          #{{ detail.instance.templateId }} {{ detail.instance.templateName }}
        </el-descriptions-item>
        <el-descriptions-item label="面值">
          {{ detail.instance.faceValue }} 元{{
            detail.instance.thresholdAmount > 0 ? `（满 ${detail.instance.thresholdAmount} 可用）` : '（无门槛）'
          }}
        </el-descriptions-item>
        <el-descriptions-item label="持有用户">
          {{ detail.instance.userName || '-' }}（{{ detail.instance.userPhone }}）
        </el-descriptions-item>
        <el-descriptions-item label="发放方">{{ detail.instance.issuerMerchantName || '-' }}</el-descriptions-item>
        <el-descriptions-item label="状态">
          <el-tag size="small" :type="couponInstanceStatusTagType(detail.instance.status)">
            {{ couponInstanceStatusLabel(detail.instance.status) }}
          </el-tag>
        </el-descriptions-item>
        <el-descriptions-item label="获得时间">{{ formatDateTime(detail.instance.obtainedAt) }}</el-descriptions-item>
        <el-descriptions-item label="有效期至">{{ formatDateTime(detail.instance.expireAt) }}</el-descriptions-item>
        <el-descriptions-item label="核销时间">
          {{ detail.instance.usedAt ? formatDateTime(detail.instance.usedAt) : '-' }}
        </el-descriptions-item>
        <el-descriptions-item label="适用范围">
          {{
            detail.instance.applyScope === 'ALL_STORES'
              ? '全部门店'
              : detail.instance.stores.map((s) => s.name).join('、') || '—'
          }}
        </el-descriptions-item>
      </el-descriptions>

      <!-- S2.4：关联的核销记录（含冲正过的），回答「这张券被谁、在哪、哪单核过」 -->
      <el-divider content-position="left">关联核销记录</el-divider>
      <el-table v-if="detail?.instance.redemptions?.length" :data="detail.instance.redemptions" border size="small">
        <el-table-column prop="id" label="记录 id" width="80" />
        <el-table-column label="状态" width="100">
          <template #default="{ row }">
            <el-tag size="small" :type="redemptionStatusTagType(row.status)">
              {{ redemptionStatusLabel(row.status) }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="核销门店" min-width="130">
          <template #default="{ row }">{{ row.storeName || '-' }}</template>
        </el-table-column>
        <el-table-column label="操作人" min-width="110">
          <template #default="{ row }">{{ row.operatorName || row.operatorId || '-' }}</template>
        </el-table-column>
        <el-table-column label="订单号" min-width="150">
          <template #default="{ row }">{{ row.orderNo || '-' }}</template>
        </el-table-column>
        <el-table-column label="抵扣" width="90">
          <template #default="{ row }">¥{{ row.discountAmount }}</template>
        </el-table-column>
        <el-table-column label="核销时间" min-width="165">
          <template #default="{ row }">{{ formatDateTime(row.redeemedAt) }}</template>
        </el-table-column>
        <el-table-column label="冲正原因" min-width="160">
          <template #default="{ row }">
            <span v-if="row.status === 'REVERSED'">{{ row.reverseReason || '-' }}</span>
            <span v-else class="page__muted">—</span>
          </template>
        </el-table-column>
      </el-table>
      <el-empty v-else description="这张券还没有核销记录" :image-size="70" />

    </el-drawer>
  </div>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { couponInstanceApi } from '@/api/coupon-instance';
import type { CouponInstance, CouponInstanceStatus, CouponSource } from '@/types/business';
import {
  COUPON_INSTANCE_STATUS_OPTIONS,
  COUPON_SOURCE,
  couponInstanceStatusLabel,
  couponInstanceStatusTagType,
  formatDateTime,
  redemptionStatusLabel,
  redemptionStatusTagType,
} from '@/utils/dict';

/**
 * 券实例管理（S2.2）
 *
 * 数据隔离由后端保证：主体看自己拥有 / 创建的模板下的券，附属只看自己发放或自己名下的。
 * 这里不做任何前端过滤 —— 前端过滤等于把「谁的数据可见」这件事复制了一份，迟早与后端不一致。
 */
const list = ref<CouponInstance[]>([]);
const total = ref(0);
const loading = ref(false);
const detailVisible = ref(false);
const detail = ref<Awaited<ReturnType<typeof couponInstanceApi.detail>> | null>(null);


const query = reactive({
  page: 1,
  pageSize: 10,
  templateId: undefined as number | undefined,
  userId: undefined as number | undefined,
  status: '' as CouponInstanceStatus | '',
  code: '',
  expireRange: [] as string[],
});

async function load() {
  loading.value = true;
  try {
    const res = await couponInstanceApi.list({
      page: query.page,
      pageSize: query.pageSize,
      templateId: query.templateId || undefined,
      userId: query.userId || undefined,
      status: query.status || undefined,
      code: query.code.trim() || undefined,
      expireFrom: query.expireRange[0] ? `${query.expireRange[0]}T00:00:00.000Z` : undefined,
      expireTo: query.expireRange[1] ? `${query.expireRange[1]}T23:59:59.000Z` : undefined,
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

async function onDetail(id: number) {
  detail.value = await couponInstanceApi.detail(id);
  detailVisible.value = true;
}

async function onFreeze(id: number, frozen: boolean) {
  try {
    await ElMessageBox.prompt(
      frozen ? '填写冻结原因（写进操作日志）' : '确认解冻该券？解冻后用户可正常核销',
      frozen ? '冻结券实例' : '解冻券实例',
      { inputPlaceholder: '如：疑似黄牛批量领取', inputValidator: frozen ? (v: string) => !!v.trim() || '原因必填' : undefined },
    );
  } catch {
    return;
  }
  const { instance } = await couponInstanceApi.freeze(id, frozen);
  ElMessage.success(`已${frozen ? '冻结' : '解冻'}：${instance.code}`);
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
.page__code {
  font-family: 'SFMono-Regular', Consolas, monospace;
  letter-spacing: 1px;
}
</style>
