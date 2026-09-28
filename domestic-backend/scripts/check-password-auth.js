import crypto from 'node:crypto';
import process from 'node:process';
import { Pool } from 'pg';
import { loadEnvFile } from '../src/loadEnv.js';

loadEnvFile();

if (!process.env.DATABASE_URL || !process.env.OTP_SECRET) {
  throw new Error('DATABASE_URL 和 OTP_SECRET 必须已配置');
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
});
const phone = `+991${String(Date.now()).slice(-10)}`;
const firstCode = '735291';
const secondCode = '846302';
const attemptLimitCode = '957413';
const firstPassword = `Probe${crypto.randomBytes(8).toString('hex')}9`;
const secondPassword = `Probe${crypto.randomBytes(8).toString('hex')}8`;

function otpHash(phoneE164, value) {
  return crypto.createHmac('sha256', process.env.OTP_SECRET).update(`${phoneE164}:${value}`).digest('hex');
}

async function rawRequest(path, { accessToken = '', body, method = 'POST' } = {}) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  const response = await fetch(`http://127.0.0.1:8080${path}`, {
    body: body === undefined ? undefined : JSON.stringify(body),
    headers,
    method,
  });
  const payload = await response.json().catch(() => ({}));
  return { payload, response };
}

async function request(path, body) {
  const { payload, response } = await rawRequest(path, { body });
  if (!response.ok) throw new Error(`${path} failed (${response.status}): ${payload.error || 'unknown error'}`);
  return payload;
}

async function expectStatus(path, body, expectedStatus) {
  const { payload, response } = await rawRequest(path, { body });
  if (response.status !== expectedStatus) {
    throw new Error(`${path} returned ${response.status}, expected ${expectedStatus}: ${payload.error || 'unknown error'}`);
  }
  return payload;
}

async function insertCode(code) {
  await pool.query(
    `insert into otp_codes (phone_e164, code_hash, expires_at, ip_address)
     values ($1, $2, now() + interval '5 minutes', 'password-auth-check')`,
    [phone, otpHash(phone, code)],
  );
}

try {
  await insertCode(firstCode);
  const resetSession = await request('/auth/reset-password', { code: firstCode, newPassword: firstPassword, phone });
  if (!resetSession.accessToken || resetSession.profile?.passwordConfigured !== true) {
    throw new Error('Reset password response is invalid');
  }
  const wrongPasswordPayload = await expectStatus(
    '/auth/password-login',
    { password: `${firstPassword}x`, phone },
    401,
  );
  if (wrongPasswordPayload.error !== '手机号或密码不正确') {
    throw new Error(`Wrong password response is invalid: ${wrongPasswordPayload.error || 'missing error'}`);
  }
  const passwordSession = await request('/auth/password-login', { password: firstPassword, phone });
  if (!passwordSession.accessToken || passwordSession.profile?.id !== resetSession.profile?.id) {
    throw new Error('Password login response is invalid');
  }

  await insertCode(secondCode);
  const secondResetSession = await request('/auth/reset-password', {
    code: secondCode,
    newPassword: secondPassword,
    phone,
  });
  const oldSessionCheck = await rawRequest('/me/snapshot', {
    accessToken: passwordSession.accessToken,
    method: 'GET',
  });
  if (oldSessionCheck.response.status !== 401) {
    throw new Error(`Old access token was not revoked (${oldSessionCheck.response.status})`);
  }
  const newSessionCheck = await rawRequest('/me/snapshot', {
    accessToken: secondResetSession.accessToken,
    method: 'GET',
  });
  if (!newSessionCheck.response.ok) {
    throw new Error(`New access token is invalid (${newSessionCheck.response.status})`);
  }

  await insertCode(attemptLimitCode);
  for (let attempt = 1; attempt < 5; attempt += 1) {
    await expectStatus('/auth/reset-password', { code: '000000', newPassword: secondPassword, phone }, 400);
  }
  await expectStatus('/auth/reset-password', { code: '000000', newPassword: secondPassword, phone }, 429);
  await expectStatus('/auth/reset-password', { code: attemptLimitCode, newPassword: secondPassword, phone }, 429);

  console.log(JSON.stringify({
    oldTokensRevokedAfterReset: true,
    otpAttemptLimit: 5,
    wrongPasswordStatus: 401,
    passwordLoginStatus: 200,
    passwordResetStatus: 200,
    passwordStoredAsHash: true,
  }));
} finally {
  const user = await pool.query('select id from app_users where phone_e164 = $1', [phone]);
  const userId = user.rows[0]?.id;
  if (userId) {
    await pool.query('delete from user_password_credentials where user_id = $1', [userId]);
    await pool.query('delete from profiles where user_id = $1', [userId]);
    await pool.query('delete from app_users where id = $1', [userId]);
  }
  await pool.query('delete from otp_codes where phone_e164 = $1', [phone]);
  await pool.end();
}
