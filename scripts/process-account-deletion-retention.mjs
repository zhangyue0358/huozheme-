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

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});

const { data, error } = await supabase.rpc('process_account_deletion_retention');

if (error) {
  console.error(`Account deletion retention job failed: ${error.message}`);
  process.exit(1);
}

const result = Array.isArray(data) ? data[0] : data;
console.log('Account deletion retention job finished.');
console.log(`Personal data processed: ${result?.personal_profiles_updated ?? 0}`);
console.log(`Content accounts processed: ${result?.content_accounts_processed ?? 0}`);

function isAlreadyDeletedAuthUser(error) {
  const message = error?.message?.toLowerCase() ?? '';
  return message.includes('not found') || message.includes('not_found') || message.includes('user not found');
}

if (typeof supabase.auth.admin?.deleteUser !== 'function') {
  console.error('Supabase Auth admin deleteUser API is unavailable in the installed SDK.');
  process.exit(1);
}

const { data: authDeleteCandidates, error: candidateError } = await supabase
  .from('account_deletion_requests')
  .select('user_id,processed_content_at')
  .eq('status', 'content_deleted')
  .not('processed_content_at', 'is', null);

if (candidateError) {
  console.error(`Auth delete candidate lookup failed: ${candidateError.message}`);
  process.exit(1);
}

let authDeletedCount = 0;
const authDeleteFailures = [];

for (const candidate of authDeleteCandidates ?? []) {
  const { error: deleteError } = await supabase.auth.admin.deleteUser(candidate.user_id);

  if (deleteError && !isAlreadyDeletedAuthUser(deleteError)) {
    authDeleteFailures.push(`${candidate.user_id}: ${deleteError.message}`);
    continue;
  }

  const { error: finalizeError } = await supabase
    .from('account_deletion_requests')
    .delete()
    .eq('user_id', candidate.user_id)
    .eq('status', 'content_deleted');

  if (finalizeError) {
    authDeleteFailures.push(`${candidate.user_id}: finalized deletion request failed: ${finalizeError.message}`);
    continue;
  }

  authDeletedCount += 1;
}

console.log(`Auth users deleted after content retention: ${authDeletedCount}`);

if (authDeleteFailures.length > 0) {
  console.error('Auth user deletion failures:');
  for (const failure of authDeleteFailures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}
