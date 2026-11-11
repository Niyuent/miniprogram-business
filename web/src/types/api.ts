/** 后端统一响应：{ code, message, data, traceId } */
export interface ApiResponse<T = unknown> {
  code: number;
  message: string;
  data: T | null;
  traceId?: string;
}

/** 分页结果 */
export interface PageResult<T> {
  list: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface PageQuery {
  page?: number;
  pageSize?: number;
  [key: string]: unknown;
}
