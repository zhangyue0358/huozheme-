import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';

const env = Object.fromEntries(
  readFileSync(new URL('../.env', import.meta.url), 'utf8')
    .split(/\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
    .map((line) => {
      const index = line.indexOf('=');
      return [line.slice(0, index), line.slice(index + 1)];
    }),
);

const supabaseUrl = env.EXPO_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
const password = env.EXPO_PUBLIC_DEV_TEST_PASSWORD;

const accounts = [
  { avatarColor: '#ffd166', email: 'test-a@huozhema.local', nickname: '用户0001', phone: '+8613900000001', label: '测试账号 A' },
  { avatarColor: '#9be27c', email: 'test-b@huozhema.local', nickname: '用户0002', phone: '+8613900000002', label: '测试账号 B' },
];

if (!supabaseUrl || !supabaseAnonKey) {
  console.error('Missing EXPO_PUBLIC_SUPABASE_URL or EXPO_PUBLIC_SUPABASE_ANON_KEY in .env');
  process.exit(1);
}

if (!password) {
  console.error('Missing EXPO_PUBLIC_DEV_TEST_PASSWORD in .env');
  process.exit(1);
}

function createSupabaseClient() {
  return createClient(supabaseUrl, supabaseAnonKey);
}

async function signIn(supabase, account) {
  const { data, error } = await supabase.auth.signInWithPassword({
    email: account.email,
    password,
  });

  if (error) throw new Error(`${account.label} login failed: ${error.message}`);
  if (!data.user) throw new Error(`${account.label} login returned no user`);

  return data.user;
}

async function listOwnJournalPhotoPaths(supabase, userId) {
  const { data: dateFolders, error: dateError } = await supabase.storage.from('journal-photos').list(userId);
  if (dateError) return [];

  const nestedPaths = await Promise.all(
    (dateFolders ?? []).map(async (folder) => {
      const folderPath = `${userId}/${folder.name}`;
      const { data: files, error: fileError } = await supabase.storage.from('journal-photos').list(folderPath);
      if (fileError) return [];

      return (files ?? []).map((file) => `${folderPath}/${file.name}`);
    }),
  );

  return nestedPaths.flat();
}

async function resetAccount(account) {
  const supabase = createSupabaseClient();
  const user = await signIn(supabase, account);
  const photoPaths = await listOwnJournalPhotoPaths(supabase, user.id);

  if (photoPaths.length > 0) {
    const { error } = await supabase.storage.from('journal-photos').remove(photoPaths);
    if (error) throw error;
  }

  const { error: deleteError } = await supabase.from('profiles').delete().eq('id', user.id);
  if (deleteError) throw deleteError;

  const { error: insertError } = await supabase.from('profiles').insert({
    avatar_color: account.avatarColor,
    id: user.id,
    nickname: account.nickname,
    phone_e164: account.phone,
    show_status_to_friends: true,
  });
  if (insertError) throw insertError;

  await supabase.auth.signOut({ scope: 'local' });
  console.log(`${account.label} reset: ${account.phone}`);
}

for (const account of accounts) {
  await resetAccount(account);
}

console.log('Dev account data reset complete.');
