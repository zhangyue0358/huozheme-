import crypto from 'node:crypto';
import http from 'node:http';
import { URL } from 'node:url';
import { Pool } from 'pg';
import { loadEnvFile } from './loadEnv.js';
import { assertDatabaseSchema } from './schemaCheck.js';

loadEnvFile();

const PORT = Number(process.env.PORT || 8080);
const DATABASE_URL = process.env.DATABASE_URL || '';
const JWT_SECRET = process.env.JWT_SECRET || '';
const OTP_SECRET = process.env.OTP_SECRET || '';
const SMS_PROVIDER = process.env.SMS_PROVIDER || 'console';

const pool = DATABASE_URL
  ? new Pool({
      connectionString: DATABASE_URL,
      ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
    })
  : null;

const DEFAULT_QUOTE = '今天不用很厉害，能把自己带到晚上就很好。';
const DEFAULT_WEATHER = '☀️ 晴';
const OTP_EXPIRES_SECONDS = 60;
const ACCESS_TOKEN_SECONDS = 60 * 60 * 24 * 30;
const MAX_JOURNAL_PHOTOS = 3;
const MAX_AVATAR_BYTES = 5 * 1024 * 1024;
const PASSWORD_SCRYPT_KEY_BYTES = 64;
const PASSWORD_MAX_ATTEMPTS = 5;
const OTP_MAX_ATTEMPTS = 5;

function requireConfig(name, value) {
  if (!value) {
    const error = new Error(`服务配置缺失：${name}`);
    error.statusCode = 500;
    throw error;
  }
}

function requireDatabase() {
  if (!pool) {
    const error = new Error('数据库还没有配置 DATABASE_URL');
    error.statusCode = 500;
    throw error;
  }
  return pool;
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'content-type, authorization',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
    'Content-Type': 'application/json; charset=utf-8',
  });
  res.end(JSON.stringify(payload));
}

function sendError(res, error) {
  const statusCode = error.statusCode || 500;
  const message = statusCode >= 500 ? '服务器开小差了，请稍后再试' : error.message;
  if (statusCode >= 500) console.error(error);
  sendJson(res, statusCode, { error: message });
}

async function parseJson(req) {
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > 1024 * 1024) {
      const error = new Error('请求内容太大');
      error.statusCode = 413;
      throw error;
    }
    chunks.push(chunk);
  }

  if (chunks.length === 0) return {};

  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    const error = new Error('请求格式不正确');
    error.statusCode = 400;
    throw error;
  }
}

function normalizePhone(value) {
  const compact = String(value || '').replace(/[\s-]/g, '');
  if (/^\+861\d{10}$/.test(compact)) return compact;
  if (/^861\d{10}$/.test(compact)) return `+${compact}`;
  if (/^1\d{10}$/.test(compact)) return `+86${compact}`;
  if (/^\+[1-9]\d{6,14}$/.test(compact)) return compact;

  const error = new Error('请输入正确的手机号');
  error.statusCode = 400;
  throw error;
}

function phoneForAliyun(phoneE164) {
  return phoneE164.startsWith('+86') ? phoneE164.slice(3) : phoneE164.replace(/^\+/, '');
}

function maskPhone(phoneE164) {
  if (!phoneE164) return '手机号未绑定';
  const national = phoneE164.startsWith('+86') ? phoneE164.slice(3) : phoneE164;
  if (/^\d{11}$/.test(national)) return `${national.slice(0, 3)}****${national.slice(-4)}`;
  return `${phoneE164.slice(0, 4)}****${phoneE164.slice(-3)}`;
}

function todayIso(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

async function requireTodayConfirmed(userId) {
  const { rows } = await requireDatabase().query(
    `select id
     from checkins
     where user_id = $1 and checkin_date = $2 and confirmed_at is not null`,
    [userId, todayIso()],
  );
  if (!rows[0]) {
    const error = new Error('请先确认今天还在');
    error.statusCode = 409;
    throw error;
  }
  return rows[0];
}

function requestError(message, statusCode = 400) {
  return Object.assign(new Error(message), { statusCode });
}

function isOwnedJournalPhotoKey(key, userId, date) {
  return typeof key === 'string'
    && key.startsWith(`journal-photos/${userId}/${date}/`)
    && /^[a-zA-Z0-9_-]+\.(?:jpg|jpeg|png|webp|heic)$/.test(key.slice(`journal-photos/${userId}/${date}/`.length));
}

async function withTodayCheckinLock(userId, date, action) {
  if (date !== todayIso()) throw requestError('日期已变化，请刷新今天的记录后重试', 409);
  const client = await requireDatabase().connect();
  try {
    await client.query('begin');
    const { rows } = await client.query(
      `select journal_text, journal_photo_paths from checkins
       where user_id = $1 and checkin_date = $2 and confirmed_at is not null for update`,
      [userId, date],
    );
    if (!rows[0]) throw requestError('请先确认今天还在', 409);
    const result = await action(client, rows[0]);
    await client.query('commit');
    return result;
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}

function localDateFromIso(value) {
  return todayIso(new Date(value));
}

function calculateStreak(checkins) {
  const dates = new Set(checkins.map((item) => item.checkin_date));
  const cursor = new Date(`${todayIso()}T00:00:00+08:00`);
  let streak = 0;

  // Before today's confirmation, keep showing the streak completed through
  // yesterday. The streak only breaks after a full calendar day is missed.
  if (!dates.has(todayIso())) cursor.setDate(cursor.getDate() - 1);

  while (dates.has(todayIso(cursor))) {
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }

  return streak;
}

function formatLastSeen(checkins) {
  if (checkins.length === 0) return '还没出现';
  const latest = checkins[0];
  if (latest.checkin_date === todayIso()) return '今天';

  const latestDate = new Date(`${latest.checkin_date}T00:00:00+08:00`);
  const today = new Date(`${todayIso()}T00:00:00+08:00`);
  const diff = Math.floor((today.getTime() - latestDate.getTime()) / 86400000);
  if (diff === 1) return '昨天';
  return `${diff} 天前`;
}

function base64url(input) {
  return Buffer.from(input).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function signAccessToken(user) {
  requireConfig('JWT_SECRET', JWT_SECRET);
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = base64url(
    JSON.stringify({
      exp: now + ACCESS_TOKEN_SECONDS,
      iat: now,
      phone: user.phone_e164,
      sub: user.id,
      ver: Number(user.auth_version || 1),
    }),
  );
  const data = `${header}.${payload}`;
  const signature = base64url(crypto.createHmac('sha256', JWT_SECRET).update(data).digest());
  return `${data}.${signature}`;
}

function verifyAccessToken(token) {
  requireConfig('JWT_SECRET', JWT_SECRET);
  const parts = String(token || '').split('.');
  if (parts.length !== 3) {
    const error = new Error('登录已失效，请重新登录');
    error.statusCode = 401;
    throw error;
  }

  const [header, payload, signature] = parts;
  const expected = base64url(crypto.createHmac('sha256', JWT_SECRET).update(`${header}.${payload}`).digest());
  if (!/^[A-Za-z0-9_-]+$/.test(signature) || Buffer.byteLength(signature) !== Buffer.byteLength(expected)) {
    const error = new Error('登录已失效，请重新登录');
    error.statusCode = 401;
    throw error;
  }
  if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) {
    const error = new Error('登录已失效，请重新登录');
    error.statusCode = 401;
    throw error;
  }

  let claims;
  try {
    claims = JSON.parse(Buffer.from(payload.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
  } catch {
    const error = new Error('登录已失效，请重新登录');
    error.statusCode = 401;
    throw error;
  }
  if (!claims || !Number.isSafeInteger(claims.exp) || claims.exp <= Math.floor(Date.now() / 1000)) {
    const error = new Error('登录已过期，请重新登录');
    error.statusCode = 401;
    throw error;
  }
  if (typeof claims.sub !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(claims.sub)
      || (claims.ver !== undefined && (!Number.isSafeInteger(claims.ver) || claims.ver < 1))) {
    const error = new Error('登录已失效，请重新登录');
    error.statusCode = 401;
    throw error;
  }
  return claims;
}

async function requireUser(req) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  const claims = verifyAccessToken(token);
  const authVersion = Number.isInteger(claims.ver) && claims.ver > 0 ? claims.ver : 1;
  const { rows } = await requireDatabase().query(
    `select u.id, u.phone_e164, p.nickname, p.avatar_color, p.show_status_to_friends, p.started_on
     from app_users u
     join profiles p on p.user_id = u.id
     where u.id = $1 and u.auth_version = $2 and u.disabled_at is null`,
    [claims.sub, authVersion],
  );

  if (!rows[0]) {
    const error = new Error('登录已失效，请重新登录');
    error.statusCode = 401;
    throw error;
  }
  return rows[0];
}

function otpHash(phoneE164, code) {
  requireConfig('OTP_SECRET', OTP_SECRET);
  return crypto.createHmac('sha256', OTP_SECRET).update(`${phoneE164}:${code}`).digest('hex');
}

function secureHashEqual(left, right) {
  const leftBuffer = Buffer.from(String(left || ''));
  const rightBuffer = Buffer.from(String(right || ''));
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function normalizePassword(value) {
  const password = String(value || '');
  if (password.length < 8 || password.length > 64 || !/[A-Za-z]/.test(password) || !/\d/.test(password)) {
    const error = new Error('密码需为 8 至 64 位，并同时包含字母和数字');
    error.statusCode = 400;
    throw error;
  }
  return password;
}

function scryptPassword(password, salt) {
  return new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, PASSWORD_SCRYPT_KEY_BYTES, (error, derivedKey) => {
      if (error) reject(error);
      else resolve(derivedKey);
    });
  });
}

async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const derivedKey = await scryptPassword(password, salt);
  return `scrypt$${salt.toString('base64')}$${derivedKey.toString('base64')}`;
}

