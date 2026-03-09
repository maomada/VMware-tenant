import axios, { AxiosError } from 'axios';

export type ApiErrorPayload = { error?: string };

export function getApiErrorMessage(error: unknown, fallback: string): string {
  const axiosError = error as AxiosError<ApiErrorPayload>;
  return axiosError.response?.data?.error || fallback;
}

export type UserRole = 'admin' | 'user';
export type RequestStatus = 'pending' | 'approved' | 'deploying' | 'deployed' | 'rejected' | 'failed';
export type EnvironmentType = 'development' | 'testing' | 'production';
export type GpuStatus = 'available' | 'in_use' | 'reserved' | 'maintenance';

export type AuthUser = {
  id: number;
  username: string;
  email: string;
  role: UserRole;
};

export type LoginResponse = {
  token: string;
  user: AuthUser;
};

export type MeResponse = {
  id: number;
  username: string;
  email: string;
  role: UserRole;
  iat: number;
  exp: number;
};

export type Project = {
  id: number;
  user_id: number;
  name: string;
  project_code: string;
  status: string;
  vcenter_folder_id: string | null;
  vcenter_folder_path: string | null;
  created_at: string;
};

export type CreateProjectPayload = {
  name: string;
  projectCode: string;
};

export type VirtualMachine = {
  id: number;
  project_id: number;
  vcenter_vm_id: string;
  name: string;
  cpu_cores: number;
  memory_gb: number;
  storage_gb: number;
  gpu_count: number;
  gpu_type: string | null;
  status: string;
  bound_at: string | null;
  unbound_at: string | null;
  create_time: string | null;
  end_time: string | null;
  owner: string | null;
  created_at: string;
  project_name?: string;
  project_code?: string;
  username?: string;
};

export type PricingConfig = {
  id: number;
  resource_type: string;
  unit_price: number;
  effective_from: string;
};

export type DailyBill = {
  id: number;
  project_id: number;
  project_name: string;
  project_code: string | null;
  vm_id: number;
  vm_name: string;
  vcenter_vm_id: string;
  bill_date: string;
  cpu_cores: number;
  memory_gb: number;
  storage_gb: number;
  gpu_count: number;
  gpu_type: string | null;
  unit_price: number;
  daily_cost: number;
  username: string;
  created_at: string;
};

export type DailyBillingStat = {
  period: string;
  vm_count: number;
  bill_days: number;
  total_cost: number;
};

export type DailyBillingQuery = {
  startDate?: string;
  endDate?: string;
  projectId?: number;
};

export type StatsQuery = DailyBillingQuery & {
  dimension: 'day' | 'month';
};

export type VmRequestItem = {
  id: number;
  vm_name: string | null;
  template_name: string;
  cpu_cores: number;
  memory_gb: number;
  disk_gb: number;
  requires_gpu: boolean;
  gpu_model: string | null;
  gpu_count: number;
  gpu_assigned_ids?: number[] | null;
  ip_address?: string | null;
  gateway?: string | null;
  dns_servers?: string[] | null;
  deployment_status?: string | null;
  deployment_error?: string | null;
  deployed_at?: string | null;
};

export type ResourceRequestSummary = {
  id: number;
  request_number: string;
  user_id: number;
  user_name: string;
  purpose: string;
  environment: EnvironmentType;
  status: RequestStatus;
  created_at: string;
  approved_at: string | null;
  deployed_at: string | null;
  vm_count: number;
};

export type ResourceRequestDetail = {
  id: number;
  request_number: string;
  user_id: number;
  user_name: string;
  project_id: number | null;
  project_name: string | null;
  purpose: string;
  environment: EnvironmentType;
  status: RequestStatus;
  admin_notes: string | null;
  rejection_reason: string | null;
  approved_at: string | null;
  approved_by: number | null;
  approver_name: string | null;
  deployed_at: string | null;
  created_at: string;
  updated_at: string;
  vm_items: VmRequestItem[];
};

export type PaginatedResult<T> = {
  data: T[];
  pagination: {
    total: number;
    page: number;
    limit: number;
    total_pages: number;
  };
};

export type ListResourceRequestParams = {
  status?: RequestStatus;
  environment?: EnvironmentType;
  page?: number;
  limit?: number;
  search?: string;
};

export type CreateVmItemPayload = {
  template_name: string;
  cpu_cores: number;
  memory_gb: number;
  disk_gb: number;
  requires_gpu: boolean;
  gpu_model?: string;
  gpu_count?: number;
};

export type CreateResourceRequestPayload = {
  purpose: string;
  environment: EnvironmentType;
  project_id?: number;
  vm_items: CreateVmItemPayload[];
};

