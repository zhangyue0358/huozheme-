import crypto from 'node:crypto';
import { Pool } from 'pg';
import { loadEnvFile } from '../src/loadEnv.js';

loadEnvFile();

const DATABASE_URL = process.env.DATABASE_URL || '';

if (!DATABASE_URL) {
  console.error('Missing DATABASE_URL');
  process.exit(1);
}

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
});

function requireOssConfig() {
  const config = {
    accessKeyId: process.env.ALIYUN_OSS_ACCESS_KEY_ID || process.env.ALIYUN_ACCESS_KEY_ID || '',
    accessKeySecret: process.env.ALIYUN_OSS_ACCESS_KEY_SECRET || process.env.ALIYUN_ACCESS_KEY_SECRET || '',
    bucket: process.env.ALIYUN_OSS_BUCKET || '',
    region: process.env.ALIYUN_OSS_REGION || 'oss-cn-beijing',
  };

  for (const [key, value] of Object.entries(config)) {
    if (!value) throw new Error(`Missing OSS configuration: ${key}`);
  }

  return config;
}

async function deleteOssObject(objectKey) {
  const config = requireOssConfig();
  const date = new Date().toUTCString();
  const canonical = `DELETE\n\n\n${date}\n/${config.bucket}/${objectKey}`;
  const signature = crypto.createHmac('sha1', config.accessKeySecret).update(canonical).digest('base64');
  const encodedKey = objectKey.split('/').map(encodeURIComponent).join('/');
  const endpoint = `https://${config.bucket}.${config.region}.aliyuncs.com`;
  const response = await fetch(`${endpoint}/${encodedKey}`, {
    method: 'DELETE',
    headers: {
      Authorization: `OSS ${config.accessKeyId}:${signature}`,
      Date: date,
    },
  });

  if (!response.ok && response.status !== 404) {
    const detail = (await response.text()).slice(0, 300);
    throw new Error(`OSS delete failed (${response.status}): ${detail}`);
  }
}

async function processAccountDeletionRetention() {
  const client = await pool.connect();
  const result = {
    accountsDeleted: 0,
    contentDeleted: 0,
    contentFailed: 0,
    ok: true,
    personalDataDeleted: 0,
    personalDataFailed: 0,
    photosDeleted: 0,
  };

  try {
    const personal = await client.query(
      `select deletion.user_id, avatar.object_key as avatar_object_key
       from account_deletion_requests deletion
       left join profile_avatars avatar on avatar.user_id = deletion.user_id
       where deletion.status = 'pending'
         and deletion.personal_data_delete_after <= now()`,
    );

    for (const row of personal.rows) {
      try {
        if (row.avatar_object_key) await deleteOssObject(row.avatar_object_key);
        await client.query('begin');
        await client.query('delete from friend_request_attempts where requester_id = $1', [row.user_id]);
        await client.query('delete from profile_avatars where user_id = $1', [row.user_id]);
        await client.query(
          `update profiles
           set nickname = '已注销用户',
               avatar_color = '#777268',
               show_status_to_friends = false
           where user_id = $1`,
          [row.user_id],
        );
        await client.query(
          'update app_users set disabled_at = coalesce(disabled_at, now()), phone_e164 = $2 where id = $1',
          [row.user_id, `deleted:${row.user_id}`],
        );
        await client.query(
          `update account_deletion_requests
           set status = 'personal_data_deleted',
               processed_personal_at = now()
           where user_id = $1`,
          [row.user_id],
        );
        await client.query('commit');
        result.personalDataDeleted += 1;
      } catch (error) {
        await client.query('rollback');
        result.personalDataFailed += 1;
        console.error(`Personal data cleanup failed for ${row.user_id}:`, error);
      }
    }

    const content = await client.query(
      `select user_id
       from account_deletion_requests
       where status in ('personal_data_deleted', 'content_deleted')
         and content_delete_after <= now()`,
    );

    for (const row of content.rows) {
      try {
        const photos = await client.query('select object_key from journal_photos where user_id = $1', [row.user_id]);
        for (const photo of photos.rows) {
          await deleteOssObject(photo.object_key);
          result.photosDeleted += 1;
        }

        await client.query('begin');
        const deletedAccount = await client.query('delete from app_users where id = $1', [row.user_id]);
        await client.query('commit');
        result.accountsDeleted += deletedAccount.rowCount;
        result.contentDeleted += 1;
      } catch (error) {
        try {
          await client.query('rollback');
        } catch {
          // No transaction may have started when an OSS request failed.
        }
        result.contentFailed += 1;
        console.error(`Content cleanup failed for ${row.user_id}:`, error);
      }
    }

    result.ok = result.contentFailed === 0 && result.personalDataFailed === 0;
    console.log(JSON.stringify(result));
    if (!result.ok) process.exitCode = 1;
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

processAccountDeletionRetention();
