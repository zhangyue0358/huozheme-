import { createClient } from '@supabase/supabase-js';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

function readDotEnv(file) {
  const filePath = path.join(process.cwd(), file);
  if (!existsSync(filePath)) return {};

  return Object.fromEntries(
    readFileSync(filePath, 'utf8')
      .split(/\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#'))
      .map((line) => {
        const index = line.indexOf('=');
        return [line.slice(0, index), line.slice(index + 1)];
      }),
  );
}

function localDateIso(date = new Date()) {
  const timezoneOffset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - timezoneOffset).toISOString().slice(0, 10);
}

function todayStartIso() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
}

function createAdminClient() {
  const fileEnv = readDotEnv('.env');
  const supabaseUrl = process.env.SUPABASE_URL || process.env.EXPO_PUBLIC_SUPABASE_URL || fileEnv.EXPO_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl) {
    console.error('Missing SUPABASE_URL or EXPO_PUBLIC_SUPABASE_URL.');
    process.exit(1);
  }

  if (!serviceRoleKey) {
    console.error('Missing SUPABASE_SERVICE_ROLE_KEY. Use a server-only service role key, never an EXPO_PUBLIC key.');
    process.exit(1);
  }

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

async function exactCount(label, query) {
  const { count, error } = await query.select('*', { count: 'exact', head: true });
  if (error) throw new Error(`${label} count failed: ${error.message}`);
  return count ?? 0;
}

async function optionalExactCount(label, query) {
  try {
    return await exactCount(label, query);
  } catch (error) {
    return `unavailable (${error.message})`;
  }
}

function countStatuses(rows) {
  return rows.reduce((result, row) => {
    result[row.status] = (result[row.status] ?? 0) + 1;
    return result;
  }, {});
}

function printStatusCounts(statusCounts) {
  const entries = Object.entries(statusCounts);
  if (entries.length === 0) {
    console.log('  none');
    return;
  }

  for (const [status, count] of entries.sort(([left], [right]) => left.localeCompare(right))) {
    console.log(`  ${status}: ${count}`);
  }
}

const supabase = createAdminClient();
const today = localDateIso();
const todayStart = todayStartIso();

const [
  profiles,
  checkins,
  checkinsToday,
  todos,
  todosToday,
  friendshipsPending,
  friendshipsAccepted,
  pokesToday,
  journalPhotos,
] = await Promise.all([
  exactCount('profiles', supabase.from('profiles')),
  exactCount('checkins', supabase.from('checkins')),
  exactCount('today checkins', supabase.from('checkins').eq('checkin_date', today)),
  exactCount('todos', supabase.from('todos')),
  exactCount('today todos', supabase.from('todos').eq('todo_date', today)),
  exactCount('pending friendships', supabase.from('friendships').eq('status', 'pending')),
  exactCount('accepted friendships', supabase.from('friendships').eq('status', 'accepted')),
  exactCount('today pokes', supabase.from('pokes').gte('created_at', todayStart)),
  optionalExactCount('journal photo objects', supabase.schema('storage').from('objects').eq('bucket_id', 'journal-photos')),
]);

const { data: deletionRows, error: deletionError } = await supabase
  .from('account_deletion_requests')
  .select('status')
  .order('status');

if (deletionError) throw new Error(`account_deletion_requests status failed: ${deletionError.message}`);

const { data: recentDeletionRows, error: recentDeletionError } = await supabase
  .from('account_deletion_requests')
  .select('user_id,status,requested_at,personal_data_delete_after,content_delete_after')
  .order('requested_at', { ascending: false })
  .limit(10);

if (recentDeletionError) throw new Error(`recent account_deletion_requests failed: ${recentDeletionError.message}`);

console.log('活着吗后台运营报表');
console.log(`生成时间: ${new Date().toISOString()}`);
console.log('');
console.log('用户与内容');
console.log(`  用户资料: ${profiles}`);
console.log(`  打卡记录: ${checkins}`);
console.log(`  今日打卡: ${checkinsToday}`);
console.log(`  三件事记录: ${todos}`);
console.log(`  今日三件事: ${todosToday}`);
console.log(`  随笔照片对象: ${journalPhotos}`);
console.log('');
console.log('好友互动');
console.log(`  待处理好友申请: ${friendshipsPending}`);
console.log(`  已接受好友关系: ${friendshipsAccepted}`);
console.log(`  今日戳一下/回馈: ${pokesToday}`);
console.log('');
console.log('注销请求状态');
printStatusCounts(countStatuses(deletionRows ?? []));
console.log('');
console.log('最近注销请求');
if (!recentDeletionRows || recentDeletionRows.length === 0) {
  console.log('  none');
} else {
  for (const row of recentDeletionRows) {
    console.log(
      `  ${row.user_id} | ${row.status} | requested ${row.requested_at} | personal ${row.personal_data_delete_after} | content ${row.content_delete_after}`,
    );
  }
}

