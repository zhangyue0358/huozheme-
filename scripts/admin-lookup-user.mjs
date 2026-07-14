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

function readArg(name) {
  const prefix = `--${name}=`;
  const inline = process.argv.find((arg) => arg.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);

  const index = process.argv.indexOf(`--${name}`);
  if (index >= 0) return process.argv[index + 1];
  return '';
}

function normalizePhone(value) {
  const compact = value.replace(/\s|-/g, '');
  if (compact.startsWith('+')) return compact;
  if (/^1\d{10}$/.test(compact)) return `+86${compact}`;
  return compact;
}

function maskPhone(phone) {
  if (!phone) return '未绑定';
  const national = phone.startsWith('+86') ? phone.slice(3) : phone;
  if (/^\d{11}$/.test(national)) return `${national.slice(0, 3)}****${national.slice(-4)}`;
  if (phone.length <= 7) return phone;
  return `${phone.slice(0, 4)}****${phone.slice(-3)}`;
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

const phoneArg = readArg('phone');
const userIdArg = readArg('user-id');

if (!phoneArg && !userIdArg) {
  console.error('Usage: npm run admin:lookup-user -- --phone 18810409001');
  console.error('   or: npm run admin:lookup-user -- --user-id <uuid>');
  process.exit(1);
}

const supabase = createAdminClient();

let profileQuery = supabase.from('profiles').select('id,nickname,phone_e164,show_status_to_friends,started_on,created_at').limit(1);
if (userIdArg) {
  profileQuery = profileQuery.eq('id', userIdArg);
} else {
  profileQuery = profileQuery.eq('phone_e164', normalizePhone(phoneArg));
}

const { data: profiles, error: profileError } = await profileQuery;
if (profileError) throw new Error(`profile lookup failed: ${profileError.message}`);

const profile = profiles?.[0];
if (!profile) {
  console.log('No profile found.');
  process.exit(0);
}

const friendshipFilter = `requester_id.eq.${profile.id},addressee_id.eq.${profile.id}`;
const pokeFilter = `sender_id.eq.${profile.id},receiver_id.eq.${profile.id}`;

const [
  checkins,
  todos,
  friendships,
  pendingFriendships,
  pokes,
  deletionResult,
  recentCheckinsResult,
] = await Promise.all([
  exactCount('checkins', supabase.from('checkins').eq('user_id', profile.id)),
  exactCount('todos', supabase.from('todos').eq('user_id', profile.id)),
  exactCount('friendships', supabase.from('friendships').or(friendshipFilter)),
  exactCount('pending friendships', supabase.from('friendships').or(friendshipFilter).eq('status', 'pending')),
  exactCount('pokes', supabase.from('pokes').or(pokeFilter)),
  supabase
    .from('account_deletion_requests')
    .select('status,requested_at,personal_data_delete_after,content_delete_after,processed_personal_at,processed_content_at')
    .eq('user_id', profile.id)
    .maybeSingle(),
  supabase
    .from('checkins')
    .select('checkin_date,created_at,journal_photo_paths')
    .eq('user_id', profile.id)
    .order('checkin_date', { ascending: false })
    .limit(5),
]);

if (deletionResult.error) throw new Error(`deletion status lookup failed: ${deletionResult.error.message}`);
if (recentCheckinsResult.error) throw new Error(`recent checkins lookup failed: ${recentCheckinsResult.error.message}`);

console.log('活着吗用户排查');
console.log(`用户 ID: ${profile.id}`);
console.log(`昵称: ${profile.nickname}`);
console.log(`手机号: ${maskPhone(profile.phone_e164)}`);
console.log(`好友可见状态: ${profile.show_status_to_friends ? '开启' : '关闭'}`);
console.log(`开始日期: ${profile.started_on}`);
console.log(`资料创建: ${profile.created_at}`);
console.log('');
console.log('数据概览');
console.log(`  打卡记录: ${checkins}`);
console.log(`  三件事记录: ${todos}`);
console.log(`  好友关系: ${friendships}`);
console.log(`  待处理好友申请: ${pendingFriendships}`);
console.log(`  戳一下/回馈记录: ${pokes}`);
console.log('');
console.log('注销状态');
if (deletionResult.data) {
  console.log(`  状态: ${deletionResult.data.status}`);
  console.log(`  申请时间: ${deletionResult.data.requested_at}`);
  console.log(`  个人信息删除时间: ${deletionResult.data.personal_data_delete_after}`);
  console.log(`  内容删除时间: ${deletionResult.data.content_delete_after}`);
} else {
  console.log('  无注销请求');
}
console.log('');
console.log('最近打卡日期');
if (!recentCheckinsResult.data || recentCheckinsResult.data.length === 0) {
  console.log('  none');
} else {
  for (const row of recentCheckinsResult.data) {
    console.log(`  ${row.checkin_date} | created ${row.created_at} | photos ${(row.journal_photo_paths ?? []).length}`);
  }
}

