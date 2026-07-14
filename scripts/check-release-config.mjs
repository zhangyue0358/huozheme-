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
if (productionEnv.EXPO_PUBLIC_ENABLE_TEST_ACCOUNTS !== 'false') {
  fail('eas.json production must set EXPO_PUBLIC_ENABLE_TEST_ACCOUNTS to "false".');
}

if ('EXPO_PUBLIC_DEV_TEST_PASSWORD' in productionEnv) {
  fail('eas.json production must not define EXPO_PUBLIC_DEV_TEST_PASSWORD.');
}

if (appSource.includes("|| 'HuozhemaTest2026!'") || appSource.includes('密码为 ${devTestPassword}')) {
  fail('App.tsx must not contain the old hardcoded test password fallback or password-revealing alert.');
}

if (app.name !== '活着吗') {
  fail('app.json expo.name should be 活着吗.');
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
