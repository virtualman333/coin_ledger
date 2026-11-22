'use strict';
/**
 * 回归：改昵称不能把头像清掉。
 *
 * 线上真实事故：鸿蒙「编辑资料」页点保存（只改昵称）后本站头像消失。
 * 原因是客户端把 `avatar: ''` 一起发上来，服务端当时把空串当「清除头像」，
 * 删文件 + 清字段。修复后清除头像必须显式 `avatarClear: true`。
 *
 * 这里不写真实文件（PUBLIC_DIR/avatar 下的文件本来就可能不存在），
 * 只验证 store 里 avatar 字段是否被改。
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const store = require('../server/store');
const authService = require('../server/services/auth.service');

function useDoc(doc) {
  store.load = () => doc;
  store.commit = async (mutator) => {
    const r = mutator(doc);
    doc.rev = (doc.rev || 0) + 1;
    return r;
  };
}

function docWithAvatar(avatar) {
  return {
    users: [{
      id: 'u1', name: '甲', role: 'user', salt: '', hash: '',
      avatar: avatar, createdAt: new Date().toISOString()
    }],
    holdings: {},
    prices: {},
    visits: { total: 0, days: {} },
    rev: 0
  };
}

test('只改昵称：带 avatar:"" 也不清头像（老客户端兼容）', async () => {
  const doc = docWithAvatar('u1-abc.jpg');
  useDoc(doc);
  const r = await authService.updateProfile(doc.users[0], { nickname: '新名字', avatar: '' });
  assert.equal(r.ok, true);
  assert.equal(doc.users[0].nickname, '新名字');
  assert.equal(doc.users[0].avatar, 'u1-abc.jpg');
});

test('只改昵称：完全不带 avatar 字段，头像保持不变', async () => {
  const doc = docWithAvatar('u1-abc.jpg');
  useDoc(doc);
  await authService.updateProfile(doc.users[0], { nickname: '新名字' });
  assert.equal(doc.users[0].avatar, 'u1-abc.jpg');
});

test('显式 avatarClear:true 才清头像', async () => {
  const doc = docWithAvatar('u1-abc.jpg');
  useDoc(doc);
  await authService.updateProfile(doc.users[0], { nickname: '新名字', avatarClear: true });
  assert.equal(doc.users[0].avatar, '');
});

test('没有要保存的内容时报 400', async () => {
  const doc = docWithAvatar('u1-abc.jpg');
  useDoc(doc);
  await assert.rejects(
    () => authService.updateProfile(doc.users[0], {}),
    (e) => e.status === 400
  );
});
