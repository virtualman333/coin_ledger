'use strict';
/**
 * 管理端 · 用户域业务层：列表 / 详情 / 批量操作 / 角色与禁用 / 删除 / 审计查询。
 *
 * 从 legacy/api-handler.js 里 6 个 admin/users 分支 + audit 分支拆出。
 * 权限判定不在这里：路由层已经挂了 app.requireAdmin（preHandler），
 * 服务层拿到的 me 一定是管理员，因此这里只做「管理员之间的约束」
 * （不能动自己、最后一个管理员不能降级/删除）。
 */
const store = require('../store');
const auth = require('../auth');
const audit = require('../audit');
const { badRequest, httpError } = require('../core/http');

/**
 * 用户列表：分页 + 搜索 + 角色/状态筛选 + 任意字段排序。
 *
 * @param {object} query 已解析的查询参数
 * @returns {object} 响应体
 */
function list(query) {
  const d = store.load();
  const kw = String(query.q || '').trim().toLowerCase();
  const role = String(query.role || 'all');
  const status = String(query.status || 'all');
  const sort = String(query.sort || '-createdAt');
  const page = Math.max(1, Number(query.page) || 1);
  const size = Math.min(200, Math.max(1, Number(query.size) || 20));

  let items = d.users.map((u) => Object.assign(auth.publicUser(u), {
    holdings: Array.isArray(d.holdings[u.id]) ? d.holdings[u.id].length : 0
  }));
  const stats = {
    total: items.length,
    admins: items.filter((u) => u.role === 'admin').length,
    tests: items.filter((u) => u.isTest).length,
    disabled: items.filter((u) => u.disabled).length
  };
  if (kw) items = items.filter((u) =>
    [u.id, u.name, u.nickname].some((v) => String(v || '').toLowerCase().includes(kw)));
  if (role === 'admin' || role === 'user') items = items.filter((u) => u.role === role);
  if (status === 'active') items = items.filter((u) => !u.disabled && !u.isTest);
  else if (status === 'disabled') items = items.filter((u) => u.disabled);
  else if (status === 'test') items = items.filter((u) => u.isTest);

  const desc = sort.charAt(0) === '-';
  const key = desc ? sort.slice(1) : sort;
  items.sort((a, b) => {
    const av = a[key] == null ? '' : a[key];
    const bv = b[key] == null ? '' : b[key];
    const n = (typeof av === 'number' && typeof bv === 'number')
      ? av - bv
      : String(av).localeCompare(String(bv), 'zh-CN');
    return desc ? -n : n;
  });

  return {
    ok: true,
    users: items.slice((page - 1) * size, page * size),
    total: items.length, page, size, stats
  };
}

/**
 * 单个用户详情（带持仓条数）。
 *
 * @param {string} id 用户 ID
 * @returns {object} 响应体
 */
function one(id) {
  const d = store.load();
  const target = auth.findByID(d, id);
  if (!target) throw httpError(404, '用户不存在');
  return {
    ok: true,
    user: Object.assign(auth.publicUser(target), {
      holdings: Array.isArray(d.holdings[target.id]) ? d.holdings[target.id].length : 0
    })
  };
}

/**
 * 某个用户的持仓明细（管理端只读）。
 *
 * @param {string} id 用户 ID
 * @returns {object} 响应体
 */
function holdingsOf(id) {
  const d = store.load();
  const target = auth.findByID(d, id);
  if (!target) throw httpError(404, '用户不存在');
  return {
    ok: true,
    user: auth.publicUser(target),
    holdings: Array.isArray(d.holdings[target.id]) ? d.holdings[target.id] : []
  };
}

/**
 * 批量操作：标记测试账号 / 禁用 / 启用 / 删除，一次最多 100 个。
 *
 * @param {object} me 当前管理员
 * @param {{ids?: unknown, action?: string}} body 请求体
 * @param {string} ip 客户端 IP
 * @returns {Promise<object>} 响应体
 */
