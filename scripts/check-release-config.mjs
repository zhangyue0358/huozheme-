import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const failures = [];
const warnings = [];

function readJson(file) {
  return JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));
}

function fail(message) {
  failures.push(message);
}

function warn(message) {
  warnings.push(message);
}

const eas = readJson('eas.json');
const app = readJson('app.json').expo;
const appSource = fs.readFileSync(path.join(root, 'App.tsx'), 'utf8');

const productionEnv = eas.build?.production?.env ?? {};
const previewEnv = eas.build?.preview?.env ?? {};
const requiredPublicUrls = {
  EXPO_PUBLIC_DOMESTIC_API_URL: 'https://api.huozhema.senbeikeji.cn',
  EXPO_PUBLIC_APP_SHARE_URL: 'https://huozhema.senbeikeji.cn/',
  EXPO_PUBLIC_PRIVACY_POLICY_URL: 'https://huozhema.senbeikeji.cn/privacy.html',
  EXPO_PUBLIC_TERMS_OF_SERVICE_URL: 'https://huozhema.senbeikeji.cn/terms.html',
  EXPO_PUBLIC_REGISTRATION_AGREEMENT_URL: 'https://huozhema.senbeikeji.cn/registration.html',
};

for (const [profileName, profileEnv] of Object.entries({ preview: previewEnv, production: productionEnv })) {
  for (const [key, expectedValue] of Object.entries(requiredPublicUrls)) {
    if (profileEnv[key] !== expectedValue) {
      fail(`eas.json ${profileName} must set ${key} to ${expectedValue}.`);
    }
  }

  const supabaseKeys = Object.keys(profileEnv).filter((key) => key.toUpperCase().includes('SUPABASE'));
  if (supabaseKeys.length > 0) {
    fail(`eas.json ${profileName} still contains Supabase variables: ${supabaseKeys.join(', ')}.`);
  }
}

function collectSourceFiles(targetPath) {
  const stat = fs.statSync(targetPath);
  if (stat.isFile()) return [targetPath];

  return fs.readdirSync(targetPath, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(targetPath, entry.name);
    if (entry.isDirectory()) return collectSourceFiles(entryPath);
    return /\.(?:ts|tsx|js|jsx)$/.test(entry.name) ? [entryPath] : [];
  });
}

const runtimeFiles = [path.join(root, 'App.tsx'), ...collectSourceFiles(path.join(root, 'src'))];
const supabaseRuntimeFiles = runtimeFiles.filter((file) => /supabase/i.test(fs.readFileSync(file, 'utf8')));
if (supabaseRuntimeFiles.length > 0) {
  fail(`Runtime source still references Supabase: ${supabaseRuntimeFiles.map((file) => path.relative(root, file)).join(', ')}.`);
}

if (
  !appSource.includes('EXPO_PUBLIC_PRIVACY_POLICY_URL') ||
  !appSource.includes('EXPO_PUBLIC_TERMS_OF_SERVICE_URL') ||
  !appSource.includes('EXPO_PUBLIC_REGISTRATION_AGREEMENT_URL')
) {
  fail('App.tsx must expose working privacy-policy, terms-of-service, and registration-agreement links.');
}

if (appSource.includes("|| 'HuozhemaTest2026!'") || appSource.includes('密码为 ${devTestPassword}')) {
  fail('App.tsx must not contain the old hardcoded test password fallback or password-revealing alert.');
}

if (app.name !== '在否') {
  fail('app.json expo.name should be 在否.');
}

if (app.ios?.bundleIdentifier !== 'com.huozhema.app') {
  fail('app.json ios.bundleIdentifier should be com.huozhema.app.');
}

if (app.android?.package !== 'com.huozhema.app') {
  fail('app.json android.package should be com.huozhema.app.');
}

const androidPermissions = app.android?.permissions ?? [];
if (!androidPermissions.includes('android.permission.READ_MEDIA_IMAGES')) {
  warn('Android photo permission READ_MEDIA_IMAGES is not listed.');
}

const blockedPermissions = app.android?.blockedPermissions ?? [];
if (!blockedPermissions.includes('android.permission.RECORD_AUDIO')) {
  fail('Android RECORD_AUDIO should remain blocked.');
}

if (androidPermissions.some((permission) => permission.includes('CAMERA') || permission.includes('RECORD_AUDIO'))) {
  fail('Android production permissions should not include camera or microphone permissions.');
}

if (warnings.length > 0) {
  console.log('Warnings:');
  for (const message of warnings) console.log(`- ${message}`);
}

if (failures.length > 0) {
  console.error('Release config check failed:');
  for (const message of failures) console.error(`- ${message}`);
  process.exit(1);
}

console.log('Release config OK.');
