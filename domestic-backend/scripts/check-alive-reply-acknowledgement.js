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

function createShortLivedToken(user) {
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = base64url(JSON.stringify({ exp: now + 300, iat: now, phone: user.phone_e164, sub: user.id }));
  const data = `${header}.${payload}`;
  const signature = base64url(crypto.createHmac('sha256', process.env.JWT_SECRET).update(data).digest());
  return `${data}.${signature}`;
}

async function request(path, token, method = 'GET') {
  const response = await fetch(`${process.env.AUTH_TEST_BASE_URL || 'http://127.0.0.1:8080'}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
    method,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`${path} failed (${response.status}): ${payload.error || 'unknown error'}`);
  return payload;
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
});
const suffix = `${Date.now()}${crypto.randomInt(1000, 9999)}`.slice(-12);
const phones = [`+991${suffix}`, `+992${suffix}`];
const userIds = [];

try {
  for (const [index, phone] of phones.entries()) {
    const user = await pool.query(
      'insert into app_users (phone_e164) values ($1) returning id, phone_e164',
      [phone],
    );
    userIds.push(user.rows[0].id);
    await pool.query('insert into profiles (user_id, nickname) values ($1, $2)', [user.rows[0].id, `回馈测试${index + 1}`]);
  }

  await pool.query(
    `insert into friendships (requester_id, addressee_id, status, accepted_at)
     values ($1, $2, 'accepted', now())`,
    userIds,
  );

  const senderToken = createShortLivedToken({ id: userIds[0], phone_e164: phones[0] });
  const receiverToken = createShortLivedToken({ id: userIds[1], phone_e164: phones[1] });
  await request(`/friends/${userIds[1]}/poke`, senderToken, 'POST');
  await request(`/friends/${userIds[0]}/alive-reply`, receiverToken, 'POST');
  await request(`/friends/${userIds[0]}/alive-reply`, receiverToken, 'POST');

  const before = await request('/me/snapshot', senderToken);
  if (before.aliveReplies.length !== 1 || before.aliveReplies[0].acknowledgedAt) {
    throw new Error('Alive reply was duplicated or unexpectedly acknowledged');
  }

  const replyId = before.aliveReplies[0].id;
  await request(`/alive-replies/${replyId}/acknowledge`, senderToken, 'POST');
  await request(`/alive-replies/${replyId}/acknowledge`, senderToken, 'POST');

  const after = await request('/me/snapshot', senderToken);
  const acknowledgedReply = after.aliveReplies.find((reply) => reply.id === replyId);
  if (!acknowledgedReply?.acknowledgedAt) throw new Error('Acknowledgement was not persisted');

  console.log(JSON.stringify({
    acknowledgementPersisted: true,
    duplicateReplyPrevented: true,
    replyCount: after.aliveReplies.length,
  }));
} finally {
  if (userIds.length) {
    await pool.query('delete from alive_reply_acknowledgements where receiver_id = any($1::uuid[])', [userIds]);
    await pool.query('delete from pokes where sender_id = any($1::uuid[]) or receiver_id = any($1::uuid[])', [userIds]);
    await pool.query('delete from friendships where requester_id = any($1::uuid[]) or addressee_id = any($1::uuid[])', [userIds]);
    await pool.query('delete from profiles where user_id = any($1::uuid[])', [userIds]);
    await pool.query('delete from app_users where id = any($1::uuid[])', [userIds]);
  }
  await pool.end();
}