async function batch(me, body, ip) {
  const ids = Array.isArray(body.ids) ? body.ids.map(String) : [];
  const action = String(body.action || '');
  const ALLOWED = { markTest: 1, unmarkTest: 1, disable: 1, enable: 1, delete: 1 };
  if (!ids.length || !ALLOWED[action]) throw badRequest('参数不合法');
  if (ids.length > 100) throw badRequest('一次最多操作 100 个账号');

  let affected = 0;
  await store.commit((draft) => {
    ids.forEach((id) => {
      if (id === me.id) return;
      const u = auth.findByID(draft, id);
      if (!u) return;
      if (action === 'delete') {
        if (u.role === 'admin') return;
        draft.users = draft.users.filter((x) => x.id !== id);
        delete draft.holdings[id];
      } else if (action === 'markTest') u.isTest = true;
      else if (action === 'unmarkTest') u.isTest = false;
      else if (action === 'disable') u.disabled = true;
      else if (action === 'enable') u.disabled = false;
      affected += 1;
    });
  });
  audit.log(me.name, 'user.batch.' + action, ids.join(','), '成功 ' + affected + ' 个', ip);
  return { ok: true, affected };
}

/**
 * 修改单个用户的角色 / 测试标记 / 禁用状态。
 *
 * @param {object} me 当前管理员
 * @param {string} id 目标用户 ID
 * @param {object} body 请求体
 * @param {string} ip 客户端 IP
 * @returns {Promise<object>} 响应体
 */
async function patchOne(me, id, body, ip) {
  const d = store.load();
  const target = auth.findByID(d, id);
  if (!target) throw httpError(404, '用户不存在');

  const patch = {};
  if (typeof body.isTest === 'boolean') patch.isTest = body.isTest;
  if (typeof body.disabled === 'boolean') patch.disabled = body.disabled;
  if (body.role === 'admin' || body.role === 'user') patch.role = body.role;
  if (!Object.keys(patch).length) throw badRequest('没有可修改的字段');

  if (target.id === me.id) throw badRequest('不能修改自己的账号状态');
  if (patch.role && target.role === 'admin' && patch.role !== 'admin'
      && d.users.filter((u) => u.role === 'admin').length <= 1) {
    throw badRequest('至少保留一个管理员');
  }

  await store.commit((draft) => {
    const u = auth.findByID(draft, target.id);
    if (u) Object.assign(u, patch);
  });
  audit.log(me.name, 'user.patch', target.name, JSON.stringify(patch), ip);
  return Object.assign({ ok: true }, patch);
}

/**
 * 删除单个用户（连带持仓）。
 *
 * @param {object} me 当前管理员
 * @param {string} id 目标用户 ID
 * @param {string} ip 客户端 IP
 * @returns {Promise<object>} 响应体
 */
async function remove(me, id, ip) {
  const d = store.load();
  const target = auth.findByID(d, id);
  if (!target) throw httpError(404, '用户不存在');
  if (target.id === me.id) throw badRequest('不能删除自己');
  if (target.role === 'admin' && d.users.filter((u) => u.role === 'admin').length <= 1) {
    throw badRequest('至少保留一个管理员');
  }

  await store.commit((draft) => {
    draft.users = draft.users.filter((u) => u.id !== target.id);
    delete draft.holdings[target.id];
  });
  audit.log(me.name, 'user.delete', target.name, '账号及收藏已删除', ip);
  return { ok: true };
}

/**
 * 审计日志查询。
 *
 * @param {object} query 已解析的查询参数
 * @returns {object} 响应体
 */
function auditLog(query) {
  return Object.assign({ ok: true }, audit.query(query));
}

module.exports = {
  list: list,
  one: one,
  holdingsOf: holdingsOf,
  batch: batch,
  patchOne: patchOne,
  remove: remove,
  auditLog: auditLog
};
