import type { AppSnapshot, DiaryEntry, Friend, FriendRequest, IncomingPoke, Profile, Todo } from './types';
import { demoSnapshot } from './mockData';
import { supabase } from './supabase';

type TodoRow = {
  id: number;
  todo_date?: string;
  text: string;
  done: boolean;
  important: boolean;
};

type CheckinRow = {
  user_id?: string;
  checkin_date: string;
  journal_photo_paths?: string[] | null;
  journal_text?: string | null;
  quote_text?: string | null;
  status_text: string;
  weather_text?: string | null;
};

const JOURNAL_PHOTO_BUCKET = 'journal-photos';

type ProfileRow = {
  id: string;
  nickname: string;
  phone_e164?: string | null;
  avatar_color: string;
  show_status_to_friends: boolean;
  started_on: string;
};

type FriendshipRow = {
  id: number;
  requester_id: string;
  addressee_id: string;
  status: 'pending' | 'accepted' | 'blocked';
  accepted_at?: string | null;
  created_at: string;
  requester?: ProfileRow | ProfileRow[] | null;
  addressee?: ProfileRow | ProfileRow[] | null;
};

type PokeRow = {
  id: number;
  sender_id: string;
  receiver_id: string;
  created_at: string;
  poke_type?: 'poke' | 'alive_reply' | null;
};

function isMissingAccountDeletionTable(error: { code?: string; message?: string }) {
  const message = error.message?.toLowerCase() ?? '';
  return error.code === '42P01' || error.code === 'PGRST205' || message.includes('account_deletion_requests');
}

function todayIso() {
  return localDateIso();
}

function localDateIso(date = new Date()) {
  const timezoneOffset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - timezoneOffset).toISOString().slice(0, 10);
}

function toTodo(row: TodoRow): Todo {
  return {
    id: String(row.id),
    text: row.text,
    done: row.done,
    important: row.important,
  };
}

function normalizePhotoPaths(value?: string[] | null) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function inferPhotoContentType(uri: string) {
  const cleanUri = uri.split('?')[0].toLowerCase();
  if (cleanUri.endsWith('.png')) return { contentType: 'image/png', ext: 'png' };
  if (cleanUri.endsWith('.webp')) return { contentType: 'image/webp', ext: 'webp' };
  if (cleanUri.endsWith('.heic')) return { contentType: 'image/heic', ext: 'heic' };
  return { contentType: 'image/jpeg', ext: 'jpg' };
}

async function signedJournalPhotoUrls(paths: string[]) {
  if (paths.length === 0) return [];

  const { data, error } = await supabase.storage.from(JOURNAL_PHOTO_BUCKET).createSignedUrls(paths, 60 * 60);
  if (error) return paths.map(() => '');

  return paths.map((_path, index) => data?.[index]?.signedUrl ?? '');
}

async function listOwnJournalPhotoPaths(userId: string) {
  const { data: dateFolders, error: dateError } = await supabase.storage.from(JOURNAL_PHOTO_BUCKET).list(userId);
  if (dateError) return [];

  const nestedPaths = await Promise.all(
    (dateFolders ?? []).map(async (folder) => {
      const folderPath = `${userId}/${folder.name}`;
      const { data: files, error: fileError } = await supabase.storage.from(JOURNAL_PHOTO_BUCKET).list(folderPath);
      if (fileError) return [];

      return (files ?? []).map((file) => `${folderPath}/${file.name}`);
    }),
  );

  return nestedPaths.flat();
}

function dayDiff(startDate: string) {
  const start = new Date(`${startDate}T00:00:00`);
  const today = new Date(`${todayIso()}T00:00:00`);
  return Math.max(1, Math.floor((today.getTime() - start.getTime()) / 86400000) + 1);
}

function calculateStreak(checkins: CheckinRow[]) {
  const dates = new Set(checkins.map((item) => item.checkin_date));
  let streak = 0;
  const cursor = new Date(`${todayIso()}T00:00:00`);

  while (dates.has(localDateIso(cursor))) {
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }

  return streak;
}

function formatLastSeen(checkins: CheckinRow[]) {
  if (checkins.length === 0) return '还没出现';

  const latest = checkins[0];
  if (latest.checkin_date === todayIso()) return '今天';

  const latestDate = new Date(`${latest.checkin_date}T00:00:00`);
  const today = new Date(`${todayIso()}T00:00:00`);
  const diff = Math.floor((today.getTime() - latestDate.getTime()) / 86400000);

  if (diff === 1) return '昨天';
  return `${diff} 天前`;
}