async function verifyPassword(password, encodedHash) {
  const [algorithm, saltBase64, hashBase64] = String(encodedHash || '').split('$');
  if (algorithm !== 'scrypt' || !saltBase64 || !hashBase64) return false;
  const expected = Buffer.from(hashBase64, 'base64');
  if (expected.length !== PASSWORD_SCRYPT_KEY_BYTES) return false;
  const actual = await scryptPassword(password, Buffer.from(saltBase64, 'base64'));
  return crypto.timingSafeEqual(actual, expected);
}

async function requireAccountNotDeleting(client, userId) {
  const deletionResult = await client.query(
    `select user_id
     from account_deletion_requests
     where user_id = $1 and status in ('pending', 'personal_data_deleted', 'content_deleted')`,
    [userId],
  );
  if (deletionResult.rows[0]) {
    const error = new Error('账户注销处理中，暂不能登录。');
    error.statusCode = 403;
    throw error;
  }
}

function randomCode() {
  return String(crypto.randomInt(0, 1000000)).padStart(6, '0');
}

function aliyunEncode(value) {
  return encodeURIComponent(value).replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
}

function ossConfig() {
  return {
    accessKeyId: process.env.ALIYUN_OSS_ACCESS_KEY_ID || process.env.ALIYUN_ACCESS_KEY_ID || '',
    accessKeySecret: process.env.ALIYUN_OSS_ACCESS_KEY_SECRET || process.env.ALIYUN_ACCESS_KEY_SECRET || '',
    bucket: process.env.ALIYUN_OSS_BUCKET || '',
    region: process.env.ALIYUN_OSS_REGION || 'oss-cn-beijing',
  };
}

function ossEndpoint() {
  const { bucket, region } = ossConfig();
  return `https://${bucket}.${region}.aliyuncs.com`;
}

function photoExtension(fileName, contentType) {
  const lower = String(fileName || '').split('?')[0].toLowerCase();
  if (lower.endsWith('.png') || contentType === 'image/png') return 'png';
  if (lower.endsWith('.webp') || contentType === 'image/webp') return 'webp';
  if (lower.endsWith('.heic') || contentType === 'image/heic') return 'heic';
  return 'jpg';
}

function requireOssConfig() {
  const config = ossConfig();
  requireConfig('ALIYUN_OSS_BUCKET', config.bucket);
  requireConfig('ALIYUN_OSS_ACCESS_KEY_ID', config.accessKeyId);
  requireConfig('ALIYUN_OSS_ACCESS_KEY_SECRET', config.accessKeySecret);
  return config;
}

function signOssGetUrl(objectKey, expiresSeconds = 900) {
  const config = requireOssConfig();
  const expires = Math.floor(Date.now() / 1000) + expiresSeconds;
  const canonical = `GET\n\n\n${expires}\n/${config.bucket}/${objectKey}`;
  const signature = crypto.createHmac('sha1', config.accessKeySecret).update(canonical).digest('base64');
  return `${ossEndpoint()}/${objectKey}?OSSAccessKeyId=${encodeURIComponent(config.accessKeyId)}&Expires=${expires}&Signature=${encodeURIComponent(signature)}`;
}

async function deleteOssObject(objectKey) {
  const config = requireOssConfig();
  const date = new Date().toUTCString();
  const canonical = `DELETE\n\n\n${date}\n/${config.bucket}/${objectKey}`;
  const signature = crypto.createHmac('sha1', config.accessKeySecret).update(canonical).digest('base64');
  const encodedKey = objectKey.split('/').map(encodeURIComponent).join('/');
  const response = await fetch(`${ossEndpoint()}/${encodedKey}`, {
    method: 'DELETE',
    signal: AbortSignal.timeout(10000),
    headers: {
      Authorization: `OSS ${config.accessKeyId}:${signature}`,
      Date: date,
    },
  });
  if (!response.ok && response.status !== 404) {
    throw new Error(`OSS 删除照片失败：${response.status}`);
  }
}

function maybeSignPhotoUrls(paths) {
  const config = ossConfig();
  if (!config.bucket || !config.accessKeyId || !config.accessKeySecret) return paths || [];
  return (paths || []).map((path) => signOssGetUrl(path));
}

