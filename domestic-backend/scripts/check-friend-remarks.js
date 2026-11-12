import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { Readable } from 'node:stream';
import { PGlite } from '@electric-sql/pglite';

// Real PostgreSQL engine + actual API router, with an in-memory DB and HTTP
// transport adapter. No .env, TCP connection, cloud credentials or live users.
const db = new PGlite();
const secret = crypto.randomBytes(32).toString('hex');
let handler;
let failRemark = false;
const errors = [];
const context = vm.createContext({ Buffer, URL, setTimeout, clearTimeout,
  console: { log() {}, error(error) { errors.push(error); } },
  process: { env: { DATABASE_URL: 'memory-only', JWT_SECRET: secret, NODE_ENV: 'test' } },
});
const query = async (sql, values) => {
  if (failRemark && sql.includes('insert into friend_remarks')) throw new Error('test write failure');
  const result = await db.query(sql, values);
  return { ...result, rowCount: result.affectedRows ?? result.rows.length };
};
const fakePool = class {
  query = query;
  async connect() { return { query, release() {} }; }
};
const modules = new Map();
function synthetic(id, exports) {
  return new vm.SyntheticModule(Object.keys(exports), function () {
    for (const [key, value] of Object.entries(exports)) this.setExport(key, value);
  }, { context, identifier: id });
}
async function moduleFor(id) {
  if (modules.has(id)) return modules.get(id);
  let mod;
  if (id === 'pg') mod = synthetic(id, { Pool: fakePool });
  else if (id === 'node:http') mod = synthetic(id, { default: { createServer(fn) { handler = fn; return { listen() {} }; } } });
  else if (id.endsWith('/loadEnv.js')) mod = synthetic(id, { loadEnvFile() {} });
  else if (id.startsWith('node:')) mod = synthetic(id, await import(id));
  else mod = new vm.SourceTextModule(await fs.readFile(new URL(id), 'utf8'), {
    context, identifier: id, initializeImportMeta(meta) { meta.url = id; },
  });
  modules.set(id, mod);
  await mod.link((specifier, referencing) => moduleFor(specifier.startsWith('.') ? new URL(specifier, referencing.identifier).href : specifier));
  return mod;
}
function token(id) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ sub: id, ver: 1, exp: Math.floor(Date.now() / 1000) + 600 })).toString('base64url');
  return `${header}.${payload}.${crypto.createHmac('sha256', secret).update(`${header}.${payload}`).digest('base64url')}`;
}
async function request(id, path, { method = 'GET', body, status = 200 } = {}) {
  const req = Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))]);
  req.headers = id ? { authorization: `Bearer ${token(id)}` } : {};
  req.method = method;
  req.url = path;
  const result = await new Promise(resolve => {
    let code;
    handler(req, { writeHead(value) { code = value; }, end(data) { resolve({ status: code, ...JSON.parse(data) }); } });
  });
  assert.equal(result.status, status, `${method} ${path}: ${JSON.stringify(result)}`);
  return result;
}
const snapshot = id => request(id, '/me/snapshot');
const send = (id, phone, remark) => request(id, '/friends/request', { method: 'POST', body: { phone, ...(remark === undefined ? {} : { remark }) } });
const accept = (id, requestId, remark) => request(id, `/friends/requests/${requestId}/accept`, { method: 'POST', ...(remark === undefined ? {} : { body: { remark } }) });
const edit = (id, friendId, remark, status = 200, extra = {}) => request(id, `/friends/${friendId}/remark`, { method: 'PUT', body: { remark, ...extra }, status });
const results = [];
try {
  const schema = (await fs.readFile(new URL('../db/schema.sql', import.meta.url), 'utf8')).replace('create extension if not exists pgcrypto;', '');
  await db.exec(schema);
  // Verify deployment patch also upgrades an old schema and is repeatable.
  await db.exec('drop table friend_remarks');
  const patch = await fs.readFile(new URL('../db/patch_friend_remarks.sql', import.meta.url), 'utf8');
  await db.exec(patch);
  await db.exec(patch);
  const server = await moduleFor(new URL('../src/server.js', import.meta.url).href);
  await server.evaluate(); // Includes the real startup schema assertion.
  results.push('旧结构升级、重复执行迁移、后端启动结构检查');
  const ids = [], phones = ['+8613900000011', '+8613900000022', '+8613900000033'];
  for (let i = 0; i < phones.length; i++) {
    const { rows } = await query('insert into app_users (phone_e164) values ($1) returning id', [phones[i]]);
    ids.push(rows[0].id);
    await query('insert into profiles (user_id, nickname) values ($1, $2)', [ids[i], `原昵称${i}`]);
  }
  const [a, b, c] = ids;
  const pending = await send(a, phones[1], '  妈妈  ');
  assert.equal((await snapshot(a)).friendRequests[0].remark, '妈妈');
  assert.equal((await snapshot(b)).friendRequests[0].remark, '');
  await edit(a, b, '未接受不可改', 403);
  await accept(b, pending.requestId, '大学室友');
  assert.equal((await snapshot(a)).friends[0].remark, '妈妈');
  assert.equal((await snapshot(b)).friends[0].remark, '大学室友');
  assert.equal((await snapshot(a)).friends[0].name, '原昵称1');
  assert.equal((await snapshot(b)).profile.nickname, '原昵称1');
  results.push('添加时备注私有、接受时各自备注、原昵称不变');
  await edit(a, b, '我的好友', 200, { ownerId: b, owner_id: b });
  assert.equal((await snapshot(b)).friends[0].remark, '大学室友');
  await edit(c, b, '越权', 403);
  await edit(a, c, '非好友', 403);
  await edit(null, b, '未登录', 401);
  assert.equal((await snapshot(c)).friends.length, 0);
  const bc = await send(b, phones[2]);
  await accept(c, bc.requestId);
  assert.equal((await snapshot(c)).friends[0].remark, '');
  assert.equal((await snapshot(c)).friends[0].name, '原昵称1');
  results.push('第三方、未登录、伪造 owner 均无法读写他人备注；旧客户端无备注兼容');
  await edit(a, b, '😀'.repeat(20));
  for (const invalid of ['😀'.repeat(21), 'x'.repeat(21), '换\n行', '\u0000', 42, null, {}, ['错误']]) {
    await edit(a, b, invalid, 400);
  }
  await request(a, `/friends/${b}/remark`, { method: 'PUT', body: {}, status: 400 });
  await request(a, `/friends/${b}/remark`, { method: 'PUT', body: null, status: 400 });
  assert.equal((await snapshot(a)).friends[0].remark, '😀'.repeat(20));
  await edit(a, b, '  ');
  assert.equal((await snapshot(a)).friends[0].remark, '');
  assert.equal((await snapshot(b)).friends.find(f => f.id === a).remark, '大学室友');
  results.push('中文和 emoji 长度限制、无效类型、控制字符、清空只影响本人');
  await edit(b, a, '新的备注');
  await request(a, `/friends/${b}/poke`, { method: 'POST' });
  await accept(b, pending.requestId, '旧的备注');
  await accept(b, pending.requestId); // Empty-body legacy retry.
  assert.equal((await snapshot(b)).friends.find(f => f.id === a).remark, '新的备注');
  assert.equal((await snapshot(b)).incomingPokes.length, 1);
  results.push('接受申请重试不会覆盖后续备注或清除戳一下');
  failRemark = true;
  await request(a, '/friends/request', { method: 'POST', body: { phone: phones[2], remark: '失败不能留下申请' }, status: 500 });
  failRemark = false;
  assert.equal((await snapshot(a)).friendRequests.length, 0);
  const ac = await send(a, phones[2], '事务测试');
  failRemark = true;
  await request(c, `/friends/requests/${ac.requestId}/accept`, { method: 'POST', body: { remark: '失败不能接受' }, status: 500 });
  failRemark = false;
  assert.equal((await snapshot(c)).friendRequests.length, 1);
  assert.equal((await snapshot(a)).friendRequests[0].remark, '事务测试');
  await accept(c, ac.requestId, '接受成功');
  results.push('备注写入失败时，申请和接受一起回滚，可保留草稿重试');
  await request(a, `/friends/${b}`, { method: 'DELETE' });
  assert.equal((await query('select * from friend_remarks where friendship_id = $1', [pending.requestId])).rows.length, 0);
  const readded = await send(a, phones[1]);
  await accept(b, readded.requestId);
  assert.equal((await snapshot(a)).friends.find(f => f.id === b).remark, '');
  assert.equal((await snapshot(b)).friends.find(f => f.id === a).remark, '');
  await request(c, '/account/deletion-request', { method: 'POST' });
  assert.equal((await query('select * from friend_remarks')).rows.length, 0);
  await request(c, '/me/snapshot', { status: 401 });
  await query('delete from app_users where id = $1', [c]);
  results.push('删除好友、重新添加、注销账号均不残留旧备注');
  assert.equal(errors.length, 2, 'only injected rollback failures should log server errors');
  console.log(JSON.stringify({ friendRemarksPassed: true, results }));
} finally {
  await db.close();
}
