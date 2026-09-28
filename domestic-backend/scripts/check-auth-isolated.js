import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { Pool } from 'pg';
import { loadEnvFile } from '../src/loadEnv.js';
import { inspectDatabaseSchema } from '../src/schemaCheck.js';

loadEnvFile();
const legacy = process.argv.includes('--compat');
const serverFile = path.resolve(process.env.AUTH_TEST_SERVER || 'src/server.js');
const schema = `auth_audit_${crypto.randomBytes(8).toString('hex')}`;
const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error('DATABASE_URL 未配置');
const ssl = process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false;
const admin = new Pool({connectionString,ssl});
const testUrl = new URL(connectionString);
testUrl.searchParams.set('options',`-csearch_path=${schema}`);
const testPool = new Pool({connectionString:testUrl.toString(),ssl});
let schemaCreated = false;
let api;
let apiExit;
let apiErrors = '';
let passed = false;

async function runScript(file, args, env) {
  const child = spawn(process.execPath, [file,...args], {env,stdio:['ignore','inherit','inherit']});
  const [code] = await once(child,'exit');
  assert.equal(code,0,`${file} failed`);
}

async function startApi(env) {
  apiErrors = '';
  api = spawn(process.execPath,[serverFile],{env,stdio:['ignore','ignore','pipe']});
  apiExit = once(api,'exit');
  api.stderr.on('data',chunk=>{apiErrors=(apiErrors+chunk.toString()).slice(-8000);});
  for (let attempt=0;attempt<80;attempt++) {
    if (api.exitCode!==null) throw new Error(`测试后端启动失败: ${apiErrors}`);
    try {
      const response=await fetch(`${env.AUTH_TEST_BASE_URL}/health`,{signal:AbortSignal.timeout(500)});
      if(response.ok)return;
    } catch {}
    await delay(100);
  }
  throw new Error('测试后端启动超时');
}

async function stopApi() {
  if(api && api.exitCode===null) {
    api.kill('SIGTERM');
    const timeout=setTimeout(()=>api.kill('SIGKILL'),5000);
    await apiExit;
    clearTimeout(timeout);
    api=undefined;
  }
}

try {
  await admin.query(`create schema ${schema}`);
  schemaCreated = true;
  let sql = await fs.readFile(new URL('../db/schema.sql',import.meta.url),'utf8');
  sql = sql.replace('create extension if not exists pgcrypto;','').replace('set search_path to public;',`set search_path to ${schema};`);
  // Begin with the exact legacy gap, then exercise the migration twice.
  sql = sql.replace('  auth_version integer not null default 1,\n','');
  const otpStart = sql.indexOf('create table if not exists otp_codes');
  const otpEnd = sql.indexOf('\n);',otpStart);
  sql = sql.slice(0,otpStart)+sql.slice(otpStart,otpEnd).replace('  failed_attempts integer not null default 0,\n','')+sql.slice(otpEnd);
  await testPool.query(sql);
  const before = await inspectDatabaseSchema(testPool);
  assert.deepEqual(before.missing.sort(),['app_users.auth_version','otp_codes.failed_attempts']);
  if (!legacy) {
    let patch = await fs.readFile(new URL('../db/patch_auth_security.sql',import.meta.url),'utf8');
    patch = patch.replaceAll('public.',`${schema}.`).replace("table_schema = 'public'",`table_schema = '${schema}'`);
    await testPool.query(patch);
    await testPool.query(patch);
    assert.equal((await inspectDatabaseSchema(testPool)).ok,true);
    console.log('PASS: 缺列检测、数据库补丁、重复执行补丁');
  }
  const socket = net.createServer();
  socket.listen(0,'127.0.0.1');
  await once(socket,'listening');
  const port = socket.address().port;
  await new Promise(resolve=>socket.close(resolve));
  const env = {...process.env,DATABASE_URL:testUrl.toString(),JWT_SECRET:crypto.randomBytes(32).toString('hex'),OTP_SECRET:crypto.randomBytes(32).toString('hex'),PORT:String(port),HOST:'127.0.0.1',NODE_ENV:'test',SMS_PROVIDER:'console',AUTH_TEST_BASE_URL:`http://127.0.0.1:${port}`};
  await startApi(env);
  await runScript('scripts/check-auth-regression.js',legacy?['--compat']:[],env);
  await runScript('scripts/check-sms-regression.js',[],env);
  await stopApi();
  const failureEnv={...env,SMS_PROVIDER:'invalid-audit-provider'};
  await startApi(failureEnv);
  await runScript('scripts/check-sms-regression.js',['--failure'],failureEnv);
  passed = true;
} finally {
  await stopApi();
  await testPool.end();
  try {
    if(schemaCreated && /^auth_audit_[0-9a-f]{16}$/.test(schema)) await admin.query(`drop schema ${schema} cascade`);
  } finally { await admin.end(); }
  console.log(JSON.stringify({isolatedAuthPassed:passed,legacySchema:legacy,temporarySchemaRemoved:schemaCreated}));
}
