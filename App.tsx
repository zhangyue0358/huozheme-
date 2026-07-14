import { StatusBar } from 'expo-status-bar';
import * as ImagePicker from 'expo-image-picker';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Animated,
  Image,
  KeyboardAvoidingView,
  Modal,
  PanResponder,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import type { Session } from '@supabase/supabase-js';

import {
  acceptFriendRequest,
  createTodo,
  deleteFriendship,
  deleteJournalPhoto,
  deleteOwnAppData,
  ensureProfile,
  loadAppSnapshot,
  requestAccountDeletion,
  saveCheckin,
  sendFriendRequest,
  pokeFriend,
  replyAliveToPoke,
  uploadJournalPhoto,
  updatePrivacySetting,
  updateProfile,
  updateTodoImportant,
  updateTodoDone,
} from './src/lib/appApi';
import { sendPhoneLoginCode, signInWithPassword, signOut, verifyPhoneLoginCode } from './src/lib/authApi';
import { demoSnapshot } from './src/lib/mockData';
import { hasSupabaseConfig, supabase } from './src/lib/supabase';
import type { AppSnapshot, DiaryEntry, Friend, FriendRequest, IncomingPoke, Profile, Todo } from './src/lib/types';

type TabKey = 'today' | 'friends' | 'todos' | 'profile';
type TabIconKey = TabKey;
type SaveState = 'idle' | 'saving' | 'saved';

const DEFAULT_POKE_NOTICE = '还没戳好友。';
const SMS_RESEND_SECONDS = 60;

const notes = [
  '😊 开心，难得有点亮，就先好好接住。',
  '😌 平静，世界没变好，但我没被卷走。',
  '😐 不好不坏，普通也算认真活了一点。',
  '😢 伤感，心有点沉，但还愿意往前挪。',
  '😵 烦躁，脑子很吵，先把今天过小一点。',
  '😴 低电量，不想用力，慢慢活也算数。',
];

const quotePool = [
  '今天不用很厉害，能把自己带到晚上就很好。',
  '你不是一项任务，你是一个正在生活的人。',
  '宇宙很大，今天的小崩溃不会定义你。',
  '先把自己放回呼吸里，其他事稍后再说。',
  '你已经穿过很多天，今天也可以慢慢穿过去。',
  '不必证明值得存在，存在本身就已经成立。',
];

const todoNotes = [
  '不是效率工具。只是帮你把今天从一团雾里捞出来一点点。',
  '三件事就够了，今天不用把人生全修好。',
  '能完成一件也算数，价值不是靠忙出来的。',
  '把今天收得小一点，人会轻一点。',
  '写下来，不是催自己，是给今天一点形状。',
];

const weatherOptions = ['☀️ 晴', '🌤️ 多云', '🌧️ 雨', '⛈️ 雷', '🌙 夜'];

const devTestAccounts = [
  { email: 'test-a@huozhema.local', label: '测试账号 A', phone: '+8613900000001' },
  { email: 'test-b@huozhema.local', label: '测试账号 B', phone: '+8613900000002' },
  { email: 'test-delete@huozhema.local', label: '注销测试账号', phone: '' },
];
const allowDevTestAccounts = __DEV__ || process.env.EXPO_PUBLIC_ENABLE_TEST_ACCOUNTS === 'true';
const devTestPassword = allowDevTestAccounts ? (process.env.EXPO_PUBLIC_DEV_TEST_PASSWORD ?? '').trim() : '';
const showDevTestAccounts = allowDevTestAccounts && devTestPassword.length > 0;

function formatFriendNames(friends: Friend[]) {
  if (friends.length === 0) return '';
  if (friends.length === 1) return friends[0].name;
  if (friends.length === 2) return `${friends[0].name}、${friends[1].name}`;
  return `${friends[0].name}、${friends[1].name}等 ${friends.length} 位好友`;
}

function fallbackPhoneForSession(session: Session | null) {
  const sessionEmail = session?.user.email?.toLowerCase();
  const devPhone = devTestAccounts.find((account) => account.email === sessionEmail)?.phone ?? null;
  return session?.user.phone || devPhone || '';
}

function maskDisplayPhone(phone: string) {
  if (!phone) return '手机号未绑定';
  const national = phone.startsWith('+86') ? phone.slice(3) : phone;
  if (/^\d{11}$/.test(national)) return `${national.slice(0, 3)}****${national.slice(-4)}`;
  if (phone.length <= 7) return phone;
  return `${phone.slice(0, 4)}****${phone.slice(-3)}`;
}

function isLocalPhotoUrl(url: string) {
  return url.startsWith('file:') || url.startsWith('ph:') || url.startsWith('assets-library:');
}

function stablePhotoUrls(previousPaths: string[], previousUrls: string[], nextPaths: string[], nextUrls: string[]) {
  const previousUrlByPath = new Map(previousPaths.map((path, index) => [path, previousUrls[index] ?? '']));

  return nextPaths.map((path, index) => {
    const previousUrl = previousUrlByPath.get(path) ?? '';
    const nextUrl = nextUrls[index] ?? '';

    if (!previousUrl) return nextUrl;
    if (isLocalPhotoUrl(previousUrl) && nextUrl) return nextUrl;
    return previousUrl;
  });
}

function keepStableSnapshotPhotos(previous: AppSnapshot, next: AppSnapshot): AppSnapshot {
  return {
    ...next,
    journalPhotoUrls: stablePhotoUrls(previous.journalPhotoPaths, previous.journalPhotoUrls, next.journalPhotoPaths, next.journalPhotoUrls),
  };
}

function accountPlaceholderSnapshot(userId: string, session: Session | null): AppSnapshot {
  const phone = fallbackPhoneForSession(session);

  return {
    ...demoSnapshot,
    aliveDays: 1,
    aliveReplies: [],
    checkedIn: false,
    diaryEntries: [],
    friends: [],
    friendRequests: [],
    incomingPokes: [],
    sentPokes: [],
    journalPhotoPaths: [],
    journalPhotoUrls: [],
    journalText: '',
    profile: {
      id: userId,
      nickname: phone ? `用户${phone.slice(-4)}` : '加载中',
      phoneE164: phone,
      phoneMasked: maskDisplayPhone(phone),
      avatarColor: demoSnapshot.profile.avatarColor,
      showStatusToFriends: true,
    },
    streak: 0,
    todos: [],
  };
}

function buildDiaryText({
  aliveDays,
  journalText,
  photoCount,
  quoteText,
  statusText,
  weatherText,
  todos,
}: {
  aliveDays: number;
  journalText: string;
  photoCount: number;
  quoteText: string;
  statusText: string;
  weatherText: string;
  todos: Todo[];
}) {
  const doneTodos = todos.filter((todo) => todo.done);
  const doneText = doneTodos.length > 0 ? doneTodos.map((todo, index) => `${index + 1}. ${todo.text}`).join('\n') : '今天还没有标记完成的事。';
  const journal = journalText.trim() || '今天还没有写随笔。';
  const quote = quoteText.trim() || '今天还没有保存给自己的话。';

  return [
    `累计存活：${aliveDays} 天`,
    `今天天气：${weatherText}`,
    `今天心情：${statusText}`,
    `随笔小记：${journal}`,
    `照片：${photoCount} 张`,
    `送给自己的一句话：${quote}`,
    `完成的三件事：\n${doneText}`,
  ].join('\n\n');
}

function localDateIso(date = new Date()) {
  const timezoneOffset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - timezoneOffset).toISOString().slice(0, 10);
}

function isAuthSessionMissingError(error: unknown) {
  return error instanceof Error && (error.name === 'AuthSessionMissingError' || error.message.toLowerCase().includes('session missing'));
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message = '网络请求超时，请检查网络后再试') {
  return Promise.race([
    promise,
    new Promise<T>((_resolve, reject) => {
      setTimeout(() => reject(new Error(message)), timeoutMs);
    }),
  ]);
}

