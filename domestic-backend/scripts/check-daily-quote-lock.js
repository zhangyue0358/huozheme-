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
  return `${data}.${base64url(crypto.createHmac('sha256', process.env.JWT_SECRET).update(data).digest())}`;
}

async function request(path, token, body, method = body ? 'POST' : 'GET') {
  const response = await fetch(`${process.env.AUTH_TEST_BASE_URL || 'http://127.0.0.1:8080'}${path}`, {
    body: body ? JSON.stringify(body) : undefined,
    headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    method,
  });
  return { status: response.status, payload: await response.json() };
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
  await pool.query('insert into profiles (user_id, nickname) values ($1, $2)', [userId, '箴言锁定测试']);
  const token = createToken(user.rows[0]);

  const unconfirmed = await request('/checkins/today/quote', token, { quoteText: '测试句子' });
  if (unconfirmed.status !== 409) throw new Error(`Unconfirmed save expected 409, got ${unconfirmed.status}`);

  const confirmed = await request('/checkins/today/confirm', token, { statusText: '平静', weatherText: '☀️ 晴' });
  if (confirmed.status !== 200) throw new Error(`Confirm failed: ${confirmed.status}`);
  const before = await request('/me/snapshot', token);
  if (before.status !== 200 || before.payload.quoteSaved !== false) throw new Error('Default quote must remain unsaved');

  const first = await request('/checkins/today/quote', token, { quoteText: '今天也值得被记住。' });
  if (first.status !== 200) throw new Error(`First quote save failed: ${first.status}`);
  const second = await request('/checkins/today/quote', token, { quoteText: '试图修改的文字' });
  if (second.status !== 409) throw new Error(`Second quote save expected 409, got ${second.status}`);

  const legacyEdit = await request('/checkins/today', token, {
    statusText: '平静', quoteText: '旧客户端试图覆盖', journalText: '随笔仍可编辑', journalPhotoPaths: [], weatherText: '☀️ 晴',
  });
  if (legacyEdit.status !== 426) throw new Error(`Unsafe legacy save expected 426, got ${legacyEdit.status}`);
  const otherEdit = await request('/checkins/today/journal', token, {
    journalText: '随笔仍可编辑', expectedJournalText: '', checkinDate: before.payload.checkinDate,
  }, 'PATCH');
  if (otherEdit.status !== 200) throw new Error(`Unrelated checkin edit failed: ${otherEdit.status}`);
  const after = await request('/me/snapshot', token);
  if (after.status !== 200 || after.payload.quoteSaved !== true || after.payload.quoteText !== '今天也值得被记住。' || after.payload.journalText !== '随笔仍可编辑') {
    throw new Error('Saved quote changed, or unrelated journal edit failed');
  }
  console.log('Daily quote lock OK: first save succeeds, repeat save is rejected, unrelated edits preserve quote.');
} finally {
  if (userId) {
    await pool.query('delete from checkins where user_id = $1', [userId]);
    await pool.query('delete from profiles where user_id = $1', [userId]);
    await pool.query('delete from app_users where id = $1', [userId]);
  }
  await pool.end();
}
