import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { Pool } from 'pg';
import { loadEnvFile } from '../src/loadEnv.js';

loadEnvFile();
if (!process.env.DATABASE_URL || !process.env.OTP_SECRET || !process.env.JWT_SECRET) {
  throw new Error('DATABASE_URL、OTP_SECRET 和 JWT_SECRET 必须已配置');
}
const compatibilityMode = process.argv.includes('--compat');
const baseUrl = process.env.AUTH_TEST_BASE_URL || 'http://127.0.0.1:8080';
const pool = new Pool({connectionString:process.env.DATABASE_URL,ssl:process.env.DB_SSL==='true'?{rejectUnauthorized:false}:false});
// Synthetic account only. This script never requests an SMS delivery.
const phone = `+991${crypto.randomInt(100000000,999999999)}${crypto.randomInt(10,99)}`;
const firstPassword = `Probe${crypto.randomBytes(12).toString('hex')}9`;
const secondPassword = `Probe${crypto.randomBytes(12).toString('hex')}8`;
const results = [];
let userId;

async function request(path, body, token, expectedStatus = 200) {
  const response = await fetch(`${baseUrl}${path}`, {
    body:body===undefined?undefined:JSON.stringify(body),
    headers:{...(body===undefined?{}:{'Content-Type':'application/json'}),...(token?{Authorization:`Bearer ${token}`}:{})},
    method:body===undefined?'GET':'POST',signal:AbortSignal.timeout(15000),
  });
  const payload = await response.json();
  if (expectedStatus!==null) assert.equal(response.status,expectedStatus,`${path}: ${payload.error||'unexpected response'}`);
  return {status:response.status,payload};
}
async function insertCode({expired=false}={}) {
  const code=String(crypto.randomInt(100000,1000000));
  const hash=crypto.createHmac('sha256',process.env.OTP_SECRET).update(`${phone}:${code}`).digest('hex');
  await pool.query(`insert into otp_codes (phone_e164,code_hash,expires_at,ip_address)
    values ($1,$2,now()+($3::integer*interval '1 second'),'auth-audit-check')`,[phone,hash,expired?-1:300]);
  return code;
}
const login=(password,status=200)=>request('/auth/password-login',{phone,password},undefined,status);
const reset=(code,newPassword=secondPassword,status=200)=>request('/auth/reset-password',{phone,code,newPassword},undefined,status);
const snapshot=(token,status=200)=>request('/me/snapshot',undefined,token,status);

try {
  const {rows}=await pool.query('insert into app_users (phone_e164) values ($1) returning id',[phone]);
  userId=rows[0].id;
  await pool.query('insert into profiles (user_id,nickname) values ($1,$2)',[userId,'认证回归临时账号']);
  const created=await reset(await insertCode(),firstPassword);
  assert.equal(created.payload.profile.passwordConfigured,true);
  assert.ok(created.payload.accessToken);
  const stored=await pool.query('select password_hash from user_password_credentials where user_id=$1',[userId]);
  assert.match(stored.rows[0].password_hash,/^scrypt\$/);
  assert.notEqual(stored.rows[0].password_hash,firstPassword);
  results.push('验证码设置密码、哈希保存');
  for (const password of [`${firstPassword}x`,'x','12345678','']) {
    const wrong=await login(password,401);
    assert.equal(wrong.payload.error,'手机号或密码不正确');
  }
  const session=(await login(firstPassword)).payload;
  await snapshot(session.accessToken);
  const counters=await pool.query('select failed_attempts from user_password_credentials where user_id=$1',[userId]);
  assert.equal(counters.rows[0].failed_attempts,0);
  results.push('错误密码401、正确登录200、登录态访问、成功清零');
  const attempts=await Promise.all(Array.from({length:5},()=>login(`${firstPassword}x`,null)));
  assert.deepEqual(attempts.map(item=>item.status).sort(),[401,401,401,401,429]);
  await login(firstPassword,429);
  const locked=await pool.query('select failed_attempts,locked_until from user_password_credentials where user_id=$1',[userId]);
  assert.equal(locked.rows[0].failed_attempts,5);
  assert.ok(new Date(locked.rows[0].locked_until).getTime()>Date.now());
  results.push('并发5次错误锁定、锁定时正确密码也拒绝');
  await pool.query("update user_password_credentials set locked_until=now()-interval '1 second' where user_id=$1",[userId]);
  await login(`${firstPassword}x`,401);
  const unlocked=await pool.query('select failed_attempts,locked_until from user_password_credentials where user_id=$1',[userId]);
  assert.equal(unlocked.rows[0].failed_attempts,1);
  assert.equal(unlocked.rows[0].locked_until,null);
  await login(firstPassword);
  results.push('锁定到期恢复');
  await pool.query("update user_password_credentials set failed_attempts=5,locked_until=now()+interval '15 minutes' where user_id=$1",[userId]);
  const resetCode=await insertCode();
  const next=(await reset(resetCode)).payload;
  await snapshot(next.accessToken);
  await reset(resetCode,secondPassword,400);
  await login(firstPassword,401);
  await login(secondPassword);
  results.push('重置解锁、旧密码拒绝、验证码不能重复使用');
  if (!compatibilityMode) {
    await snapshot(session.accessToken,401);
    results.push('重置后旧令牌失效');
  }
  await reset(await insertCode({expired:true}),secondPassword,400);
  const previous=await insertCode();
  let latest=await insertCode();
  while(latest===previous) latest=await insertCode();
  await reset(previous,secondPassword,400);
  await reset(latest);
  results.push('验证码过期、重新获取后旧验证码失效');
  if (!compatibilityMode) {
    const limitedCode=await insertCode();
    const otpAttempts=await Promise.all(Array.from({length:5},()=>reset('000000',secondPassword,null)));
    assert.deepEqual(otpAttempts.map(item=>item.status).sort(),[400,400,400,400,429]);
    await reset(limitedCode,secondPassword,429);
    results.push('验证码并发5次错误作废');
  }
  for (const token of ['','invalid','a.b.'+'é'.repeat(43),'a.b.'+'a'.repeat(43),session.accessToken+'x']) await snapshot(token,401);
  const header=Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url');
  for (const claims of [null,{exp:Math.floor(Date.now()/1000)+60,sub:'not-a-uuid'},{exp:'never',sub:userId}]) {
    const encoded=Buffer.from(JSON.stringify(claims)).toString('base64url');
    const data=`${header}.${encoded}`;
    const signature=crypto.createHmac('sha256',process.env.JWT_SECRET).update(data).digest('base64url');
    await snapshot(`${data}.${signature}`,401);
  }
  results.push('损坏或非法令牌返回401');
  await pool.query('update app_users set disabled_at=now() where id=$1',[userId]);
  await login(secondPassword,401);
  await snapshot(next.accessToken,401);
  await reset(await insertCode(),secondPassword,403);
  results.push('停用账号无法登录或重置恢复');
  console.log(JSON.stringify({ok:true,compatibilityMode,passed:results,pending:compatibilityMode?['验证码5次限制','重置后旧令牌撤销']:[]},null,2));
} finally {
  try {
    if(userId) await pool.query('delete from app_users where id=$1',[userId]);
    await pool.query('delete from otp_codes where phone_e164=$1',[phone]);
  } finally { await pool.end(); }
}
