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
  { email: 'test-a@huozhema.local', phone: '+8613900000001', label: '测试账号 A' },
  { email: 'test-b@huozhema.local', phone: '+8613900000002', label: '测试账号 B' },
];

if (!supabaseUrl || !supabaseAnonKey) {
  console.error('Missing EXPO_PUBLIC_SUPABASE_URL or EXPO_PUBLIC_SUPABASE_ANON_KEY in .env');
  process.exit(1);
}

if (!password) {
  console.error('Missing EXPO_PUBLIC_DEV_TEST_PASSWORD in .env');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseAnonKey);

async function withRetry(label, action, attempts = 3) {
  let lastError;

  for (let index = 1; index <= attempts; index += 1) {
    try {
      return await action();
    } catch (error) {
      lastError = error;
      if (index === attempts) break;
      console.warn(`${label} failed, retrying (${index}/${attempts - 1}): ${error.message}`);
      await new Promise((resolve) => setTimeout(resolve, 1000 * index));
    }
  }

  throw lastError;
}

async function signIn(account) {
  return withRetry(`${account.label} login`, async () => {
    const { data, error } = await supabase.auth.signInWithPassword({
      email: account.email,
      password,
    });

    if (error) throw new Error(`${account.label} login failed: ${error.message}`);
    if (!data.user) throw new Error(`${account.label} login returned no user`);

    return data.user;
  });
}

async function loadProfile(userId) {
  return withRetry('load profile', async () => {
    const { data, error } = await supabase
      .from('profiles')
      .select('id,nickname,phone_e164')
      .eq('id', userId)
      .maybeSingle();

    if (error) throw error;
    return data;
  });
}

async function assertFindsPhone(selfUserId, target) {
  return withRetry(`find ${target.label}`, async () => {
    const { data, error } = await supabase
      .from('profiles')
      .select('id,nickname,phone_e164')
      .eq('phone_e164', target.phone)
      .neq('id', selfUserId)
      .maybeSingle();

    if (error) throw error;
    if (!data) throw new Error(`Cannot find ${target.label} by ${target.phone}`);
    if (data.phone_e164 !== target.phone) throw new Error(`${target.label} phone mismatch while searching`);
  });
}

for (const account of accounts) {
  const user = await signIn(account);
  const profile = await loadProfile(user.id);

  if (!profile) throw new Error(`${account.label} has no profile row`);
  if (profile.phone_e164 !== account.phone) {
    throw new Error(`${account.label} phone mismatch: expected ${account.phone}, got ${profile.phone_e164 ?? 'null'}`);
  }

  const target = accounts.find((item) => item.email !== account.email);
  await assertFindsPhone(user.id, target);
  await supabase.auth.signOut();

  console.log(`${account.label} OK: ${profile.phone_e164}`);
}

console.log('Dev account phone checks passed.');
