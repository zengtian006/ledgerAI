import { getToken, signOut } from './auth.js';

export class ApiError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

async function request(method, url, { body, form, raw } = {}) {
  const headers = {};
  const token = await getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body) headers['Content-Type'] = 'application/json';

  const res = await fetch(`/api${url}`, { method, headers, body: form ?? (body ? JSON.stringify(body) : undefined) });
  if (res.status === 401 && token) {
    signOut();
    window.dispatchEvent(new Event('ledgerai:logout'));
  }
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new ApiError(res.status, data.error || `Request failed (${res.status})`, data.details);
  }
  if (raw) return res;
  return res.status === 204 ? null : res.json();
}

const qs = (params) => {
  const p = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined && v !== ''));
  const s = p.toString();
  return s ? `?${s}` : '';
};

export const api = {
  me: () => request('GET', '/auth/me'),
  countries: () => request('GET', '/countries'),
  getProfile: () => request('GET', '/profile'),
  updateProfile: (body) => request('PUT', '/profile', { body }),
  deleteAccount: (password) => request('DELETE', '/profile', { body: { password } }),

  parseReceipt: (blob, name) => {
    const form = new FormData();
    form.append('image', blob, name);
    return request('POST', '/receipts/parse', { form });
  },
  discardImage: (key) => request('DELETE', `/receipts/draft-image${qs({ key })}`).catch(() => {}),
  saveReceipt: (r) => request('POST', '/receipts', { body: r }),
  updateReceipt: (id, r) => request('PUT', `/receipts/${id}`, { body: r }),
  deleteReceipt: (id) => request('DELETE', `/receipts/${id}`),
  getReceipt: (id) => request('GET', `/receipts/${id}`),
  listReceipts: (params) => request('GET', `/receipts${qs(params)}`),
  exportCsv: async (params) => (await request('GET', `/receipts/export.csv${qs(params)}`, { raw: true })).blob(),

  daily: (month) => request('GET', `/daily${qs({ month })}`),
  monthly: (month) => request('GET', `/monthly${qs({ month })}`),
  yearly: (year) => request('GET', `/yearly${qs({ year })}`),
  recurring: () => request('GET', '/recurring'),
  getBudget: (month) => request('GET', `/budget${qs({ month })}`),
  setBudget: (month, amount) => request('PUT', '/budget', { body: { month, amount } }),
  adminOverview: () => request('GET', '/admin/overview'),
  adminUsers: (params) => request('GET', `/admin/users${qs(params)}`),

  insights: () => request('GET', '/insights'),
  refreshInsights: (force = false) => request('POST', '/insights/refresh', { body: { force } }),
};