export default function App() {
  const [tab, setTab] = useState<TabKey>('today');
  const [snapshot, setSnapshot] = useState<AppSnapshot>(demoSnapshot);
  const [draft, setDraft] = useState('');
  const [importantDraft, setImportantDraft] = useState(false);
  const [pokeNotice, setPokeNotice] = useState(DEFAULT_POKE_NOTICE);
  const [journalDraft, setJournalDraft] = useState(demoSnapshot.journalText);
  const [quoteDraft, setQuoteDraft] = useState(demoSnapshot.quoteText);
  const [demoMode, setDemoMode] = useState(!hasSupabaseConfig);
  const [journalSaveState, setJournalSaveState] = useState<SaveState>('idle');
  const [quoteSaveState, setQuoteSaveState] = useState<SaveState>('idle');
  const [savedJournalText, setSavedJournalText] = useState(demoSnapshot.journalText);
  const [savedQuoteText, setSavedQuoteText] = useState('');
  const [dismissedPokeIds, setDismissedPokeIds] = useState<Set<string>>(new Set());
  const [dismissedReplyIds, setDismissedReplyIds] = useState<Set<string>>(new Set());
  const [optimisticPokedFriendIds, setOptimisticPokedFriendIds] = useState<Set<string>>(new Set());
  const [quickRecordDraft, setQuickRecordDraft] = useState('');
  const [quickRecordOpen, setQuickRecordOpen] = useState(false);
  const [todayDiaryOpen, setTodayDiaryOpen] = useState(false);
  const [weatherPickerOpen, setWeatherPickerOpen] = useState(false);
  const [session, setSession] = useState<Session | null>(null);
  const [signingOut, setSigningOut] = useState(false);
  const quoteNoticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveNoticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastPokeAlertId = useRef<string | null>(null);
  const lastSnapshotJournalText = useRef(demoSnapshot.journalText);
  const lastSnapshotQuoteText = useRef(demoSnapshot.quoteText);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [appToast, setAppToast] = useState('');
  const appToastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const userId = session?.user.id;
  const effectiveSnapshot =
    !demoMode && userId && snapshot.profile.id === demoSnapshot.profile.id ? accountPlaceholderSnapshot(userId, session) : snapshot;

  const checkedIn = effectiveSnapshot.checkedIn;
  const statusText = effectiveSnapshot.statusText;
  const todos = effectiveSnapshot.todos;
  const friends = effectiveSnapshot.friends;
  const friendRequests = effectiveSnapshot.friendRequests;
  const incomingPokes = effectiveSnapshot.incomingPokes;
  const aliveReplies = effectiveSnapshot.aliveReplies;
  const sentPokes = effectiveSnapshot.sentPokes;
  const diaryEntries = effectiveSnapshot.diaryEntries;
  const aliveDays = effectiveSnapshot.aliveDays;
  const journalPhotoPaths = effectiveSnapshot.journalPhotoPaths;
  const journalPhotoUrls = effectiveSnapshot.journalPhotoUrls;
  const journalPhotoCount = journalPhotoPaths.length;
  const journalText = effectiveSnapshot.journalText;
  const quoteText = effectiveSnapshot.quoteText;
  const streak = effectiveSnapshot.streak;
  const weatherText = effectiveSnapshot.weatherText;
  const profile = effectiveSnapshot.profile;

  const todayLabel = useMemo(() => {
    return new Intl.DateTimeFormat('zh-CN', {
      month: 'long',
      day: 'numeric',
      weekday: 'long',
    }).format(new Date());
  }, []);

  const doneCount = todos.filter((todo) => todo.done).length;
  const incomingFriendRequestCount = friendRequests.filter((request) => request.direction === 'incoming').length;
  const visibleIncomingPokes = useMemo(
    () => incomingPokes.filter((poke) => !dismissedPokeIds.has(poke.id)),
    [dismissedPokeIds, incomingPokes],
  );
  const repliedFriendIds = useMemo(() => {
    const today = localDateIso();
    return new Set(aliveReplies.filter((reply) => localDateIso(new Date(reply.createdAt)) === today).map((reply) => reply.friendId));
  }, [aliveReplies]);
  const incomingPokeCount = visibleIncomingPokes.length;
  const currentFriendIds = useMemo(() => new Set(friends.map((friend) => friend.id)), [friends]);
  const sentPokedFriendIds = useMemo(() => {
    const today = localDateIso();
    return new Set(
      sentPokes
        .filter((poke) => localDateIso(new Date(poke.createdAt)) === today && currentFriendIds.has(poke.friendId))
        .map((poke) => poke.friendId),
    );
  }, [currentFriendIds, sentPokes]);
  const pokedFriendIds = useMemo(() => {
    return new Set([
      ...sentPokedFriendIds,
      ...Array.from(optimisticPokedFriendIds).filter((friendId) => currentFriendIds.has(friendId)),
    ]);
  }, [currentFriendIds, optimisticPokedFriendIds, sentPokedFriendIds]);
  const visibleAliveReplyNotices = useMemo(() => {
    const today = localDateIso();
    return aliveReplies.filter((reply) => localDateIso(new Date(reply.createdAt)) === today && !dismissedReplyIds.has(reply.id));
  }, [aliveReplies, dismissedReplyIds]);
  const friendSignalCount = incomingPokeCount + visibleAliveReplyNotices.length;
  const todoNote = useMemo(() => todoNotes[Math.floor(Math.random() * todoNotes.length)], [tab]);

  function showSavedFeedback(savedText = journalDraft.trim()) {
    setJournalSaveState('saved');
    setSavedJournalText(savedText);
    if (saveNoticeTimer.current) clearTimeout(saveNoticeTimer.current);
    saveNoticeTimer.current = setTimeout(() => setJournalSaveState('idle'), 1400);
  }

  function showQuoteSavedFeedback(savedText = quoteDraft.trim()) {
    setQuoteSaveState('saved');
    setSavedQuoteText(savedText);
    if (quoteNoticeTimer.current) clearTimeout(quoteNoticeTimer.current);
    quoteNoticeTimer.current = setTimeout(() => setQuoteSaveState('idle'), 1400);
  }

  function requireCheckin() {
    if (checkedIn) return true;
    Alert.alert('请先确认还活着吗？', '确认之后，今天的随笔、照片和三件事才会留下痕迹。');
    return false;
  }

  function showAppToast(message: string) {
    setAppToast(message);
    if (appToastTimer.current) clearTimeout(appToastTimer.current);
    appToastTimer.current = setTimeout(() => setAppToast(''), 1800);
  }

  useEffect(() => {
    if (!hasSupabaseConfig) return;

    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: subscription } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
    });

    return () => subscription.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    return () => {
      if (quoteNoticeTimer.current) clearTimeout(quoteNoticeTimer.current);
      if (saveNoticeTimer.current) clearTimeout(saveNoticeTimer.current);
      if (appToastTimer.current) clearTimeout(appToastTimer.current);
    };
  }, []);

  useEffect(() => {
    const nextSnapshot = userId && !demoMode ? accountPlaceholderSnapshot(userId, session) : demoSnapshot;
    setSnapshot(nextSnapshot);
    setJournalDraft(demoSnapshot.journalText);
    setQuoteDraft(demoSnapshot.quoteText);
    setSavedJournalText(demoSnapshot.journalText);
    setSavedQuoteText('');
    setJournalSaveState('idle');
    setQuoteSaveState('idle');
    setDismissedPokeIds(new Set());
    setDismissedReplyIds(new Set());
    setOptimisticPokedFriendIds(new Set());
    setPokeNotice(DEFAULT_POKE_NOTICE);
    lastSnapshotJournalText.current = demoSnapshot.journalText;
    lastSnapshotQuoteText.current = demoSnapshot.quoteText;
    lastPokeAlertId.current = null;
  }, [demoMode, session, userId]);

  useEffect(() => {
    if (!userId || demoMode) return;

    const profilePhone = fallbackPhoneForSession(session);
    const phoneName = profilePhone ? `用户${profilePhone.slice(-4)}` : '新朋友';

    ensureProfile(userId, phoneName, profilePhone)
      .then(() => loadAppSnapshot(userId))
      .then((nextSnapshot) => setSnapshot((current) => keepStableSnapshotPhotos(current, nextSnapshot)))
      .catch(async (error) => {
        if (error instanceof Error && error.message.includes('账户注销处理中')) {
          await signOut();
          setSession(null);
          setSnapshot(demoSnapshot);
          Alert.alert('账户注销处理中', '这个账户已经提交注销，暂时不能继续登录。');
          return;
        }
        Alert.alert('同步失败', error.message);
      });
  }, [demoMode, session?.user.email, session?.user.phone, userId]);

  useEffect(() => {
    if (!userId || demoMode) return;

    const timer = setInterval(() => {
      loadAppSnapshot(userId)
        .then((nextSnapshot) => setSnapshot((current) => keepStableSnapshotPhotos(current, nextSnapshot)))
        .catch(() => {
          // 轻量同步好友回馈和戳一下，失败时避免频繁打扰用户。
        });
    }, 6000);

    return () => clearInterval(timer);
  }, [demoMode, userId]);

  useEffect(() => {
    setQuoteDraft((currentDraft) => (currentDraft === lastSnapshotQuoteText.current ? snapshot.quoteText : currentDraft));
    lastSnapshotQuoteText.current = snapshot.quoteText;
    if (checkedIn && snapshot.quoteText.trim() && snapshot.quoteText.trim() !== demoSnapshot.quoteText) {
      setSavedQuoteText(snapshot.quoteText);
    }
    setQuoteSaveState((current) => (current === 'saving' ? current : 'idle'));
  }, [checkedIn, snapshot.quoteText]);

  useEffect(() => {
    setJournalDraft((currentDraft) => (currentDraft === lastSnapshotJournalText.current ? snapshot.journalText : currentDraft));
    lastSnapshotJournalText.current = snapshot.journalText;
    setSavedJournalText(snapshot.journalText);
  }, [snapshot.journalText]);

  useEffect(() => {
    if (visibleIncomingPokes.length === 0) return;

    const latestPoke = visibleIncomingPokes[0];
    if (lastPokeAlertId.current === latestPoke.id) return;

    lastPokeAlertId.current = latestPoke.id;
    setPokeNotice(`${latestPoke.friendName} 戳了你一下：还活着没？`);
  }, [visibleIncomingPokes]);

  async function refreshSnapshot() {
    if (!userId || demoMode) return;
    const nextSnapshot = await loadAppSnapshot(userId);
    setSnapshot((current) => keepStableSnapshotPhotos(current, nextSnapshot));
  }

  async function handleCheckin() {
    if (!statusText.trim()) {
      Alert.alert('先选今天心情', '选一个今天的状态，再确认还活着。');
      return;
    }

    if (!userId || demoMode) {
      setSnapshot((current) => ({
        ...current,
        aliveDays: current.checkedIn ? current.aliveDays : current.aliveDays + 1,
        checkedIn: true,
        streak: current.checkedIn ? current.streak : current.streak + 1,
      }));
      return;
    }

    try {
      await saveCheckin(userId, statusText, quoteText, journalText, journalPhotoPaths, weatherText);
      await refreshSnapshot();
    } catch (error) {
      Alert.alert('打卡失败', error instanceof Error ? error.message : '请稍后再试');
      await refreshSnapshot().catch(() => undefined);
    }
  }

  async function toggleTodo(id: string) {
    if (!requireCheckin()) return;

    const target = todos.find((todo) => todo.id === id);
    if (!target) return;

    setSnapshot((current) => ({
      ...current,
      todos: current.todos.map((item) => (item.id === id ? { ...item, done: !item.done } : item)),
    }));

    if (!userId || demoMode) return;

    try {
      await updateTodoDone(id, !target.done);
      await refreshSnapshot();
    } catch (error) {
      Alert.alert('更新失败', error instanceof Error ? error.message : '请稍后再试');
      await refreshSnapshot().catch(() => undefined);
    }
  }

  async function toggleTodoImportant(id: string) {
    if (!requireCheckin()) return;

    const target = todos.find((todo) => todo.id === id);
    if (!target) return;

    setSnapshot((current) => ({
      ...current,
      todos: current.todos.map((item) => (item.id === id ? { ...item, important: !item.important } : item)),
    }));

    if (!userId || demoMode) return;

    try {
      await updateTodoImportant(id, !target.important);
      await refreshSnapshot();
    } catch (error) {
      Alert.alert('标记失败', error instanceof Error ? error.message : '请稍后再试');
      await refreshSnapshot().catch(() => undefined);
    }
  }

  async function addTodo() {
    if (!requireCheckin()) return;

    const text = draft.trim();
    if (!text || todos.length >= 3) return;

    if (userId && !demoMode) {
      try {
        const todo = await createTodo(userId, text, importantDraft);
        setSnapshot((current) => ({ ...current, todos: [...current.todos, todo] }));
        await refreshSnapshot();
      } catch (error) {
        Alert.alert('添加失败', error instanceof Error ? error.message : '请稍后再试');
        return;
      }
    } else {
      setSnapshot((current) => ({
        ...current,
        todos: [...current.todos, { id: String(Date.now()), text, done: false, important: importantDraft }],
      }));
    }

    setDraft('');
    setImportantDraft(false);
  }

  async function updateStatusText(value: string) {
    setSnapshot((current) => ({ ...current, statusText: value }));

    if (!checkedIn || !userId || demoMode) return;

    try {
      await saveCheckin(userId, value, quoteText, journalText, journalPhotoPaths, weatherText);
      await refreshSnapshot();
    } catch (error) {
      Alert.alert('保存心情失败', error instanceof Error ? error.message : '请稍后再试');
      await refreshSnapshot();
    }
  }

  function updateJournalText(value: string) {
    setJournalDraft(value);
    setJournalSaveState('idle');
  }

  function updateQuoteText(value: string) {
    setQuoteDraft(value);
    setQuoteSaveState('idle');
  }

  async function saveQuote() {
    if (!requireCheckin()) return;

    const nextQuote = quoteDraft.trim();
    if (!nextQuote) return;

    setQuoteSaveState('saving');

    if (!userId || demoMode) {
      setSnapshot((current) => ({ ...current, quoteText: nextQuote }));
      showQuoteSavedFeedback(nextQuote);
      return;
    }

    try {
      await saveCheckin(userId, statusText, nextQuote, journalText, journalPhotoPaths, weatherText);
      await refreshSnapshot();
      showQuoteSavedFeedback(nextQuote);
    } catch (error) {
      setQuoteSaveState('idle');
      Alert.alert('保存失败', error instanceof Error ? error.message : '请稍后再试');
      await refreshSnapshot();
    }
  }

  function shuffleQuote() {
    if (!requireCheckin()) return;

    const currentIndex = quotePool.findIndex((quote) => quote === quoteDraft.trim());
    const nextQuote = quotePool[(currentIndex + 1 + quotePool.length) % quotePool.length];

    setQuoteDraft(nextQuote);
    setQuoteSaveState('idle');
  }

  async function saveJournal() {
    if (!requireCheckin()) return;

    const nextJournal = journalDraft.trim();

    setJournalSaveState('saving');

    if (!userId || demoMode) {
      setSnapshot((current) => ({ ...current, journalText: nextJournal }));
      showSavedFeedback(nextJournal);
      return;
    }

    try {
      await saveCheckin(userId, statusText, quoteText, nextJournal, journalPhotoPaths, weatherText);
      await refreshSnapshot();
      showSavedFeedback(nextJournal);
    } catch (error) {
      setJournalSaveState('idle');
      Alert.alert('保存失败', error instanceof Error ? error.message : '请稍后再试');
      await refreshSnapshot();
    }
  }

  function toggleWeatherPicker() {
    if (!requireCheckin()) return;
    setWeatherPickerOpen((current) => !current);
  }

  async function updateWeatherText(nextWeather: string) {
    setSnapshot((current) => ({ ...current, weatherText: nextWeather }));
    setWeatherPickerOpen(false);

    if (!userId || demoMode) return;

    try {
      await saveCheckin(userId, statusText, quoteText, journalText, journalPhotoPaths, nextWeather);
      await refreshSnapshot();
    } catch (error) {
      Alert.alert('保存天气失败', error instanceof Error ? error.message : '请稍后再试');
      await refreshSnapshot();
    }
  }

  function openQuickRecord() {
    if (!requireCheckin()) return;
    setQuickRecordOpen(true);
  }

  async function saveQuickRecord() {
    if (!requireCheckin()) return;

    const text = quickRecordDraft.trim();
    if (!text) return;

    const time = new Intl.DateTimeFormat('zh-CN', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(new Date());
    const baseJournal = journalText.trim();
    const nextJournal = baseJournal ? `${baseJournal}\n${time} ${text}` : `${time} ${text}`;

    setJournalSaveState('saving');

    if (!userId || demoMode) {
      setJournalDraft(nextJournal);
      setSnapshot((current) => ({ ...current, journalText: nextJournal }));
      setQuickRecordDraft('');
      setQuickRecordOpen(false);
      showSavedFeedback(nextJournal);
      return;
    }

    try {
      await saveCheckin(userId, statusText, quoteText, nextJournal, journalPhotoPaths, weatherText);
      await refreshSnapshot();
      setJournalDraft(nextJournal);
      setQuickRecordDraft('');
      setQuickRecordOpen(false);
      showSavedFeedback(nextJournal);
    } catch (error) {
      setJournalSaveState('idle');
      Alert.alert('记录失败', error instanceof Error ? error.message : '请稍后再试');
    }
  }

  async function addJournalPhoto() {
    if (!requireCheckin()) return;

    if (journalPhotoCount >= 3) {
      Alert.alert('最多 3 张', '今天的电子日记最多放 3 张照片。');
      return;
    }

    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('需要相册权限', '允许访问相册后，才能给随笔小记添加照片。');
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      allowsEditing: false,
      allowsMultipleSelection: false,
      mediaTypes: ['images'],
      quality: 0.82,
    });

    if (result.canceled || !result.assets[0]?.uri) return;

    const localUri = result.assets[0].uri;

    if (!userId || demoMode) {
      setSnapshot((current) => ({
        ...current,
        journalPhotoPaths: [...current.journalPhotoPaths, localUri].slice(0, 3),
        journalPhotoUrls: [...current.journalPhotoUrls, localUri].slice(0, 3),
      }));
      showAppToast('照片已保存到今天。');
      return;
    }

    setUploadingPhoto(true);
    try {
      const photo = await uploadJournalPhoto(userId, localUri);
      const nextPaths = [...journalPhotoPaths, photo.path].slice(0, 3);
      const currentUrls = journalPhotoPaths.map((_path, index) => journalPhotoUrls[index] ?? '');
      const nextUrls = [...currentUrls, photo.signedUrl || localUri].slice(0, 3);

      setSnapshot((current) => ({
        ...current,
        journalPhotoPaths: nextPaths,
        journalPhotoUrls: nextUrls,
      }));

      await saveCheckin(userId, statusText, quoteText, journalText, nextPaths, weatherText);
      await refreshSnapshot();
      showAppToast('照片已保存到今天。');
    } catch (error) {
      Alert.alert('照片上传失败，请稍后再试', error instanceof Error ? error.message : undefined);
    } finally {
      setUploadingPhoto(false);
    }
  }

  async function removeJournalPhoto(index: number) {
    if (!requireCheckin()) return;

    const removedPath = journalPhotoPaths[index];
    const nextPaths = journalPhotoPaths.filter((_path, pathIndex) => pathIndex !== index);
    const urlByPath = new Map(journalPhotoPaths.map((path, pathIndex) => [path, journalPhotoUrls[pathIndex] ?? '']));
    const nextUrls = nextPaths.map((path) => urlByPath.get(path) ?? '');

    setSnapshot((current) => ({
      ...current,
      journalPhotoPaths: nextPaths,
      journalPhotoUrls: nextUrls,
    }));

    if (!userId || demoMode) {
      showAppToast('照片已移除。');
      return;
    }

    try {
      if (removedPath) await deleteJournalPhoto(removedPath);
      await saveCheckin(userId, statusText, quoteText, journalText, nextPaths, weatherText);
      await refreshSnapshot();
      showAppToast('照片已移除。');
    } catch (error) {
      Alert.alert('删除照片失败', error instanceof Error ? error.message : '请稍后再试');
      await refreshSnapshot();
    }
  }

  function openTodayDiary() {
    if (!requireCheckin()) return;
    setTodayDiaryOpen(true);
  }

  const savedTodayQuoteText =
    savedQuoteText.trim() || (checkedIn && quoteText.trim() && quoteText.trim() !== demoSnapshot.quoteText ? quoteText : '');

  const todayDiaryText = buildDiaryText({
    aliveDays,
    journalText,
    photoCount: journalPhotoCount,
    quoteText: savedTodayQuoteText,
    statusText,
    weatherText,
    todos,
  });
  const visibleDiaryEntries = useMemo(() => {
    if (!checkedIn) return diaryEntries;

    const today = localDateIso();
    const todayEntry: DiaryEntry = {
      date: today,
      journalText,
      photoUrls: journalPhotoPaths.map((_path, index) => journalPhotoUrls[index] ?? '').filter(Boolean),
      quoteText: savedTodayQuoteText,
      statusText,
      todos,
      weatherText,
    };
    const historyWithoutToday = diaryEntries.filter((entry) => entry.date !== today);

    return [todayEntry, ...historyWithoutToday];
  }, [checkedIn, diaryEntries, journalPhotoUrls, journalText, savedTodayQuoteText, statusText, todos, weatherText]);

  async function handleSendFriendRequest(phone: string) {
    if (!userId || demoMode) {
      Alert.alert('演示模式', '接入 Supabase 并登录后，就可以添加真实好友。');
      return;
    }

    try {
      await sendFriendRequest(userId, phone);
      await refreshSnapshot();
      showAppToast('好友申请已发送，等对方接受。');
    } catch (error) {
      Alert.alert('添加失败', error instanceof Error ? error.message : '请稍后再试');
    }
  }

  async function handleAcceptFriendRequest(requestId: string) {
    if (!userId || demoMode) return;

    try {
      await acceptFriendRequest(requestId);
      await refreshSnapshot();
    } catch (error) {
      Alert.alert('接受失败', error instanceof Error ? error.message : '请稍后再试');
    }
  }

  async function handlePokeFriend(friend: Friend) {
    if (pokedFriendIds.has(friend.id)) return;

    setPokeNotice(`你戳了 ${friend.name} 一下：还活着没？`);
    setOptimisticPokedFriendIds((current) => new Set([...current, friend.id]));

    if (!userId || demoMode) return;

    try {
      await pokeFriend(userId, friend.id);
      await refreshSnapshot();
      setOptimisticPokedFriendIds((current) => {
        const next = new Set(current);
        next.delete(friend.id);
        return next;
      });
    } catch (error) {
      setOptimisticPokedFriendIds((current) => {
        const next = new Set(current);
        next.delete(friend.id);
        return next;
      });
      Alert.alert('戳一戳失败', error instanceof Error ? error.message : '请稍后再试');
    }
  }

  async function handleReplyPoke(poke: IncomingPoke) {
    setPokeNotice(`你回了 ${poke.friendName} 一下：我还活着。`);
    setDismissedPokeIds((current) => new Set([...current, poke.id]));

    if (!userId || demoMode) return;

    try {
      await replyAliveToPoke(userId, poke.friendId);
      await refreshSnapshot();
    } catch (error) {
      setDismissedPokeIds((current) => {
        const next = new Set(current);
        next.delete(poke.id);
        return next;
      });
      Alert.alert('回馈失败', error instanceof Error ? error.message : '请稍后再试');
    }
  }

  function handleDeleteFriend(friend: Friend) {
    if (!userId || demoMode) {
      Alert.alert('演示模式', '真实登录后才能删除好友。');
      return;
    }

    Alert.alert('删除好友', `确定删除 ${friend.name} 吗？删除后需要重新发送好友申请。`, [
      { text: '取消', style: 'cancel' },
      {
        text: '删除',
        style: 'destructive',
        onPress: async () => {
          try {
            await deleteFriendship(userId, friend.id);
            await refreshSnapshot();
          } catch (error) {
            Alert.alert('删除失败', error instanceof Error ? error.message : '请稍后再试');
          }
        },
      },
    ]);
  }

  async function handleUpdateNickname(nickname: string) {
    const nextNickname = nickname.trim();
    if (!nextNickname) return;

    setSnapshot((current) => ({
      ...current,
      profile: {
        ...current.profile,
        nickname: nextNickname,
      },
    }));

    if (!userId || demoMode) {
      return;
    }

    try {
      await updateProfile(userId, nextNickname);
    } catch (error) {
      Alert.alert('保存失败', error instanceof Error ? error.message : '请稍后再试');
      await refreshSnapshot();
      throw error;
    }
  }

  async function handleUpdatePrivacy(showStatusToFriends: boolean) {
    setSnapshot((current) => ({
      ...current,
      profile: {
        ...current.profile,
        showStatusToFriends,
      },
    }));

    if (!userId || demoMode) return;

    try {
      await updatePrivacySetting(userId, showStatusToFriends);
    } catch (error) {
      Alert.alert('保存失败', error instanceof Error ? error.message : '请稍后再试');
      await refreshSnapshot();
    }
  }

  async function handleSignOut() {
    if (signingOut) return;

    if (demoMode) {
      setDemoMode(false);
      setSnapshot(demoSnapshot);
      return;
    }

    setSigningOut(true);
    try {
      await signOut();
      setSession(null);
      setSnapshot(demoSnapshot);
      setTab('today');
      setDismissedPokeIds(new Set());
      setDismissedReplyIds(new Set());
      setOptimisticPokedFriendIds(new Set());
      setPokeNotice(DEFAULT_POKE_NOTICE);
    } catch (error) {
      Alert.alert('退出失败', error instanceof Error ? error.message : '请检查网络后再试');
    } finally {
      setSigningOut(false);
    }
  }

  function handleDeleteAppData() {
    if (demoMode) {
      Alert.alert('演示模式', '演示数据只保存在当前 App 状态里，退出演示模式后会恢复。');
      return;
    }

    if (!userId) return;

    Alert.alert('删除本应用数据', '这会清空打卡、待办、好友关系和日记照片，并重置昵称；手机号登录资料会保留，方便之后继续被好友搜索到。', [
      { text: '取消', style: 'cancel' },
      {
        text: '删除',
        style: 'destructive',
        onPress: async () => {
          try {
            await deleteOwnAppData(userId);
            await signOut();
            setSession(null);
            setSnapshot(demoSnapshot);
            setTab('today');
            setDismissedPokeIds(new Set());
            setDismissedReplyIds(new Set());
            setOptimisticPokedFriendIds(new Set());
            setPokeNotice(DEFAULT_POKE_NOTICE);
          } catch (error) {
            if (isAuthSessionMissingError(error)) {
              await signOut();
              setSession(null);
              setSnapshot(demoSnapshot);
              setTab('today');
              setDismissedPokeIds(new Set());
              setDismissedReplyIds(new Set());
              setOptimisticPokedFriendIds(new Set());
              setPokeNotice(DEFAULT_POKE_NOTICE);
              Alert.alert('登录状态已失效', '已返回登录页。这次没有删除云端数据，请重新登录后再删除。');
              return;
            }
            Alert.alert('删除失败', error instanceof Error ? error.message : '请稍后再试');
          }
        },
      },
    ]);
  }

  function handleRequestAccountDeletion() {
    if (demoMode) {
      Alert.alert('演示模式', '演示模式没有真实账号，不需要注销。');
      return;
    }

    if (!userId) return;

    Alert.alert(
      '注销账户',
      '注销后会立即退出登录，并停止展示你的昵称、手机号和好友关系。打卡、日记、照片等内容会按保留规则进入后续清理。',
      [
        { text: '取消', style: 'cancel' },
        {
          text: '继续注销',
          style: 'destructive',
          onPress: () => {
            Alert.alert(
              '再次确认注销',
              '确认后当前账户将进入注销流程：个人信息会先去标识化，其他内容最长保留一年后清理。这个操作提交后不能在 App 内撤销。',
              [
                { text: '再想想', style: 'cancel' },
                {
                  text: '确认注销',
                  style: 'destructive',
                  onPress: async () => {
                    try {
                      await requestAccountDeletion(userId);
                      await signOut();
                      setSession(null);
                      setSnapshot(demoSnapshot);
                      setTab('today');
                      setDismissedPokeIds(new Set());
                      setDismissedReplyIds(new Set());
                      setOptimisticPokedFriendIds(new Set());
                      setPokeNotice(DEFAULT_POKE_NOTICE);
                      Alert.alert('注销成功', '账户已退出登录，个人信息已进入删除流程。');
                    } catch (error) {
                      Alert.alert('注销失败', error instanceof Error ? error.message : '请稍后再试');
                    }
                  },
                },
              ],
            );
          },
        },
      ],
    );
  }

  if (!demoMode && hasSupabaseConfig && !session) {
    return <AuthScreen onUseDemo={() => setDemoMode(true)} />;
  }

  if (!demoMode && !hasSupabaseConfig) {
    return <LaunchScreen onUseDemo={() => setDemoMode(true)} />;
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar style="light" />
      <View style={styles.app}>
        <View style={styles.topbar}>
          <View>
            <Text style={styles.date}>{todayLabel}</Text>
            <Text style={styles.logo}>活着吗</Text>
          </View>
          <Pressable style={styles.iconButton} onPress={openQuickRecord}>
            <Text style={styles.iconText}>记</Text>
          </Pressable>
        </View>

        <ScrollView style={styles.content} contentContainerStyle={styles.contentInner} showsVerticalScrollIndicator={false}>
          {tab === 'today' && (
            <TodayScreen
              aliveDays={aliveDays}
              checkedIn={checkedIn}
              doneCount={doneCount}
              journalDraft={journalDraft}
              journalPhotoPaths={journalPhotoPaths}
              journalPhotoUrls={journalPhotoUrls}
              journalSaveState={journalSaveState}
              journalText={journalText}
              onAddJournalPhoto={addJournalPhoto}
              onCheckin={handleCheckin}
              onOpenDiary={openTodayDiary}
              onRemoveJournalPhoto={removeJournalPhoto}
              onSaveJournal={saveJournal}
              onSaveQuote={saveQuote}
              onShuffleQuote={shuffleQuote}
              onSelectWeather={updateWeatherText}
              onToggleWeatherPicker={toggleWeatherPicker}
              quoteDraft={quoteDraft}
              quoteSaveState={quoteSaveState}
              quoteText={quoteText}
              savedJournalText={savedJournalText}
              savedQuoteText={savedQuoteText}
              setJournalDraft={updateJournalText}
              setQuoteDraft={updateQuoteText}
              setStatusText={updateStatusText}
              statusText={statusText}
              streak={streak}
              todos={todos}
              toggleTodo={toggleTodo}
              toggleTodoImportant={toggleTodoImportant}
              uploadingPhoto={uploadingPhoto}
              weatherPickerOpen={weatherPickerOpen}
              weatherText={weatherText}
            />
          )}
          {tab === 'friends' && (
            <FriendsScreen
              aliveReplyNotices={visibleAliveReplyNotices}
              friendRequests={friendRequests}
              friends={friends}
              incomingPokes={visibleIncomingPokes}
              onAcceptRequest={handleAcceptFriendRequest}
              onDeleteFriend={handleDeleteFriend}
              onDismissReply={(replyId) => setDismissedReplyIds((current) => new Set([...current, replyId]))}
              onPokeFriend={handlePokeFriend}
              onReplyPoke={handleReplyPoke}
              onSendRequest={handleSendFriendRequest}
              pokedFriendIds={pokedFriendIds}
              pokeNotice={pokeNotice}
              repliedFriendIds={repliedFriendIds}
            />
          )}
          {tab === 'todos' && (
            <TodosScreen
              addTodo={addTodo}
              draft={draft}
              importantDraft={importantDraft}
              setImportantDraft={setImportantDraft}
              setDraft={setDraft}
              softNoteText={todoNote}
              todos={todos}
              toggleTodo={toggleTodo}
              toggleTodoImportant={toggleTodoImportant}
            />
          )}
          {tab === 'profile' && (
            <ProfileScreen
              aliveDays={aliveDays}
              checkedIn={checkedIn}
              diaryEntries={visibleDiaryEntries}
              doneCount={doneCount}
              isDemo={demoMode}
              onSignOut={handleSignOut}
              signingOut={signingOut}
              onUpdatePrivacy={handleUpdatePrivacy}
              onUpdateNickname={handleUpdateNickname}
              onDeleteAppData={handleDeleteAppData}
              onRequestAccountDeletion={handleRequestAccountDeletion}
              profile={profile}
              streak={streak}
            />
          )}
        </ScrollView>

        <View style={styles.tabbar}>
          <TabButton active={tab === 'today'} label="今天" icon="today" onPress={() => setTab('today')} />
          <TabButton
            active={tab === 'friends'}
            leftBadgeCount={incomingFriendRequestCount}
            rightBadgeCount={friendSignalCount}
            label="好友"
            icon="friends"
            onPress={() => setTab('friends')}
          />
          <TabButton active={tab === 'todos'} label="想做" icon="todos" onPress={() => setTab('todos')} />
          <TabButton active={tab === 'profile'} label="我" icon="profile" onPress={() => setTab('profile')} />
        </View>
        <Modal animationType="fade" transparent visible={quickRecordOpen} onRequestClose={() => setQuickRecordOpen(false)}>
          <View style={styles.modalBackdrop}>
            <View style={styles.quickRecordPanel}>
              <SectionHead title="马上记一下" meta="写进今天" />
              <TextInput
                autoFocus
                maxLength={180}
                multiline
                onChangeText={setQuickRecordDraft}
                placeholder="想马上记下的事"
                placeholderTextColor="#777268"
                style={styles.quickRecordInput}
                textAlignVertical="top"
                value={quickRecordDraft}
              />
              <View style={styles.quickRecordActions}>
                <Pressable style={styles.quickRecordCancel} onPress={() => setQuickRecordOpen(false)}>
                  <Text style={styles.quickRecordCancelText}>取消</Text>
                </Pressable>
                <Pressable
                  disabled={!quickRecordDraft.trim()}
                  style={[styles.quickRecordSave, !quickRecordDraft.trim() && styles.disabledButton]}
                  onPress={saveQuickRecord}
                >
                  <Text style={styles.quickRecordSaveText}>保存</Text>
                </Pressable>
              </View>
            </View>
          </View>
        </Modal>
        <Modal animationType="fade" transparent visible={todayDiaryOpen} onRequestClose={() => setTodayDiaryOpen(false)}>
          <View style={styles.modalBackdrop}>
            <View style={styles.todayDiaryPanel}>
              <SectionHead title="看看今天的我" meta="电子日记" />
              <ScrollView style={styles.todayDiaryScroll} showsVerticalScrollIndicator={false}>
                <Text style={styles.todayDiaryText}>{todayDiaryText}</Text>
              </ScrollView>
              <Pressable style={styles.todayDiaryClose} onPress={() => setTodayDiaryOpen(false)}>
                <Text style={styles.quickRecordSaveText}>关闭</Text>
              </Pressable>
            </View>
          </View>
        </Modal>
        {appToast ? (
          <View pointerEvents="none" style={styles.appToast}>
            <Text style={styles.appToastText}>{appToast}</Text>
          </View>
        ) : null}
      </View>
    </SafeAreaView>
  );
}

