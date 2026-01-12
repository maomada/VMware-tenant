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
  login: (username: string, password: string) => api.post('/auth/login', { username, password }),
  me: () => api.get('/auth/me')
};

export const tenants = {
  list: () => api.get('/tenants'),
  get: (id: number) => api.get(`/tenants/${id}`),
  create: (data: any) => api.post('/tenants', data),
  update: (id: number, data: any) => api.put(`/tenants/${id}`, data),
  delete: (id: number) => api.delete(`/tenants/${id}`),
  createUser: (id: number, data: any) => api.post(`/tenants/${id}/users`, data)
};

export const vms = {
  list: () => api.get('/vms'),
  get: (id: number) => api.get(`/vms/${id}`),
  create: (data: any) => api.post('/vms', data),
  powerOn: (id: number) => api.post(`/vms/${id}/power-on`),
  powerOff: (id: number) => api.post(`/vms/${id}/power-off`),
  syncVCenter: () => api.get('/vms/sync/vcenter')
};

export const billing = {
  bills: () => api.get('/billing/bills'),
  bill: (id: number) => api.get(`/billing/bills/${id}`),
  exportBill: (id: number) => `/api/billing/bills/${id}/export`,
  generate: (tenantId: number, period: string) => api.post('/billing/generate', { tenantId, period }),
  pricing: () => api.get('/billing/pricing'),
  updatePricing: (prices: any[]) => api.put('/billing/pricing', { prices })
};

export default api;