function firstProfile(value?: ProfileRow | ProfileRow[] | null) {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

function normalizePhone(value: string) {
  const compact = value.replace(/[\s-]/g, '');
  if (compact.startsWith('+')) return compact;
  if (/^1\d{10}$/.test(compact)) return `+86${compact}`;
  return compact;
}

function maskPhone(phone?: string | null) {
  if (!phone) return '手机号未绑定';
  const national = phone.startsWith('+86') ? phone.slice(3) : phone;
  if (/^\d{11}$/.test(national)) return `${national.slice(0, 3)}****${national.slice(-4)}`;
  if (phone.length <= 7) return phone;
  return `${phone.slice(0, 4)}****${phone.slice(-3)}`;
}

function toProfile(row: ProfileRow): Profile {
  return {
    id: row.id,
    nickname: row.nickname,
    phoneE164: row.phone_e164 ?? '',
    phoneMasked: maskPhone(row.phone_e164),
    avatarColor: row.avatar_color,
    showStatusToFriends: row.show_status_to_friends,
  };
}

async function loadFriendships(userId: string): Promise<{
  acceptedSinceByFriendId: Map<string, string>;
  friends: Friend[];
  friendRequests: FriendRequest[];
}> {
  const today = todayIso();
  const { data: friendshipRows, error: friendshipError } = await supabase
    .from('friendships')
    .select(`
      id,
      requester_id,
      addressee_id,
      status,
      accepted_at,
      created_at,
      requester:profiles!friendships_requester_id_fkey(id,nickname,phone_e164,avatar_color,show_status_to_friends,started_on),
      addressee:profiles!friendships_addressee_id_fkey(id,nickname,phone_e164,avatar_color,show_status_to_friends,started_on)
    `)
    .or(`requester_id.eq.${userId},addressee_id.eq.${userId}`)
    .neq('status', 'blocked')
    .order('created_at', { ascending: false });

  if (friendshipError) throw friendshipError;

  const friendships = (friendshipRows ?? []) as FriendshipRow[];
  const accepted = friendships.filter((item) => item.status === 'accepted');
  const acceptedSinceByFriendId = new Map<string, string>();
  accepted.forEach((item) => {
    const friendId = item.requester_id === userId ? item.addressee_id : item.requester_id;
    acceptedSinceByFriendId.set(friendId, item.accepted_at ?? item.created_at);
  });
  const friendProfiles = accepted
    .map((item) => firstProfile(item.requester_id === userId ? item.addressee : item.requester))
    .filter((profile): profile is ProfileRow => Boolean(profile));
  const friendIds = friendProfiles.map((profile) => profile.id);

  const { data: friendCheckins, error: checkinsError } = friendIds.length
    ? await supabase
        .from('checkins')
        .select('user_id,checkin_date,status_text,quote_text,journal_text,weather_text')
        .in('user_id', friendIds)
        .order('checkin_date', { ascending: false })
    : { data: [], error: null };

  if (checkinsError) throw checkinsError;

  const checkinsByUser = new Map<string, CheckinRow[]>();
  ((friendCheckins ?? []) as CheckinRow[]).forEach((checkin) => {
    if (!checkin.user_id) return;
    checkinsByUser.set(checkin.user_id, [...(checkinsByUser.get(checkin.user_id) ?? []), checkin]);
  });

  const friends = friendProfiles.map((profile) => {
    const checkins = checkinsByUser.get(profile.id) ?? [];
    const todayCheckin = checkins.find((item) => item.checkin_date === today);

    return {
      id: profile.id,
      name: profile.nickname,
      phoneMasked: maskPhone(profile.phone_e164),
      days: dayDiff(profile.started_on),
      streak: calculateStreak(checkins),
      aliveToday: Boolean(todayCheckin),
      lastSeen: formatLastSeen(checkins),
      mood: todayCheckin?.status_text ?? checkins[0]?.status_text ?? '今天还没出现',
      color: profile.avatar_color,
    };
  });

  const friendRequests = friendships
    .filter((item) => item.status === 'pending')
    .map((item) => {
      const direction = item.addressee_id === userId ? 'incoming' : 'outgoing';
      const profile = firstProfile(direction === 'incoming' ? item.requester : item.addressee);
      if (!profile) return null;

      return {
        id: String(item.id),
        name: profile.nickname,
        phoneMasked: maskPhone(profile.phone_e164),
        color: profile.avatar_color,
        direction,
      };
    })
    .filter((request): request is FriendRequest => Boolean(request));

  return { acceptedSinceByFriendId, friends, friendRequests };
}

async function loadIncomingPokes(userId: string, pokeType: 'poke' | 'alive_reply' = 'poke'): Promise<IncomingPoke[]> {
  const query = supabase
    .from('pokes')
    .select('id,sender_id,receiver_id,created_at,poke_type')
    .eq('receiver_id', userId)
    .eq('poke_type', pokeType)
    .order('created_at', { ascending: false })
    .limit(20);
  const result = await query;
  let pokeRows: unknown = result.data;
  let pokeError = result.error;

  if (pokeError && pokeError.code === '42703' && pokeType === 'alive_reply') return [];

  if (pokeError && pokeError.code === '42703' && pokeType === 'poke') {
    const fallback = await supabase
      .from('pokes')
      .select('id,sender_id,receiver_id,created_at')
      .eq('receiver_id', userId)
      .order('created_at', { ascending: false })
      .limit(20);

    pokeRows = fallback.data;
    pokeError = fallback.error;
  }

  if (pokeError) throw pokeError;

  const pokes = (pokeRows ?? []) as PokeRow[];
  const senderIds = Array.from(new Set(pokes.map((poke) => poke.sender_id)));
  if (senderIds.length === 0) return [];

  const { data: profiles, error: profileError } = await supabase
    .from('profiles')
    .select('id,nickname,phone_e164,avatar_color,show_status_to_friends,started_on')
    .in('id', senderIds);

  if (profileError) throw profileError;

  const profilesById = new Map((profiles ?? []).map((profile) => [profile.id, profile as ProfileRow]));

  return pokes
    .map((poke) => {
      const profile = profilesById.get(poke.sender_id);
      if (!profile) return null;

      return {
        id: String(poke.id),
        friendId: profile.id,
        friendName: profile.nickname,
        friendColor: profile.avatar_color,
        createdAt: poke.created_at,
      };
    })
    .filter((poke): poke is IncomingPoke => Boolean(poke));
}

async function loadSentPokes(userId: string): Promise<IncomingPoke[]> {
  return loadSentSignals(userId, 'poke');
}

async function loadSentAliveReplies(userId: string): Promise<IncomingPoke[]> {
  return loadSentSignals(userId, 'alive_reply');
}

async function loadSentSignals(userId: string, pokeType: 'poke' | 'alive_reply'): Promise<IncomingPoke[]> {
  const query = supabase
    .from('pokes')
    .select('id,sender_id,receiver_id,created_at,poke_type')
    .eq('sender_id', userId)
    .eq('poke_type', pokeType)
    .order('created_at', { ascending: false })
    .limit(40);
  const result = await query;
  let pokeRows: unknown = result.data;
  let pokeError = result.error;

  if (pokeError && pokeError.code === '42703') {
    const fallback = await supabase
      .from('pokes')
      .select('id,sender_id,receiver_id,created_at')
      .eq('sender_id', userId)
      .order('created_at', { ascending: false })
      .limit(40);

    pokeRows = fallback.data;
    pokeError = fallback.error;
  }

  if (pokeError) throw pokeError;

  const pokes = (pokeRows ?? []) as PokeRow[];
  const receiverIds = Array.from(new Set(pokes.map((poke) => poke.receiver_id)));
  if (receiverIds.length === 0) return [];

  const { data: profiles, error: profileError } = await supabase
    .from('profiles')
    .select('id,nickname,phone_e164,avatar_color,show_status_to_friends,started_on')
    .in('id', receiverIds);

  if (profileError) throw profileError;

  const profilesById = new Map((profiles ?? []).map((profile) => [profile.id, profile as ProfileRow]));

  return pokes
    .map((poke) => {
      const profile = profilesById.get(poke.receiver_id);
      if (!profile) return null;

      return {
        id: String(poke.id),
        friendId: profile.id,
        friendName: profile.nickname,
        friendColor: profile.avatar_color,
        createdAt: poke.created_at,
      };
    })
    .filter((poke): poke is IncomingPoke => Boolean(poke));
}

export async function loadAppSnapshot(userId: string): Promise<AppSnapshot> {
  const today = todayIso();

  const [{ data: profile, error: profileError }, { data: checkins, error: checkinsError }, { data: todos, error: todosError }] =
    await Promise.all([
      supabase.from('profiles').select('id,nickname,phone_e164,avatar_color,show_status_to_friends,started_on').eq('id', userId).single(),
      supabase
        .from('checkins')
        .select('checkin_date,status_text,quote_text,journal_text,journal_photo_paths,weather_text')
        .eq('user_id', userId)
        .order('checkin_date', { ascending: false })
        .limit(60),
      supabase
        .from('todos')
        .select('id,todo_date,text,done,important')
        .eq('user_id', userId)
        .order('todo_date', { ascending: false })
        .order('created_at'),
    ]);

  if (profileError || checkinsError || todosError) {
    throw profileError ?? checkinsError ?? todosError;
  }

  const rows = (checkins ?? []) as CheckinRow[];
  const todayCheckin = rows.find((item) => item.checkin_date === today);
  const journalPhotoPaths = normalizePhotoPaths(todayCheckin?.journal_photo_paths);
  const profileRow = profile as ProfileRow | null;
  const [{ acceptedSinceByFriendId, friends, friendRequests }, incomingPokes, aliveReplies, sentPokes, sentAliveReplies] =
    await Promise.all([
    loadFriendships(userId),
    loadIncomingPokes(userId),
    loadIncomingPokes(userId, 'alive_reply'),
    loadSentPokes(userId),
    loadSentAliveReplies(userId),
  ]);
  const acceptedFriendIds = new Set(friends.map((friend) => friend.id));
  const isCurrentFriendSignal = (poke: IncomingPoke) => {
    const acceptedSince = acceptedSinceByFriendId.get(poke.friendId);
    return acceptedFriendIds.has(poke.friendId) && Boolean(acceptedSince) && new Date(poke.createdAt) >= new Date(acceptedSince as string);
  };
  const relatedIncomingPokes = incomingPokes.filter(isCurrentFriendSignal);
  const relatedAliveReplies = aliveReplies.filter(isCurrentFriendSignal);
  const relatedSentPokes = sentPokes.filter(isCurrentFriendSignal);
  const relatedSentAliveReplies = sentAliveReplies.filter(isCurrentFriendSignal);
  const visibleIncomingPokes = relatedIncomingPokes.filter(
    (poke) =>
      !relatedSentAliveReplies.some(
        (reply) => reply.friendId === poke.friendId && new Date(reply.createdAt) >= new Date(poke.createdAt),
      ),
  );
  const mergedAliveReplies = relatedAliveReplies.filter((poke, index, list) => {
    const key = `${poke.friendId}:${localDateIso(new Date(poke.createdAt))}`;
    return list.findIndex((item) => `${item.friendId}:${localDateIso(new Date(item.createdAt))}` === key) === index;
  });
  const todoRows = (todos ?? []) as TodoRow[];
  const todosByDate = new Map<string, Todo[]>();

  todoRows.forEach((todo) => {
    if (!todo.todo_date) return;
    todosByDate.set(todo.todo_date, [...(todosByDate.get(todo.todo_date) ?? []), toTodo(todo)]);
  });

  const diaryEntries: DiaryEntry[] = await Promise.all(
    rows.map(async (checkin) => {
      const photoPaths = normalizePhotoPaths(checkin.journal_photo_paths);

      return {
        date: checkin.checkin_date,
        journalText: checkin.journal_text ?? '',
        photoUrls: await signedJournalPhotoUrls(photoPaths),
        quoteText: checkin.quote_text ?? demoSnapshot.quoteText,
        statusText: checkin.status_text,
        todos: todosByDate.get(checkin.checkin_date) ?? [],
        weatherText: checkin.weather_text ?? demoSnapshot.weatherText,
      };
    }),
  );

  return {
    ...demoSnapshot,
    aliveDays: dayDiff(profileRow?.started_on ?? today),
    aliveReplies: mergedAliveReplies,
    checkedIn: Boolean(todayCheckin),
    diaryEntries,
    friends,
    friendRequests,
    incomingPokes: visibleIncomingPokes,
    sentPokes,
    journalPhotoPaths,
    journalPhotoUrls: await signedJournalPhotoUrls(journalPhotoPaths),
    journalText: todayCheckin?.journal_text ?? demoSnapshot.journalText,
    profile: profileRow ? toProfile(profileRow) : demoSnapshot.profile,
    quoteText: todayCheckin?.quote_text ?? demoSnapshot.quoteText,
    statusText: todayCheckin?.status_text ?? demoSnapshot.statusText,
    streak: calculateStreak(rows),
    todos: (todosByDate.get(today) ?? []).map((todo) => todo),
    weatherText: todayCheckin?.weather_text ?? demoSnapshot.weatherText,
  };
}

export async function ensureProfile(userId: string, nickname: string, phoneE164?: string | null) {
  const normalizedPhone = phoneE164 ? normalizePhone(phoneE164) : null;
  const { data: deletionRequest, error: deletionLookupError } = await supabase
    .from('account_deletion_requests')
    .select('user_id,status')
    .eq('user_id', userId)
    .in('status', ['pending', 'personal_data_deleted', 'content_deleted'])
    .maybeSingle();

  if (deletionLookupError && !isMissingAccountDeletionTable(deletionLookupError)) throw deletionLookupError;
  if (deletionRequest) throw new Error('账户注销处理中，暂不能登录。');

  const { data: existingProfile, error: lookupError } = await supabase
    .from('profiles')
    .select('id,phone_e164')
    .eq('id', userId)
    .maybeSingle();

  if (lookupError) throw lookupError;
  if (existingProfile) {
    if (normalizedPhone && existingProfile.phone_e164 !== normalizedPhone) {
      const { error } = await supabase.from('profiles').update({ phone_e164: normalizedPhone }).eq('id', userId);
      if (error) throw error;
    }
    return;
  }

  const { error } = await supabase.from('profiles').insert({
    id: userId,
    nickname,
    phone_e164: normalizedPhone,
    avatar_color: demoSnapshot.profile.avatarColor,
    show_status_to_friends: demoSnapshot.profile.showStatusToFriends,
  });

  if (error) throw error;
}

export async function updateProfile(userId: string, nickname: string) {
  const { error } = await supabase.from('profiles').update({ nickname }).eq('id', userId);

  if (error) throw error;
}

export async function updatePrivacySetting(userId: string, showStatusToFriends: boolean) {
  const { error } = await supabase
    .from('profiles')
    .update({ show_status_to_friends: showStatusToFriends })
    .eq('id', userId);

  if (error) throw error;
}

export async function uploadJournalPhoto(userId: string, localUri: string) {
  const { contentType, ext } = inferPhotoContentType(localUri);
  const response = await fetch(localUri);
  const body = await response.arrayBuffer();
  const path = `${userId}/${todayIso()}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;

  const { error } = await supabase.storage.from(JOURNAL_PHOTO_BUCKET).upload(path, body, {
    contentType,
    upsert: false,
  });

  if (error) throw error;

  const [signedUrl] = await signedJournalPhotoUrls([path]);
  return { path, signedUrl };
}

export async function deleteJournalPhoto(path: string) {
  const { error } = await supabase.storage.from(JOURNAL_PHOTO_BUCKET).remove([path]);
  if (error) throw error;
}

export async function saveCheckin(
  userId: string,
  statusText: string,
  quoteText: string,
  journalText: string,
  journalPhotoPaths: string[],
  weatherText: string,
) {
  const { error } = await supabase
    .from('checkins')
    .upsert(
      {
        user_id: userId,
        checkin_date: todayIso(),
        journal_photo_paths: journalPhotoPaths,
        journal_text: journalText,
        quote_text: quoteText,
        status_text: statusText,
        weather_text: weatherText,
      },
      { onConflict: 'user_id,checkin_date' },
    );

  if (error) throw error;
}

export async function requestAccountDeletion(userId: string) {
  const { data: existingRequest, error: requestLookupError } = await supabase
    .from('account_deletion_requests')
    .select('user_id')
    .eq('user_id', userId)
    .in('status', ['pending', 'personal_data_deleted', 'content_deleted'])
    .maybeSingle();

  if (requestLookupError) {
    if (isMissingAccountDeletionTable(requestLookupError)) {
      throw new Error('注销功能数据库补丁还没执行，请先运行 supabase/patch_account_deletion_requests.sql。');
    }
    throw requestLookupError;
  }

  if (!existingRequest) {
    const { error: insertError } = await supabase.from('account_deletion_requests').insert({
      user_id: userId,
    });

    if (insertError) throw insertError;
  }

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .update({
      avatar_color: '#777268',
      nickname: '已注销用户',
      phone_e164: null,
      show_status_to_friends: false,
    })
    .eq('id', userId)
    .select('phone_e164')
    .single();

  if (profileError) throw profileError;
  if (profile.phone_e164) {
    throw new Error('数据库手机号默认触发器还没更新，请先运行 supabase/patch_account_deletion_requests.sql。');
  }

  const pokeDelete = await supabase.from('pokes').delete().or(`sender_id.eq.${userId},receiver_id.eq.${userId}`);
  if (pokeDelete.error) throw pokeDelete.error;

  const friendshipDelete = await supabase.from('friendships').delete().or(`requester_id.eq.${userId},addressee_id.eq.${userId}`);
  if (friendshipDelete.error) throw friendshipDelete.error;
}

export async function createTodo(userId: string, text: string, important: boolean): Promise<Todo> {
  const { data, error } = await supabase
    .from('todos')
    .insert({
      important,
      user_id: userId,
      todo_date: todayIso(),
      text,
    })
    .select('id,text,done,important')
    .single();

  if (error) throw error;
  return { id: String(data.id), text: data.text, done: data.done, important: data.important };
}

export async function updateTodoDone(todoId: string, done: boolean) {
  const { error } = await supabase.from('todos').update({ done }).eq('id', Number(todoId));

  if (error) throw error;
}

export async function updateTodoImportant(todoId: string, important: boolean) {
  const { error } = await supabase.from('todos').update({ important }).eq('id', Number(todoId));

  if (error) throw error;
}

export async function pokeFriend(senderId: string, receiverId: string) {
  const { error } = await supabase.from('pokes').insert({
    poke_type: 'poke',
    receiver_id: receiverId,
    sender_id: senderId,
  });

  if (error) throw error;
}

export async function replyAliveToPoke(senderId: string, receiverId: string) {
  const { error } = await supabase.from('pokes').insert({
    poke_type: 'alive_reply',
    receiver_id: receiverId,
    sender_id: senderId,
  });

  if (error) throw error;
}

export async function sendFriendRequest(userId: string, phone: string) {
  if (!userId) throw new Error('请先登录');
  const targetPhone = normalizePhone(phone.trim());
  if (!targetPhone) throw new Error('请输入好友手机号');

  const { error } = await supabase.rpc('send_friend_request_by_phone', {
    raw_phone: targetPhone,
  });

  if (error) {
    if (error.code === 'PGRST202' || error.message.includes('send_friend_request_by_phone')) {
      throw new Error('数据库好友添加防刷补丁还没执行，请先运行 supabase/patch_friend_request_security.sql。');
    }
    throw error;
  }
}

export async function acceptFriendRequest(requestId: string) {
  const { data: request, error: requestError } = await supabase
    .from('friendships')
    .select('requester_id,addressee_id')
    .eq('id', Number(requestId))
    .single();

  if (requestError) throw requestError;

  const { error: cleanupError } = await supabase
    .from('pokes')
    .delete()
    .or(
      `and(sender_id.eq.${request.requester_id},receiver_id.eq.${request.addressee_id}),and(sender_id.eq.${request.addressee_id},receiver_id.eq.${request.requester_id})`,
    );

  if (cleanupError) throw cleanupError;

  const { error } = await supabase
    .from('friendships')
    .update({ accepted_at: new Date().toISOString(), status: 'accepted' })
    .eq('id', Number(requestId));

  if (error) throw error;
}

export async function deleteFriendship(userId: string, friendId: string) {
  const { error } = await supabase
    .from('friendships')
    .delete()
    .or(`and(requester_id.eq.${userId},addressee_id.eq.${friendId}),and(requester_id.eq.${friendId},addressee_id.eq.${userId})`)
    .eq('status', 'accepted');

  if (error) throw error;
}

export async function deleteOwnAppData(userId: string) {
  const photoPaths = await listOwnJournalPhotoPaths(userId);
  if (photoPaths.length > 0) {
    await supabase.storage.from(JOURNAL_PHOTO_BUCKET).remove(photoPaths);
  }

  const pokeDelete = await supabase.from('pokes').delete().or(`sender_id.eq.${userId},receiver_id.eq.${userId}`);
  if (pokeDelete.error) throw pokeDelete.error;

  const { error: friendshipError } = await supabase
    .from('friendships')
    .delete()
    .or(`requester_id.eq.${userId},addressee_id.eq.${userId}`);
  if (friendshipError) throw friendshipError;

  const { error: checkinError } = await supabase.from('checkins').delete().eq('user_id', userId);
  if (checkinError) throw checkinError;

  const { error: todoError } = await supabase.from('todos').delete().eq('user_id', userId);
  if (todoError) throw todoError;

  const { error } = await supabase
    .from('profiles')
    .update({
      avatar_color: demoSnapshot.profile.avatarColor,
      nickname: '新朋友',
      show_status_to_friends: true,
      started_on: todayIso(),
    })
    .eq('id', userId);

  if (error) throw error;
}