function LaunchScreen({ onUseDemo }: { onUseDemo: () => void }) {
  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar style="light" />
      <View style={styles.launch}>
        <View style={styles.launchCard}>
          <Text style={styles.launchKicker}>一人公司 MVP</Text>
          <Text style={styles.launchTitle}>活着吗</Text>
          <Text style={styles.launchCopy}>
            真实后端入口已经预留。现在可以先用演示模式继续打磨产品，等 Supabase 配好后自动切换到账号登录。
          </Text>
          <Pressable style={styles.primaryButton} onPress={onUseDemo}>
            <Text style={styles.primaryButtonText}>进入演示模式</Text>
          </Pressable>
        </View>
      </View>
    </SafeAreaView>
  );
}

function AuthScreen({ onUseDemo }: { onUseDemo: () => void }) {
  const [code, setCode] = useState('');
  const [phone, setPhone] = useState('');
  const [sentPhone, setSentPhone] = useState('');
  const [devSigningIn, setDevSigningIn] = useState('');
  const [sending, setSending] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [resendCountdown, setResendCountdown] = useState(0);

  useEffect(() => {
    if (resendCountdown <= 0) return undefined;

    const timer = setTimeout(() => {
      setResendCountdown((current) => Math.max(current - 1, 0));
    }, 1000);

    return () => clearTimeout(timer);
  }, [resendCountdown]);

  function normalizePhone(value: string) {
    const compact = value.replace(/\s|-/g, '');
    if (compact.startsWith('+')) return compact;
    if (/^1\d{10}$/.test(compact)) return `+86${compact}`;
    return compact;
  }

  function formatAuthError(error: unknown) {
    const message = error instanceof Error ? error.message : '';
    const lowerMessage = message.toLowerCase();
    if (lowerMessage.includes('token has expired') || lowerMessage.includes('expired or is invalid')) {
      return '验证码已过期或不正确。请使用最后一次收到的验证码，并在有效期内输入；如果重新发送过，旧验证码会失效。';
    }
    if (lowerMessage.includes('unsupported phone provider')) {
      return 'Supabase 还没有启用手机号登录。请到 Authentication > Providers > Phone 打开 Phone Provider，并确认 Send SMS Hook 已保存。';
    }
    return message || '请稍后再试';
  }

  async function sendCode() {
    const value = normalizePhone(phone.trim());
    if (!value) return;

    setSending(true);
    try {
      await withTimeout(sendPhoneLoginCode(value), 10000, '发送验证码超时，请检查网络后再试');
      setSentPhone(value);
      setCode('');
      setResendCountdown(SMS_RESEND_SECONDS);
      Alert.alert('验证码已发送', '短信验证码已发送，回到这里输入 6 位数字。');
    } catch (error) {
      Alert.alert('发送失败', formatAuthError(error));
    } finally {
      setSending(false);
    }
  }

  async function verifyCode() {
    const token = code.trim();
    if (!sentPhone || token.length < 6) return;

    setVerifying(true);
    try {
      await withTimeout(verifyPhoneLoginCode(sentPhone, token), 10000, '验证码登录超时，请检查网络后再试');
    } catch (error) {
      Alert.alert('登录失败', formatAuthError(error));
    } finally {
      setVerifying(false);
    }
  }

  async function signInDevAccount(email: string) {
    if (!devTestPassword) {
      Alert.alert('测试账号未配置', '请先在本地环境或 EAS preview 环境里配置测试账号密码。');
      return;
    }

    setDevSigningIn(email);
    try {
      await withTimeout(signInWithPassword(email, devTestPassword), 10000, '测试账号登录超时，请检查 iPhone 网络后再试');
    } catch (error) {
      Alert.alert(
        '测试账号登录失败',
        error instanceof Error
          ? `${error.message}\n\n请确认 Supabase Authentication 里已经创建 ${email}，并且测试账号密码与当前环境配置一致。`
          : '请稍后再试',
      );
    } finally {
      setDevSigningIn('');
    }
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar style="light" />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.launchKeyboard}>
        <ScrollView
          contentContainerStyle={styles.authLaunch}
          keyboardDismissMode="interactive"
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.launchCard}>
          <Text style={styles.launchKicker}>欢迎回来</Text>
          <Text style={styles.launchTitle}>今天，活着吗？</Text>
          <Text style={styles.launchCopy}>输入手机号获取 6 位验证码。中国手机号可直接输入 11 位，其他地区请带国际区号。</Text>
          <TextInput
            keyboardType="phone-pad"
            onChangeText={setPhone}
            placeholder="13800138000"
            placeholderTextColor="#777268"
            style={styles.authInput}
            value={phone}
          />
          <Pressable
            disabled={sending || resendCountdown > 0 || !phone.trim()}
            style={[styles.primaryButton, (sending || resendCountdown > 0 || !phone.trim()) && styles.disabledButton]}
            onPress={sendCode}
          >
            <Text style={styles.primaryButtonText}>
              {sending ? '发送中' : resendCountdown > 0 ? `${resendCountdown} 秒后可重新发送` : sentPhone ? '重新发送验证码' : '发送验证码'}
            </Text>
          </Pressable>
          {sentPhone ? (
            <>
              <Text style={styles.authHint}>验证码已发送到 {sentPhone}，60 秒内有效。重新发送后，旧验证码会失效。</Text>
              <TextInput
                keyboardType="number-pad"
                maxLength={6}
                onChangeText={setCode}
                onSubmitEditing={verifyCode}
                placeholder="输入 6 位验证码"
                placeholderTextColor="#777268"
                style={styles.authInput}
                value={code}
              />
              <Pressable
                disabled={verifying || code.trim().length < 6}
                style={[styles.primaryButton, (verifying || code.trim().length < 6) && styles.disabledButton]}
                onPress={verifyCode}
              >
                <Text style={styles.primaryButtonText}>{verifying ? '登录中' : '确认登录'}</Text>
              </Pressable>
            </>
          ) : null}
          <Pressable style={styles.secondaryButton} onPress={onUseDemo}>
            <Text style={styles.secondaryButtonText}>先看演示模式</Text>
          </Pressable>
          {showDevTestAccounts ? (
            <View style={styles.devAccountPanel}>
              <Text style={styles.devAccountHint}>开发内测：走真实 Supabase 数据，不依赖短信验证码。</Text>
              <View style={styles.devAccountRow}>
                {devTestAccounts.map((account) => (
                  <Pressable
                    key={account.email}
                    disabled={Boolean(devSigningIn)}
                    style={[styles.devAccountButton, Boolean(devSigningIn) && styles.disabledButton]}
                    onPress={() => signInDevAccount(account.email)}
                  >
                    <Text style={styles.devButtonText}>{devSigningIn === account.email ? '登录中' : account.label}</Text>
                  </Pressable>
                ))}
              </View>
            </View>
          ) : null}
        </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function TodayScreen({
  aliveDays,
  checkedIn,
  doneCount,
  journalDraft,
  journalPhotoPaths,
  journalPhotoUrls,
  journalSaveState,
  journalText,
  onAddJournalPhoto,
  onCheckin,
  onOpenDiary,
  onRemoveJournalPhoto,
  onSaveJournal,
  onSaveQuote,
  onShuffleQuote,
  onSelectWeather,
  onToggleWeatherPicker,
  quoteDraft,
  quoteSaveState,
  quoteText,
  savedJournalText,
  savedQuoteText,
  setJournalDraft,
  setQuoteDraft,
  setStatusText,
  statusText,
  streak,
  todos,
  toggleTodo,
  toggleTodoImportant,
  uploadingPhoto,
  weatherPickerOpen,
  weatherText,
}: {
  aliveDays: number;
  checkedIn: boolean;
  doneCount: number;
  journalDraft: string;
  journalPhotoPaths: string[];
  journalPhotoUrls: string[];
  journalSaveState: SaveState;
  journalText: string;
  onAddJournalPhoto: () => void;
  onCheckin: () => void;
  onOpenDiary: () => void;
  onRemoveJournalPhoto: (index: number) => void;
  onSaveJournal: () => void;
  onSaveQuote: () => void;
  onShuffleQuote: () => void;
  onSelectWeather: (weatherText: string) => void;
  onToggleWeatherPicker: () => void;
  quoteDraft: string;
  quoteSaveState: SaveState;
  quoteText: string;
  savedJournalText: string;
  savedQuoteText: string;
  setJournalDraft: (value: string) => void;
  setQuoteDraft: (value: string) => void;
  setStatusText: (value: string) => void;
  statusText: string;
  streak: number;
  todos: Todo[];
  toggleTodo: (id: string) => void;
  toggleTodoImportant: (id: string) => void;
  uploadingPhoto: boolean;
  weatherPickerOpen: boolean;
  weatherText: string;
}) {
  const journalPhotoCount = journalPhotoPaths.length;
  const heartbeat = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (!checkedIn) {
      heartbeat.stopAnimation();
      heartbeat.setValue(1);
      return;
    }

    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(heartbeat, { toValue: 1.16, duration: 110, useNativeDriver: true }),
        Animated.timing(heartbeat, { toValue: 1, duration: 120, useNativeDriver: true }),
        Animated.timing(heartbeat, { toValue: 1.08, duration: 100, useNativeDriver: true }),
        Animated.timing(heartbeat, { toValue: 1, duration: 150, useNativeDriver: true }),
        Animated.delay(880),
      ])
    );

    loop.start();
    return () => loop.stop();
  }, [checkedIn, heartbeat]);

  const heartOpacity = heartbeat.interpolate({
    inputRange: [1, 1.16],
    outputRange: [0.82, 1],
  });
  const savePulse = useRef(new Animated.Value(1)).current;
  const quotePulse = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (journalSaveState !== 'saved') return;

    Animated.sequence([
      Animated.timing(savePulse, { toValue: 1.05, duration: 120, useNativeDriver: true }),
      Animated.timing(savePulse, { toValue: 1, duration: 160, useNativeDriver: true }),
    ]).start();
  }, [journalSaveState, savePulse]);

  useEffect(() => {
    if (quoteSaveState !== 'saved') return;

    Animated.sequence([
      Animated.timing(quotePulse, { toValue: 1.05, duration: 120, useNativeDriver: true }),
      Animated.timing(quotePulse, { toValue: 1, duration: 160, useNativeDriver: true }),
    ]).start();
  }, [quotePulse, quoteSaveState]);

  const canSaveJournal = journalDraft.trim() !== journalText.trim();
  const savingJournal = journalSaveState === 'saving';
  const journalSaveLabel = journalSaveState === 'saving' ? '保存中' : journalSaveState === 'saved' ? '已保存' : '保存';
  const savingQuote = quoteSaveState === 'saving';
  const quoteSaveLabel = quoteSaveState === 'saving' ? '保存中' : quoteSaveState === 'saved' ? '已保存' : '保存';
  const hasSavedMood = checkedIn && statusText.trim().length > 0;
  const archiveItems = [
    { done: checkedIn, label: '天气', mark: '天' },
    { done: hasSavedMood, label: '心情', mark: '心' },
    { done: checkedIn && savedJournalText.trim().length > 0, label: '随笔', mark: '随' },
    { done: checkedIn && savedQuoteText.trim().length > 0, label: '箴言', mark: '箴' },
    { done: todos.some((todo) => todo.done), label: '三件事', mark: '事' },
  ];
  const archiveDoneCount = archiveItems.filter((item) => item.done).length;
  const weatherChoices = weatherOptions.filter((option) => option !== weatherText);

  return (
    <View style={styles.stack}>
      <View style={[styles.heroCard, checkedIn && styles.heroCardChecked]}>
        <View style={styles.heroTopRow}>
          <View style={styles.pulseMark}>
            <Animated.Text style={[styles.pulseIcon, { opacity: heartOpacity, transform: [{ scale: heartbeat }] }]}>♥</Animated.Text>
          </View>
          <View style={[styles.weatherInlineDrawer, weatherPickerOpen && styles.weatherInlineDrawerOpen]}>
            <Pressable style={styles.lifeSignal} onPress={onToggleWeatherPicker}>
              <View style={styles.archiveHead}>
                <Text style={styles.lifeSignalLabel}>今日存档</Text>
                <View style={styles.weatherCurrentRow}>
                  <Text style={styles.weatherButtonText}>{weatherText.split(' ')[0]}</Text>
                  <Text style={styles.weatherArrow}>{weatherPickerOpen ? '⌃' : '⌄'}</Text>
                </View>
              </View>
              <View style={styles.archiveDots}>
                {archiveItems.map((item) => (
                  <View key={item.label} style={[styles.archiveDot, item.done && styles.archiveDotDone]}>
                    <Text style={[styles.archiveDotText, item.done && styles.archiveDotTextDone]}>{item.mark}</Text>
                  </View>
                ))}
              </View>
            </Pressable>
          </View>
          {weatherPickerOpen && (
            <View style={styles.weatherInlineChoices}>
              {weatherChoices.map((option) => (
                <Pressable key={option} style={styles.weatherInlineChoice} onPress={() => onSelectWeather(option)}>
                  <Text style={styles.weatherInlineChoiceText}>{option.split(' ')[0]}</Text>
                </Pressable>
              ))}
            </View>
          )}
        </View>
        {!checkedIn && (
          <View style={styles.heroMoodBlock}>
            <Text style={styles.heroMoodTitle}>今天心情</Text>
            <View style={styles.noteList}>
              {notes.map((note) => (
                <Pressable
                  key={note}
                  style={[styles.noteChip, statusText === note && styles.noteChipActive]}
                  onPress={() => setStatusText(note)}
                >
                  <Text numberOfLines={1} style={[styles.noteText, statusText === note && styles.noteTextActive]}>{note}</Text>
                </Pressable>
              ))}
            </View>
          </View>
        )}
        <Text style={styles.heroKicker}>{checkedIn ? '今日已确认' : '今日还没确认'}</Text>
        <Text style={styles.heroTitle}>{checkedIn ? '还活着，挺好。' : '今天，活着吗？'}</Text>
        <Text style={styles.heroCopy}>
          {checkedIn ? `送给自己：${quoteText}` : '点一下，不解释，不汇报。只是给自己留个小小的信号。'}
        </Text>
        <Pressable style={styles.primaryButton} onPress={onCheckin}>
          <Text style={styles.primaryButtonText}>{checkedIn ? '今天已确认' : '确认我还活着'}</Text>
        </Pressable>
      </View>

      <View style={styles.metricsGrid}>
        <MetricCard label="累计存活" value={`${aliveDays} 天`} valueColor={colors.green} />
        <MetricCard label="连续存活" value={`${streak} 天`} valueColor={colors.yellow} />
        <MetricCard label="今天要做的" value={`${todos.length} 件`} valueColor={colors.blue} />
      </View>

      <View style={styles.panel}>
        <SectionHead title={checkedIn ? '今天心情和随笔' : '随笔小记'} meta={checkedIn ? '随便记一下' : '确认后留下'} />
        {checkedIn && (
          <View style={styles.noteList}>
            {notes.map((note) => (
              <Pressable
                key={note}
                style={[styles.noteChip, statusText === note && styles.noteChipActive]}
                onPress={() => setStatusText(note)}
              >
                <Text numberOfLines={1} style={[styles.noteText, statusText === note && styles.noteTextActive]}>{note}</Text>
              </Pressable>
            ))}
          </View>
        )}
        <Text style={styles.fieldLabel}>随笔小记</Text>
        <TextInput
          maxLength={180}
          multiline
          onChangeText={setJournalDraft}
          placeholder="一时兴起的话，可以写在这里。"
          placeholderTextColor="#777268"
          style={styles.journalInput}
          textAlignVertical="top"
          value={journalDraft}
        />
        {journalText ? <Text style={styles.journalHint}>已留在今天：{journalText}</Text> : null}
        <View style={styles.photoActionRow}>
          <Animated.View style={{ transform: [{ scale: savePulse }] }}>
            <Pressable
              disabled={!canSaveJournal || savingJournal}
              style={[
                styles.journalSaveButton,
                journalSaveState === 'saved' && styles.journalSaveButtonSaved,
                (!canSaveJournal || savingJournal) && styles.disabledButton,
              ]}
              onPress={onSaveJournal}
            >
              <Text style={styles.journalSaveButtonText}>{journalSaveLabel}</Text>
            </Pressable>
          </Animated.View>
          <Pressable
            disabled={uploadingPhoto || journalPhotoCount >= 3}
            style={[styles.photoAddButton, (uploadingPhoto || journalPhotoCount >= 3) && styles.disabledButton]}
            onPress={onAddJournalPhoto}
          >
            <Text style={styles.photoAddButtonText}>{uploadingPhoto ? '上传中' : '添加照片'}</Text>
          </Pressable>
          <Text style={styles.photoLimitText}>{journalPhotoCount}/3</Text>
        </View>
        {journalPhotoPaths.length > 0 && (
          <View style={styles.photoGrid}>
            {journalPhotoPaths.map((path, index) => {
              const url = journalPhotoUrls[index] ?? '';

              return (
                <View key={path} style={styles.photoThumbWrap}>
                  {url ? <Image source={{ uri: url }} style={styles.photoThumb} /> : null}
                  <Pressable style={styles.photoRemoveButton} onPress={() => onRemoveJournalPhoto(index)}>
                    <Text style={styles.photoRemoveText}>×</Text>
                  </Pressable>
                </View>
              );
            })}
          </View>
        )}
      </View>

      <View style={styles.panel}>
        <SectionHead title="送给自己的一句话" meta="每日箴言" />
        <TextInput
          maxLength={96}
          multiline
          onChangeText={setQuoteDraft}
          placeholder="今天想留给自己的话"
          placeholderTextColor="#777268"
          style={styles.quoteCardInput}
          textAlignVertical="center"
          value={quoteDraft}
        />
        <View style={styles.quoteActionRow}>
          <Animated.View style={{ transform: [{ scale: quotePulse }] }}>
            <Pressable
              disabled={!quoteDraft.trim() || savingQuote}
              onPress={onSaveQuote}
              style={[styles.quoteActionButton, quoteSaveState === 'saved' && styles.addButtonSaved, (!quoteDraft.trim() || savingQuote) && styles.disabledButton]}
            >
              <Text style={styles.quoteActionButtonText}>{quoteSaveLabel}</Text>
            </Pressable>
          </Animated.View>
          <Pressable onPress={onShuffleQuote} style={[styles.quoteActionButton, styles.quoteShuffleButton]}>
            <Text style={styles.shuffleButtonText}>换一句</Text>
          </Pressable>
        </View>
      </View>

      <View style={styles.panel}>
        <SectionHead title="今天最想做的三件事" meta={`${doneCount}/${todos.length}`} />
        {todos.map((todo) => (
          <TodoRow
            key={todo.id}
            todo={todo}
            onPress={() => toggleTodo(todo.id)}
            onToggleImportant={() => toggleTodoImportant(todo.id)}
          />
        ))}
      </View>

      <Pressable style={styles.diaryButton} onPress={onOpenDiary}>
        <Text style={styles.diaryButtonText}>看看今天的我</Text>
      </Pressable>
    </View>
  );
}

