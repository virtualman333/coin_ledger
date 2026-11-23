/**
 * 管理端 API 契约集中在这里；页面只依赖本模块，不直接拼 URL。
 * 路径相对 /api（见 client.js 的 buildUrl）。
 */
import { http } from './client';

export const authApi = {
  bootstrap: () => http.get('/bootstrap'),
  health: () => http.get('/health')
};

export const usersApi = {
  list: (params, signal) => http.get('/admin/users', params, signal),
  detail: (id) => http.get('/admin/users/' + encodeURIComponent(id)),
  holdings: (id) => http.get('/admin/users/' + encodeURIComponent(id) + '/holdings'),
  patch: (id, body) => http.patch('/admin/users/' + encodeURIComponent(id), body),
  remove: (id) => http.del('/admin/users/' + encodeURIComponent(id)),
  batch: (body) => http.post('/admin/users/batch', body)
};

export const appConfigApi = {
  get: () => http.get('/app-config'),
  setMaintenance: (maintenance) => http.put('/admin/app-config', { maintenance })
};

export const auditApi = {
  list: (params, signal) => http.get('/admin/audit', params, signal)
};

export const guardApi = {
  bans: () => http.get('/admin/guard/bans'),
  unban: (ip) => http.post('/admin/guard/unban', { ip })
};

export const seriesApi = {
  list: () => http.get('/series'),
  create: (body) => http.post('/admin/series', body),
  update: (key, body) => http.patch('/admin/series/' + encodeURIComponent(key), body),
  remove: (key) => http.del('/admin/series/' + encodeURIComponent(key)),
  image: (key, data) => http.post('/admin/series/image', { key, data }),
  coins: () => http.get('/admin/coins'),
  members: (key, ids) => http.post('/admin/series/members', { key, ids })
};

export const coinsApi = {
  all: () => http.get('/admin/coins'),
  batchUpdate: (items) => http.patch('/admin/coins', { items }),
  updateOne: (body) => http.patch('/admin/coin', body)
};

export const planApi = {
  get: () => http.get('/admin/plan'),
  save: (plan) => http.put('/admin/plan', { plan })
};

export const planPmApi = {
  get: () => http.get('/admin/plan-pm'),
  save: (plan) => http.put('/admin/plan-pm', { plan })
};

export const imagesApi = {
  all: () => http.get('/admin/coins'),
  upload: (body) => http.post('/admin/image', body),
  remove: (id, kind) => http.del('/admin/image?id=' + encodeURIComponent(id) + '&kind=' + encodeURIComponent(kind)),
  gallery: (body) => http.post('/admin/gallery', body)
};

/** 贵金属：唯一数据源为金币云集全量库 cl_ecgci_pm（只读展示） */
export const pmAllApi = {
  page: (params, signal) => http.get('/admin/pm-all', params, signal)
};

export const categoriesApi = {
  list: () => http.get('/admin/categories')
};

export const feedbackApi = {
  list: (status) => http.get('/admin/feedback', { status }),
  update: (id, status) => http.patch('/admin/feedback/' + encodeURIComponent(id), { status }),
  remove: (id) => http.del('/admin/feedback/' + encodeURIComponent(id))
};

export const visitorsApi = {
  list: (params) => http.get('/admin/visitors', params),
  detail: (params) => http.get('/admin/visitors/detail', params)
};
