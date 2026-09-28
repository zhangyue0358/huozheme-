import crypto from 'node:crypto';
import process from 'node:process';
import { Pool } from 'pg';
import { loadEnvFile } from '../src/loadEnv.js';

loadEnvFile();

function base64url(input) {
  return Buffer.from(input).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function createShortLivedToken(user) {
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = base64url(JSON.stringify({
    exp: now + 300,
    iat: now,
    phone: user.phone_e164,
    sub: user.id,
  }));
  const data = `${header}.${payload}`;
  const signature = base64url(crypto.createHmac('sha256', process.env.JWT_SECRET).update(data).digest());
  return `${data}.${signature}`;
}

function ossEndpoint() {
  const bucket = process.env.ALIYUN_OSS_BUCKET || '';
  const region = process.env.ALIYUN_OSS_REGION || 'oss-cn-beijing';
  if (!bucket) throw new Error('ALIYUN_OSS_BUCKET must be configured');
  return `https://${bucket}.${region}.aliyuncs.com`;
}

async function deleteOssProbe(objectKey) {
  const accessKeyId = process.env.ALIYUN_OSS_ACCESS_KEY_ID || process.env.ALIYUN_ACCESS_KEY_ID || '';
  const accessKeySecret = process.env.ALIYUN_OSS_ACCESS_KEY_SECRET || process.env.ALIYUN_ACCESS_KEY_SECRET || '';
  const bucket = process.env.ALIYUN_OSS_BUCKET || '';
  if (!accessKeyId || !accessKeySecret || !bucket) throw new Error('OSS credentials must be configured');

  const date = new Date().toUTCString();
  const canonical = `DELETE\n\n\n${date}\n/${bucket}/${objectKey}`;
  const signature = crypto.createHmac('sha1', accessKeySecret).update(canonical).digest('base64');
  const encodedKey = objectKey.split('/').map(encodeURIComponent).join('/');
  const response = await fetch(`${ossEndpoint()}/${encodedKey}`, {
    headers: {
      Authorization: `OSS ${accessKeyId}:${signature}`,
      Date: date,
    },
    method: 'DELETE',
  });
  if (!response.ok && response.status !== 404) {
    throw new Error(`Avatar probe cleanup failed (${response.status})`);
  }
}

async function verifyAvatarUpload(policy) {
  const onePixelPng = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
    'base64',
  );
  const form = new FormData();
  for (const [key, value] of Object.entries(policy.fields || {})) form.append(key, value);
  form.append('file', new Blob([onePixelPng], { type: 'image/png' }), 'avatar-probe.png');

  const response = await fetch(policy.uploadUrl, { body: form, method: 'POST' });
  const detail = await response.text();
  if (!response.ok) {
    const match = detail.match(/<Code>([^<]+)<\/Code>/);
    throw new Error(`Avatar OSS upload failed (${response.status}${match ? `/${match[1]}` : ''})`);
  }
  await deleteOssProbe(policy.objectKey);
  return response.status;
}

if (!process.env.DATABASE_URL || !process.env.JWT_SECRET) {
  throw new Error('DATABASE_URL 和 JWT_SECRET 必须已配置');
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
});
let probeUserId;

try {
  const result = await pool.query(
    'insert into app_users (phone_e164) values ($1) returning id, phone_e164',
    [`+991${crypto.randomInt(100000000, 999999999)}${crypto.randomInt(10, 99)}`],
  );
  probeUserId = result.rows[0].id;
  await pool.query('insert into profiles (user_id, nickname) values ($1, $2)', [probeUserId, '图片验收临时账号']);
  if (!result.rows[0]) {
    console.log('No active user; authenticated API check skipped.');
    process.exitCode = 0;
  } else {
    const authorization = `Bearer ${createShortLivedToken(result.rows[0])}`;
    const snapshotResponse = await fetch('http://127.0.0.1:8080/me/snapshot', {
      headers: { Authorization: authorization },
    });
    const snapshot = await snapshotResponse.json();
    if (!snapshotResponse.ok) throw new Error(snapshot.error || 'Snapshot failed');
    if (!Number.isInteger(snapshot.aliveDays) || snapshot.aliveDays < 0) throw new Error('aliveDays is invalid');
    if (typeof snapshot.profile?.avatarUrl !== 'string') throw new Error('profile avatarUrl is invalid');
    if (!snapshot.friends.every((friend) => typeof friend.avatarUrl === 'string')) {
      throw new Error('friend avatarUrl is invalid');
    }

    const policyResponse = await fetch('http://127.0.0.1:8080/me/avatar/upload-policy', {
      body: JSON.stringify({ contentType: 'image/jpeg', fileName: 'avatar.jpg' }),
      headers: {
        Authorization: authorization,
        'Content-Type': 'application/json',
      },
      method: 'POST',
    });
    const policy = await policyResponse.json();
    if (!policyResponse.ok || !policy.objectKey || !policy.uploadUrl) {
      throw new Error(policy.error || 'Avatar policy failed');
    }
    const avatarUploadStatus = await verifyAvatarUpload(policy);

    console.log(JSON.stringify({
      aliveDaysValid: true,
      avatarUploadStatus,
      avatarPolicyValid: true,
      friendAvatarFieldsValid: true,
      snapshotStatus: snapshotResponse.status,
    }));
  }
} finally {
  try {
    if (probeUserId) await pool.query('delete from app_users where id = $1', [probeUserId]);
  } finally { await pool.end(); }
}