function FriendsScreen({
  aliveReplyNotices,
  friendRequests,
  friends,
  incomingPokes,
  onAcceptRequest,
  onDeleteFriend,
  onDismissReply,
  onPokeFriend,
  onReplyPoke,
  onSendRequest,
  pokedFriendIds,
  pokeNotice,
  repliedFriendIds,
}: {
  aliveReplyNotices: IncomingPoke[];
  friendRequests: FriendRequest[];
  friends: Friend[];
  incomingPokes: IncomingPoke[];
  onAcceptRequest: (requestId: string) => void;
  onDeleteFriend: (friend: Friend) => void;
  onDismissReply: (replyId: string) => void;
  onPokeFriend: (friend: Friend) => void;
  onReplyPoke: (poke: IncomingPoke) => void;
  onSendRequest: (phone: string) => void;
  pokedFriendIds: Set<string>;
  pokeNotice: string;
  repliedFriendIds: Set<string>;
}) {
  const [friendDraft, setFriendDraft] = useState('');
  const isConfirmed = (friend: Friend) => repliedFriendIds.has(friend.id);
  const activeCount = friends.filter(isConfirmed).length;
  const confirmedFriends = friends.filter(isConfirmed);
  const pendingFriends = friends.filter((friend) => !isConfirmed(friend));
  const pokedPendingFriends = pendingFriends.filter((friend) => pokedFriendIds.has(friend.id));
  const pokedConfirmedFriends = confirmedFriends.filter((friend) => pokedFriendIds.has(friend.id));
  const displayPokeNotice =
    pokeNotice !== DEFAULT_POKE_NOTICE
      ? pokeNotice
      : pokedPendingFriends.length > 0
        ? `今天已戳 ${formatFriendNames(pokedPendingFriends)}，等对方回一句：我还活着。`
        : pokedConfirmedFriends.length > 0
          ? `今天 ${formatFriendNames(pokedConfirmedFriends)} 已回馈：我还活着。`
          : DEFAULT_POKE_NOTICE;
  const incomingRequests = friendRequests.filter((request) => request.direction === 'incoming');
  const outgoingRequests = friendRequests.filter((request) => request.direction === 'outgoing');

  function submitRequest() {
    const value = friendDraft.trim();
    if (!value) return;
    onSendRequest(value);
    setFriendDraft('');
  }

  return (
    <View style={styles.stack}>
      <View style={styles.searchPanel}>
        <TextInput
          autoCapitalize="none"
          autoCorrect={false}
          onChangeText={setFriendDraft}
          onSubmitEditing={submitRequest}
          keyboardType="phone-pad"
          placeholder="输入好友手机号"
          placeholderTextColor="#777268"
          returnKeyType="send"
          style={styles.friendInput}
          value={friendDraft}
        />
        <Pressable disabled={!friendDraft.trim()} onPress={submitRequest} style={[styles.smallButton, !friendDraft.trim() && styles.disabledButton]}>
          <Text style={styles.smallButtonText}>添加</Text>
        </Pressable>
      </View>

      {incomingRequests.length > 0 && (
        <View style={styles.requestNotice}>
          <Text style={styles.requestNoticeText}>你有 {incomingRequests.length} 个好友申请待处理</Text>
        </View>
      )}

      {incomingRequests.length > 0 && (
        <View style={styles.panel}>
          <SectionHead title="待接受好友" meta={String(incomingRequests.length)} />
          {incomingRequests.map((request) => (
            <View key={request.id} style={styles.requestRow}>
              <View style={[styles.avatar, styles.requestAvatar, { backgroundColor: request.color }]}>
                <Text style={styles.avatarText}>{request.name.slice(0, 1)}</Text>
              </View>
              <Text style={styles.requestName}>{request.name}</Text>
              <Pressable style={styles.tinyButton} onPress={() => onAcceptRequest(request.id)}>
                <Text style={styles.tinyButtonText}>接受</Text>
              </Pressable>
            </View>
          ))}
        </View>
      )}

      {outgoingRequests.length > 0 && (
        <View style={styles.panel}>
          <SectionHead title="已发出申请" meta={String(outgoingRequests.length)} />
          {outgoingRequests.map((request) => (
            <View key={request.id} style={styles.requestRow}>
              <View style={[styles.avatar, styles.requestAvatar, { backgroundColor: request.color }]}>
                <Text style={styles.avatarText}>{request.name.slice(0, 1)}</Text>
              </View>
              <Text style={styles.requestName}>{request.name}</Text>
              <Text style={styles.requestStatus}>等待中</Text>
            </View>
          ))}
        </View>
      )}

      {incomingPokes.length > 0 && (
        <View style={styles.panel}>
          <SectionHead title="有人戳你" meta={String(incomingPokes.length)} />
          {incomingPokes.slice(0, 3).map((poke) => (
            <View key={poke.id} style={styles.pokeNoticeRow}>
              <View style={[styles.avatar, styles.requestAvatar, { backgroundColor: poke.friendColor }]}>
                <Text style={styles.avatarText}>{poke.friendName.slice(0, 1)}</Text>
              </View>
              <View style={styles.pokeNoticeBody}>
                <Text style={styles.requestName}>{poke.friendName}</Text>
                <Text style={styles.pokeNoticeMeta}>戳了你一下：还活着没？</Text>
              </View>
              <Pressable style={styles.tinyButton} onPress={() => onReplyPoke(poke)}>
                <Text style={styles.tinyButtonText}>我还活着</Text>
              </Pressable>
            </View>
          ))}
        </View>
      )}

      {aliveReplyNotices.length > 0 && (
        <View style={styles.panel}>
          <SectionHead title="好友回馈" meta={String(aliveReplyNotices.length)} />
          {aliveReplyNotices.slice(0, 3).map((reply) => (
            <View key={reply.id} style={styles.pokeNoticeRow}>
              <View style={[styles.avatar, styles.requestAvatar, { backgroundColor: reply.friendColor }]}>
                <Text style={styles.avatarText}>{reply.friendName.slice(0, 1)}</Text>
              </View>
              <View style={styles.pokeNoticeBody}>
                <Text style={styles.requestName}>{reply.friendName}</Text>
                <Text style={styles.pokeNoticeMeta}>回了你一句：我还活着。</Text>
              </View>
              <Pressable style={styles.tinyButtonGhost} onPress={() => onDismissReply(reply.id)}>
                <Text style={styles.tinyButtonGhostText}>知道了</Text>
              </Pressable>
            </View>
          ))}
        </View>
      )}

      <View style={styles.summaryCard}>
        <View>
          <Text style={styles.mutedText}>好友存活雷达</Text>
          <Text style={styles.summaryNumber}>{activeCount}/{friends.length}</Text>
        </View>
        <View style={styles.summarySide}>
          <Text style={styles.mutedText}>今天向你确认</Text>
          <Text style={styles.summaryPending}>待确认 {pendingFriends.length}</Text>
        </View>
      </View>

      {friends.length === 0 && (
        <View style={styles.emptyPanel}>
          <Text style={styles.emptyText}>还没有好友。输入对方手机号，先建一个很小的圈子。</Text>
        </View>
      )}

      {confirmedFriends.length > 0 && (
        <View style={styles.friendSection}>
          <SectionHead title="今天已确认" meta={String(confirmedFriends.length)} />
          {confirmedFriends.map((friend) => (
            <FriendRow
              key={friend.id}
              friend={friend}
              onDeleteFriend={onDeleteFriend}
              onPokeFriend={onPokeFriend}
              poked={pokedFriendIds.has(friend.id)}
              replied={repliedFriendIds.has(friend.id)}
            />
          ))}
        </View>
      )}

      {pendingFriends.length > 0 && (
        <View style={styles.friendSection}>
          <SectionHead title="待确认是否活着" meta={String(pendingFriends.length)} />
          {pendingFriends.map((friend) => (
            <FriendRow
              key={friend.id}
              friend={friend}
              onDeleteFriend={onDeleteFriend}
              onPokeFriend={onPokeFriend}
              poked={pokedFriendIds.has(friend.id)}
              replied={repliedFriendIds.has(friend.id)}
            />
          ))}
        </View>
      )}

      <View style={styles.softNote}>
        <Text style={styles.softNoteText}>{displayPokeNotice}</Text>
      </View>
    </View>
  );
}

