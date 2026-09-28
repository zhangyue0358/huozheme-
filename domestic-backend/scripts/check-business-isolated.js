import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { Pool } from 'pg';
import { loadEnvFile } from '../src/loadEnv.js';

// The only shared database operation is CREATE/DROP of this random schema.
// No production users, SMS deliveries, or stored OSS objects are accessed.
loadEnvFile(process.env.CHECK_ENV_FILE);
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL 未配置');
const schema = `business_audit_${crypto.randomBytes(8).toString('hex')}`;
const ssl = process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false;
const admin = new Pool({ connectionString: process.env.DATABASE_URL, ssl });
const testUrl = new URL(process.env.DATABASE_URL);
testUrl.searchParams.set('options', `-csearch_path=${schema}`);
const db = new Pool({ connectionString: testUrl.toString(), ssl });
const jwtSecret = crypto.randomBytes(32).toString('hex');
let schemaCreated = false;
let server;
let serverExit;
let errors = '';
let baseUrl;
const results = [];
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
function token(id) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ sub: id, ver: 1, exp: Math.floor(Date.now() / 1000) + 600 })).toString('base64url');
  return `${header}.${payload}.${crypto.createHmac('sha256', jwtSecret).update(`${header}.${payload}`).digest('base64url')}`;
}
async function request(id, path, { body, method = body === undefined ? 'GET' : 'POST', status = 200 } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    headers: { Authorization: `Bearer ${token(id)}`, 'Content-Type': 'application/json' },
    method, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(15000),
  });
  const payload = await response.json();
  if (status !== null) assert.equal(response.status, status, `${path}: ${payload.error || 'unexpected status'}`);
  return { status: response.status, payload };
}
const snapshot = async id => (await request(id, '/me/snapshot')).payload;
const save = (id, text, expected, status = 200, date = today) => request(id, '/checkins/today/journal', {
  method: 'PATCH', body: { journalText: text, expectedJournalText: expected, checkinDate: date }, status,
});
try {
  await admin.query(`create schema ${schema}`);
  schemaCreated = true;
  const sql = (await fs.readFile(new URL('../db/schema.sql', import.meta.url), 'utf8'))
    .replace('create extension if not exists pgcrypto;', '')
    .replace('set search_path to public;', `set search_path to ${schema};`);
  await db.query(sql);
  const socket = net.createServer();
  socket.listen(0, '127.0.0.1');
  await once(socket, 'listening');
  const port = socket.address().port;
  await new Promise(resolve => socket.close(resolve));
  baseUrl = `http://127.0.0.1:${port}`;
  const env = {
    ...process.env, DATABASE_URL: testUrl.toString(), JWT_SECRET: jwtSecret,
    OTP_SECRET: crypto.randomBytes(32).toString('hex'), NODE_ENV: 'test', SMS_PROVIDER: 'console',
    HOST: '127.0.0.1', PORT: String(port), AUTH_TEST_BASE_URL: baseUrl,
    // Signing only. No valid cloud credentials, and tests never fetch these URLs.
    ALIYUN_OSS_BUCKET: 'logic-test-not-a-real-bucket', ALIYUN_OSS_ACCESS_KEY_ID: 'test-only',
    ALIYUN_OSS_ACCESS_KEY_SECRET: 'test-only', ALIYUN_OSS_REGION: 'oss-cn-beijing',
    ALIYUN_ACCESS_KEY_ID: 'test-only', ALIYUN_ACCESS_KEY_SECRET: 'test-only',
  };
  server = spawn(process.execPath, ['src/server.js'], { env, stdio: ['ignore', 'ignore', 'pipe'] });
  serverExit = once(server, 'exit');
  server.stderr.on('data', chunk => { errors = (errors + chunk).slice(-6000); });
  let ready = false;
  for (let attempt = 0; attempt < 80; attempt++) {
    if (server.exitCode !== null) throw new Error(`测试后端启动失败: ${errors}`);
    try { ready = (await fetch(`${baseUrl}/health`, { signal: AbortSignal.timeout(500) })).ok; } catch {}
    if (ready) break;
    await delay(100);
  }
  assert.equal(ready, true, 'test API did not start');
  const ids = [];
  for (let i = 0; i < 3; i++) {
    const { rows } = await db.query('insert into app_users (phone_e164) values ($1) returning id', [`+991${crypto.randomInt(100000000, 999999999)}${i}`]);
    ids.push(rows[0].id);
    await db.query('insert into profiles (user_id, nickname) values ($1, $2)', [rows[0].id, `隔离测试${i}`]);
  }
  const [a, b, c] = ids;
  await db.query(
    `insert into checkins (user_id, checkin_date, status_text, confirmed_at)
     select $1, $2::date - offset_day, '测试心情', now() from generate_series(0, 99) as offset_day`, [a, today],
  );
  let state = await snapshot(a);
  assert.equal(state.streak, 100); assert.equal(state.aliveDays, 100);
  assert.equal(state.diaryEntries.length, 90); assert.equal(state.checkinDate, today);
  results.push('连续100天独立于90条日记分页');

  await request(b, '/checkins/today/confirm', { body: { statusText: '不应向好友泄露的心情' } });
  await db.query("insert into friendships (requester_id,addressee_id,status,accepted_at) values ($1,$2,'accepted',now())", [a,b]);
  await request(b, '/me/privacy', { method: 'PUT', body: { showStatusToFriends: false } });
  let friend = (await snapshot(a)).friends[0];
  assert.equal(friend.statusVisible, false); assert.equal(friend.mood, '');
  assert.equal(friend.days, null); assert.equal(friend.streak, null); assert.equal(friend.aliveToday, false);
  await request(b, '/me/privacy', { method: 'PUT', body: { showStatusToFriends: true } });
  friend = (await snapshot(a)).friends[0];
  assert.equal(friend.statusVisible, true); assert.equal(friend.mood, '不应向好友泄露的心情');
  results.push('好友隐私关闭过滤文字和统计、重新开启可见');

  const policy = async id => (await request(id, '/journal/photos/upload-policy', { body: { fileName: 'test.jpg', contentType: 'image/jpeg' } })).payload.objectKey;
  const confirm = (id, key, status = 200) => request(id, '/journal/photos/confirm', { body: { objectKey: key, byteSize: 100, contentType: 'image/jpeg' }, status });
  const foreign = await policy(b); await confirm(b, foreign);
  await request(a, '/checkins/today', { body: { journalText: '', journalPhotoPaths: [foreign] }, status: 403 });
  await confirm(a, `journal-photos/${a}/${today}/../other.jpg`, 400);
  const keys = await Promise.all([policy(a), policy(a), policy(a)]);
  await Promise.all(keys.map(key => confirm(a, key)));
  await confirm(a, keys[0]);
  await confirm(a, await policy(b), 400);
  state = await snapshot(a);
  assert.deepEqual([...state.journalPhotoPaths].sort(), [...keys].sort());
  const extra = `journal-photos/${a}/${today}/${Date.now()}-ffffffff.jpg`;
  await confirm(a, extra, 400);
  await db.query('update checkins set journal_photo_paths = array_append(journal_photo_paths, $3) where user_id=$1 and checkin_date=$2', [a,today,foreign]);
  state = await snapshot(a);
  assert.equal(state.journalPhotoPaths.includes(foreign), false);
  assert.equal(JSON.stringify(state).includes(foreign), false);
  await db.query('update checkins set journal_photo_paths=$3 where user_id=$1 and checkin_date=$2', [a,today,keys]);
  await request(a, '/journal/photos', { method: 'DELETE', body: { path: foreign }, status: 400 });
  results.push('照片归属、异常路径、历史污染过滤、三张并发确认和幂等重试');

  await save(a, '新随笔', '');
  await save(a, '新随笔', ''); // retry after a lost successful response
  await request(a, '/checkins/today', { body: { journalText: '旧随笔', journalPhotoPaths: [] }, status: 426 });
  await request(a, '/checkins/today', { body: { journalText: '新随笔', journalPhotoPaths: [] } });
  assert.deepEqual((await snapshot(a)).journalPhotoPaths.sort(), keys.sort());
  const concurrent = await Promise.all(['设备一', '设备二', '设备三'].map(text => save(a, text, '新随笔', null)));
  assert.deepEqual(concurrent.map(result => result.status).sort(), [200,409,409]);
  await save(a, '过期日期', '新随笔', 409, '2000-01-01');
  await request(a, '/checkins/today/quote', { body: { quoteText: '不能被随笔覆盖的箴言' } });
  const latest = await snapshot(a);
  await save(a, '只更新文字', latest.journalText);
  state = await snapshot(a);
  assert.equal(state.quoteText, '不能被随笔覆盖的箴言');
  assert.deepEqual(state.journalPhotoPaths.sort(), keys.sort());
  results.push('随笔冲突拒绝、重试幂等、日期校验、旧版安全提示、文字照片箴言互不覆盖');

  const added = await Promise.all(Array.from({ length: 8 }, (_,i) => request(a, '/todos', { body: { text: `事项${i}` }, status: null })));
  assert.equal(added.filter(item => item.status === 200).length, 3);
  assert.equal(added.filter(item => item.status === 400).length, 5);
  assert.equal((await snapshot(a)).todos.length, 3);
  await request(a, '/me/app-data', { method: 'DELETE', status: 410 });
  assert.equal((await snapshot(a)).journalPhotoPaths.length, 3);
  await save(c, '未打卡', '', 409);
  await request(c, '/todos', { body: { text: '未打卡' }, status: 409 });
  results.push('待办并发不超过三件、危险清空接口停用、未确认账户禁止写入');

  const auth = spawn(process.execPath, ['scripts/check-auth-regression.js'], { env, stdio: ['ignore', 'inherit', 'inherit'] });
  const [authCode] = await once(auth, 'exit');
  assert.equal(authCode, 0, '认证回归失败');
  results.push('现有完整认证回归保持通过');
  for (const file of ['check-weather-streak.js', 'check-daily-quote-lock.js', 'check-alive-reply-acknowledgement.js']) {
    const child = spawn(process.execPath, [`scripts/${file}`], { env, stdio: ['ignore', 'inherit', 'inherit'] });
    const [code] = await once(child, 'exit');
    assert.equal(code, 0, `${file} failed`);
  }
  results.push('原有天气、箴言锁定、好友回馈回归保持通过');
  console.log(JSON.stringify({ isolatedBusinessPassed: true, results }));
} catch (error) {
  if (errors) console.error(errors);
  throw error;
} finally {
  if (server && server.exitCode === null) {
    server.kill('SIGTERM');
    const timer = setTimeout(() => server.kill('SIGKILL'), 5000);
    await serverExit;
    clearTimeout(timer);
  }
  await db.end();
  try {
    if (schemaCreated && /^business_audit_[0-9a-f]{16}$/.test(schema)) await admin.query(`drop schema ${schema} cascade`);
  } finally { await admin.end(); }
  console.log(JSON.stringify({ temporarySchemaRemoved: schemaCreated }));
}
