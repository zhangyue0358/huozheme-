import crypto from 'node:crypto';
import process from 'node:process';
import { Pool } from 'pg';
import { loadEnvFile } from '../src/loadEnv.js';

loadEnvFile();

if (!process.env.DATABASE_URL || !process.env.JWT_SECRET) {
  throw new Error('DATABASE_URL 和 JWT_SECRET 必须已配置');
}

function base64url(input) {
  return Buffer.from(input).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function createToken(user) {
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = base64url(JSON.stringify({ exp: now + 300, iat: now, phone: user.phone_e164, sub: user.id }));
  const data = `${header}.${payload}`;
  const signature = base64url(crypto.createHmac('sha256', process.env.JWT_SECRET).update(data).digest());
  return `${data}.${signature}`;
}

async function request(path, token, body) {
  const response = await fetch(`${process.env.AUTH_TEST_BASE_URL || 'http://127.0.0.1:8080'}${path}`, {
    body: body ? JSON.stringify(body) : undefined,
    headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    method: body ? 'POST' : 'GET',
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`${path} failed (${response.status}): ${payload.error || 'unknown error'}`);
  return payload;
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
});
const phone = `+993${String(Date.now())}${crypto.randomInt(10, 99)}`.slice(0, 16);
let userId = '';

try {
  const user = await pool.query('insert into app_users (phone_e164) values ($1) returning id, phone_e164', [phone]);
  userId = user.rows[0].id;
  await pool.query('insert into profiles (user_id, nickname) values ($1, $2)', [userId, '天气连续测试']);
  await pool.query(
    `insert into checkins (user_id, checkin_date, status_text, confirmed_at)
     values ($1, (now() at time zone 'Asia/Shanghai')::date - 2, '平静', now()),
            ($1, (now() at time zone 'Asia/Shanghai')::date - 1, '不错', now())`,
    [userId],
  );

  const token = createToken(user.rows[0]);
  const before = await request('/me/snapshot', token);
  if (before.checkedIn || before.streak !== 2) {
    throw new Error(`Expected pre-checkin streak 2, received ${before.streak}`);
  }

  await request('/checkins/today/confirm', token, { statusText: '还好', weatherText: '🌧️ 雨' });
  const after = await request('/me/snapshot', token);
  if (!after.checkedIn || after.streak !== 3 || after.weatherText !== '🌧️ 雨') {
    throw new Error(`Post-checkin snapshot invalid: ${JSON.stringify({ checkedIn: after.checkedIn, streak: after.streak, weatherText: after.weatherText })}`);
  }

  console.log(JSON.stringify({ preCheckinStreak: before.streak, savedWeather: after.weatherText, postCheckinStreak: after.streak }));
} finally {
  if (userId) {
    await pool.query('delete from checkins where user_id = $1', [userId]);
    await pool.query('delete from profiles where user_id = $1', [userId]);
    await pool.query('delete from app_users where id = $1', [userId]);
  }
  await pool.end();
}