function FriendRow({
  friend,
  onDeleteFriend,
  onPokeFriend,
  poked,
  replied,
}: {
  friend: Friend;
  onDeleteFriend: (friend: Friend) => void;
  onPokeFriend: (friend: Friend) => void;
  poked: boolean;
  replied: boolean;
}) {
  const translateX = useRef(new Animated.Value(0)).current;
  const [deleteOpen, setDeleteOpen] = useState(false);
  const confirmed = replied;
  const statusBadgeText = confirmed ? '还活着' : poked ? '待确认' : '未知';
  const statusBadgeStyle = confirmed ? styles.badgeAlive : poked ? styles.badgePending : styles.badgeQuiet;
  const moodText = poked && replied ? '对方回了一句：我还活着。' : poked ? '等对方回一句：我还活着。' : '还没有向你确认今天的状态。';
  const lastSeenText = replied ? '今天反馈' : friend.lastSeen;
  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_event, gesture) => Math.abs(gesture.dx) > 12 && Math.abs(gesture.dx) > Math.abs(gesture.dy),
      onPanResponderMove: (_event, gesture) => {
        const baseX = deleteOpen ? -86 : 0;
        const nextX = Math.max(-86, Math.min(0, baseX + gesture.dx));
        translateX.setValue(nextX);
      },
      onPanResponderRelease: (_event, gesture) => {
        const shouldOpen = deleteOpen ? gesture.dx < 42 : gesture.dx < -42;
        setDeleteOpen(shouldOpen);
        Animated.spring(translateX, {
          toValue: shouldOpen ? -86 : 0,
          useNativeDriver: true,
        }).start();
      },
    }),
  ).current;

  function closeDelete() {
    setDeleteOpen(false);
    Animated.spring(translateX, {
      toValue: 0,
      useNativeDriver: true,
    }).start();
  }

  function deleteFriend() {
    closeDelete();
    onDeleteFriend(friend);
  }

  return (
    <View style={styles.friendSwipeWrap}>
      <View style={styles.friendDeleteReveal}>
        <Pressable style={styles.deleteFriendButton} onPress={deleteFriend}>
          <Text style={styles.deleteFriendText}>删除</Text>
        </Pressable>
      </View>
      <Animated.View
        {...panResponder.panHandlers}
        style={[styles.friendCard, deleteOpen && styles.friendCardOpen, { transform: [{ translateX }] }]}
      >
        <View style={[styles.avatar, { backgroundColor: friend.color }]}>
          <Text style={styles.avatarText}>{friend.name.slice(0, 1)}</Text>
        </View>
        <View style={styles.friendBody}>
          <View style={styles.friendTop}>
            <Text style={styles.friendName}>{friend.name}</Text>
            <Text style={[styles.badge, statusBadgeStyle]}>{statusBadgeText}</Text>
          </View>
          <Text style={styles.friendPhone}>{friend.phoneMasked}</Text>
          <Text style={styles.friendMood} numberOfLines={1}>{moodText}</Text>
          <Text style={styles.friendMeta}>
            {friend.days} 天 · 连续 {friend.streak} 天 · {lastSeenText}
          </Text>
        </View>
        <Pressable disabled={poked} style={[styles.pokeButton, poked && styles.pokeButtonDone]} onPress={() => onPokeFriend(friend)}>
          <Text numberOfLines={1} style={[styles.pokeButtonText, poked && styles.pokeButtonTextDone]}>{poked ? '已戳' : '戳一下'}</Text>
        </Pressable>
      </Animated.View>
    </View>
  );
}

function TodosScreen({
  addTodo,
  draft,
  importantDraft,
  softNoteText,
  setImportantDraft,
  setDraft,
  todos,
  toggleTodo,
  toggleTodoImportant,
}: {
  addTodo: () => void;
  draft: string;
  importantDraft: boolean;
  softNoteText: string;
  setImportantDraft: (value: boolean) => void;
  setDraft: (value: string) => void;
  todos: Todo[];
  toggleTodo: (id: string) => void;
  toggleTodoImportant: (id: string) => void;
}) {
  return (
    <View style={styles.stack}>
      <View style={styles.panel}>
        <SectionHead title="今天最想做的三件事" meta={`${todos.length}/3`} />
        <View style={styles.addRow}>
          <TextInput
            editable={todos.length < 3}
            maxLength={24}
            onChangeText={setDraft}
            onSubmitEditing={addTodo}
            placeholder={todos.length >= 3 ? '今天已经够了' : '写下今天想完成的一件事'}
            placeholderTextColor="#777268"
            returnKeyType="done"
            style={styles.input}
            value={draft}
          />
          <Pressable
            disabled={todos.length >= 3 || !draft.trim()}
            onPress={addTodo}
            style={[styles.addButton, (todos.length >= 3 || !draft.trim()) && styles.disabledButton]}
          >
            <Text style={styles.addButtonText}>加</Text>
          </Pressable>
        </View>
        <Pressable style={[styles.importantToggle, importantDraft && styles.importantToggleActive]} onPress={() => setImportantDraft(!importantDraft)}>
          <Text style={[styles.importantToggleText, importantDraft && styles.importantToggleTextActive]}>
            {importantDraft ? '已标记为大事' : '标记为大事'}
          </Text>
        </Pressable>
      </View>

      <View style={styles.panel}>
        {todos.map((todo) => (
          <TodoRow
            large
            key={todo.id}
            todo={todo}
            onPress={() => toggleTodo(todo.id)}
            onToggleImportant={() => toggleTodoImportant(todo.id)}
          />
        ))}
      </View>

      <View style={styles.softNote}>
        <Text style={styles.softNoteText}>{softNoteText}</Text>
      </View>
    </View>
  );
}

function ProfileScreen({
  aliveDays,
  checkedIn,
  diaryEntries,
  doneCount,
  isDemo,
  onSignOut,
  onUpdatePrivacy,
  onUpdateNickname,
  onDeleteAppData,
  onRequestAccountDeletion,
  profile,
  signingOut,
  streak,
}: {
  aliveDays: number;
  checkedIn: boolean;
  diaryEntries: DiaryEntry[];
  doneCount: number;
  isDemo: boolean;
  onSignOut: () => void;
  onUpdatePrivacy: (showStatusToFriends: boolean) => void;
  onUpdateNickname: (nickname: string) => Promise<void>;
  onDeleteAppData: () => void;
  onRequestAccountDeletion: () => void;
  profile: Profile;
  signingOut: boolean;
  streak: number;
}) {
  const diaryByDate = useMemo(() => new Map(diaryEntries.map((entry) => [entry.date, entry])), [diaryEntries]);
  const todayIso = localDateIso();
  const monthLabel = useMemo(
    () =>
      new Intl.DateTimeFormat('zh-CN', {
        month: 'long',
        year: 'numeric',
      }).format(new Date(`${todayIso}T00:00:00`)),
    [todayIso],
  );
  const calendarDays = useMemo(() => {
    const today = new Date(`${todayIso}T00:00:00`);
    const year = today.getFullYear();
    const month = today.getMonth();
    const firstDay = new Date(year, month, 1);
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const leadingBlanks = (firstDay.getDay() + 6) % 7;
    const totalCells = Math.ceil((leadingBlanks + daysInMonth) / 7) * 7;

    return Array.from({ length: totalCells }, (_item, index) => {
      const dayNumber = index - leadingBlanks + 1;
      if (dayNumber < 1 || dayNumber > daysInMonth) {
        return { active: false, date: '', dayNumber: 0, today: false };
      }

      const date = localDateIso(new Date(year, month, dayNumber));
      return {
        active: diaryByDate.has(date),
        date,
        dayNumber,
        today: date === todayIso,
      };
    });
  }, [diaryByDate, todayIso]);
  const [selectedDiaryDate, setSelectedDiaryDate] = useState(todayIso);
  const selectedDiary = diaryByDate.get(selectedDiaryDate);
  const [nicknameDraft, setNicknameDraft] = useState(profile.nickname);
  const [nicknameSaveState, setNicknameSaveState] = useState<SaveState>('idle');
  const [showAccount, setShowAccount] = useState(false);
  const [showPrivacy, setShowPrivacy] = useState(false);
  const [showReminder, setShowReminder] = useState(false);
  const [showWill, setShowWill] = useState(false);
  const [willDraft, setWillDraft] = useState('');
  const [savedWillDraft, setSavedWillDraft] = useState('');
  const [willSaveState, setWillSaveState] = useState<SaveState>('idle');
  const [friendVisible, setFriendVisible] = useState(profile.showStatusToFriends);
  const [softReminder, setSoftReminder] = useState(false);
  const [reminderTime, setReminderTime] = useState('22:30');

  useEffect(() => {
    setNicknameDraft(profile.nickname);
    setNicknameSaveState('idle');
  }, [profile.nickname]);

  useEffect(() => {
    setFriendVisible(profile.showStatusToFriends);
  }, [profile.showStatusToFriends]);

  async function saveNickname() {
    const value = nicknameDraft.trim();
    if (!value) return;
    setNicknameSaveState('saving');

    try {
      await onUpdateNickname(value);
      setNicknameSaveState('saved');
      setTimeout(() => setNicknameSaveState('idle'), 1400);
    } catch {
      setNicknameSaveState('idle');
    }
  }

  function toggleFriendVisible() {
    const nextValue = !friendVisible;
    setFriendVisible(nextValue);
    onUpdatePrivacy(nextValue);
  }

  function updateWillDraft(value: string) {
    setWillDraft(value);
    setWillSaveState('idle');
  }

  function saveWillDraft() {
    setSavedWillDraft(willDraft.trim());
    setWillSaveState('saved');
    setTimeout(() => setWillSaveState('idle'), 1400);
  }

  return (
    <View style={styles.stack}>
      <View style={styles.profileCard}>
        <View style={[styles.profileAvatar, { backgroundColor: profile.avatarColor }]}>
          <Text style={styles.avatarText}>{profile.nickname.slice(0, 1)}</Text>
        </View>
        <Text style={styles.profileName}>{profile.nickname}</Text>
        <Text style={styles.profilePhone}>{profile.phoneMasked}</Text>
        <Text style={styles.mutedText}>{checkedIn ? '今天已确认活着' : '今天还没出现'}</Text>
        <View style={styles.profileStats}>
          <ProfileStat label="累计存活" value={`${aliveDays} 天`} valueColor={colors.green} />
          <ProfileStat label="连续存活" value={`${streak} 天`} valueColor={colors.yellow} />
          <ProfileStat label="今天要做的" value={`${doneCount} 件`} valueColor={colors.blue} />
        </View>
      </View>

      <View style={styles.calendarPanel}>
        <SectionHead title="打卡日历" meta={monthLabel} />
        <View style={styles.weekRow}>
          {['一', '二', '三', '四', '五', '六', '日'].map((day) => (
            <Text key={day} style={styles.weekText}>{day}</Text>
          ))}
        </View>
        <View style={styles.monthCalendar}>
          {calendarDays.map((item, index) => (
            <Pressable
              disabled={!item.date}
              key={item.date || `blank-${index}`}
              style={[
                styles.calendarCell,
                item.active && styles.calendarCellActive,
                item.today && styles.calendarCellToday,
                selectedDiaryDate === item.date && styles.calendarCellSelected,
              ]}
              onPress={() => setSelectedDiaryDate(item.date)}
            >
              <Text style={[styles.calendarCellText, item.active && styles.calendarCellTextActive]}>{item.dayNumber || ''}</Text>
              {item.active && <View style={styles.calendarDot} />}
            </Pressable>
          ))}
        </View>
        <View style={styles.calendarDivider} />
        {selectedDiary ? (
          <DiaryEntryCard aliveDays={aliveDays} entry={selectedDiary} />
        ) : (
          <View style={styles.diaryEmptyEntry}>
            <Text style={styles.diaryEmptyText}>这一天还没有留下日记。</Text>
          </View>
        )}
      </View>

      <View style={styles.settingsList}>
        <Pressable style={styles.settingItem} onPress={() => setShowAccount((current) => !current)}>
          <Text style={styles.settingText}>账号和昵称</Text>
          <Text style={styles.settingArrow}>{showAccount ? '⌃' : '⌄'}</Text>
        </Pressable>
        {showAccount && (
          <View style={styles.settingPanel}>
            <Text style={styles.settingHelp}>昵称用于展示身份。正式版好友添加会优先使用手机号。</Text>
            <View style={styles.addRow}>
              <TextInput
                maxLength={16}
                onChangeText={setNicknameDraft}
                onSubmitEditing={saveNickname}
                placeholder="你的昵称"
                placeholderTextColor="#777268"
                returnKeyType="done"
                style={styles.input}
                value={nicknameDraft}
              />
              <Pressable
                disabled={!nicknameDraft.trim() || nicknameSaveState === 'saving'}
                onPress={saveNickname}
                style={[
                  styles.addButton,
                  nicknameSaveState === 'saved' && styles.addButtonSaved,
                  (!nicknameDraft.trim() || nicknameSaveState === 'saving') && styles.disabledButton,
                ]}
              >
                <Text style={styles.addButtonText}>
                  {nicknameSaveState === 'saving' ? '保存中' : nicknameSaveState === 'saved' ? '已保存' : '保存'}
                </Text>
              </Pressable>
            </View>
          </View>
        )}

        <Pressable style={styles.settingItem} onPress={() => setShowPrivacy((current) => !current)}>
          <Text style={styles.settingText}>隐私设置</Text>
          <Text style={styles.settingArrow}>{showPrivacy ? '⌃' : '⌄'}</Text>
        </Pressable>
        {showPrivacy && (
          <View style={styles.settingPanel}>
            <View style={styles.toggleRow}>
              <View style={styles.toggleTextGroup}>
                <Text style={styles.toggleTitle}>好友可见今日状态</Text>
                <Text style={styles.settingHelp}>关闭后，好友不能读取你的打卡状态和状态文字。</Text>
              </View>
              <Pressable
                accessibilityRole="switch"
                accessibilityState={{ checked: friendVisible }}
                onPress={toggleFriendVisible}
                style={[styles.switchTrack, friendVisible && styles.switchTrackActive]}
              >
                <View style={[styles.switchThumb, friendVisible && styles.switchThumbActive]} />
              </Pressable>
            </View>
            <Pressable onPress={() => Alert.alert('隐私政策', '隐私政策已整理在 PRIVACY_POLICY.md 和 privacy.html，正式上架前需要发布为可访问网页链接。')}>
              <Text style={styles.linkText}>查看隐私政策</Text>
            </Pressable>
          </View>
        )}

        <Pressable style={styles.settingItem} onPress={() => setShowReminder((current) => !current)}>
          <Text style={styles.settingText}>提醒时间</Text>
          <Text style={styles.settingArrow}>{showReminder ? '⌃' : '⌄'}</Text>
        </Pressable>
        {showReminder && (
          <View style={styles.settingPanel}>
            <View style={styles.toggleRow}>
              <View style={styles.toggleTextGroup}>
                <Text style={styles.toggleTitle}>轻提醒</Text>
                <Text style={styles.settingHelp}>{softReminder ? `每天 ${reminderTime} 提醒你确认活着。` : '打开后，每天到点提醒你确认活着。'}</Text>
              </View>
              <Pressable
                accessibilityRole="switch"
                accessibilityState={{ checked: softReminder }}
                onPress={() => setSoftReminder((current) => !current)}
                style={[styles.switchTrack, softReminder && styles.switchTrackActive]}
              >
                <View style={[styles.switchThumb, softReminder && styles.switchThumbActive]} />
              </Pressable>
            </View>
            <View style={styles.timeChipRow}>
              {['21:30', '22:30', '23:00'].map((time) => (
                <Pressable key={time} style={[styles.timeChip, reminderTime === time && styles.timeChipActive]} onPress={() => setReminderTime(time)}>
                  <Text style={[styles.timeChipText, reminderTime === time && styles.timeChipTextActive]}>{time}</Text>
                </Pressable>
              ))}
            </View>
            <Text style={styles.savedHint}>正式版会接入 iOS/Android 系统通知权限。</Text>
          </View>
        )}

        <Pressable disabled={signingOut} style={[styles.settingItem, signingOut && styles.disabledButton]} onPress={onSignOut}>
          <Text style={styles.settingText}>{signingOut ? '退出中...' : isDemo ? '退出演示模式' : '退出登录'}</Text>
        </Pressable>
        <Pressable style={[styles.settingItem, styles.dangerItem]} onPress={onDeleteAppData}>
          <Text style={styles.dangerText}>删除本应用数据</Text>
        </Pressable>
        <Pressable style={[styles.settingItem, styles.accountDeleteItem]} onPress={onRequestAccountDeletion}>
          <View>
            <Text style={styles.accountDeleteText}>注销账户</Text>
            <Text style={styles.accountDeleteMeta}>二次确认后退出登录，个人信息进入删除流程</Text>
          </View>
          <Text style={styles.settingArrow}>›</Text>
        </Pressable>

        <Pressable style={styles.willEntry} onPress={() => setShowWill((current) => !current)}>
          <View>
            <Text style={styles.willEntryTitle}>我的遗言</Text>
            <Text style={styles.willEntryMeta}>重要内容，本机草稿</Text>
          </View>
          <Text style={styles.willEntryArrow}>{showWill ? '⌃' : '⌄'}</Text>
        </Pressable>
        {showWill && (
          <View style={styles.willPanel}>
            <Text style={styles.settingHelp}>正式版需要单独做加密、二次确认和紧急联系人机制。现在先作为本机草稿。</Text>
            <TextInput
              maxLength={600}
              multiline
              onChangeText={updateWillDraft}
              placeholder="留给重要的人，或留给未来的自己。"
              placeholderTextColor="#777268"
              style={styles.willInput}
              textAlignVertical="top"
              value={willDraft}
            />
            <View style={styles.willActionRow}>
              <Pressable
                disabled={willDraft.trim() === savedWillDraft.trim()}
                onPress={saveWillDraft}
                style={[
                  styles.willSaveButton,
                  willSaveState === 'saved' && styles.addButtonSaved,
                  willDraft.trim() === savedWillDraft.trim() && styles.disabledButton,
                ]}
              >
                <Text style={styles.willSaveButtonText}>{willSaveState === 'saved' ? '已保存' : '保存'}</Text>
              </Pressable>
              <Text style={styles.savedHint}>
                {savedWillDraft.trim() ? '已保存为本机草稿。' : willDraft.trim() ? '还没保存。' : '还没有写。'}
              </Text>
            </View>
          </View>
        )}
      </View>
    </View>
  );
}

