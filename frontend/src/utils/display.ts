import type { EnvironmentType, RequestStatus } from '../api';

const requestStatusLabelMap: Record<RequestStatus, string> = {
  pending: '待处理',
  approved: '已批准',
  deploying: '部署中',
  deployed: '已部署',
  rejected: '已驳回',
  failed: '已失败'
};

const environmentLabelMap: Record<EnvironmentType, string> = {
  development: '开发',
  testing: '测试',
  production: '生产'
};

export function formatDateTime(value?: string | null): string {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleString();
}

export function getRequestStatusLabel(status: RequestStatus): string {
  return requestStatusLabelMap[status] || status;
}

export function getEnvironmentLabel(environment: EnvironmentType): string {
  return environmentLabelMap[environment] || environment;
}
