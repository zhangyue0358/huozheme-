import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { Pool } from 'pg';
import { loadEnvFile } from '../src/loadEnv.js';

loadEnvFile();
if (process.env.NODE_ENV !== 'test' || process.env.SMS_PROVIDER === 'aliyun') {
  throw new Error('短信回归只能在隔离测试环境中使用模拟服务');
}
const expectFailure = process.argv.includes('--failure');
const pool = new Pool({connectionString:process.env.DATABASE_URL,ssl:process.env.DB_SSL==='true'?{rejectUnauthorized:false}:false});
const phone=`+991${crypto.randomInt(100000000,999999999)}${crypto.randomInt(10,99)}`;
async function send() {
  const response=await fetch(`${process.env.AUTH_TEST_BASE_URL}/auth/send-code`,{
    method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({phone}),signal:AbortSignal.timeout(15000),
  });
  return {status:response.status,payload:await response.json()};
}
try {
  if(expectFailure) {
    const prior=await pool.query(`insert into otp_codes (phone_e164,code_hash,created_at,expires_at)
      values ($1,'previous-code-hash',now()-interval '2 minutes',now()+interval '5 minutes') returning id`,[phone]);
    assert.equal((await send()).status,500);
    const after=await pool.query('select id from otp_codes where phone_e164=$1 order by id',[phone]);
    assert.deepEqual(after.rows,prior.rows);
    console.log('PASS: 短信发送失败回滚新验证码，保留之前有效记录');
  } else {
    const sent=await Promise.all([send(),send()]);
    assert.deepEqual(sent.map(item=>item.status).sort(),[200,429]);
    const after=await pool.query('select count(*)::integer as count from otp_codes where phone_e164=$1',[phone]);
    assert.equal(after.rows[0].count,1);
    await pool.query("update otp_codes set created_at=now()-interval '2 minutes' where phone_e164=$1",[phone]);
    await pool.query(`insert into otp_codes (phone_e164,code_hash,created_at,expires_at)
      select $1,'test-hash',now()-interval '2 minutes',now() from generate_series(1,19)`,[phone]);
    const limited=await send();
    assert.equal(limited.status,429);
    assert.match(limited.payload.error,/今天/);
    console.log('PASS: 并发发码只发送1次，60秒间隔和每日20次限制有效');
  }
} finally {
  try { await pool.query('delete from otp_codes where phone_e164=$1',[phone]); }
  finally { await pool.end(); }
}