function formatDiaryDate(date: string) {
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'long',
    day: 'numeric',
    weekday: 'long',
  }).format(new Date(`${date}T00:00:00`));
}

function DiaryEntryCard({ aliveDays, entry }: { aliveDays: number; entry: DiaryEntry }) {
  const [expanded, setExpanded] = useState(false);
  const diaryText = buildDiaryText({
    aliveDays,
    journalText: entry.journalText,
    photoCount: entry.photoUrls.length,
    quoteText: entry.quoteText,
    statusText: entry.statusText,
    todos: entry.todos,
    weatherText: entry.weatherText,
  });

  return (
    <View style={styles.diaryEntry}>
      <Pressable style={styles.diaryEntryHead} onPress={() => setExpanded((current) => !current)}>
        <Text style={styles.diaryEntryDate}>{formatDiaryDate(entry.date)}</Text>
        <Text style={styles.diaryEntryArrow}>{expanded ? '⌃' : '⌄'}</Text>
        <Text style={styles.diaryEntryMeta}>{entry.photoUrls.length} 图 · {entry.todos.filter((todo) => todo.done).length} 件事</Text>
      </Pressable>
      {expanded && (
        <View>
          <Text style={styles.diaryEntryText}>{diaryText}</Text>
          {entry.photoUrls.length > 0 && (
            <View style={styles.diaryPhotoGrid}>
              {entry.photoUrls.map((url, index) => (
                <Image key={`${url}-${index}`} source={{ uri: url }} style={styles.diaryPhotoThumb} />
              ))}
            </View>
          )}
        </View>
      )}
    </View>
  );
}

function MetricCard({ label, value, valueColor }: { label: string; value: string; valueColor?: string }) {
  return (
    <View style={styles.metricCard}>
      <Text style={styles.metricLabel}>{label}</Text>
      <Text style={[styles.metricValue, valueColor ? { color: valueColor } : null]}>{value}</Text>
    </View>
  );
}

function TodoRow({
  large,
  onPress,
  onToggleImportant,
  todo,
}: {
  large?: boolean;
  onPress: () => void;
  onToggleImportant: () => void;
  todo: Todo;
}) {
  return (
    <View style={[styles.todoRow, large && styles.todoRowLarge, todo.important && styles.todoRowImportant]}>
      <Pressable style={styles.todoMain} onPress={onPress}>
        <Text style={[styles.todoCheck, todo.done && styles.todoCheckDone]}>{todo.done ? '✓' : '○'}</Text>
        <Text style={[styles.todoText, todo.done && styles.todoTextDone]}>{todo.text}</Text>
      </Pressable>
      <Pressable style={[styles.todoImportantButton, todo.important && styles.todoImportantButtonActive]} onPress={onToggleImportant}>
        <Text style={[styles.todoImportantText, todo.important && styles.todoImportantTextActive]}>{todo.important ? '大事' : '标记'}</Text>
      </Pressable>
    </View>
  );
}

function SectionHead({ meta, title }: { meta: string; title: string }) {
  return (
    <View style={styles.sectionHead}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <Text style={styles.sectionMeta}>{meta}</Text>
    </View>
  );
}

function ProfileStat({ label, value, valueColor }: { label: string; value: string; valueColor?: string }) {
  return (
    <View style={styles.profileStat}>
      <Text style={[styles.profileStatValue, valueColor ? { color: valueColor } : null]}>{value}</Text>
      <Text style={styles.profileStatLabel}>{label}</Text>
    </View>
  );
}

function TabButton({
  active,
  icon,
  label,
  leftBadgeCount = 0,
  onPress,
  rightBadgeCount = 0,
}: {
  active: boolean;
  icon: TabIconKey;
  label: string;
  leftBadgeCount?: number;
  onPress: () => void;
  rightBadgeCount?: number;
}) {
  return (
    <Pressable style={[styles.tabButton, active && styles.tabButtonActive]} onPress={onPress}>
      <View style={styles.tabIconWrap}>
        <TabGlyph icon={icon} active={active} />
        {leftBadgeCount > 0 && (
          <View style={[styles.tabBadge, styles.tabBadgeLeft]}>
            <Text style={styles.tabBadgeText}>{leftBadgeCount > 9 ? '9+' : leftBadgeCount}</Text>
          </View>
        )}
        {rightBadgeCount > 0 && (
          <View style={[styles.tabBadge, styles.tabBadgeRight]}>
            <Text style={styles.tabBadgeText}>{rightBadgeCount > 9 ? '9+' : rightBadgeCount}</Text>
          </View>
        )}
      </View>
      <Text style={[styles.tabLabel, active && styles.tabTextActive]}>{label}</Text>
    </Pressable>
  );
}

function TabGlyph({ active, icon }: { active: boolean; icon: TabIconKey }) {
  const main = active ? '#10120f' : colors.green;
  const glow = active ? 'rgba(16,18,15,0.18)' : 'rgba(155,226,124,0.34)';
  const shell = active ? 'rgba(16,18,15,0.18)' : '#1b211a';
  const border = active ? 'rgba(16,18,15,0.22)' : 'rgba(155,226,124,0.28)';

  if (icon === 'today') {
    return (
      <View style={[styles.tabGlyphBox, { borderColor: border, backgroundColor: shell }]}>
        <View style={[styles.tabGlyphGlow, { backgroundColor: glow }]} />
        <View style={[styles.tabGlyphSwitchTrack, { backgroundColor: active ? '#10120f' : '#070907' }]}>
          <View style={[styles.tabGlyphSwitchLight, { backgroundColor: active ? colors.green : '#86df63' }]} />
          <Text style={styles.tabGlyphHeart}>♥</Text>
          <View style={styles.tabGlyphSwitchKnob} />
        </View>
      </View>
    );
  }

  if (icon === 'friends') {
    return (
      <View style={[styles.tabGlyphBox, { borderColor: border, backgroundColor: shell }]}>
        <View style={[styles.tabGlyphGlow, { backgroundColor: glow }]} />
        <View style={[styles.tabGlyphFriendOrb, styles.tabGlyphFriendOrbLeft, { backgroundColor: main }]} />
        <View style={[styles.tabGlyphFriendOrb, styles.tabGlyphFriendOrbRight, { borderColor: main }]} />
        <View style={[styles.tabGlyphFriendLink, { backgroundColor: main }]} />
        <View style={styles.tabGlyphPing} />
      </View>
    );
  }

  if (icon === 'todos') {
    return (
      <View style={[styles.tabGlyphBox, { borderColor: border, backgroundColor: shell }]}>
        <View style={[styles.tabGlyphGlow, { backgroundColor: glow }]} />
        {[0, 1, 2].map((item) => (
          <View key={item} style={[styles.tabGlyphTodoPill, { top: 6 + item * 8, opacity: item === 0 ? 1 : item === 1 ? 0.72 : 0.48 }]}>
            <View style={[styles.tabGlyphTodoDot, { backgroundColor: item === 2 ? colors.red : main }]} />
            <View style={[styles.tabGlyphTodoLine, { backgroundColor: main }]} />
          </View>
        ))}
      </View>
    );
  }

  return (
    <View style={[styles.tabGlyphBox, { borderColor: border, backgroundColor: shell }]}>
      <View style={[styles.tabGlyphGlow, { backgroundColor: glow }]} />
      <View style={[styles.tabGlyphProfileHalo, { borderColor: main }]} />
      <View style={[styles.tabGlyphProfileHead, { backgroundColor: main }]} />
      <View style={[styles.tabGlyphProfileBody, { borderColor: main }]} />
      <Text style={styles.tabGlyphProfileHeart}>♥</Text>
    </View>
  );
}

