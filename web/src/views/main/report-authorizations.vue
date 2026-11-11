<template>
  <ReportView ref="rv" apiKey="authorizations" :load="reportApi.authorizationLogs">
    <template #default="{ data, keyword, query }">
      <el-card shadow="never" header="授权记录（主体 ↔ 附属）">
        <el-table
          :data="paged(filterByKeyword(data?.list, keyword, ['mainMerchantName', 'subMerchantName']), query.page, query.pageSize)"
          border
          empty-text="暂无数据"
        >
          <el-table-column prop="id" label="ID" width="70" />
          <el-table-column prop="mainMerchantName" label="主体商家" min-width="110" />
          <el-table-column prop="subMerchantName" label="附属商家" min-width="110" />
          <el-table-column prop="status" label="状态" width="90" />
          <el-table-column prop="templateScope" label="范围" width="90" />
          <el-table-column label="券模板" min-width="160">
            <template #default="{ row }">{{ (row.templateNames || []).join(' / ') }}</template>
          </el-table-column>
          <el-table-column prop="grantedAt" label="授权时间" min-width="150" />
          <el-table-column prop="revokedAt" label="撤销时间" min-width="150" />
          <el-table-column prop="revokeReason" label="撤销原因" min-width="140" />
        </el-table>
        <el-pagination
          v-model:current-page="query.page"
          v-model:page-size="query.pageSize"
          :total="data?.total || 0"
          layout="total, sizes, prev, pager, next"
          :page-sizes="[10, 20, 50]"
          style="margin-top: 12px; justify-content: flex-end"
          @current-change="rv?.reload()"
          @size-change="rv?.reload()"
        />
      </el-card>
    </template>
  </ReportView>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import ReportView from '@/views/common/ReportView.vue';
import { reportApi } from '@/api/report';
import { filterByKeyword } from '@/utils/report';

const rv = ref();
function paged(arr: unknown[], page: number, size: number) {
  return (arr || []).slice((page - 1) * size, page * size);
}
</script>
