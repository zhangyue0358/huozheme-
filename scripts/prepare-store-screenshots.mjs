import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

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
const photoBucket = 'journal-photos';

const accounts = [
  { avatarColor: '#ffd166', email: 'test-a@huozhema.local', label: '测试账号 A', nickname: '张三', phone: '+8613900000001' },
  { avatarColor: '#9be27c', email: 'test-b@huozhema.local', label: '测试账号 B', nickname: '李四', phone: '+8613900000002' },
];

if (!supabaseUrl || !supabaseAnonKey) {
  console.error('Missing EXPO_PUBLIC_SUPABASE_URL or EXPO_PUBLIC_SUPABASE_ANON_KEY in .env');
  process.exit(1);
}

if (!password) {
  console.error('Missing EXPO_PUBLIC_DEV_TEST_PASSWORD in .env');
  process.exit(1);
}

function localDateIso(date = new Date()) {
  const timezoneOffset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - timezoneOffset).toISOString().slice(0, 10);
}

function daysAgo(days) {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return localDateIso(date);
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let index = 0; index < 8; index += 1) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const typeBuffer = Buffer.from(type);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);
  return Buffer.concat([length, typeBuffer, data, crc]);
}

function makeGradientPng(width, height, palette) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  const [start, end, accent] = palette.map((hex) => [
    Number.parseInt(hex.slice(1, 3), 16),
    Number.parseInt(hex.slice(3, 5), 16),
    Number.parseInt(hex.slice(5, 7), 16),
  ]);

  for (let y = 0; y < height; y += 1) {
    const row = y * (width * 4 + 1);
    raw[row] = 0;
    for (let x = 0; x < width; x += 1) {
      const offset = row + 1 + x * 4;
      const t = (x + y) / (width + height);
      const heart = Math.abs(x - width * 0.5) + Math.abs(y - height * 0.5) < Math.min(width, height) * 0.18;
      const color = heart ? accent : start.map((channel, index) => Math.round(channel * (1 - t) + end[index] * t));
      raw[offset] = color[0];
      raw[offset + 1] = color[1];
      raw[offset + 2] = color[2];
      raw[offset + 3] = 255;
    }
  }

  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  return Buffer.concat([signature, pngChunk('IHDR', ihdr), pngChunk('IDAT', deflateSync(raw)), pngChunk('IEND', Buffer.alloc(0))]);
}

function createSupabaseClient() {
  return createClient(supabaseUrl, supabaseAnonKey);
}

async function signIn(account) {
  const supabase = createSupabaseClient();
  const { data, error } = await supabase.auth.signInWithPassword({
    email: account.email,
    password,
  });

  if (error) throw new Error(`${account.label} login failed: ${error.message}`);
  if (!data.user) throw new Error(`${account.label} login returned no user`);
  return { supabase, user: data.user };
}

async function assertNotDeleting(supabase, userId, label) {
  const { data, error } = await supabase
    .from('account_deletion_requests')
    .select('status')
    .eq('user_id', userId)
    .in('status', ['pending', 'personal_data_deleted', 'content_deleted'])
    .maybeSingle();

  if (error && error.code !== '42P01' && error.code !== 'PGRST205') throw error;
  if (data) throw new Error(`${label} is in account deletion status: ${data.status}`);
}

async function listOwnJournalPhotoPaths(supabase, userId) {
  const { data: dateFolders, error: dateError } = await supabase.storage.from(photoBucket).list(userId);
  if (dateError) return [];

  const nestedPaths = await Promise.all(
    (dateFolders ?? []).map(async (folder) => {
      const folderPath = `${userId}/${folder.name}`;
      const { data: files, error: fileError } = await supabase.storage.from(photoBucket).list(folderPath);
      if (fileError) return [];

      return (files ?? []).map((file) => `${folderPath}/${file.name}`);
    }),
  );

  return nestedPaths.flat();
}

async function resetProfile(supabase, userId, account) {
  const photoPaths = await listOwnJournalPhotoPaths(supabase, userId);
  if (photoPaths.length > 0) {
    const { error } = await supabase.storage.from(photoBucket).remove(photoPaths);
    if (error) throw error;
  }

  const deleteResult = await supabase.from('profiles').delete().eq('id', userId);
  if (deleteResult.error) throw deleteResult.error;

  const insertResult = await supabase.from('profiles').insert({
    avatar_color: account.avatarColor,
    id: userId,
    nickname: account.nickname,
    phone_e164: account.phone,
    show_status_to_friends: true,
  });
  if (insertResult.error) throw insertResult.error;
}

async function uploadScreenshotPhotos(supabase, userId) {
  const today = localDateIso();
  const photos = [
    makeGradientPng(320, 240, ['#1f2a21', '#9be27c', '#ff1f3d']),
    makeGradientPng(320, 240, ['#151515', '#ffd166', '#9be27c']),
  ];

  const paths = [];
  for (const [index, body] of photos.entries()) {
    const path = `${userId}/${today}/store-screenshot-${index + 1}.png`;
    const { error } = await supabase.storage.from(photoBucket).upload(path, body, {
      contentType: 'image/png',
      upsert: true,
    });
    if (error) throw error;
    paths.push(path);
  }

  return paths;
}