export type ApproveRequestPayload = { admin_notes?: string };
export type RejectRequestPayload = { rejection_reason: string; admin_notes?: string };

export type DeployVmConfigPayload = {
  vm_item_id: number;
  vm_name?: string;
  template_name?: string;
  datastore?: string;
  vcenter_folder?: string;
};

export type DeployRequestPayload = {
  vm_configs?: DeployVmConfigPayload[];
};

export type DeployRequestResponse = {
  message: string;
  deployment_tasks: Array<{ vm_item_id: number; vm_name: string | null; status: string }>;
};

export type GPURecord = {
  id: number;
  host_id: string;
  host_name: string;
  device_id: string;
  device_name: string;
  gpu_model: string;
  status: GpuStatus;
  allocated_to_vm: string | null;
  allocated_at: string | null;
  last_synced_at: string | null;
  sync_error: string | null;
};

export type GPUInventoryResponse = {
  data: GPURecord[];
  last_synced_at: string | null;
};

export type GPUAvailabilityItem = {
  gpu_model: string;
  total: number;
  available: number;
  in_use: number;
  reserved: number;
  maintenance: number;
};

export type AdminUser = {
  id: number;
  username: string;
  email: string;
  role: UserRole;
  email_verified: boolean;
  status: string;
  created_at: string;
};

export type AdminProject = Project & {
  username: string | null;
  user_email: string | null;
  vm_count: number;
};

export type AdminPricingUpdateItem = {
  resourceType: string;
  unitPrice: number;
};

export type NetworkPool = {
  id: number;
  environment: EnvironmentType;
  network_segment: string;
  gateway: string;
  subnet_mask: string;
  dns_servers: string[];
  ip_range_start: string;
  ip_range_end: string;
  total_ips: number;
  allocated_ips: number;
  is_active: boolean;
  description?: string | null;
  created_at?: string;
  updated_at?: string;
};

export type NetworkPoolPayload = {
  environment: EnvironmentType;
  network_segment: string;
  gateway: string;
  subnet_mask: string;
  dns_servers: string[];
  ip_range_start: string;
  ip_range_end: string;
  is_active?: boolean;
  description?: string;
};

export type NetworkAllocation = {
  id: number;
  ip_address: string;
  status: 'available' | 'allocated' | 'reserved' | string;
  vm_item_id: number | null;
  vm_name: string | null;
  vcenter_vm_id: string | null;
  allocated_at: string | null;
  released_at: string | null;
  request_number: string | null;
};

export type ResourceRequestStats = {
  status_counts: Record<RequestStatus, number>;
  environment_counts: Record<EnvironmentType, number>;
  gpu_usage: Array<{ gpu_model: string; count: number }>;
  daily_requests: Array<{ date: string; count: number }>;
};

const api = axios.create({ baseURL: '/api' });

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

api.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response?.status === 401) {
      localStorage.removeItem('token');
      window.location.href = '/login';
    }
    return Promise.reject(err);
  }
);

function buildDailyBillingExportUrl(params?: DailyBillingQuery): string {
  const query = new URLSearchParams();
  if (params?.startDate) query.set('startDate', params.startDate);
  if (params?.endDate) query.set('endDate', params.endDate);
  if (typeof params?.projectId === 'number') query.set('projectId', String(params.projectId));
  const queryString = query.toString();
  return queryString ? `/api/daily-billing/export?${queryString}` : '/api/daily-billing/export';
}

export const auth = {
  register: (email: string, password: string) => api.post<{ success: boolean }>('/auth/register', { email, password }),
  verify: (token: string) => api.get<{ success: boolean }>(`/auth/verify/${token}`),
  login: (email: string, password: string) => api.post<LoginResponse>('/auth/login', { email, password }),
  me: () => api.get<MeResponse>('/auth/me')
};

export const projects = {
  list: () => api.get<Project[]>('/projects'),
  get: (id: number) => api.get<Project>(`/projects/${id}`),
  create: (data: CreateProjectPayload) => api.post<Project>('/projects', data),
  delete: (id: number) => api.delete<{ success: boolean }>(`/projects/${id}`),
  sync: (id: number) => api.post<{ synced: number; vms: VirtualMachine[] }>(`/projects/${id}/sync`)
};

export const vms = {
  list: (projectId?: number) => api.get<VirtualMachine[]>('/vms', { params: projectId ? { projectId } : {} }),
  get: (id: number) => api.get<VirtualMachine>(`/vms/${id}`),
  powerOn: (id: number) => api.post<{ success: boolean }>(`/vms/${id}/power-on`),
  powerOff: (id: number) => api.post<{ success: boolean }>(`/vms/${id}/power-off`)
};