async function sendAliyunSms(phoneE164, code) {
  const accessKeyId = process.env.ALIYUN_ACCESS_KEY_ID || '';
  const accessKeySecret = process.env.ALIYUN_ACCESS_KEY_SECRET || '';
  const signName = process.env.ALIYUN_SMS_SIGN_NAME || '';
  const templateCode = process.env.ALIYUN_SMS_TEMPLATE_CODE || '';
  requireConfig('ALIYUN_ACCESS_KEY_ID', accessKeyId);
  requireConfig('ALIYUN_ACCESS_KEY_SECRET', accessKeySecret);
  requireConfig('ALIYUN_SMS_SIGN_NAME', signName);
  requireConfig('ALIYUN_SMS_TEMPLATE_CODE', templateCode);

  const params = {
    AccessKeyId: accessKeyId,
    Action: 'SendSms',
    Format: 'JSON',
    PhoneNumbers: phoneForAliyun(phoneE164),
    RegionId: 'cn-hangzhou',
    SignName: signName,
    SignatureMethod: 'HMAC-SHA1',
    SignatureNonce: crypto.randomUUID(),
    SignatureVersion: '1.0',
    TemplateCode: templateCode,
    TemplateParam: JSON.stringify({ code }),
    Timestamp: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
    Version: '2017-05-25',
  };

  const canonical = Object.keys(params)
    .sort()
    .map((key) => `${aliyunEncode(key)}=${aliyunEncode(params[key])}`)
    .join('&');
  const stringToSign = `POST&%2F&${aliyunEncode(canonical)}`;
  const signature = crypto.createHmac('sha1', `${accessKeySecret}&`).update(stringToSign).digest('base64');
  const body = `Signature=${aliyunEncode(signature)}&${canonical}`;

  const response = await fetch('https://dysmsapi.aliyuncs.com/', {
    signal: AbortSignal.timeout(10000),
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const result = await response.json();
  if (!response.ok || result.Code !== 'OK') {
    const error = new Error(result.Message || result.Code || '短信发送失败');
    error.statusCode = 502;
    throw error;
  }
}

async function deliverSms(phoneE164, code) {
  if (SMS_PROVIDER === 'console') {
    console.log(`[SMS dev] ${phoneE164} code=${code}`);
    return;
  }
  if (SMS_PROVIDER === 'aliyun') {
    await sendAliyunSms(phoneE164, code);
    return;
  }

  const error = new Error('短信服务商配置不正确');
  error.statusCode = 500;
  throw error;
}

async function sendPhoneCode(req, res) {
  const body = await parseJson(req);
  const phone = normalizePhone(body.phone);
  const db = await requireDatabase().connect();
  try {
    await db.query('begin');
    await db.query('select pg_advisory_xact_lock(hashtextextended($1, 0))', [`auth:${phone}`]);
    const recent = await db.query(
      `select
         count(*) filter (where created_at >= now() - interval '60 seconds') as last_minute,
         count(*) filter (where created_at >= now() - interval '1 day') as last_day
       from otp_codes
       where phone_e164 = $1`,
      [phone],
    );
    const lastMinute = Number(recent.rows[0]?.last_minute || 0);
    const lastDay = Number(recent.rows[0]?.last_day || 0);
    if (lastMinute >= 1) {
      const error = new Error('请 60 秒后再重新发送验证码');
      error.statusCode = 429;
      throw error;
    }
    if (lastDay >= 20) {
      const error = new Error('今天验证码发送次数太多，请明天再试');
      error.statusCode = 429;
      throw error;
    }

    const code = randomCode();
    await db.query(
      `insert into otp_codes (phone_e164, code_hash, expires_at, ip_address)
       values ($1, $2, now() + interval '60 seconds', $3)`,
      [phone, otpHash(phone, code), req.socket.remoteAddress || ''],
    );
    await deliverSms(phone, code);
    await db.query('commit');
    sendJson(res, 200, { expiresIn: OTP_EXPIRES_SECONDS, ok: true, phoneMasked: maskPhone(phone) });
  } catch (error) {
    await db.query('rollback').catch(() => {});
    throw error;
  } finally {
    db.release();
  }
}

async function verifyPhoneCode(req, res, requireNewPassword = false) {
  const body = await parseJson(req);
  const phone = normalizePhone(body.phone);
  const code = String(body.code || '').trim();
  const newPassword = body.newPassword === undefined ? '' : normalizePassword(body.newPassword);
  if (requireNewPassword && !newPassword) {
    const error = new Error('请设置新的登录密码');
    error.statusCode = 400;
    throw error;
  }
  if (!/^\d{6}$/.test(code)) {
    const error = new Error('请输入 6 位验证码');
    error.statusCode = 400;
    throw error;
  }

  const db = requireDatabase();
  const client = await db.connect();
  let transactionCommitted = false;
  try {
    await client.query('begin');
    await client.query('select pg_advisory_xact_lock(hashtextextended($1, 0))', [`auth:${phone}`]);
    const codeResult = await client.query(
      `select id, code_hash, expires_at, consumed_at, failed_attempts
       from otp_codes
       where phone_e164 = $1
       order by created_at desc, id desc
       limit 1
       for update`,
      [phone],
    );
    const latest = codeResult.rows[0];
    if (!latest || new Date(latest.expires_at).getTime() < Date.now()) {
      const error = new Error('验证码已过期，请重新获取');
      error.statusCode = 400;
      throw error;
    }
    if (Number(latest.failed_attempts || 0) >= OTP_MAX_ATTEMPTS) {
      const error = new Error('验证码尝试次数过多，请重新获取');
      error.statusCode = 429;
      throw error;
    }
    if (latest.consumed_at) {
      const error = new Error('验证码已使用，请重新获取');
      error.statusCode = 400;
      throw error;
    }
    if (!secureHashEqual(latest.code_hash, otpHash(phone, code))) {
      const attempts = await client.query(
        `update otp_codes
         set failed_attempts = failed_attempts + 1,
             consumed_at = case when failed_attempts + 1 >= $2 then now() else consumed_at end
         where id = $1
         returning failed_attempts`,
        [latest.id, OTP_MAX_ATTEMPTS],
      );
      const nextAttempts = Number(attempts.rows[0]?.failed_attempts || OTP_MAX_ATTEMPTS);
      await client.query('commit');
      transactionCommitted = true;
      const error = new Error(
        nextAttempts >= OTP_MAX_ATTEMPTS
          ? '验证码尝试次数过多，请重新获取'
          : `验证码不正确，还可尝试 ${OTP_MAX_ATTEMPTS - nextAttempts} 次`,
      );
      error.statusCode = nextAttempts >= OTP_MAX_ATTEMPTS ? 429 : 400;
      throw error;
    }
    await client.query('update otp_codes set consumed_at = now() where id = $1', [latest.id]);
    const passwordHash = newPassword ? await hashPassword(newPassword) : '';
    const userResult = await client.query(
      `insert into app_users (phone_e164, last_login_at)
       values ($1, now())
       on conflict (phone_e164)
       do update set last_login_at = excluded.last_login_at
       returning id, phone_e164, auth_version, disabled_at`,
      [phone],
    );
    let user = userResult.rows[0];
    if (user.disabled_at) {
      const error = new Error('账户不可用，请联系支持');
      error.statusCode = 403;
      throw error;
    }
    await client.query(
      `insert into profiles (user_id, nickname, avatar_color)
       values ($1, $2, $3)
       on conflict (user_id) do nothing`,
      [user.id, `用户${phone.slice(-4)}`, '#9be27c'],
    );
    await requireAccountNotDeleting(client, user.id);
    if (passwordHash) {
      await client.query(
        `insert into user_password_credentials (user_id, password_hash)
         values ($1, $2)
         on conflict (user_id)
         do update set password_hash = excluded.password_hash,
                       failed_attempts = 0,
                       locked_until = null,
                       password_set_at = now(),
                       updated_at = now()`,
        [user.id, passwordHash],
      );
      const versionResult = await client.query(
        `update app_users
         set auth_version = auth_version + 1
         where id = $1
         returning id, phone_e164, auth_version`,
        [user.id],
      );
      user = versionResult.rows[0];
    }
    await client.query('commit');
    transactionCommitted = true;
    sendJson(res, 200, {
      accessToken: signAccessToken(user),
      profile: await loadProfile(user.id),
    });
  } catch (error) {
    if (!transactionCommitted) await client.query('rollback').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function loginWithPassword(req, res) {
  const body = await parseJson(req);
  const phone = normalizePhone(body.phone);
  const password = typeof body.password === 'string' ? body.password : '';
  if (!password || password.length > 64) {
    const error = new Error('手机号或密码不正确');
    error.statusCode = 401;
    throw error;
  }
  const db = await requireDatabase().connect();
  let transactionCommitted = false;
  let signedInUser;
  try {
    await db.query('begin');
    // Reset and login share a phone lock so concurrent guesses cannot lose counts.
    await db.query('select pg_advisory_xact_lock(hashtextextended($1, 0))', [`auth:${phone}`]);
    const result = await db.query(
      `select u.id, u.phone_e164, u.auth_version,
              credentials.password_hash, credentials.failed_attempts, credentials.locked_until
       from app_users u
       join user_password_credentials credentials on credentials.user_id = u.id
       where u.phone_e164 = $1 and u.disabled_at is null`,
      [phone],
    );
    const credential = result.rows[0];
    if (!credential) {
      const error = new Error('手机号或密码不正确');
      error.statusCode = 401;
      throw error;
    }

    const lockedUntil = credential.locked_until ? new Date(credential.locked_until) : null;
    if (lockedUntil && lockedUntil.getTime() > Date.now()) {
      const error = new Error('密码尝试次数过多，请 15 分钟后再试或使用验证码重置密码');
      error.statusCode = 429;
      throw error;
    }
    const failedAttempts = lockedUntil ? 0 : Number(credential.failed_attempts || 0);
    const valid = await verifyPassword(password, credential.password_hash);
    if (!valid) {
      const nextAttempts = failedAttempts + 1;
      await db.query(
        `update user_password_credentials
         set failed_attempts = $2::integer,
             locked_until = case
               when $2::integer >= $3::integer then now() + interval '15 minutes'
               else null
             end
         where user_id = $1`,
        [credential.id, nextAttempts, PASSWORD_MAX_ATTEMPTS],
      );
      await db.query('commit');
      transactionCommitted = true;
      const error = new Error(
        nextAttempts >= PASSWORD_MAX_ATTEMPTS
          ? '密码尝试次数过多，请 15 分钟后再试或使用验证码重置密码'
          : '手机号或密码不正确',
      );
      error.statusCode = nextAttempts >= PASSWORD_MAX_ATTEMPTS ? 429 : 401;
      throw error;
    }

    await requireAccountNotDeleting(db, credential.id);
    await db.query(
      `update user_password_credentials
       set failed_attempts = 0, locked_until = null
       where user_id = $1`,
      [credential.id],
    );
    await db.query('update app_users set last_login_at = now() where id = $1', [credential.id]);
    await db.query('commit');
    transactionCommitted = true;
    signedInUser = credential;
  } catch (error) {
    if (!transactionCommitted) await db.query('rollback').catch(() => {});
    throw error;
  } finally {
    db.release();
  }
  sendJson(res, 200, {
    accessToken: signAccessToken(signedInUser),
    profile: await loadProfile(signedInUser.id),
  });
}

async function loadProfile(userId) {
  const { rows } = await requireDatabase().query(
    `select u.id, u.phone_e164, p.nickname, p.avatar_color, p.show_status_to_friends, p.started_on,
            avatar.object_key as avatar_object_key,
            (credentials.user_id is not null) as password_configured
     from app_users u
     join profiles p on p.user_id = u.id
     left join profile_avatars avatar on avatar.user_id = u.id
     left join user_password_credentials credentials on credentials.user_id = u.id
     where u.id = $1`,
    [userId],
  );
  const row = rows[0];
  return {
    avatarColor: row.avatar_color,
    avatarUrl: row.avatar_object_key ? signOssGetUrl(row.avatar_object_key) : '',
    id: row.id,
    nickname: row.nickname,
    passwordConfigured: Boolean(row.password_configured),
    phoneE164: row.phone_e164,
    phoneMasked: maskPhone(row.phone_e164),
    showStatusToFriends: row.show_status_to_friends,
  };
}

function mapTodo(row) {
  return {
    done: row.done,
    id: String(row.id),
    important: row.important,
    text: row.text,
  };
}

function mapPersonalMessage(row) {
  return {
    id: String(row.id),
    message: row.message_text,
    recipientName: row.recipient_name,
  };
}

async function loadSnapshot(req, res) {
  const user = await requireUser(req);
  const db = requireDatabase();
  const today = todayIso();
  const [
    checkinsResult,
    todosResult,
    friendshipsResult,
    pokesResult,
    personalMessagesResult,
    confirmedDatesResult,
    registeredPhotosResult,
  ] = await Promise.all([
    db.query(
      `select checkin_date::text, status_text, quote_text, quote_saved_at, journal_text, journal_photo_paths, weather_text, confirmed_at
       from checkins
       where user_id = $1
       order by checkin_date desc
       limit 90`,
      [user.id],
    ),
    db.query(
      `select id, todo_date::text, text, done, important
       from todos
       where user_id = $1
       order by todo_date desc, created_at`,
      [user.id],
    ),
    db.query(
      `select f.id, f.requester_id, f.addressee_id, f.status, f.accepted_at, f.created_at,
              requester.nickname as requester_nickname,
              requester.avatar_color as requester_color,
              requester_avatar.object_key as requester_avatar_object_key,
              requester.show_status_to_friends as requester_show_status,
              requester.started_on as requester_started_on,
              requester_user.phone_e164 as requester_phone,
              addressee.nickname as addressee_nickname,
              addressee.avatar_color as addressee_color,
              addressee_avatar.object_key as addressee_avatar_object_key,
              addressee.show_status_to_friends as addressee_show_status,
              addressee.started_on as addressee_started_on,
              addressee_user.phone_e164 as addressee_phone
       from friendships f
       join profiles requester on requester.user_id = f.requester_id
       left join profile_avatars requester_avatar on requester_avatar.user_id = f.requester_id
       join app_users requester_user on requester_user.id = f.requester_id
       join profiles addressee on addressee.user_id = f.addressee_id
       left join profile_avatars addressee_avatar on addressee_avatar.user_id = f.addressee_id
       join app_users addressee_user on addressee_user.id = f.addressee_id
       where (f.requester_id = $1 or f.addressee_id = $1) and f.status <> 'blocked'
       order by f.created_at desc`,
      [user.id],
    ),
    db.query(
      `select p.id, p.sender_id, p.receiver_id, p.poke_type, p.signal_date::text, p.created_at,
              acknowledgement.acknowledged_at,
              sender_profile.nickname as sender_nickname,
              sender_profile.avatar_color as sender_color,
              receiver_profile.nickname as receiver_nickname,
              receiver_profile.avatar_color as receiver_color
       from pokes p
       left join alive_reply_acknowledgements acknowledgement
         on acknowledgement.reply_id = p.id and acknowledgement.receiver_id = $1
       join profiles sender_profile on sender_profile.user_id = p.sender_id
       join profiles receiver_profile on receiver_profile.user_id = p.receiver_id
       where p.sender_id = $1 or p.receiver_id = $1
       order by p.created_at desc
       limit 80`,
      [user.id],
    ),
    db.query(
      `select id, recipient_name, message_text
       from personal_messages
       where user_id = $1
       order by position, id`,
      [user.id],
    ),
    db.query(
      `select checkin_date::text
       from checkins
       where user_id = $1 and confirmed_at is not null
       order by checkin_date desc`,
      [user.id],
    ),
    db.query(
      `select object_key, checkin_date::text from journal_photos
       where user_id = $1 and deleted_at is null`,
      [user.id],
    ),
  ]);

  // Never sign paths merely because an old client placed them in an array.
  const registeredPhotos = new Set(registeredPhotosResult.rows
    .filter((photo) => isOwnedJournalPhotoKey(photo.object_key, user.id, photo.checkin_date))
    .map((photo) => photo.object_key));
  const checkins = checkinsResult.rows.map((checkin) => ({
    ...checkin,
    journal_photo_paths: (checkin.journal_photo_paths || []).filter((key) =>
      registeredPhotos.has(key) && isOwnedJournalPhotoKey(key, user.id, checkin.checkin_date)),
  }));
  const confirmedCheckins = checkins.filter((item) => Boolean(item.confirmed_at));
  const todoRows = todosResult.rows;
  const todayCheckin = checkins.find((item) => item.checkin_date === today);
  const todayConfirmedCheckin = confirmedCheckins.find((item) => item.checkin_date === today);
  const todosByDate = new Map();
  for (const todo of todoRows) {
    const list = todosByDate.get(todo.todo_date) || [];
    list.push(mapTodo(todo));
    todosByDate.set(todo.todo_date, list);
  }

  const acceptedFriendIds = new Set();
  const friendAcceptedAt = new Map();
  const friends = friendshipsResult.rows
    .filter((row) => row.status === 'accepted')
    .map((row) => {
      const isRequester = row.requester_id === user.id;
      const friend = {
        avatar_color: isRequester ? row.addressee_color : row.requester_color,
        avatar_object_key: isRequester ? row.addressee_avatar_object_key : row.requester_avatar_object_key,
        id: isRequester ? row.addressee_id : row.requester_id,
        nickname: isRequester ? row.addressee_nickname : row.requester_nickname,
        phone_e164: isRequester ? row.addressee_phone : row.requester_phone,
        show_status_to_friends: isRequester ? row.addressee_show_status : row.requester_show_status,
        started_on: isRequester ? row.addressee_started_on : row.requester_started_on,
      };
      acceptedFriendIds.add(friend.id);
      friendAcceptedAt.set(friend.id, row.accepted_at || row.created_at);
      return friend;
    });

  const visibleFriendIds = friends.filter((friend) => friend.show_status_to_friends).map((friend) => friend.id);
  const friendCheckins = visibleFriendIds.length
    ? (
        await db.query(
          `select user_id, checkin_date::text, status_text
           from checkins
           where user_id = any($1::uuid[]) and confirmed_at is not null
           order by checkin_date desc`,
          [visibleFriendIds],
        )
      ).rows
    : [];
  const checkinsByUser = new Map();
  for (const row of friendCheckins) {
    const list = checkinsByUser.get(row.user_id) || [];
    list.push(row);
    checkinsByUser.set(row.user_id, list);
  }

  const visibleFriends = friends.map((friend) => {
    const rows = checkinsByUser.get(friend.id) || [];
    const todays = friend.show_status_to_friends ? rows.find((item) => item.checkin_date === today) : null;
    return {
      aliveToday: Boolean(todays),
      avatarUrl: friend.avatar_object_key ? signOssGetUrl(friend.avatar_object_key) : '',
      color: friend.avatar_color,
      days: friend.show_status_to_friends ? rows.length : null,
      id: friend.id,
      lastSeen: friend.show_status_to_friends ? formatLastSeen(rows) : '不展示状态',
      mood: friend.show_status_to_friends ? (todays?.status_text || rows[0]?.status_text || '还没有向你确认今天的状态。') : '',
      name: friend.nickname,
      phoneMasked: maskPhone(friend.phone_e164),
      statusVisible: Boolean(friend.show_status_to_friends),
      streak: friend.show_status_to_friends ? calculateStreak(rows) : null,
    };
  });

  const friendRequests = friendshipsResult.rows
    .filter((row) => row.status === 'pending')
    .map((row) => {
      const incoming = row.addressee_id === user.id;
      return {
        avatarUrl: incoming
          ? row.requester_avatar_object_key
            ? signOssGetUrl(row.requester_avatar_object_key)
            : ''
          : row.addressee_avatar_object_key
            ? signOssGetUrl(row.addressee_avatar_object_key)
            : '',
        color: incoming ? row.requester_color : row.addressee_color,
        direction: incoming ? 'incoming' : 'outgoing',
        id: String(row.id),
        name: incoming ? row.requester_nickname : row.addressee_nickname,
        phoneMasked: maskPhone(incoming ? row.requester_phone : row.addressee_phone),
      };
    });

  const relatedPokes = pokesResult.rows.filter((poke) => {
    const friendId = poke.sender_id === user.id ? poke.receiver_id : poke.sender_id;
    const acceptedAt = friendAcceptedAt.get(friendId);
    return acceptedFriendIds.has(friendId) && acceptedAt && new Date(poke.created_at) >= new Date(acceptedAt);
  });
  const incomingPokes = relatedPokes
    .filter((poke) => poke.receiver_id === user.id && poke.poke_type === 'poke' && poke.signal_date === today)
    .filter(
      (poke) =>
        !relatedPokes.some(
          (reply) =>
            reply.sender_id === user.id &&
            reply.receiver_id === poke.sender_id &&
            reply.poke_type === 'alive_reply' &&
            reply.signal_date === today &&
            new Date(reply.created_at) >= new Date(poke.created_at),
        ),
    )
    .map((poke) => ({
      createdAt: poke.created_at,
      friendColor: poke.sender_color,
      friendId: poke.sender_id,
      friendName: poke.sender_nickname,
      id: String(poke.id),
    }));
  const aliveReplies = relatedPokes
    .filter((poke) => poke.receiver_id === user.id && poke.poke_type === 'alive_reply' && poke.signal_date === today)
    .map((poke) => ({
      acknowledgedAt: poke.acknowledged_at,
      createdAt: poke.created_at,
      friendColor: poke.sender_color,
      friendId: poke.sender_id,
      friendName: poke.sender_nickname,
      id: String(poke.id),
    }));
  const sentPokes = relatedPokes
    .filter((poke) => poke.sender_id === user.id && poke.poke_type === 'poke' && poke.signal_date === today)
    .map((poke) => ({
      createdAt: poke.created_at,
      friendColor: poke.receiver_color,
      friendId: poke.receiver_id,
      friendName: poke.receiver_nickname,
      id: String(poke.id),
    }));

  sendJson(res, 200, {
    aliveDays: confirmedDatesResult.rows.length,
    aliveReplies,
    checkinDate: today,
    checkedIn: Boolean(todayConfirmedCheckin),
    diaryEntries: confirmedCheckins.map((checkin) => ({
      date: checkin.checkin_date,
      journalText: checkin.journal_text || '',
      photoUrls: maybeSignPhotoUrls(checkin.journal_photo_paths || []),
      quoteText: checkin.quote_saved_at ? checkin.quote_text : '',
      statusText: checkin.status_text || '',
      todos: todosByDate.get(checkin.checkin_date) || [],
      weatherText: checkin.weather_text || DEFAULT_WEATHER,
    })),
    friendRequests,
    friends: visibleFriends,
    incomingPokes,
    journalPhotoPaths: todayCheckin?.journal_photo_paths || [],
    journalPhotoUrls: maybeSignPhotoUrls(todayCheckin?.journal_photo_paths || []),
    journalText: todayCheckin?.journal_text || '',
    personalMessages: personalMessagesResult.rows.map(mapPersonalMessage),
    profile: await loadProfile(user.id),
    quoteText: todayCheckin?.quote_text || DEFAULT_QUOTE,
    quoteSaved: Boolean(todayCheckin?.quote_saved_at),
    sentPokes,
    statusText: todayCheckin?.status_text || '',
    streak: calculateStreak(confirmedDatesResult.rows),
    todos: todosByDate.get(today) || [],
    weatherText: todayCheckin?.weather_text || DEFAULT_WEATHER,
  });
}

async function updateProfile(req, res) {
  const user = await requireUser(req);
  const body = await parseJson(req);
  const nickname = String(body.nickname || '').trim().slice(0, 20);
  if (!nickname) {
    const error = new Error('昵称不能为空');
    error.statusCode = 400;
    throw error;
  }
  await requireDatabase().query('update profiles set nickname = $1 where user_id = $2', [nickname, user.id]);
  sendJson(res, 200, { ok: true, profile: await loadProfile(user.id) });
}

async function updatePrivacy(req, res) {
  const user = await requireUser(req);
  const body = await parseJson(req);
  await requireDatabase().query('update profiles set show_status_to_friends = $1 where user_id = $2', [
    Boolean(body.showStatusToFriends),
    user.id,
  ]);
  sendJson(res, 200, { ok: true, profile: await loadProfile(user.id) });
}

async function createProfileAvatarUploadPolicy(req, res) {
  const user = await requireUser(req);
  const body = await parseJson(req);
  const contentType = String(body.contentType || 'image/jpeg').toLowerCase();
  if (!contentType.startsWith('image/')) {
    const error = new Error('头像必须是图片');
    error.statusCode = 400;
    throw error;
  }

  const config = requireOssConfig();
  const ext = photoExtension(body.fileName, contentType);
  // Reuse the existing least-privilege OSS prefix already granted to this service.
  // Avatars stay isolated from journal entries in their own per-user subdirectory.
  const objectKey = `journal-photos/${user.id}/profile-avatar/${Date.now()}-${crypto.randomBytes(4).toString('hex')}.${ext}`;
  const expiration = new Date(Date.now() + 5 * 60 * 1000).toISOString();
  const policy = Buffer.from(
    JSON.stringify({
      conditions: [
        ['eq', '$key', objectKey],
        ['content-length-range', 1, MAX_AVATAR_BYTES],
        ['starts-with', '$Content-Type', 'image/'],
      ],
      expiration,
    }),
  ).toString('base64');
  const signature = crypto.createHmac('sha1', config.accessKeySecret).update(policy).digest('base64');

  sendJson(res, 200, {
    fields: {
      'Content-Type': contentType,
      OSSAccessKeyId: config.accessKeyId,
      key: objectKey,
      policy,
      signature,
      success_action_status: '200',
    },
    objectKey,
    uploadUrl: ossEndpoint(),
  });
}

async function confirmProfileAvatar(req, res) {
  const user = await requireUser(req);
  const body = await parseJson(req);
  const objectKey = String(body.objectKey || '').trim();
  const contentType = String(body.contentType || 'image/jpeg').toLowerCase();
  const byteSize = Number(body.byteSize || 0);
  if (!objectKey.startsWith(`journal-photos/${user.id}/profile-avatar/`)) {
    const error = new Error('头像路径不正确');
    error.statusCode = 400;
    throw error;
  }
  if (!contentType.startsWith('image/') || !Number.isFinite(byteSize) || byteSize <= 0 || byteSize > MAX_AVATAR_BYTES) {
    const error = new Error('头像文件不符合要求');
    error.statusCode = 400;
    throw error;
  }

  const db = requireDatabase();
  const current = await db.query('select object_key from profile_avatars where user_id = $1', [user.id]);
  const previousObjectKey = current.rows[0]?.object_key || '';
  await db.query(
    `insert into profile_avatars (user_id, object_key, content_type, byte_size)
     values ($1, $2, $3, $4)
     on conflict (user_id)
     do update set object_key = excluded.object_key,
                   content_type = excluded.content_type,
                   byte_size = excluded.byte_size,
                   updated_at = now()`,
    [user.id, objectKey, contentType, byteSize],
  );

  if (previousObjectKey && previousObjectKey !== objectKey) {
    deleteOssObject(previousObjectKey).catch((error) => console.error('Old avatar cleanup failed:', error));
  }
  sendJson(res, 200, { avatarUrl: signOssGetUrl(objectKey), ok: true, path: objectKey });
}

async function savePersonalMessages(req, res) {
  const user = await requireUser(req);
  const body = await parseJson(req);
  const requested = Array.isArray(body.personalMessages) ? body.personalMessages : [];
  if (requested.length > 3) {
    const error = new Error('最多只能添加三位留言对象');
    error.statusCode = 400;
    throw error;
  }

  const personalMessages = requested.map((item) => ({
    message: String(item?.message || '').trim(),
    recipientName: String(item?.recipientName || '').trim(),
  }));
  if (personalMessages.some((item) => !item.recipientName || !item.message)) {
    const error = new Error('请填写每位对象的称呼和留言内容');
    error.statusCode = 400;
    throw error;
  }
  if (personalMessages.some((item) => item.recipientName.length > 20 || item.message.length > 600)) {
    const error = new Error('对象称呼最多 20 字，留言最多 600 字');
    error.statusCode = 400;
    throw error;
  }

  const client = await requireDatabase().connect();
  try {
    await client.query('begin');
    await client.query('delete from personal_messages where user_id = $1', [user.id]);
    const saved = [];
    for (const [index, item] of personalMessages.entries()) {
      const { rows } = await client.query(
        `insert into personal_messages (user_id, recipient_name, message_text, position)
         values ($1, $2, $3, $4)
         returning id, recipient_name, message_text`,
        [user.id, item.recipientName, item.message, index + 1],
      );
      saved.push(mapPersonalMessage(rows[0]));
    }
    await client.query('commit');
    sendJson(res, 200, { ok: true, personalMessages: saved });
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}

async function saveTodayCheckin(req, res) {
  const user = await requireUser(req);
  const body = await parseJson(req);
  const today = todayIso();
  // Legacy clients send a full stale snapshot after uploads. Accept harmless
  // acknowledgements only; changing text now requires the conflict-safe endpoint.
  if (Array.isArray(body.journalPhotoPaths)
      && body.journalPhotoPaths.some((key) => !isOwnedJournalPhotoKey(key, user.id, today))) {
    throw requestError('照片不属于当前账号或今天的记录', 403);
  }
  await withTodayCheckinLock(user.id, today, async (_client, current) => {
    if (typeof body.journalText !== 'string' || body.journalText !== current.journal_text) {
      throw requestError('请更新 App 后再保存随笔，以保护已保存的内容', 426);
    }
  });
  sendJson(res, 200, { ok: true });
}

async function saveTodayJournal(req, res) {
  const user = await requireUser(req);
  const body = await parseJson(req);
  if (typeof body.journalText !== 'string' || typeof body.expectedJournalText !== 'string'
      || typeof body.checkinDate !== 'string') {
    throw requestError('随笔内容或版本信息不完整，请刷新后重试');
  }
  await withTodayCheckinLock(user.id, body.checkinDate, async (client, current) => {
    if (current.journal_text !== body.expectedJournalText && current.journal_text !== body.journalText) {
      throw requestError('随笔已在其他地方更新，你的草稿已保留，请查看最新内容后再保存', 409);
    }
    await client.query(
      'update checkins set journal_text = $3 where user_id = $1 and checkin_date = $2',
      [user.id, body.checkinDate, body.journalText],
    );
  });
  sendJson(res, 200, { ok: true, journalText: body.journalText });
}

async function saveTodayQuote(req, res) {
  const user = await requireUser(req);
  const body = await parseJson(req);
  const quoteText = String(body.quoteText || '').trim();
  if (!quoteText || quoteText.length > 96) {
    const error = new Error('每日箴言需为 1–96 字');
    error.statusCode = 400;
    throw error;
  }

  const { rows } = await requireDatabase().query(
    `update checkins
     set quote_text = $3, quote_saved_at = now(), updated_at = now()
     where user_id = $1 and checkin_date = $2
       and confirmed_at is not null and quote_saved_at is null
     returning quote_text, quote_saved_at`,
    [user.id, todayIso(), quoteText],
  );
  if (!rows[0]) {
    const error = new Error('今天尚未确认，或箴言已经保存，不能再次修改');
    error.statusCode = 409;
    throw error;
  }
  sendJson(res, 200, { ok: true, quoteText: rows[0].quote_text });
}

async function confirmTodayCheckin(req, res) {
  const user = await requireUser(req);
  const body = await parseJson(req);
  const statusText = String(body.statusText || '').trim();
  const weatherText = String(body.weatherText || DEFAULT_WEATHER).trim().slice(0, 16) || DEFAULT_WEATHER;
  if (!statusText) {
    const error = new Error('请先选择今天心情');
    error.statusCode = 400;
    throw error;
  }

  const { rows } = await requireDatabase().query(
    `insert into checkins (user_id, checkin_date, status_text, weather_text, confirmed_at)
     values ($1, $2, $3, $4, now())
     on conflict (user_id, checkin_date)
     do update set
       status_text = excluded.status_text,
       weather_text = excluded.weather_text,
       confirmed_at = coalesce(checkins.confirmed_at, excluded.confirmed_at)
     returning checkin_date::text, status_text, weather_text, confirmed_at`,
    [user.id, todayIso(), statusText, weatherText],
  );
  sendJson(res, 200, { checkin: rows[0], ok: true });
}

async function createJournalPhotoUploadPolicy(req, res) {
  const user = await requireUser(req);
  await requireTodayConfirmed(user.id);
  const body = await parseJson(req);
  const contentType = String(body.contentType || 'image/jpeg');
  if (!contentType.startsWith('image/')) {
    const error = new Error('只能上传图片');
    error.statusCode = 400;
    throw error;
  }

  const today = todayIso();
  const photoCount = await requireDatabase().query(
    `select coalesce(cardinality(journal_photo_paths), 0) as count
     from checkins
     where user_id = $1 and checkin_date = $2`,
    [user.id, today],
  );
  if (Number(photoCount.rows[0]?.count || 0) >= MAX_JOURNAL_PHOTOS) {
    const error = new Error('今天最多上传 3 张照片');
    error.statusCode = 400;
    throw error;
  }

  const config = requireOssConfig();
  const ext = photoExtension(body.fileName, contentType);
  const objectKey = `journal-photos/${user.id}/${today}/${Date.now()}-${crypto.randomBytes(4).toString('hex')}.${ext}`;
  const expiration = new Date(Date.now() + 5 * 60 * 1000).toISOString();
  const policy = Buffer.from(
    JSON.stringify({
      conditions: [
        ['eq', '$key', objectKey],
        ['content-length-range', 1, 10 * 1024 * 1024],
        ['starts-with', '$Content-Type', 'image/'],
      ],
      expiration,
    }),
  ).toString('base64');
  const signature = crypto.createHmac('sha1', config.accessKeySecret).update(policy).digest('base64');

  sendJson(res, 200, {
    fields: {
      'Content-Type': contentType,
      OSSAccessKeyId: config.accessKeyId,
      key: objectKey,
      policy,
      signature,
      success_action_status: '200',
    },
    objectKey,
    uploadUrl: ossEndpoint(),
  });
}

async function confirmJournalPhoto(req, res) {
  const user = await requireUser(req);
  const body = await parseJson(req);
  const objectKey = body.objectKey;
  const today = todayIso();
  if (!isOwnedJournalPhotoKey(objectKey, user.id, today)) {
    throw requestError('照片路径或日期不正确');
  }
  const byteSize = Number(body.byteSize);
  const contentType = String(body.contentType || 'image/jpeg').toLowerCase();
  if (!contentType.startsWith('image/') || !Number.isSafeInteger(byteSize) || byteSize <= 0 || byteSize > 10 * 1024 * 1024) {
    throw requestError('照片文件不符合要求');
  }
  await withTodayCheckinLock(user.id, today, async (client, current) => {
    const paths = current.journal_photo_paths || [];
    if (!paths.includes(objectKey) && paths.length >= MAX_JOURNAL_PHOTOS) {
      throw requestError('今天最多上传 3 张照片');
    }
    const nextPaths = paths.includes(objectKey) ? paths : [...paths, objectKey];
    await client.query(
      `insert into journal_photos (user_id, checkin_date, object_key, content_type, byte_size)
       values ($1, $2, $3, $4, $5)
       on conflict (user_id, object_key) do nothing`,
      [user.id, today, objectKey, contentType, byteSize],
    );
    await client.query(
      'update checkins set journal_photo_paths = $3 where user_id = $1 and checkin_date = $2',
      [user.id, today, nextPaths],
    );
  });
  sendJson(res, 200, { ok: true, path: objectKey, signedUrl: maybeSignPhotoUrls([objectKey])[0] || objectKey });
}

async function deleteJournalPhoto(req, res) {
  const user = await requireUser(req);
  const body = await parseJson(req);
  const objectKey = body.path;
  const today = todayIso();
  if (!isOwnedJournalPhotoKey(objectKey, user.id, today)) {
    throw requestError('照片路径或日期不正确');
  }
  await withTodayCheckinLock(user.id, today, async (client) => {
    const registered = await client.query(
      'select object_key from journal_photos where user_id = $1 and object_key = $2 and checkin_date = $3',
      [user.id, objectKey, today],
    );
    if (registered.rows.length) await deleteOssObject(objectKey);
    await client.query('delete from journal_photos where user_id = $1 and object_key = $2', [user.id, objectKey]);
    await client.query(
      `update checkins set journal_photo_paths = array_remove(journal_photo_paths, $3)
       where user_id = $1 and checkin_date = $2`,
      [user.id, today, objectKey],
    );
  });
  sendJson(res, 200, { ok: true });
}

async function createTodo(req, res) {
  const user = await requireUser(req);
  const body = await parseJson(req);
  const text = String(body.text || '').trim();
  if (!text) throw requestError('先写下想做的事');
  const today = todayIso();
  const todo = await withTodayCheckinLock(user.id, today, async (client) => {
    const countResult = await client.query(
      'select count(*) as count from todos where user_id = $1 and todo_date = $2', [user.id, today],
    );
    if (Number(countResult.rows[0].count) >= 3) throw requestError('今天最多写三件事');
    const { rows } = await client.query(
      `insert into todos (user_id, todo_date, text, important)
       values ($1, $2, $3, $4) returning id, text, done, important`,
      [user.id, today, text.slice(0, 40), Boolean(body.important)],
    );
    return mapTodo(rows[0]);
  });
  sendJson(res, 200, { ok: true, todo });
}

async function patchTodo(req, res, todoId) {
  const user = await requireUser(req);
  await requireTodayConfirmed(user.id);
  const body = await parseJson(req);
  const fields = [];
  const values = [];
  if (typeof body.done === 'boolean') {
    values.push(body.done);
    fields.push(`done = $${values.length}`);
  }
  if (typeof body.important === 'boolean') {
    values.push(body.important);
    fields.push(`important = $${values.length}`);
  }
  if (fields.length === 0) {
    const error = new Error('没有可更新的内容');
    error.statusCode = 400;
    throw error;
  }
  values.push(Number(todoId), user.id);
  const { rows } = await requireDatabase().query(
    `update todos set ${fields.join(', ')}
     where id = $${values.length - 1} and user_id = $${values.length}
     returning id, text, done, important`,
    values,
  );
  if (!rows[0]) {
    const error = new Error('没有找到这件事');
    error.statusCode = 404;
    throw error;
  }
  sendJson(res, 200, { ok: true, todo: mapTodo(rows[0]) });
}

async function sendFriendRequest(req, res) {
  const user = await requireUser(req);
  const body = await parseJson(req);
  const phone = normalizePhone(body.phone);
  const db = requireDatabase();

  if (phone === user.phone_e164) {
    const error = new Error('不能添加自己');
    error.statusCode = 400;
    throw error;
  }

  const limit = await db.query(
    `select
       count(*) filter (where created_at >= now() - interval '1 hour') as last_hour,
       count(*) filter (where created_at >= now() - interval '1 day') as last_day
     from friend_request_attempts
     where requester_id = $1`,
    [user.id],
  );
  if (Number(limit.rows[0].last_hour) >= 10 || Number(limit.rows[0].last_day) >= 30) {
    const error = new Error('添加太频繁，请稍后再试');
    error.statusCode = 429;
    throw error;
  }

  const attempt = await db.query('insert into friend_request_attempts (requester_id) values ($1) returning id', [user.id]);
  const attemptId = attempt.rows[0].id;
  const client = await db.connect();
  try {
    await client.query('begin');
    const target = await client.query(
      `select u.id
       from app_users u
       left join account_deletion_requests r on r.user_id = u.id
         and r.status in ('pending', 'personal_data_deleted', 'content_deleted')
       where u.phone_e164 = $1 and u.disabled_at is null and r.user_id is null`,
      [phone],
    );
    if (!target.rows[0]) {
      const error = new Error('没有找到可添加的用户');
      error.statusCode = 404;
      throw error;
    }

    const insert = await client.query(
      `insert into friendships (requester_id, addressee_id, status)
       values ($1, $2, 'pending')
       returning id`,
      [user.id, target.rows[0].id],
    );
    await client.query('update friend_request_attempts set success = true where id = $1', [attemptId]);
    await client.query('commit');
    sendJson(res, 200, { ok: true, requestId: String(insert.rows[0].id) });
  } catch (error) {
    await client.query('rollback');
    if (error.code === '23505') {
      error.statusCode = 400;
      error.message = '已经发送过好友申请或已经是好友';
    }
    throw error;
  } finally {
    client.release();
  }
}

async function acceptFriendRequest(req, res, requestId) {
  const user = await requireUser(req);
  const db = requireDatabase();
  const client = await db.connect();
  try {
    await client.query('begin');
    const request = await client.query(
      `select requester_id, addressee_id
       from friendships
       where id = $1 and addressee_id = $2 and status = 'pending'
       for update`,
      [Number(requestId), user.id],
    );
    if (!request.rows[0]) {
      const error = new Error('没有找到这条好友申请');
      error.statusCode = 404;
      throw error;
    }
    await client.query(
      `delete from alive_reply_acknowledgements
       where reply_id in (
         select id from pokes
         where (sender_id = $1 and receiver_id = $2) or (sender_id = $2 and receiver_id = $1)
       )`,
      [request.rows[0].requester_id, request.rows[0].addressee_id],
    );
    await client.query(
      `delete from pokes
       where (sender_id = $1 and receiver_id = $2) or (sender_id = $2 and receiver_id = $1)`,
      [request.rows[0].requester_id, request.rows[0].addressee_id],
    );
    await client.query(`update friendships set status = 'accepted', accepted_at = now() where id = $1`, [Number(requestId)]);
    await client.query('commit');
    sendJson(res, 200, { ok: true });
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}

async function deleteFriend(req, res, friendId) {
  const user = await requireUser(req);
  const { rowCount } = await requireDatabase().query(
    `delete from friendships
     where status = 'accepted'
       and ((requester_id = $1 and addressee_id = $2) or (requester_id = $2 and addressee_id = $1))`,
    [user.id, friendId],
  );
  if (!rowCount) {
    const error = new Error('没有找到这个好友');
    error.statusCode = 404;
    throw error;
  }
  sendJson(res, 200, { ok: true });
}

async function ensureAcceptedFriend(userId, friendId) {
  const { rows } = await requireDatabase().query(
    `select id, accepted_at
     from friendships
     where status = 'accepted'
       and ((requester_id = $1 and addressee_id = $2) or (requester_id = $2 and addressee_id = $1))`,
    [userId, friendId],
  );
  if (!rows[0]) {
    const error = new Error('你们还不是好友');
    error.statusCode = 403;
    throw error;
  }
}

async function pokeFriend(req, res, friendId) {
  const user = await requireUser(req);
  await ensureAcceptedFriend(user.id, friendId);
  const { rowCount } = await requireDatabase().query(
    `insert into pokes (sender_id, receiver_id, poke_type, signal_date)
     values ($1, $2, 'poke', $3)
     on conflict (sender_id, receiver_id, poke_type, signal_date) do nothing`,
    [user.id, friendId, todayIso()],
  );
  sendJson(res, 200, { alreadySent: rowCount === 0, ok: true });
}

async function replyAlive(req, res, friendId) {
  const user = await requireUser(req);
  await ensureAcceptedFriend(user.id, friendId);
  const today = todayIso();
  const incoming = await requireDatabase().query(
    `select id
     from pokes
     where sender_id = $1 and receiver_id = $2 and poke_type = 'poke' and signal_date = $3`,
    [friendId, user.id, today],
  );
  if (!incoming.rows[0]) {
    const error = new Error('今天还没有收到这个好友的戳一下');
    error.statusCode = 400;
    throw error;
  }
  await requireDatabase().query(
    `insert into pokes (sender_id, receiver_id, poke_type, signal_date)
     values ($1, $2, 'alive_reply', $3)
     on conflict (sender_id, receiver_id, poke_type, signal_date) do nothing`,
    [user.id, friendId, today],
  );
  sendJson(res, 200, { ok: true });
}

async function acknowledgeAliveReply(req, res, replyId) {
  const user = await requireUser(req);
  const { rowCount } = await requireDatabase().query(
    `insert into alive_reply_acknowledgements (reply_id, receiver_id)
     select id, $2
     from pokes
     where id = $1 and receiver_id = $2 and poke_type = 'alive_reply'
     on conflict (reply_id) do update
     set acknowledged_at = alive_reply_acknowledgements.acknowledged_at`,
    [replyId, user.id],
  );
  if (rowCount === 0) {
    const error = new Error('回馈不存在');
    error.statusCode = 404;
    throw error;
  }
  sendJson(res, 200, { ok: true });
}

async function requestAccountDeletion(req, res) {
  const user = await requireUser(req);
  const db = requireDatabase();
  const client = await db.connect();
  let avatarObjectKey = '';
  try {
    await client.query('begin');
    const avatar = await client.query('select object_key from profile_avatars where user_id = $1', [user.id]);
    avatarObjectKey = avatar.rows[0]?.object_key || '';
    await client.query(
      `insert into account_deletion_requests (user_id, personal_data_delete_after, content_delete_after)
       values ($1, now() + interval '7 days', now() + interval '7 days')
       on conflict (user_id)
       do update set requested_at = now(),
                     personal_data_delete_after = now() + interval '7 days',
                     content_delete_after = now() + interval '7 days',
                     status = 'pending',
                     processed_personal_at = null,
                     processed_content_at = null,
                     cancelled_at = null`,
      [user.id],
    );
    await client.query(
      `update profiles
       set nickname = '已注销用户',
           avatar_color = '#777268',
           show_status_to_friends = false
       where user_id = $1`,
      [user.id],
    );
    await client.query('update app_users set disabled_at = now(), phone_e164 = $2 where id = $1', [
      user.id,
      `deleted:${user.id}`,
    ]);
    await client.query(
      `delete from alive_reply_acknowledgements
       where reply_id in (select id from pokes where sender_id = $1 or receiver_id = $1)`,
      [user.id],
    );
    await client.query('delete from pokes where sender_id = $1 or receiver_id = $1', [user.id]);
    await client.query('delete from friendships where requester_id = $1 or addressee_id = $1', [user.id]);
    await client.query('delete from otp_codes where phone_e164 = $1', [user.phone_e164]);
    await client.query('delete from user_password_credentials where user_id = $1', [user.id]);
    await client.query('commit');
    if (avatarObjectKey) {
      try {
        await deleteOssObject(avatarObjectKey);
        await db.query('delete from profile_avatars where user_id = $1', [user.id]);
      } catch (error) {
        console.error('Deleted account avatar cleanup deferred:', error);
      }
    }
    sendJson(res, 200, { ok: true });
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}

async function deleteAppData(req, res) {
  await requireUser(req);
  // No UI uses this legacy endpoint. Do not discard object indexes before OSS
  // deletion; the supported account-deletion workflow retains them for retries.
  throw requestError('此清空接口已停用。如需删除账户和全部内容，请使用账户注销功能', 410);
}

async function route(req, res) {
  if (req.method === 'OPTIONS') {
    sendJson(res, 200, { ok: true });
    return;
  }

  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  const path = url.pathname;

  if (req.method === 'GET' && path === '/health') {
    sendJson(res, 200, { ok: true, service: 'huozhema-domestic-backend' });
    return;
  }
  if (req.method === 'GET' && path === '/health/db') {
    await requireDatabase().query('select 1');
    sendJson(res, 200, { database: true, ok: true, service: 'huozhema-domestic-backend' });
    return;
  }
  if (req.method === 'POST' && path === '/auth/send-code') return sendPhoneCode(req, res);
  if (req.method === 'POST' && path === '/auth/verify-code') return verifyPhoneCode(req, res);
  if (req.method === 'POST' && path === '/auth/reset-password') return verifyPhoneCode(req, res, true);
  if (req.method === 'POST' && path === '/auth/password-login') return loginWithPassword(req, res);
  if (req.method === 'GET' && path === '/me/snapshot') return loadSnapshot(req, res);
  if (req.method === 'PUT' && path === '/me/profile') return updateProfile(req, res);
  if (req.method === 'PUT' && path === '/me/privacy') return updatePrivacy(req, res);
  if (req.method === 'POST' && path === '/me/avatar/upload-policy') return createProfileAvatarUploadPolicy(req, res);
  if (req.method === 'POST' && path === '/me/avatar/confirm') return confirmProfileAvatar(req, res);
  if (req.method === 'PUT' && path === '/personal-messages') return savePersonalMessages(req, res);
  if (req.method === 'DELETE' && path === '/me/app-data') return deleteAppData(req, res);
  if (req.method === 'POST' && path === '/checkins/today/confirm') return confirmTodayCheckin(req, res);
  if (req.method === 'POST' && path === '/checkins/today/quote') return saveTodayQuote(req, res);
  if (req.method === 'POST' && path === '/checkins/today') return saveTodayCheckin(req, res);
  if (req.method === 'PATCH' && path === '/checkins/today/journal') return saveTodayJournal(req, res);
  if (req.method === 'POST' && path === '/journal/photos/upload-policy') return createJournalPhotoUploadPolicy(req, res);
  if (req.method === 'POST' && path === '/journal/photos/confirm') return confirmJournalPhoto(req, res);
  if (req.method === 'DELETE' && path === '/journal/photos') return deleteJournalPhoto(req, res);
  if (req.method === 'POST' && path === '/todos') return createTodo(req, res);

  const todoPatch = path.match(/^\/todos\/(\d+)$/);
  if (req.method === 'PATCH' && todoPatch) return patchTodo(req, res, todoPatch[1]);

  if (req.method === 'POST' && path === '/friends/request') return sendFriendRequest(req, res);
  const acceptMatch = path.match(/^\/friends\/requests\/(\d+)\/accept$/);
  if (req.method === 'POST' && acceptMatch) return acceptFriendRequest(req, res, acceptMatch[1]);
  const friendMatch = path.match(/^\/friends\/([0-9a-f-]+)$/i);
  if (req.method === 'DELETE' && friendMatch) return deleteFriend(req, res, friendMatch[1]);
  const pokeMatch = path.match(/^\/friends\/([0-9a-f-]+)\/poke$/i);
  if (req.method === 'POST' && pokeMatch) return pokeFriend(req, res, pokeMatch[1]);
  const replyMatch = path.match(/^\/friends\/([0-9a-f-]+)\/alive-reply$/i);
  if (req.method === 'POST' && replyMatch) return replyAlive(req, res, replyMatch[1]);
  const acknowledgeReplyMatch = path.match(/^\/alive-replies\/(\d+)\/acknowledge$/);
  if (req.method === 'POST' && acknowledgeReplyMatch) return acknowledgeAliveReply(req, res, acknowledgeReplyMatch[1]);

  if (req.method === 'POST' && path === '/account/deletion-request') return requestAccountDeletion(req, res);

  const error = new Error('接口不存在');
  error.statusCode = 404;
  throw error;
}

const server = http.createServer((req, res) => {
  route(req, res).catch((error) => sendError(res, error));
});

if (pool) await assertDatabaseSchema(pool);

server.listen(PORT, process.env.HOST || '0.0.0.0', () => {
  console.log(`huozhema domestic backend listening on ${PORT}`);
});