async function seedAccountA(supabase, userId) {
  const photoPaths = await uploadScreenshotPhotos(supabase, userId);
  const checkins = [
    {
      checkin_date: localDateIso(),
      journal_photo_paths: photoPaths,
      journal_text: '今天只是普通地过了一天，但也算稳稳落地。路上看见一点绿，就当作今天的小亮点。',
      quote_text: '今天不用很厉害，能把自己带到晚上就很好。',
      status_text: '😊 开心，难得有点亮，就先好好接住。',
      user_id: userId,
      weather_text: '☀️ 晴',
    },
    {
      checkin_date: daysAgo(1),
      journal_photo_paths: [],
      journal_text: '昨天有点累，但还是把自己带回来了。',
      quote_text: '你不是一项任务，你是一个正在生活的人。',
      status_text: '😌 平静，世界没变好，但我没被卷走。',
      user_id: userId,
      weather_text: '🌤️ 多云',
    },
    {
      checkin_date: daysAgo(3),
      journal_photo_paths: [],
      journal_text: '把今天收小一点，能完成一件也算数。',
      quote_text: '宇宙很大，今天的小崩溃不会定义你。',
      status_text: '😐 不好不坏，普通也算认真活了一点。',
      user_id: userId,
      weather_text: '🌧️ 雨',
    },
    {
      checkin_date: daysAgo(5),
      journal_photo_paths: [],
      journal_text: '没有发生大事，但今天也被好好存档了。',
      quote_text: '先把自己放回呼吸里，其他事稍后再说。',
      status_text: '😴 低电量，不想用力，慢慢活也算数。',
      user_id: userId,
      weather_text: '🌙 夜',
    },
  ];

  const checkinResult = await supabase.from('checkins').upsert(checkins, { onConflict: 'user_id,checkin_date' });
  if (checkinResult.error) throw checkinResult.error;

  const todoResult = await supabase.from('todos').insert([
    { done: true, important: false, text: '喝水，吃饭，出门走一小段', todo_date: localDateIso(), user_id: userId },
    { done: true, important: true, text: '回复一条重要消息', todo_date: localDateIso(), user_id: userId },
    { done: false, important: false, text: '早点睡', todo_date: localDateIso(), user_id: userId },
    { done: true, important: false, text: '把昨天写下来', todo_date: daysAgo(1), user_id: userId },
    { done: true, important: false, text: '整理明天要做的一件事', todo_date: daysAgo(3), user_id: userId },
  ]);
  if (todoResult.error) throw todoResult.error;
}

async function seedAccountB(supabase, userId) {
  const checkinResult = await supabase.from('checkins').upsert(
    [
      {
        checkin_date: daysAgo(1),
        journal_photo_paths: [],
        journal_text: '今天不算轻松，但也没有彻底散掉。',
        quote_text: '你已经穿过很多天，今天也可以慢慢穿过去。',
        status_text: '😐 不好不坏，普通也算认真活了一点。',
        user_id: userId,
        weather_text: '🌤️ 多云',
      },
    ],
    { onConflict: 'user_id,checkin_date' },
  );
  if (checkinResult.error) throw checkinResult.error;
}

async function seedFriendship(supabaseA, userAId, userBId) {
  const friendshipResult = await supabaseA.from('friendships').insert({
    accepted_at: new Date().toISOString(),
    addressee_id: userBId,
    requester_id: userAId,
    status: 'accepted',
  });
  if (friendshipResult.error) throw friendshipResult.error;

  const pokeResult = await supabaseA.from('pokes').insert({
    poke_type: 'poke',
    receiver_id: userBId,
    sender_id: userAId,
  });
  if (pokeResult.error) throw pokeResult.error;
}

const signedIn = [];

try {
  for (const account of accounts) {
    const session = await signIn(account);
    await assertNotDeleting(session.supabase, session.user.id, account.label);
    signedIn.push({ ...session, account });
  }

  for (const session of signedIn) {
    await resetProfile(session.supabase, session.user.id, session.account);
  }

  const accountA = signedIn[0];
  const accountB = signedIn[1];
  await seedAccountA(accountA.supabase, accountA.user.id);
  await seedAccountB(accountB.supabase, accountB.user.id);
  await seedFriendship(accountA.supabase, accountA.user.id, accountB.user.id);

  console.log('Store screenshot data prepared:');
  console.log(`- ${accountA.account.label}: ${accountA.account.nickname} / ${accountA.account.phone}`);
  console.log(`- ${accountB.account.label}: ${accountB.account.nickname} / ${accountB.account.phone}`);
  console.log('- A has today checkin, journal, two generated photos, todos, and history diary entries.');
  console.log('- B is an accepted friend and is pending today, so A can show the pending friend state.');
} finally {
  await Promise.allSettled(signedIn.map((session) => session.supabase.auth.signOut({ scope: 'local' })));
}
