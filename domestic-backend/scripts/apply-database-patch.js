import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { Pool } from 'pg';
import { loadEnvFile } from '../src/loadEnv.js';

loadEnvFile();

const patchArgument = process.argv[2] || '';
const patchPath = path.resolve(process.cwd(), patchArgument);
const patchDirectory = `${path.resolve(process.cwd(), 'db')}${path.sep}`;

if (!patchArgument || !patchPath.startsWith(patchDirectory) || !path.basename(patchPath).startsWith('patch_')) {
  throw new Error('请指定 db/patch_*.sql 数据库补丁');
}
if (!process.env.DATABASE_URL) {
  throw new Error('数据库还没有配置 DATABASE_URL');
}

const sql = await fs.readFile(patchPath, 'utf8');
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
});

try {
  await pool.query(sql);
  console.log(`Applied database patch: ${path.basename(patchPath)}`);
} finally {
  await pool.end();
}