export const dailyBilling = {
  list: (params?: DailyBillingQuery) => api.get<DailyBill[]>('/daily-billing/daily', { params }),
  stats: (params: StatsQuery) => api.get<DailyBillingStat[]>('/daily-billing/stats', { params }),
  exportUrl: (params?: DailyBillingQuery) => buildDailyBillingExportUrl(params),
  generate: () => api.post<{ message: string }>('/daily-billing/generate'),
  cleanup: () => api.post<{ message: string }>('/daily-billing/cleanup'),
  pricing: () => api.get<PricingConfig[]>('/daily-billing/pricing'),
  updatePricing: (resourceType: string, unitPrice: number) =>
    api.put<{ message: string }>('/daily-billing/pricing', { resourceType, unitPrice })
};

export const resourceRequests = {
  list: (params?: ListResourceRequestParams) => api.get<PaginatedResult<ResourceRequestSummary>>('/resource-requests', { params }),
  get: (id: number) => api.get<ResourceRequestDetail>(`/resource-requests/${id}`),
  create: (data: CreateResourceRequestPayload) => api.post<ResourceRequestDetail>('/resource-requests', data),
  delete: (id: number) => api.delete<{ success: boolean }>(`/resource-requests/${id}`)
};

export const gpu = {
  inventory: (params?: { status?: GpuStatus; gpu_model?: string; host_name?: string }) =>
    api.get<GPUInventoryResponse>('/gpu/inventory', { params }),
  sync: () => api.post<{ synced: number }>('/gpu/sync'),
  availability: (params?: { gpu_model?: string }) => api.get<{ data: GPUAvailabilityItem[] }>('/gpu/availability', { params }),
  updateStatus: (id: number, status: 'available' | 'maintenance') =>
    api.patch<GPURecord>(`/gpu/${id}/status`, { status })
};

export const admin = {
  users: () => api.get<AdminUser[]>('/admin/users'),
  updatePassword: (id: number, password: string) => api.put<{ success: boolean }>(`/admin/users/${id}/password`, { password }),
  updateUserStatus: (id: number, status: string) => api.put<{ success: boolean }>(`/admin/users/${id}/status`, { status }),
  verifyUser: (id: number) => api.put<{ success: boolean }>(`/admin/users/${id}/verify`),
  deleteUser: (id: number) => api.delete<{ success: boolean }>(`/admin/users/${id}`),
  projects: () => api.get<AdminProject[]>('/admin/projects'),
  updateProjectUser: (id: number, userId: number) => api.put<{ success: boolean }>(`/admin/projects/${id}/user`, { userId }),
  vms: () => api.get<VirtualMachine[]>('/admin/vms'),
  updateVmProject: (id: number, projectId: number) => api.put<{ success: boolean }>(`/admin/vms/${id}/project`, { projectId }),
  pricing: () => api.get<PricingConfig[]>('/admin/pricing'),
  updatePricing: (prices: AdminPricingUpdateItem[]) => api.put<{ success: boolean }>('/admin/pricing', { prices }),
  resourceRequests: (params?: ListResourceRequestParams) =>
    api.get<PaginatedResult<ResourceRequestSummary>>('/admin/resource-requests', { params }),
  resourceRequestStats: () => api.get<ResourceRequestStats>('/admin/resource-requests/stats'),
  approveResourceRequest: (id: number, data: ApproveRequestPayload) =>
    api.patch<ResourceRequestDetail>(`/admin/resource-requests/${id}/approve`, data),
  rejectResourceRequest: (id: number, data: RejectRequestPayload) =>
    api.patch<ResourceRequestDetail>(`/admin/resource-requests/${id}/reject`, data),
  deployResourceRequest: (id: number, data: DeployRequestPayload) =>
    api.post<DeployRequestResponse>(`/admin/resource-requests/${id}/deploy`, data),
  resourceRequestDeploymentLogs: (id: number) =>
    api.get<{ data: Array<{ id: number; log_level: string; message: string; operation: string | null; created_at: string; details: unknown }> }>(`/admin/resource-requests/${id}/deployment-logs`),
  networkPools: () => api.get<NetworkPool[]>('/admin/network-pools'),
  createNetworkPool: (data: NetworkPoolPayload) => api.post<NetworkPool>('/admin/network-pools', data),
  updateNetworkPool: (id: number, data: NetworkPoolPayload) => api.put<NetworkPool>(`/admin/network-pools/${id}`, data),
  deleteNetworkPool: (id: number) => api.delete<{ success: boolean }>(`/admin/network-pools/${id}`),
  networkPoolAllocations: (id: number) => api.get<NetworkAllocation[]>(`/admin/network-pools/${id}/ip-allocations`)
};

export default api;
