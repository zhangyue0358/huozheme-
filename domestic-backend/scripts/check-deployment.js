import { Pool } from 'pg';
import { loadEnvFile } from '../src/loadEnv.js';
import { assertDatabaseSchema } from '../src/schemaCheck.js';

loadEnvFile();
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL 未配置');
for (const key of ['JWT_SECRET', 'OTP_SECRET']) {
  if ((process.env[key] || '').length < 32) throw new Error(`${key} 必须至少 32 位`);
}
if (process.env.JWT_SECRET === process.env.OTP_SECRET) throw new Error('JWT_SECRET 和 OTP_SECRET 必须不同');
if (process.env.NODE_ENV === 'production' && process.env.SMS_PROVIDER !== 'aliyun') {
  throw new Error('生产环境必须使用阿里云短信服务');
}
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
});
try {
  await assertDatabaseSchema(pool);
  console.log(JSON.stringify({ databaseSchema: 'ready', authConfiguration: 'ready' }));
} finally {
  await pool.end();
}