const colors = {
  bg: '#151515',
  panel: '#20201f',
  panel2: '#292825',
  line: 'rgba(255,255,255,0.08)',
  text: '#f4f1e8',
  muted: '#aaa69b',
  soft: '#756f63',
  green: '#9be27c',
  red: '#ff1f3d',
  yellow: '#ffd166',
  blue: '#84c5f4',
};

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  app: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  appToast: {
    alignItems: 'center',
    backgroundColor: 'rgba(18, 20, 17, 0.96)',
    borderColor: 'rgba(155,226,124,0.28)',
    borderRadius: 18,
    borderWidth: 1,
    bottom: 88,
    left: 22,
    paddingHorizontal: 16,
    paddingVertical: 12,
    position: 'absolute',
    right: 22,
  },
  appToastText: {
    color: colors.green,
    fontSize: 14,
    fontWeight: '800',
  },
  launch: {
    flex: 1,
    justifyContent: 'center',
    padding: 22,
  },
  launchKeyboard: {
    flex: 1,
  },
  authLaunch: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: 22,
    paddingBottom: 120,
  },
  launchCard: {
    backgroundColor: colors.panel,
    borderColor: colors.line,
    borderRadius: 32,
    borderWidth: 1,
    padding: 24,
  },
  launchKicker: {
    color: colors.green,
    fontSize: 13,
    marginBottom: 10,
  },
  launchTitle: {
    color: colors.text,
    fontSize: 38,
    fontWeight: '900',
    marginBottom: 12,
  },
  launchCopy: {
    color: colors.muted,
    fontSize: 15,
    lineHeight: 24,
    marginBottom: 20,
  },
  authInput: {
    backgroundColor: colors.panel2,
    borderColor: colors.line,
    borderRadius: 16,
    borderWidth: 1,
    color: colors.text,
    fontSize: 16,
    height: 52,
    marginBottom: 12,
    paddingHorizontal: 14,
  },
  authHint: {
    color: colors.muted,
    fontSize: 13,
    lineHeight: 20,
    marginBottom: 10,
    marginTop: 12,
  },
  secondaryButton: {
    alignItems: 'center',
    borderColor: colors.line,
    borderRadius: 18,
    borderWidth: 1,
    height: 52,
    justifyContent: 'center',
    marginTop: 10,
  },
  secondaryButtonText: {
    color: colors.muted,
    fontSize: 15,
    fontWeight: '700',
  },
  devAccountPanel: {
    backgroundColor: 'rgba(132,197,244,0.08)',
    borderColor: 'rgba(132,197,244,0.2)',
    borderRadius: 18,
    borderWidth: 1,
    gap: 10,
    marginTop: 10,
    padding: 12,
  },
  devAccountHint: {
    color: colors.muted,
    fontSize: 12,
    lineHeight: 18,
  },
  devAccountRow: {
    flexDirection: 'row',
    gap: 10,
  },
  devAccountButton: {
    alignItems: 'center',
    backgroundColor: 'rgba(132,197,244,0.1)',
    borderColor: 'rgba(132,197,244,0.24)',
    borderRadius: 14,
    borderWidth: 1,
    flex: 1,
    minHeight: 44,
    justifyContent: 'center',
  },
  devButtonText: {
    color: colors.blue,
    fontSize: 15,
    fontWeight: '800',
  },
  topbar: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 22,
    paddingTop: 16,
    paddingBottom: 14,
  },
  date: {
    color: colors.green,
    fontSize: 12,
    marginBottom: 5,
  },
  logo: {
    color: colors.text,
    fontSize: 30,
    fontWeight: '800',
  },
  iconButton: {
    alignItems: 'center',
    backgroundColor: colors.panel,
    borderColor: colors.line,
    borderRadius: 16,
    borderWidth: 1,
    height: 42,
    justifyContent: 'center',
    width: 42,
  },
  iconText: {
    color: colors.green,
    fontSize: 17,
    fontWeight: '800',
  },
  content: {
    flex: 1,
  },
  contentInner: {
    paddingHorizontal: 18,
    paddingBottom: 18,
  },
  stack: {
    gap: 14,
  },
  heroCard: {
    backgroundColor: '#22211e',
    borderColor: 'rgba(255,255,255,0.1)',
    borderRadius: 32,
    borderWidth: 1,
    minHeight: 300,
    overflow: 'visible',
    padding: 24,
  },
  heroCardChecked: {
    backgroundColor: '#1c2d24',
  },
  heroTopRow: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: 10,
    justifyContent: 'space-between',
    marginBottom: 38,
  },
  pulseMark: {
    alignItems: 'center',
    backgroundColor: 'rgba(155,226,124,0.13)',
    borderRadius: 28,
    height: 84,
    justifyContent: 'center',
    width: 84,
  },
  pulseIcon: {
    color: colors.red,
    fontSize: 42,
    fontWeight: '800',
  },
  lifeSignal: {
    alignItems: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.16)',
    borderColor: 'rgba(155,226,124,0.18)',
    borderRadius: 18,
    borderWidth: 1,
    height: 84,
    justifyContent: 'center',
    paddingHorizontal: 12,
    paddingVertical: 9,
    width: 150,
  },
  archiveHead: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    width: '100%',
  },
  weatherCurrentRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 3,
  },
  lifeSignalLabel: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: '800',
  },
  lifeSignalValue: {
    color: colors.green,
    fontSize: 20,
    fontWeight: '900',
    marginTop: 3,
  },
  weatherButtonText: {
    fontSize: 27,
    fontWeight: '900',
  },
  weatherArrow: {
    color: colors.green,
    fontSize: 14,
    fontWeight: '900',
  },
  weatherInlineDrawer: {
    alignItems: 'flex-end',
    alignSelf: 'flex-start',
    minHeight: 84,
    position: 'relative',
    width: 150,
  },
  weatherInlineDrawerOpen: {
    zIndex: 5,
  },
  weatherInlineChoices: {
    gap: 4,
    position: 'absolute',
    right: 10,
    top: 66,
    width: 54,
    zIndex: 10,
  },
  weatherInlineChoice: {
    alignItems: 'center',
    backgroundColor: colors.panel2,
    borderColor: colors.line,
    borderRadius: 11,
    borderWidth: 1,
    height: 34,
    justifyContent: 'center',
    width: 54,
  },
  weatherInlineChoiceText: {
    fontSize: 19,
  },
  heroMoodBlock: {
    borderBottomColor: colors.line,
    borderBottomWidth: 1,
    marginBottom: 16,
    marginTop: -12,
    paddingBottom: 16,
  },
  heroMoodTitle: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '900',
    marginBottom: 10,
  },
  archiveDots: {
    flexDirection: 'row',
    gap: 4,
    marginTop: 9,
  },
  archiveDot: {
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderColor: colors.line,
    borderRadius: 999,
    borderWidth: 1,
    height: 19,
    justifyContent: 'center',
    width: 19,
  },
  archiveDotDone: {
    backgroundColor: colors.green,
    borderColor: colors.green,
  },
  archiveDotText: {
    color: colors.soft,
    fontSize: 9,
    fontWeight: '900',
  },
  archiveDotTextDone: {
    color: colors.bg,
  },
  heroKicker: {
    color: colors.green,
    fontSize: 13,
    marginBottom: 8,
  },
  heroTitle: {
    color: colors.text,
    fontSize: 34,
    fontWeight: '800',
    lineHeight: 40,
    marginBottom: 10,
  },
  heroCopy: {
    color: colors.muted,
    fontSize: 14,
    lineHeight: 22,
    marginBottom: 18,
  },
  primaryButton: {
    alignItems: 'center',
    backgroundColor: colors.green,
    borderRadius: 18,
    height: 52,
    justifyContent: 'center',
  },
  primaryButtonText: {
    color: '#10120f',
    fontSize: 16,
    fontWeight: '800',
  },
  metricsGrid: {
    flexDirection: 'row',
    gap: 10,
  },
  metricCard: {
    backgroundColor: colors.panel,
    borderColor: colors.line,
    borderRadius: 20,
    borderWidth: 1,
    flex: 1,
    padding: 14,
  },
  metricValue: {
    color: colors.text,
    fontSize: 22,
    fontWeight: '800',
    marginTop: 8,
  },
  metricLabel: {
    color: colors.muted,
    fontSize: 13,
  },
  panel: {
    backgroundColor: colors.panel,
    borderColor: colors.line,
    borderRadius: 24,
    borderWidth: 1,
    padding: 16,
  },
  sectionHead: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  sectionTitle: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '800',
  },
  sectionMeta: {
    color: colors.muted,
    fontSize: 13,
  },
  noteList: {
    gap: 8,
  },
  noteChip: {
    backgroundColor: colors.panel2,
    borderColor: colors.line,
    borderRadius: 16,
    borderWidth: 1,
    padding: 12,
  },
  noteChipActive: {
    backgroundColor: colors.green,
    borderColor: colors.green,
  },
  noteText: {
    color: colors.muted,
    fontSize: 13,
  },
  noteTextActive: {
    color: '#10120f',
    fontWeight: '700',
  },
  fieldLabel: {
    color: colors.green,
    fontSize: 13,
    fontWeight: '800',
    marginTop: 14,
    marginBottom: 8,
  },
  journalInput: {
    backgroundColor: colors.panel2,
    borderColor: colors.line,
    borderRadius: 16,
    borderWidth: 1,
    color: colors.text,
    fontSize: 14,
    lineHeight: 20,
    minHeight: 92,
    paddingHorizontal: 13,
    paddingVertical: 12,
  },
  journalHint: {
    color: colors.soft,
    fontSize: 12,
    lineHeight: 18,
    marginTop: 8,
  },
  photoActionRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 10,
    marginTop: 12,
  },
  journalSaveButton: {
    alignItems: 'center',
    backgroundColor: colors.green,
    borderRadius: 14,
    minHeight: 40,
    paddingHorizontal: 16,
    justifyContent: 'center',
  },
  journalSaveButtonSaved: {
    backgroundColor: colors.yellow,
  },
  journalSaveButtonText: {
    color: '#10120f',
    fontSize: 13,
    fontWeight: '900',
  },
  photoAddButton: {
    alignItems: 'center',
    backgroundColor: 'rgba(155,226,124,0.12)',
    borderColor: 'rgba(155,226,124,0.32)',
    borderRadius: 14,
    borderWidth: 1,
    minHeight: 40,
    paddingHorizontal: 14,
    justifyContent: 'center',
  },
  photoAddButtonText: {
    color: colors.green,
    fontSize: 13,
    fontWeight: '900',
  },
  photoLimitText: {
    color: colors.soft,
    fontSize: 12,
    fontWeight: '800',
  },
  photoGrid: {
    flexDirection: 'row',
    gap: 9,
    marginTop: 10,
  },
  photoThumbWrap: {
    aspectRatio: 1,
    borderColor: colors.line,
    borderRadius: 16,
    borderWidth: 1,
    flex: 1,
    maxWidth: 96,
    overflow: 'hidden',
    position: 'relative',
  },
  photoThumb: {
    height: '100%',
    width: '100%',
  },
  photoRemoveButton: {
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.62)',
    borderRadius: 999,
    height: 24,
    justifyContent: 'center',
    position: 'absolute',
    right: 6,
    top: 6,
    width: 24,
  },
  photoRemoveText: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '900',
    lineHeight: 18,
  },
  diaryButton: {
    alignItems: 'center',
    borderColor: 'rgba(255,255,255,0.1)',
    borderRadius: 14,
    borderWidth: 1,
    marginTop: 12,
    minHeight: 40,
    justifyContent: 'center',
  },
  diaryButtonText: {
    color: colors.green,
    fontSize: 13,
    fontWeight: '800',
  },
  todoRow: {
    alignItems: 'center',
    backgroundColor: colors.panel2,
    borderColor: colors.line,
    borderRadius: 16,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 10,
    minHeight: 46,
    paddingHorizontal: 12,
    marginTop: 8,
  },
  todoRowImportant: {
    backgroundColor: '#2d281d',
    borderColor: 'rgba(255,209,102,0.28)',
  },
  todoRowLarge: {
    minHeight: 62,
    paddingHorizontal: 16,
  },
  todoMain: {
    alignItems: 'center',
    flex: 1,
    flexDirection: 'row',
    gap: 10,
    minHeight: 46,
  },
  todoCheck: {
    color: colors.soft,
    fontSize: 18,
    width: 24,
  },
  todoCheckDone: {
    color: colors.green,
  },
  todoText: {
    color: colors.text,
    flex: 1,
    fontSize: 15,
  },
  todoTextDone: {
    color: colors.muted,
    textDecorationLine: 'line-through',
  },
  todoImportantButton: {
    borderColor: colors.line,
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 9,
    paddingVertical: 6,
  },
  todoImportantButtonActive: {
    backgroundColor: colors.yellow,
    borderColor: colors.yellow,
  },
  todoImportantText: {
    color: colors.muted,
    fontSize: 11,
    fontWeight: '800',
  },
  todoImportantTextActive: {
    color: '#10120f',
  },
  searchPanel: {
    alignItems: 'center',
    backgroundColor: colors.panel,
    borderColor: colors.line,
    borderRadius: 24,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 10,
    padding: 16,
  },
  searchText: {
    color: colors.muted,
    flex: 1,
    fontSize: 14,
  },
  friendInput: {
    color: colors.text,
    flex: 1,
    fontSize: 15,
    minHeight: 38,
  },
  smallButton: {
    backgroundColor: colors.green,
    borderRadius: 14,
    paddingHorizontal: 13,
    paddingVertical: 9,
  },
  smallButtonText: {
    color: '#10120f',
    fontWeight: '800',
  },
  summaryCard: {
    alignItems: 'flex-end',
    backgroundColor: '#202630',
    borderColor: 'rgba(255,255,255,0.1)',
    borderRadius: 28,
    borderWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    minHeight: 130,
    padding: 20,
  },
  mutedText: {
    color: colors.muted,
    fontSize: 13,
  },
  summaryNumber: {
    color: colors.text,
    fontSize: 38,
    fontWeight: '900',
    marginTop: 4,
  },
  summarySide: {
    alignItems: 'flex-end',
    gap: 6,
  },
  summaryPending: {
    color: colors.green,
    fontSize: 13,
    fontWeight: '800',
  },
  friendSection: {
    gap: 10,
  },
  friendCard: {
    alignItems: 'center',
    backgroundColor: colors.panel,
    borderColor: colors.line,
    borderRadius: 22,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 12,
    padding: 13,
  },
  friendSwipeWrap: {
    overflow: 'hidden',
    position: 'relative',
  },
  friendCardOpen: {
    borderColor: 'rgba(255,107,107,0.24)',
  },
  friendDeleteReveal: {
    bottom: 0,
    justifyContent: 'center',
    position: 'absolute',
    right: 0,
    top: 0,
    width: 74,
  },
  avatar: {
    alignItems: 'center',
    borderRadius: 18,
    height: 48,
    justifyContent: 'center',
    width: 48,
  },
  avatarText: {
    color: '#141414',
    fontSize: 18,
    fontWeight: '900',
  },
  friendBody: {
    flex: 1,
  },
  friendTop: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 8,
  },
  friendName: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '800',
  },
  friendPhone: {
    color: colors.soft,
    fontSize: 11,
    marginTop: 3,
  },
  friendMood: {
    color: colors.muted,
    fontSize: 13,
    marginVertical: 6,
  },
  friendMeta: {
    color: colors.soft,
    fontSize: 11,
  },
  pokeButton: {
    alignItems: 'center',
    borderColor: colors.line,
    borderRadius: 999,
    borderWidth: 1,
    flexShrink: 0,
    minWidth: 78,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  pokeButtonDone: {
    backgroundColor: 'rgba(155,226,124,0.12)',
    borderColor: 'rgba(155,226,124,0.24)',
  },
  pokeButtonText: {
    color: colors.green,
    fontSize: 12,
    fontWeight: '800',
  },
  pokeButtonTextDone: {
    color: colors.muted,
  },
  friendActions: {
    alignItems: 'stretch',
    gap: 8,
  },
  deleteFriendButton: {
    alignItems: 'center',
    backgroundColor: 'rgba(255,31,61,0.18)',
    borderColor: 'rgba(255,31,61,0.36)',
    borderRadius: 16,
    borderWidth: 1,
    minHeight: 48,
    justifyContent: 'center',
    width: 66,
  },
  deleteFriendText: {
    color: '#ff8b8b',
    fontSize: 12,
    fontWeight: '800',
  },
  badge: {
    borderRadius: 99,
    fontSize: 11,
    overflow: 'hidden',
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  badgeAlive: {
    backgroundColor: 'rgba(155,226,124,0.12)',
    color: colors.green,
  },
  badgePending: {
    backgroundColor: 'rgba(255,209,102,0.12)',
    color: colors.yellow,
  },
  badgeQuiet: {
    backgroundColor: 'rgba(255,255,255,0.07)',
    color: colors.muted,
  },
  requestRow: {
    alignItems: 'center',
    backgroundColor: colors.panel2,
    borderColor: colors.line,
    borderRadius: 16,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 10,
    marginTop: 8,
    minHeight: 56,
    paddingHorizontal: 10,
  },
  requestAvatar: {
    borderRadius: 14,
    height: 38,
    width: 38,
  },
  requestName: {
    color: colors.text,
    flex: 1,
    fontSize: 15,
    fontWeight: '800',
  },
  requestStatus: {
    color: colors.muted,
    fontSize: 12,
  },
  requestNotice: {
    backgroundColor: 'rgba(255,209,102,0.12)',
    borderColor: 'rgba(255,209,102,0.3)',
    borderRadius: 18,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  requestNoticeText: {
    color: colors.yellow,
    fontSize: 13,
    fontWeight: '900',
  },
  pokeNoticeRow: {
    alignItems: 'center',
    backgroundColor: colors.panel2,
    borderColor: 'rgba(155,226,124,0.18)',
    borderRadius: 16,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 10,
    marginTop: 8,
    minHeight: 62,
    paddingHorizontal: 10,
  },
  pokeNoticeBody: {
    flex: 1,
  },
  pokeNoticeMeta: {
    color: colors.muted,
    fontSize: 12,
    marginTop: 3,
  },
  tinyButton: {
    backgroundColor: colors.green,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  tinyButtonText: {
    color: '#10120f',
    fontSize: 12,
    fontWeight: '900',
  },
  tinyButtonGhost: {
    borderColor: 'rgba(155,226,124,0.42)',
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  tinyButtonGhostText: {
    color: colors.green,
    fontSize: 12,
    fontWeight: '900',
  },
  emptyPanel: {
    backgroundColor: colors.panel,
    borderColor: colors.line,
    borderRadius: 22,
    borderWidth: 1,
    padding: 16,
  },
  emptyText: {
    color: colors.muted,
    fontSize: 14,
    lineHeight: 21,
  },
  addRow: {
    flexDirection: 'row',
    gap: 10,
  },
  importantToggle: {
    alignSelf: 'flex-start',
    borderColor: colors.line,
    borderRadius: 999,
    borderWidth: 1,
    marginTop: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  importantToggleActive: {
    backgroundColor: colors.yellow,
    borderColor: colors.yellow,
  },
  importantToggleText: {
    color: colors.muted,
    fontSize: 13,
    fontWeight: '800',
  },
  importantToggleTextActive: {
    color: '#10120f',
  },
  input: {
    backgroundColor: colors.panel2,
    borderColor: colors.line,
    borderRadius: 16,
    borderWidth: 1,
    color: colors.text,
    flex: 1,
    height: 46,
    paddingHorizontal: 14,
  },
  addButton: {
    alignItems: 'center',
    backgroundColor: colors.green,
    borderRadius: 16,
    height: 46,
    justifyContent: 'center',
    minWidth: 48,
    paddingHorizontal: 12,
  },
  addButtonSaved: {
    backgroundColor: colors.yellow,
  },
  disabledButton: {
    opacity: 0.45,
  },
  addButtonText: {
    color: '#10120f',
    fontWeight: '900',
  },
  quoteCardInput: {
    backgroundColor: colors.panel2,
    borderColor: 'rgba(155,226,124,0.18)',
    borderRadius: 18,
    borderWidth: 1,
    color: colors.text,
    fontSize: 17,
    fontWeight: '800',
    lineHeight: 27,
    minHeight: 104,
    paddingHorizontal: 16,
    paddingVertical: 16,
  },
  quoteActionRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 12,
  },
  quoteActionButton: {
    alignItems: 'center',
    backgroundColor: colors.green,
    borderRadius: 16,
    height: 46,
    justifyContent: 'center',
    minWidth: 116,
    paddingHorizontal: 18,
  },
  quoteActionButtonText: {
    color: '#10120f',
    fontSize: 14,
    fontWeight: '900',
  },
  quoteShuffleButton: {
    backgroundColor: colors.panel2,
    borderColor: colors.line,
    borderWidth: 1,
    flex: 1,
    minWidth: 0,
  },
  shuffleButton: {
    alignItems: 'center',
    backgroundColor: colors.panel2,
    borderColor: colors.line,
    borderRadius: 16,
    borderWidth: 1,
    height: 46,
    justifyContent: 'center',
    width: 72,
  },
  shuffleButtonText: {
    color: colors.green,
    fontSize: 13,
    fontWeight: '900',
  },
  softNote: {
    backgroundColor: colors.panel,
    borderColor: colors.line,
    borderRadius: 24,
    borderWidth: 1,
    padding: 16,
  },
  softNoteText: {
    color: colors.muted,
    fontSize: 14,
    lineHeight: 21,
  },
  profileCard: {
    alignItems: 'center',
    backgroundColor: '#29261f',
    borderColor: colors.line,
    borderRadius: 32,
    borderWidth: 1,
    padding: 24,
  },
  profileAvatar: {
    alignItems: 'center',
    backgroundColor: colors.yellow,
    borderRadius: 18,
    height: 54,
    justifyContent: 'center',
    marginBottom: 14,
    width: 54,
  },
  profileName: {
    color: colors.text,
    fontSize: 24,
    fontWeight: '900',
    marginBottom: 6,
  },
  profilePhone: {
    color: colors.soft,
    fontSize: 12,
    marginBottom: 8,
  },
  profileStats: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 22,
    width: '100%',
  },
  profileStat: {
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderColor: colors.line,
    borderRadius: 18,
    borderWidth: 1,
    flex: 1,
    paddingVertical: 11,
  },
  profileStatValue: {
    color: colors.text,
    fontSize: 20,
    fontWeight: '900',
  },
  profileStatLabel: {
    color: colors.muted,
    fontSize: 12,
    marginTop: 3,
  },
  heatmap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  calendarPanel: {
    backgroundColor: colors.panel,
    borderColor: colors.line,
    borderRadius: 24,
    borderWidth: 1,
    gap: 10,
    padding: 16,
  },
  weekRow: {
    flexDirection: 'row',
    gap: 6,
  },
  weekText: {
    color: colors.soft,
    flex: 1,
    fontSize: 12,
    fontWeight: '800',
    textAlign: 'center',
  },
  monthCalendar: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  calendarCell: {
    alignItems: 'center',
    aspectRatio: 1,
    backgroundColor: colors.panel2,
    borderColor: colors.line,
    borderRadius: 12,
    borderWidth: 1,
    justifyContent: 'center',
    position: 'relative',
    width: '12.5%',
  },
  calendarCellActive: {
    backgroundColor: 'rgba(155,226,124,0.16)',
    borderColor: 'rgba(155,226,124,0.34)',
  },
  calendarCellToday: {
    borderColor: colors.green,
    borderWidth: 2,
  },
  calendarCellSelected: {
    backgroundColor: colors.green,
    borderColor: colors.green,
  },
  calendarCellText: {
    color: colors.muted,
    fontSize: 13,
    fontWeight: '800',
  },
  calendarCellTextActive: {
    color: colors.text,
  },
  calendarDot: {
    backgroundColor: colors.green,
    borderRadius: 999,
    bottom: 5,
    height: 4,
    position: 'absolute',
    width: 4,
  },
  calendarDivider: {
    backgroundColor: colors.line,
    height: 1,
    marginVertical: 4,
  },
  heatCell: {
    aspectRatio: 1,
    backgroundColor: colors.panel2,
    borderColor: colors.line,
    borderRadius: 8,
    borderWidth: 1,
    width: '11.9%',
  },
  heatCellActive: {
    backgroundColor: 'rgba(155,226,124,0.35)',
    borderColor: 'rgba(155,226,124,0.45)',
  },
  heatCellToday: {
    borderColor: colors.green,
    borderWidth: 2,
  },
  settingsList: {
    gap: 10,
  },
  diaryListPanel: {
    backgroundColor: colors.panel,
    borderColor: colors.line,
    borderRadius: 22,
    borderWidth: 1,
    gap: 10,
    padding: 16,
  },
  diaryEntry: {
    backgroundColor: colors.panel2,
    borderColor: colors.line,
    borderRadius: 18,
    borderWidth: 1,
    padding: 14,
  },
  diaryEntryHead: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 10,
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  diaryEntryDate: {
    color: colors.green,
    flex: 1,
    fontSize: 13,
    fontWeight: '900',
  },
  diaryEntryMeta: {
    color: colors.soft,
    fontSize: 11,
    fontWeight: '800',
  },
  diaryEntryArrow: {
    color: colors.green,
    fontSize: 16,
    fontWeight: '900',
  },
  diaryEntryText: {
    color: colors.text,
    fontSize: 13,
    lineHeight: 20,
  },
  diaryPhotoGrid: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 12,
  },
  diaryPhotoThumb: {
    aspectRatio: 1,
    borderRadius: 14,
    flex: 1,
    maxWidth: 88,
  },
  diaryEmptyEntry: {
    borderColor: colors.line,
    borderRadius: 16,
    borderWidth: 1,
    marginTop: 10,
    padding: 12,
  },
  diaryEmptyText: {
    color: colors.muted,
    fontSize: 13,
    lineHeight: 20,
  },
  settingItem: {
    alignItems: 'center',
    backgroundColor: colors.panel,
    borderColor: colors.line,
    borderRadius: 18,
    borderWidth: 1,
    flexDirection: 'row',
    justifyContent: 'center',
    minHeight: 54,
    paddingHorizontal: 16,
  },
  settingText: {
    color: colors.text,
    flex: 1,
    fontSize: 15,
  },
  settingArrow: {
    color: colors.green,
    fontSize: 18,
    fontWeight: '900',
  },
  dangerItem: {
    borderColor: 'rgba(255,107,107,0.25)',
  },
  dangerText: {
    color: '#ff8b8b',
    fontSize: 15,
    fontWeight: '800',
  },
  accountDeleteItem: {
    borderColor: 'rgba(255,31,61,0.32)',
    justifyContent: 'space-between',
    minHeight: 68,
  },
  accountDeleteText: {
    color: '#ff6b78',
    fontSize: 15,
    fontWeight: '900',
  },
  accountDeleteMeta: {
    color: colors.muted,
    fontSize: 12,
    marginTop: 4,
  },
  settingPanel: {
    backgroundColor: colors.panel,
    borderColor: colors.line,
    borderRadius: 18,
    borderWidth: 1,
    gap: 12,
    padding: 14,
  },
  settingHelp: {
    color: colors.muted,
    flex: 1,
    fontSize: 13,
    lineHeight: 20,
  },
  willInput: {
    backgroundColor: colors.panel2,
    borderColor: colors.line,
    borderRadius: 16,
    borderWidth: 1,
    color: colors.text,
    fontSize: 14,
    lineHeight: 20,
    minHeight: 140,
    paddingHorizontal: 13,
    paddingVertical: 12,
  },
  savedHint: {
    color: colors.soft,
    fontSize: 12,
  },
  timeChipRow: {
    flexDirection: 'row',
    gap: 8,
  },
  timeChip: {
    alignItems: 'center',
    backgroundColor: colors.panel2,
    borderColor: colors.line,
    borderRadius: 999,
    borderWidth: 1,
    flex: 1,
    minHeight: 38,
    justifyContent: 'center',
  },
  timeChipActive: {
    backgroundColor: colors.green,
    borderColor: colors.green,
  },
  timeChipText: {
    color: colors.muted,
    fontSize: 13,
    fontWeight: '800',
  },
  timeChipTextActive: {
    color: colors.bg,
  },
  willEntry: {
    alignItems: 'center',
    backgroundColor: 'rgba(255,31,61,0.13)',
    borderColor: 'rgba(255,31,61,0.42)',
    borderRadius: 20,
    borderWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    minHeight: 72,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  willEntryTitle: {
    color: colors.red,
    fontSize: 17,
    fontWeight: '900',
  },
  willEntryMeta: {
    color: colors.muted,
    fontSize: 12,
    marginTop: 4,
  },
  willEntryArrow: {
    color: colors.red,
    fontSize: 14,
    fontWeight: '900',
  },
  willPanel: {
    backgroundColor: colors.panel,
    borderColor: 'rgba(255,31,61,0.32)',
    borderRadius: 18,
    borderWidth: 1,
    gap: 12,
    padding: 14,
  },
  willActionRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12,
  },
  willSaveButton: {
    alignItems: 'center',
    backgroundColor: 'rgba(255,31,61,0.2)',
    borderColor: 'rgba(255,31,61,0.48)',
    borderRadius: 14,
    borderWidth: 1,
    height: 42,
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  willSaveButtonText: {
    color: colors.red,
    fontSize: 14,
    fontWeight: '900',
  },
  toggleRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 14,
    justifyContent: 'space-between',
  },
  toggleTextGroup: {
    flex: 1,
    gap: 4,
  },
  toggleTitle: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '800',
  },
  switchTrack: {
    backgroundColor: colors.panel2,
    borderColor: colors.line,
    borderRadius: 999,
    borderWidth: 1,
    height: 32,
    justifyContent: 'center',
    paddingHorizontal: 3,
    width: 54,
  },
  switchTrackActive: {
    backgroundColor: colors.green,
    borderColor: colors.green,
  },
  switchThumb: {
    backgroundColor: colors.muted,
    borderRadius: 999,
    height: 24,
    width: 24,
  },
  switchThumbActive: {
    alignSelf: 'flex-end',
    backgroundColor: '#10120f',
  },
  linkText: {
    color: colors.green,
    fontSize: 13,
    fontWeight: '800',
  },
  modalBackdrop: {
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.62)',
    flex: 1,
    justifyContent: 'center',
    padding: 22,
  },
  drawerBackdrop: {
    backgroundColor: 'rgba(0,0,0,0.58)',
    flex: 1,
    justifyContent: 'flex-end',
    paddingHorizontal: 14,
    paddingBottom: 18,
  },
  quickRecordPanel: {
    backgroundColor: colors.panel,
    borderColor: colors.line,
    borderRadius: 24,
    borderWidth: 1,
    padding: 16,
    width: '100%',
  },
  quickRecordInput: {
    backgroundColor: colors.panel2,
    borderColor: colors.line,
    borderRadius: 16,
    borderWidth: 1,
    color: colors.text,
    fontSize: 15,
    lineHeight: 21,
    minHeight: 120,
    paddingHorizontal: 13,
    paddingVertical: 12,
  },
  quickRecordActions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 12,
  },
  quickRecordCancel: {
    alignItems: 'center',
    borderColor: colors.line,
    borderRadius: 16,
    borderWidth: 1,
    flex: 1,
    height: 46,
    justifyContent: 'center',
  },
  quickRecordCancelText: {
    color: colors.muted,
    fontSize: 14,
    fontWeight: '800',
  },
  quickRecordSave: {
    alignItems: 'center',
    backgroundColor: colors.green,
    borderRadius: 16,
    flex: 1,
    height: 46,
    justifyContent: 'center',
  },
  quickRecordSaveText: {
    color: colors.bg,
    fontSize: 14,
    fontWeight: '900',
  },
  todayDiaryPanel: {
    backgroundColor: colors.panel,
    borderColor: colors.line,
    borderRadius: 24,
    borderWidth: 1,
    maxHeight: '78%',
    padding: 16,
    width: '100%',
  },
  todayDiaryScroll: {
    backgroundColor: colors.panel2,
    borderColor: colors.line,
    borderRadius: 16,
    borderWidth: 1,
    marginTop: 2,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  todayDiaryText: {
    color: colors.text,
    fontSize: 14,
    lineHeight: 23,
    textAlign: 'left',
  },
  todayDiaryClose: {
    alignItems: 'center',
    backgroundColor: colors.green,
    borderRadius: 16,
    height: 46,
    justifyContent: 'center',
    marginTop: 12,
  },
  weatherPickerPanel: {
    backgroundColor: colors.panel,
    borderColor: colors.line,
    borderRadius: 24,
    borderWidth: 1,
    padding: 14,
    width: '100%',
  },
  weatherChoiceGrid: {
    flexDirection: 'row',
    gap: 7,
  },
  weatherChoice: {
    alignItems: 'center',
    backgroundColor: colors.panel2,
    borderColor: colors.line,
    borderRadius: 14,
    borderWidth: 1,
    flex: 1,
    minHeight: 58,
    justifyContent: 'center',
  },
  weatherChoiceActive: {
    backgroundColor: colors.green,
    borderColor: colors.green,
  },
  weatherChoiceIcon: {
    fontSize: 22,
    marginBottom: 3,
  },
  weatherChoiceText: {
    color: colors.muted,
    fontSize: 10,
    fontWeight: '900',
  },
  weatherChoiceTextActive: {
    color: colors.bg,
  },
  weatherPickerCancel: {
    alignItems: 'center',
    borderColor: colors.line,
    borderRadius: 16,
    borderWidth: 1,
    height: 38,
    justifyContent: 'center',
    marginTop: 10,
  },
  tabbar: {
    backgroundColor: colors.bg,
    borderTopColor: colors.line,
    borderTopWidth: 1,
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 14,
    paddingTop: 12,
    paddingBottom: Platform.OS === 'android' ? 28 : 16,
  },
  tabButton: {
    alignItems: 'center',
    borderRadius: 18,
    flex: 1,
    gap: 4,
    height: 54,
    justifyContent: 'center',
  },
  tabButtonActive: {
    backgroundColor: colors.green,
  },
  tabIcon: {
    color: colors.muted,
    fontSize: 18,
    fontWeight: '800',
  },
  tabIconWrap: {
    position: 'relative',
  },
  tabGlyphBox: {
    borderRadius: 12,
    borderWidth: 1,
    elevation: 4,
    height: 30,
    overflow: 'hidden',
    position: 'relative',
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 7,
    shadowOffset: { width: 0, height: 4 },
    width: 30,
  },
  tabGlyphGlow: {
    borderRadius: 999,
    height: 24,
    left: 3,
    opacity: 0.7,
    position: 'absolute',
    top: 3,
    width: 24,
  },
  tabGlyphSwitchTrack: {
    borderColor: 'rgba(255,255,255,0.08)',
    borderRadius: 999,
    borderWidth: 1,
    height: 13,
    left: 5,
    overflow: 'hidden',
    position: 'absolute',
    top: 9,
    width: 20,
  },
  tabGlyphSwitchLight: {
    borderRadius: 999,
    height: 11,
    left: 1,
    opacity: 0.95,
    position: 'absolute',
    top: 0,
    width: 14,
  },
  tabGlyphSwitchKnob: {
    backgroundColor: '#0b0d0b',
    borderColor: 'rgba(255,255,255,0.18)',
    borderRadius: 999,
    borderWidth: 1,
    height: 13,
    position: 'absolute',
    right: -1,
    top: -1,
    width: 13,
  },
  tabGlyphHeart: {
    color: colors.red,
    fontSize: 8,
    fontWeight: '900',
    left: 4,
    lineHeight: 10,
    position: 'absolute',
    top: 1,
    zIndex: 2,
  },
  tabGlyphFriendOrb: {
    alignItems: 'center',
    borderRadius: 999,
    borderWidth: 2,
    height: 12,
    position: 'absolute',
    top: 10,
    width: 12,
  },
  tabGlyphFriendOrbLeft: {
    left: 7,
  },
  tabGlyphFriendOrbRight: {
    right: 7,
  },
  tabGlyphFriendLink: {
    borderRadius: 999,
    height: 3,
    left: 13,
    opacity: 0.62,
    position: 'absolute',
    top: 15,
    width: 7,
  },
  tabGlyphPing: {
    backgroundColor: colors.red,
    borderRadius: 999,
    height: 7,
    left: 13,
    position: 'absolute',
    top: 6,
    width: 7,
  },
  tabGlyphTodoPill: {
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.22)',
    borderRadius: 999,
    flexDirection: 'row',
    gap: 3,
    height: 6,
    left: 7,
    paddingHorizontal: 2,
    position: 'absolute',
    width: 17,
  },
  tabGlyphTodoDot: {
    borderRadius: 999,
    height: 3,
    width: 3,
  },
  tabGlyphTodoLine: {
    borderRadius: 999,
    height: 3,
    width: 8,
  },
  tabGlyphProfileHalo: {
    borderRadius: 999,
    borderWidth: 1,
    height: 19,
    left: 5,
    opacity: 0.32,
    position: 'absolute',
    top: 6,
    width: 19,
  },
  tabGlyphProfileHead: {
    borderRadius: 999,
    height: 8,
    left: 11,
    position: 'absolute',
    top: 8,
    width: 8,
  },
  tabGlyphProfileBody: {
    borderRadius: 999,
    borderTopWidth: 3,
    height: 13,
    left: 9,
    position: 'absolute',
    top: 18,
    width: 12,
  },
  tabGlyphProfileHeart: {
    color: colors.red,
    fontSize: 8,
    fontWeight: '900',
    left: 13,
    lineHeight: 10,
    position: 'absolute',
    top: 9,
  },
  tabBadge: {
    alignItems: 'center',
    backgroundColor: colors.red,
    borderRadius: 999,
    minWidth: 18,
    height: 18,
    justifyContent: 'center',
    paddingHorizontal: 4,
    position: 'absolute',
    top: -8,
  },
  tabBadgeLeft: {
    backgroundColor: colors.yellow,
    left: -14,
  },
  tabBadgeRight: {
    right: -14,
  },
  tabBadgeText: {
    color: colors.text,
    fontSize: 10,
    fontWeight: '900',
  },
  tabLabel: {
    color: colors.muted,
    fontSize: 11,
  },
  tabTextActive: {
    color: '#10120f',
    fontWeight: '800',
  },
});
