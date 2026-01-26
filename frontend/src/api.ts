import axios from 'axios';

const api = axios.create({ baseURL: '/api' });

api.interceptors.request.use(config => {
  const token = localStorage.getItem('token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

api.interceptors.response.use(
  res => res,
  err => {
    if (err.response?.status === 401) {
      localStorage.removeItem('token');
      window.location.href = '/login';
    }
    return Promise.reject(err);
  }
);

export const auth = {
  register: (email: string, password: string) => api.post('/auth/register', { email, password }),
  verify: (token: string) => api.get(`/auth/verify/${token}`),
  login: (email: string, password: string) => api.post('/auth/login', { email, password }),
  me: () => api.get('/auth/me')
};

export const projects = {
  list: () => api.get('/projects'),
  get: (id: number) => api.get(`/projects/${id}`),
  create: (data: any) => api.post('/projects', data),
  delete: (id: number) => api.delete(`/projects/${id}`),
  sync: (id: number) => api.post(`/projects/${id}/sync`)
};

export const vms = {
  list: (projectId?: number) => api.get('/vms', { params: projectId ? { projectId } : {} }),
  get: (id: number) => api.get(`/vms/${id}`),
  powerOn: (id: number) => api.post(`/vms/${id}/power-on`),
  powerOff: (id: number) => api.post(`/vms/${id}/power-off`)
};

export const dailyBilling = {
  list: (params?: { startDate?: string; endDate?: string; projectId?: number }) =>
    api.get('/daily-billing/daily', { params }),
  summary: (params?: { startDate?: string; endDate?: string; projectId?: number }) =>
    api.get('/daily-billing/summary', { params }),
  stats: (params: { dimension: 'day' | 'month'; startDate?: string; endDate?: string; projectId?: number }) =>
    api.get('/daily-billing/stats', { params }),
  exportUrl: (params?: { startDate?: string; endDate?: string; projectId?: number }) => {
    const query = new URLSearchParams({ ...params } as any).toString();
    return `/api/daily-billing/export?${query}`;
  },
  generate: () => api.post('/daily-billing/generate'),
  cleanup: () => api.post('/daily-billing/cleanup'),
  pricing: () => api.get('/daily-billing/pricing'),
  updatePricing: (resourceType: string, unitPrice: number) =>
    api.put('/daily-billing/pricing', { resourceType, unitPrice })
};

export const admin = {
  users: () => api.get('/admin/users'),
  updatePassword: (id: number, password: string) => api.put(`/admin/users/${id}/password`, { password }),
  updateUserStatus: (id: number, status: string) => api.put(`/admin/users/${id}/status`, { status }),
  verifyUser: (id: number) => api.put(`/admin/users/${id}/verify`),
  deleteUser: (id: number) => api.delete(`/admin/users/${id}`),
  projects: () => api.get('/admin/projects'),
  updateProjectUser: (id: number, userId: number) => api.put(`/admin/projects/${id}/user`, { userId }),
  vms: () => api.get('/admin/vms'),
  updateVmProject: (id: number, projectId: number) => api.put(`/admin/vms/${id}/project`, { projectId }),
  pricing: () => api.get('/admin/pricing'),
  updatePricing: (prices: any[]) => api.put('/admin/pricing', { prices })
};

export default api;
