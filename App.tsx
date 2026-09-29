import { StatusBar } from 'expo-status-bar';
import * as ImagePicker from 'expo-image-picker';
import * as LocalAuthentication from 'expo-local-authentication';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  Image,
  KeyboardAvoidingView,
  Linking,
  Modal,
  PanResponder,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import {
  acknowledgeDomesticAliveReply,
  acceptDomesticFriendRequest,
  confirmDomesticCheckin,
  createDomesticTodo,
  deleteDomesticFriendship,
  deleteDomesticJournalPhoto,
  loadDomesticAppSnapshot,
  pokeDomesticFriend,
  replyDomesticAliveToPoke,
  requestDomesticAccountDeletion,
  saveDomesticJournal,
  saveDomesticQuote,
  saveDomesticPersonalMessages,
  sendDomesticFriendRequest,
  updateDomesticPrivacySetting,
  updateDomesticProfile,
  updateDomesticTodoDone,
  updateDomesticTodoImportant,
  uploadDomesticJournalPhoto,
  uploadDomesticProfileAvatar,
} from './src/lib/domesticAppApi';
import {
  resetDomesticPasswordWithCode,
  sendDomesticPhoneLoginCode,
  signInDomesticWithPassword,
  signOutDomestic,
} from './src/lib/domesticAuthApi';
import {
  DomesticApiError,
  StaleSessionError,
  getDomesticPolicyConsent,
  getDomesticSession,
  getDomesticRememberMode,
  hasDomesticApiConfig,
  onDomesticSessionExpired,
  saveDomesticSession,
  setDomesticPolicyConsent,
  type DomesticSession,
} from './src/lib/domesticClient';
import { demoSnapshot } from './src/lib/mockData';
import { keepStableSnapshotPhotos } from './src/lib/snapshotSafety';
import { disableDailyReminder, getReminderSettings, scheduleDailyReminder } from './src/lib/reminderNotifications';
import type { AppSnapshot, DiaryEntry, Friend, FriendRequest, IncomingPoke, PersonalMessage, Profile, Todo } from './src/lib/types';

type TabKey = 'today' | 'friends' | 'todos' | 'profile';
type TabIconKey = TabKey;
type SaveState = 'idle' | 'saving' | 'saved';

const SMS_RESEND_SECONDS = 60;
const APP_FILING_NUMBER = '京ICP备2026053212号-1A';
const APP_FILING_QUERY_URL = 'https://beian.miit.gov.cn/';
const APP_SHARE_URL = process.env.EXPO_PUBLIC_APP_SHARE_URL?.trim() || 'https://huozhema.senbeikeji.cn/';
const PRIVACY_POLICY_URL = process.env.EXPO_PUBLIC_PRIVACY_POLICY_URL?.trim() || 'https://huozhema.senbeikeji.cn/privacy.html';
const TERMS_OF_SERVICE_URL = process.env.EXPO_PUBLIC_TERMS_OF_SERVICE_URL?.trim() || 'https://huozhema.senbeikeji.cn/terms.html';
const REGISTRATION_AGREEMENT_URL = process.env.EXPO_PUBLIC_REGISTRATION_AGREEMENT_URL?.trim() || 'https://huozhema.senbeikeji.cn/registration.html';
const TRUSTEE_SERVICE_EMAIL = process.env.EXPO_PUBLIC_TRUSTEE_SERVICE_EMAIL?.trim() || 'anxintuofu@senbeikeji.cn';

async function openExternalUrl(url: string, label: string) {
  try {
    await Linking.openURL(url);
  } catch {
    Alert.alert(`无法打开${label}`, '请检查网络后再试。');
  }
}

async function openTrusteeServiceEmail() {
  const subject = encodeURIComponent('安心托付服务委托');
  const body = encodeURIComponent(
    [
      '您好，我想申请“安心托付”服务。',
      '',
      '所在城市：',
      '联系方式：',
      '希望委托的内容：',
      '如不便文字说明，希望通过视频说明：是 / 否',
      '',
      '请勿在邮件中填写账户密码、验证码、支付密码、设备解锁密码、私钥、助记词，或直接附上身份证、人脸视频等敏感材料。工作人员回访后会告知必要性和安全提交方式。',
    ].join('\n'),
  );

  try {
    await Linking.openURL(`mailto:${TRUSTEE_SERVICE_EMAIL}?subject=${subject}&body=${body}`);
  } catch {
    Alert.alert('无法打开邮箱应用', `请在常用邮箱中手动联系：\n${TRUSTEE_SERVICE_EMAIL}`);
  }
}

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
  '允许自己慢一点，生活不是一场赶路比赛。',
  '先照顾好此刻的自己，答案会在路上出现。',
  '今天完成一点点，也值得认真为自己高兴。',
  '累了就停一停，休息不是退后。',
  '有些事情暂时没有答案，也不妨碍你继续生活。',
  '把心放松一点，今天不需要事事圆满。',
  '你可以一边不确定，一边勇敢地往前走。',
  '平凡的一天，也值得被好好记住。',
  '别急着责怪自己，你已经在尽力适应生活。',
  '今天的风会过去，你也会走到新的地方。',
  '把能做的做好，剩下的交给时间。',
  '世界偶尔很吵，记得听一听自己的声音。',
  '不用和别人一样，你有自己的季节。',
  '现在的你，也值得被温柔对待。',
  '给今天留一点空白，也给自己留一点余地。',
  '一次小小的坚持，也是在认真选择生活。',
  '不开心的时候，不必勉强自己看起来很好。',
  '把脚步放稳，慢慢来同样可以抵达。',
  '你不需要解决所有事情，先过好这一刻。',
  '今天也许普通，但你依然是独一无二的存在。',
  '愿你在忙碌里，也没有忘记照顾自己的感受。',
  '可以期待明天，也别忘了拥抱今天。',
  '哪怕只是好好吃饭、好好睡觉，也是在爱自己。',
  '生活有轻有重，你可以选择先放下最沉的那一件。',
  '你走过的每一步，都算数。',
  '愿今天结束时，你能对自己说一声辛苦了。',
];

const dailyEncouragements = [
  '今天迈出的一小步，也在把你带向更想去的地方。',
  '不用一次做到完美，开始本身就很有力量。',
  '把今天能做的做好，时间会替你积累答案。',
  '你认真生活的每一天，都在悄悄成为底气。',
  '慢一点没关系，只要还在朝自己的方向走。',
  '先完成眼前的一件事，今天就会多一点光。',
  '你的努力不必轰轰烈烈，坚持就已经很了不起。',
  '允许今天有难度，也相信自己能把它走过去。',
  '每一次重新出发，都比停在原地更接近答案。',
  '照顾好自己，也是今天很重要的一件事。',
  '别低估微小的行动，它们会慢慢改变生活。',
  '今天值得期待，你也值得被自己的努力照亮。',
];

const weatherOptions = ['☀️ 晴', '🌤️ 多云', '🌧️ 雨', '⛈️ 雷', '🌙 夜'];

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
    `累计存在：${aliveDays} 天`,
    `今天天气：${weatherText}`,
    `今天心情：${statusText}`,
    `随笔小记：${journal}`,
    `照片：${photoCount} 张`,
    `送给自己的一句话：${quote}`,
    `完成的三件事：\n${doneText}`,
  ].join('\n\n');
}

function buildTodayShareText({
  aliveDays,
  doneCount,
  quoteText,
  statusText,
  streak,
  weatherText,
}: {
  aliveDays: number;
  doneCount: number;
  quoteText: string;
  statusText: string;
  streak: number;
  weatherText: string;
}) {
  const quote = quoteText.trim() ? `\n送给自己：${quoteText.trim()}` : '';

  return [
    '我刚刚在「在否」确认了一下：我还在，挺好。',
    '',
    `今天心情：${statusText}`,
    `今天天气：${weatherText}`,
    `累计存在：${aliveDays} 天`,
    `连续存在：${streak} 天`,
    `今天想做：${doneCount} 件${quote}`,
    '',
    '你也来给今天留一个小小的信号。',
    APP_SHARE_URL,
  ].join('\n');
}

function buildInviteShareText() {
  return [
    '我在用「在否」给每天留一个很小的信号：我还在。',
    '',
    '可以记录心情、随笔、照片和今天最想做的三件事，也可以和好友轻轻戳一下，确认彼此还在。',
    '',
    '你也来试试：',
    APP_SHARE_URL,
  ].join('\n');
}

function localDateIso(date = new Date()) {
  const timezoneOffset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - timezoneOffset).toISOString().slice(0, 10);
}

function encouragementForDate(dateIso: string) {
  const [year, month, day] = dateIso.split('-').map(Number);
  const dayNumber = Math.floor(Date.UTC(year, month - 1, day) / 86400000);
  return dailyEncouragements[dayNumber % dailyEncouragements.length];
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
  const [pendingMood, setPendingMood] = useState({ date: localDateIso(), value: '' });
  const [pendingWeather, setPendingWeather] = useState({ date: localDateIso(), value: '' });
  const [draft, setDraft] = useState('');
  const [importantDraft, setImportantDraft] = useState(false);
  const [journalDraft, setJournalDraft] = useState(demoSnapshot.journalText);
  const [quoteDraft, setQuoteDraft] = useState(demoSnapshot.quoteText);
  const [demoMode, setDemoMode] = useState(!hasDomesticApiConfig);
  const [journalSaveState, setJournalSaveState] = useState<SaveState>('idle');
  const [journalEditing, setJournalEditing] = useState(false);
  const [journalBase, setJournalBase] = useState({ date: '', text: '' });
  const [quoteSaveState, setQuoteSaveState] = useState<SaveState>('idle');
  const [savedJournalText, setSavedJournalText] = useState(demoSnapshot.journalText);
  const [dismissedPokeIds, setDismissedPokeIds] = useState<Set<string>>(new Set());
  const [dismissedReplyIds, setDismissedReplyIds] = useState<Set<string>>(new Set());
  const [optimisticPokedFriendIds, setOptimisticPokedFriendIds] = useState<Set<string>>(new Set());
  const [quickRecordDraft, setQuickRecordDraft] = useState('');
  const [quickRecordOpen, setQuickRecordOpen] = useState(false);
  const [todayDiaryOpen, setTodayDiaryOpen] = useState(false);
  const [weatherPickerOpen, setWeatherPickerOpen] = useState(false);
  const [session, setSession] = useState<DomesticSession | null>(null);
  const [sessionRestoring, setSessionRestoring] = useState(hasDomesticApiConfig);
  const [signingOut, setSigningOut] = useState(false);
  const [snapshotLoading, setSnapshotLoading] = useState(false);
  const [snapshotError, setSnapshotError] = useState('');
  const [snapshotRetry, setSnapshotRetry] = useState(0);
  const snapshotSequence = useRef(0);
  const snapshotRequests = useRef(0);
  const [addingTodo, setAddingTodo] = useState(false);
  const addingTodoRef = useRef(false);
  const journalBusy = useRef(false);
  const saveNoticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSnapshotJournalText = useRef(demoSnapshot.journalText);
  const lastSnapshotQuoteText = useRef(demoSnapshot.quoteText);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [appToast, setAppToast] = useState('');
  const appToastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const userId = session?.profile.id;
  const accountScope = demoMode ? 'demo' : session?.accessToken || 'signed-out';
  const activeAccountScope = useRef(accountScope);
  activeAccountScope.current = accountScope;
  const isCurrentAccount = () => activeAccountScope.current === accountScope;
  const snapshotReady = demoMode || !userId || snapshot.profile.id === userId;

  const checkedIn = snapshot.checkedIn;
  const statusText = checkedIn
    ? snapshot.statusText
    : pendingMood.date === localDateIso() && pendingMood.value
      ? pendingMood.value
      : snapshot.statusText;
  const todos = snapshot.todos;
  const friends = snapshot.friends;
  const friendRequests = snapshot.friendRequests;
  const incomingPokes = snapshot.incomingPokes;
  const aliveReplies = snapshot.aliveReplies;
  const sentPokes = snapshot.sentPokes;
  const diaryEntries = snapshot.diaryEntries;
  const aliveDays = Number.isFinite(snapshot.aliveDays) ? Math.max(0, Math.floor(snapshot.aliveDays)) : 0;
  const journalPhotoPaths = snapshot.journalPhotoPaths;
  const journalPhotoUrls = snapshot.journalPhotoUrls;
  const journalPhotoCount = journalPhotoPaths.length;
  const journalText = snapshot.journalText;
  const personalMessages = snapshot.personalMessages;
  const quoteText = snapshot.quoteText;
  const quoteSaved = checkedIn && snapshot.quoteSaved;
  const streak = snapshot.streak;
  const weatherText = checkedIn
    ? snapshot.weatherText
    : pendingWeather.date === localDateIso() && pendingWeather.value
      ? pendingWeather.value
      : snapshot.weatherText;
  const profile = snapshot.profile;

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
    return aliveReplies.filter(
      (reply) =>
        localDateIso(new Date(reply.createdAt)) === today &&
        !reply.acknowledgedAt &&
        !dismissedReplyIds.has(reply.id),
    );
  }, [aliveReplies, dismissedReplyIds]);
  const friendSignalCount = incomingPokeCount + visibleAliveReplyNotices.length;
  const currentDateIso = localDateIso();
  const dailyEncouragement = useMemo(() => encouragementForDate(currentDateIso), [currentDateIso]);

  function showSavedFeedback(savedText = journalDraft.trim()) {
    setJournalSaveState('saved');
    setJournalEditing(false);
    setSavedJournalText(savedText);
    if (saveNoticeTimer.current) clearTimeout(saveNoticeTimer.current);
    saveNoticeTimer.current = setTimeout(() => setJournalSaveState('idle'), 1400);
  }

  function requireCheckin() {
    if (!isCurrentAccount()) return false;
    if (checkedIn) return true;
    Alert.alert('请先确认今天还在', '确认之后，今天的随笔、照片和三件事才会留下痕迹。');
    return false;
  }

  function showAppToast(message: string) {
    setAppToast(message);
    if (appToastTimer.current) clearTimeout(appToastTimer.current);
    appToastTimer.current = setTimeout(() => setAppToast(''), 1800);
  }

  useEffect(() => onDomesticSessionExpired(() => {
    setSession(null);
    setSnapshot(demoSnapshot);
    setSnapshotLoading(false);
    Alert.alert('登录已失效', '登录已过期或密码已重置，请重新登录。');
  }), []);

  useEffect(() => {
    if (!hasDomesticApiConfig) {
      setSessionRestoring(false);
      return;
    }

    let active = true;
    getDomesticPolicyConsent()
      .then((accepted) => (accepted ? getDomesticSession() : null))
      .then((nextSession) => {
        if (active) setSession(nextSession);
      })
      .catch(() => {
        if (active) setSession(null);
      })
      .finally(() => {
        if (active) setSessionRestoring(false);
      });

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    return () => {
      if (saveNoticeTimer.current) clearTimeout(saveNoticeTimer.current);
      if (appToastTimer.current) clearTimeout(appToastTimer.current);
    };
  }, []);

  useEffect(() => {
    setSnapshot(demoSnapshot);
    setDraft('');
    setImportantDraft(false);
    setQuickRecordDraft('');
    setQuickRecordOpen(false);
    setTodayDiaryOpen(false);
    setWeatherPickerOpen(false);
    setJournalBase({ date: '', text: '' });
    setSnapshotError('');
    setAppToast('');
    setUploadingPhoto(false);
    setUploadingAvatar(false);
    setAddingTodo(false);
    addingTodoRef.current = false;
    journalBusy.current = false;
    snapshotSequence.current += 1;
    if (saveNoticeTimer.current) clearTimeout(saveNoticeTimer.current);
    if (appToastTimer.current) clearTimeout(appToastTimer.current);
    setPendingMood({ date: localDateIso(), value: '' });
    setPendingWeather({ date: localDateIso(), value: '' });
    setJournalDraft(demoSnapshot.journalText);
    setQuoteDraft(demoSnapshot.quoteText);
    setSavedJournalText(demoSnapshot.journalText);
    setJournalSaveState('idle');
    setJournalEditing(false);
    setQuoteSaveState('idle');
    setDismissedPokeIds(new Set());
    setDismissedReplyIds(new Set());
    setOptimisticPokedFriendIds(new Set());
    lastSnapshotJournalText.current = demoSnapshot.journalText;
    lastSnapshotQuoteText.current = demoSnapshot.quoteText;
  }, [accountScope]);

  useEffect(() => {
    if (!userId || demoMode) {
      setSnapshotLoading(false);
      return;
    }

    let cancelled = false;

    setSnapshotLoading(true);
    setSnapshotError('');
    refreshSnapshot()
      .catch(async (error) => {
        if (cancelled || !isCurrentAccount()) return;
        if (error instanceof DomesticApiError && error.status === 401) return;
        if (error instanceof Error && error.message.includes('账户注销处理中')) {
          await signOutDomestic();
          setSession(null);
          setSnapshot(demoSnapshot);
          Alert.alert('账户注销处理中', '这个账户已经提交注销，暂时不能继续登录。');
          return;
        }
        setSnapshotError(error instanceof Error ? error.message : '同步失败，请稍后重试');
      })
      .finally(() => {
        if (!cancelled) setSnapshotLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [accountScope, snapshotRetry]);

  useEffect(() => {
    if (!userId || demoMode) return;

    const timer = setInterval(() => {
      if (snapshotRequests.current > 0) return;
      refreshSnapshot()
        .catch(() => {
          // 轻量同步好友回馈和戳一下，失败时避免频繁打扰用户。
        });
    }, 6000);

    return () => clearInterval(timer);
  }, [accountScope]);

  useEffect(() => {
    setQuoteDraft((currentDraft) => (currentDraft === lastSnapshotQuoteText.current ? snapshot.quoteText : currentDraft));
    lastSnapshotQuoteText.current = snapshot.quoteText;
    if (snapshot.quoteSaved) setQuoteDraft(snapshot.quoteText);
    setQuoteSaveState((current) => (current === 'saving' ? current : 'idle'));
  }, [snapshot.quoteSaved, snapshot.quoteText]);

  useEffect(() => {
    setJournalDraft((currentDraft) => (currentDraft === lastSnapshotJournalText.current ? snapshot.journalText : currentDraft));
    lastSnapshotJournalText.current = snapshot.journalText;
    setSavedJournalText(snapshot.journalText);
  }, [snapshot.journalText]);

  async function refreshSnapshot() {
    if (!userId || demoMode) return;
    if (!isCurrentAccount()) throw new StaleSessionError();
    const sequence = ++snapshotSequence.current;
    snapshotRequests.current += 1;
    try {
      const nextSnapshot = await loadDomesticAppSnapshot();
      if (!isCurrentAccount() || nextSnapshot.profile.id !== userId) throw new StaleSessionError();
      if (sequence === snapshotSequence.current) {
        setSnapshot((current) => keepStableSnapshotPhotos(current, nextSnapshot));
        setSnapshotError('');
      }
      return nextSnapshot;
    } finally {
      snapshotRequests.current -= 1;
    }
  }

  async function handleCheckin() {
    if (!statusText.trim()) {
      Alert.alert('先选今天心情', '选一个今天的状态，再确认我还在。');
      return;
    }

    if (!userId || demoMode) {
      setSnapshot((current) => ({
        ...current,
        aliveDays: current.checkedIn ? current.aliveDays : current.aliveDays + 1,
        checkedIn: true,
        statusText,
        streak: current.checkedIn ? current.streak : current.streak + 1,
        weatherText,
      }));
      setPendingMood({ date: localDateIso(), value: '' });
      setPendingWeather({ date: localDateIso(), value: '' });
      setWeatherPickerOpen(false);
      return;
    }

    try {
      await confirmDomesticCheckin(statusText, weatherText);
      await refreshSnapshot();
      setPendingMood({ date: localDateIso(), value: '' });
      setPendingWeather({ date: localDateIso(), value: '' });
      setWeatherPickerOpen(false);
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
      await updateDomesticTodoDone(id, !target.done);
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
      await updateDomesticTodoImportant(id, !target.important);
      await refreshSnapshot();
    } catch (error) {
      Alert.alert('标记失败', error instanceof Error ? error.message : '请稍后再试');
      await refreshSnapshot().catch(() => undefined);
    }
  }

  async function addTodo() {
    if (!requireCheckin() || addingTodoRef.current) return;
    const text = draft.trim();
    if (!text || todos.length >= 3) return;
    addingTodoRef.current = true;
    setAddingTodo(true);
    try {
      if (userId && !demoMode) {
        const todo = await createDomesticTodo(text, importantDraft);
        if (!isCurrentAccount()) return;
        setSnapshot((current) => ({ ...current, todos: [...current.todos.filter((item) => item.id !== todo.id), todo] }));
        await refreshSnapshot().catch(() => undefined);
      } else {
        setSnapshot((current) => ({
          ...current,
          todos: [...current.todos, { id: String(Date.now()), text, done: false, important: importantDraft }],
        }));
      }
      if (!isCurrentAccount()) return;
      setDraft('');
      setImportantDraft(false);
    } catch (error) {
      if (isCurrentAccount()) Alert.alert('添加失败', error instanceof Error ? error.message : '请稍后再试');
    } finally {
      if (isCurrentAccount()) {
        addingTodoRef.current = false;
        setAddingTodo(false);
      }
    }
  }

  async function updateStatusText(value: string) {
    if (checkedIn) {
      showAppToast('今天心情已随确认存档。');
      return;
    }
    setPendingMood({ date: localDateIso(), value });
  }

  function updateJournalText(value: string) {
    setJournalDraft(value);
    setJournalSaveState('idle');
  }

  function startJournalEditing() {
    if (!requireCheckin()) return;
    setJournalDraft(journalText);
    setJournalBase({ date: snapshot.checkinDate, text: journalText });
    setJournalSaveState('idle');
    setJournalEditing(true);
  }

  function updateQuoteText(value: string) {
    if (quoteSaved) return;
    setQuoteDraft(value);
    setQuoteSaveState('idle');
  }

  async function saveQuote() {
    if (!requireCheckin()) return;
    if (quoteSaved || quoteSaveState === 'saving') return;

    const nextQuote = quoteDraft.trim();
    if (!nextQuote) return;

    setQuoteSaveState('saving');

    if (!userId || demoMode) {
      setSnapshot((current) => ({ ...current, quoteText: nextQuote, quoteSaved: true }));
      setQuoteSaveState('idle');
      return;
    }

    try {
      await saveDomesticQuote(nextQuote);
      setSnapshot((current) => ({ ...current, quoteText: nextQuote, quoteSaved: true }));
      setQuoteSaveState('idle');
      await refreshSnapshot().catch(() => undefined);
    } catch (error) {
      setQuoteSaveState('idle');
      Alert.alert('保存失败', error instanceof Error ? error.message : '请稍后再试');
      await refreshSnapshot().catch(() => undefined);
    }
  }

  function confirmSaveQuote() {
    if (!requireCheckin() || quoteSaved || quoteSaveState === 'saving' || !quoteDraft.trim()) return;
    Alert.alert('确认保存今日箴言？', '保存后这句话将作为今天的记录展示，不能再修改。', [
      { text: '再想想', style: 'cancel' },
      { text: '确认保存', onPress: () => void saveQuote() },
    ]);
  }

  function shuffleQuote() {
    if (!requireCheckin()) return;
    if (quoteSaved || quoteSaveState === 'saving') return;

    const currentIndex = quotePool.findIndex((quote) => quote === quoteDraft.trim());
    const nextQuote = quotePool[(currentIndex + 1 + quotePool.length) % quotePool.length];

    setQuoteDraft(nextQuote);
    setQuoteSaveState('idle');
  }

  async function saveJournal() {
    if (!requireCheckin() || journalBusy.current) return;
    const nextJournal = journalDraft.trim();
    journalBusy.current = true;
    setJournalSaveState('saving');
    try {
      if (userId && !demoMode) {
        await saveDomesticJournal(nextJournal, journalBase.text, journalBase.date);
      }
      if (!isCurrentAccount()) return;
      setSnapshot((current) => ({ ...current, journalText: nextJournal }));
      setJournalDraft(nextJournal);
      setJournalBase((current) => ({ ...current, text: nextJournal }));
      showSavedFeedback(nextJournal);
      await refreshSnapshot().catch(() => undefined);
    } catch (error) {
      if (!isCurrentAccount()) return;
      setJournalSaveState('idle');
      if (error instanceof DomesticApiError && error.status === 409) {
        const latest = await refreshSnapshot().catch(() => undefined);
        if (!isCurrentAccount()) return;
        if (latest) {
          Alert.alert('随笔有更新，草稿已保留',
            '最新内容：\n' + (latest.journalText.slice(0, 400) || '（空白）') + '\n\n可以合并后继续编辑，确认后再保存。',
            [
              { text: '先保留草稿', style: 'cancel' },
              { text: '合并并编辑', onPress: () => {
                if (!isCurrentAccount()) return;
                setJournalDraft([latest.journalText, nextJournal].filter(Boolean).join('\n'));
                setJournalBase({ date: latest.checkinDate, text: latest.journalText });
                setJournalEditing(true);
              }},
            ]);
          return;
        }
      }
      Alert.alert('保存失败', error instanceof Error ? error.message : '请稍后再试');
    } finally {
      if (isCurrentAccount()) journalBusy.current = false;
    }
  }

  function toggleWeatherPicker() {
    if (checkedIn) {
      setWeatherPickerOpen(false);
      showAppToast('今日天气已随确认存档，不能再修改。');
      return;
    }
    setWeatherPickerOpen((current) => !current);
  }

  async function updateWeatherText(nextWeather: string) {
    if (checkedIn) {
      setWeatherPickerOpen(false);
      showAppToast('今日天气已随确认存档，不能再修改。');
      return;
    }

    setPendingWeather({ date: localDateIso(), value: nextWeather });
    setWeatherPickerOpen(false);
  }

  function openQuickRecord() {
    if (!requireCheckin()) return;
    if (journalEditing && journalDraft.trim() !== journalText) {
      Alert.alert('随笔尚未保存', '请先保存正在编辑的随笔，再打开快捷记录。');
      return;
    }
    setQuickRecordOpen(true);
  }

  async function saveQuickRecord() {
    if (!requireCheckin() || journalBusy.current) return;
    const text = quickRecordDraft.trim();
    if (!text) return;
    const time = new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date());
    const baseJournal = journalText.trim();
    const nextJournal = baseJournal ? `${baseJournal}\n${time} ${text}` : `${time} ${text}`;
    journalBusy.current = true;
    setJournalSaveState('saving');
    try {
      if (userId && !demoMode) {
        await saveDomesticJournal(nextJournal, journalText, snapshot.checkinDate);
      }
      if (!isCurrentAccount()) return;
      setJournalDraft(nextJournal);
      setSnapshot((current) => ({ ...current, journalText: nextJournal }));
      setQuickRecordDraft('');
      setQuickRecordOpen(false);
      showSavedFeedback(nextJournal);
      await refreshSnapshot().catch(() => undefined);
    } catch (error) {
      if (!isCurrentAccount()) return;
      setJournalSaveState('idle');
      await refreshSnapshot().catch(() => undefined);
      if (!isCurrentAccount()) return;
      Alert.alert('记录未保存，草稿已保留', error instanceof Error ? error.message : '请稍后重试');
    } finally {
      if (isCurrentAccount()) journalBusy.current = false;
    }
  }

  async function addJournalPhoto() {
    if (!requireCheckin() || journalBusy.current) return;
    if (!journalEditing) {
      Alert.alert('请先进入编辑', '点击随笔小记中的“编辑”后，再添加照片。');
      return;
    }
    if (journalPhotoCount >= 3) {
      Alert.alert('最多 3 张', '今天的电子日记最多放 3 张照片。');
      return;
    }
    journalBusy.current = true;
    setUploadingPhoto(true);
    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!isCurrentAccount()) return;
      if (!permission.granted) {
        Alert.alert('需要相册权限', '允许访问相册后，才能给随笔小记添加照片。');
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        allowsEditing: false,
        allowsMultipleSelection: false,
        mediaTypes: ['images'],
        preferredAssetRepresentationMode: ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible,
        quality: 0.82,
      });
      if (!isCurrentAccount() || result.canceled || !result.assets[0]?.uri) return;
      const selectedAsset = result.assets[0];
      const photo = userId && !demoMode
        ? await uploadDomesticJournalPhoto(selectedAsset)
        : { path: selectedAsset.uri, signedUrl: selectedAsset.uri };
      if (!isCurrentAccount()) return;
      setSnapshot((current) => current.journalPhotoPaths.includes(photo.path) ? current : ({
        ...current,
        journalPhotoPaths: [...current.journalPhotoPaths, photo.path].slice(0, 3),
        journalPhotoUrls: [...current.journalPhotoUrls, photo.signedUrl].slice(0, 3),
      }));
      await refreshSnapshot().catch(() => undefined);
      if (isCurrentAccount()) showAppToast('照片已保存到今天。');
    } catch (error) {
      if (isCurrentAccount()) Alert.alert('照片上传失败', error instanceof Error ? error.message : '请稍后重试');
    } finally {
      if (isCurrentAccount()) {
        journalBusy.current = false;
        setUploadingPhoto(false);
      }
    }
  }

  async function changeProfileAvatar() {
    if (uploadingAvatar || !isCurrentAccount()) return;

    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!isCurrentAccount()) return;
    if (!permission.granted) {
      Alert.alert('需要相册权限', '允许访问相册后，才能更换头像。');
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      allowsEditing: true,
      allowsMultipleSelection: false,
      aspect: [1, 1],
      mediaTypes: ['images'],
      preferredAssetRepresentationMode: ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible,
      quality: 0.82,
    });
    if (!isCurrentAccount() || result.canceled || !result.assets[0]?.uri) return;

    const selectedAsset = result.assets[0];
    if (!userId || demoMode) {
      setSnapshot((current) => ({
        ...current,
        profile: { ...current.profile, avatarUrl: selectedAsset.uri },
      }));
      showAppToast('头像已更新。');
      return;
    }

    setUploadingAvatar(true);
    try {
      const avatar = await uploadDomesticProfileAvatar({
        fileName: selectedAsset.fileName,
        fileSize: selectedAsset.fileSize,
        mimeType: selectedAsset.mimeType,
        uri: selectedAsset.uri,
      });
      if (!isCurrentAccount()) return;
      setSnapshot((current) => ({
        ...current,
        profile: { ...current.profile, avatarUrl: avatar.avatarUrl },
      }));
      await refreshSnapshot();
      showAppToast('头像已更新，好友列表会同步显示。');
    } catch (error) {
      if (isCurrentAccount()) Alert.alert('头像上传失败', error instanceof Error ? error.message : '请稍后再试');
    } finally {
      if (isCurrentAccount()) setUploadingAvatar(false);
    }
  }

  async function removeJournalPhoto(index: number) {
    if (!requireCheckin() || !journalEditing || journalBusy.current) return;
    const removedPath = journalPhotoPaths[index];
    if (!removedPath) return;
    journalBusy.current = true;
    setUploadingPhoto(true);
    try {
      if (userId && !demoMode) await deleteDomesticJournalPhoto(removedPath);
      if (!isCurrentAccount()) return;
      setSnapshot((current) => {
        const nextPaths = current.journalPhotoPaths.filter((path) => path !== removedPath);
        const urls = new Map(current.journalPhotoPaths.map((path, i) => [path, current.journalPhotoUrls[i] || '']));
        return { ...current, journalPhotoPaths: nextPaths, journalPhotoUrls: nextPaths.map((path) => urls.get(path) || '') };
      });
      await refreshSnapshot().catch(() => undefined);
      if (isCurrentAccount()) showAppToast('照片已移除。');
    } catch (error) {
      if (isCurrentAccount()) Alert.alert('删除照片失败', error instanceof Error ? error.message : '请稍后重试');
    } finally {
      if (isCurrentAccount()) {
        journalBusy.current = false;
        setUploadingPhoto(false);
      }
    }
  }

  function openTodayDiary() {
    if (!requireCheckin()) return;
    setTodayDiaryOpen(true);
  }

  async function handleShareToday() {
    if (!requireCheckin()) return;

    try {
      const result = await Share.share({
        title: '在否',
        message: buildTodayShareText({
          aliveDays,
          doneCount,
          quoteText: savedTodayQuoteText,
          statusText,
          streak,
          weatherText,
        }),
      });

      if (result.action !== Share.dismissedAction) {
        showAppToast('可以选择微信好友或朋友圈分享。');
      }
    } catch (error) {
      Alert.alert('分享失败', error instanceof Error ? error.message : '请稍后再试');
    }
  }

  async function handleShareInvite() {
    try {
      const result = await Share.share({
        title: '在否',
        message: buildInviteShareText(),
      });

      if (result.action !== Share.dismissedAction) {
        showAppToast('可以选择微信好友或朋友圈分享。');
      }
    } catch (error) {
      Alert.alert('分享失败', error instanceof Error ? error.message : '请稍后再试');
    }
  }

  const savedTodayQuoteText = quoteSaved ? quoteText : '';

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
      Alert.alert('演示模式', '使用手机号登录后，就可以添加真实好友。');
      return;
    }

    try {
      await sendDomesticFriendRequest(phone);
      await refreshSnapshot();
      showAppToast('好友申请已发送，等对方接受。');
    } catch (error) {
      Alert.alert('添加失败', error instanceof Error ? error.message : '请稍后再试');
    }
  }

  async function handleAcceptFriendRequest(requestId: string) {
    if (!userId || demoMode) return;

    try {
      await acceptDomesticFriendRequest(requestId);
      await refreshSnapshot();
    } catch (error) {
      Alert.alert('接受失败', error instanceof Error ? error.message : '请稍后再试');
    }
  }

  async function handlePokeFriend(friend: Friend) {
    if (pokedFriendIds.has(friend.id)) return;

    setOptimisticPokedFriendIds((current) => new Set([...current, friend.id]));

    if (!userId || demoMode) return;

    try {
      await pokeDomesticFriend(friend.id);
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
    setDismissedPokeIds((current) => new Set([...current, poke.id]));

    if (!userId || demoMode) return;

    try {
      await replyDomesticAliveToPoke(poke.friendId);
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

  async function handleDismissAliveReply(replyId: string) {
    setDismissedReplyIds((current) => new Set([...current, replyId]));

    if (!userId || demoMode) return;

    try {
      await acknowledgeDomesticAliveReply(replyId);
      setSnapshot((current) => ({
        ...current,
        aliveReplies: current.aliveReplies.map((reply) =>
          reply.id === replyId ? { ...reply, acknowledgedAt: new Date().toISOString() } : reply,
        ),
      }));
    } catch (error) {
      setDismissedReplyIds((current) => {
        const next = new Set(current);
        next.delete(replyId);
        return next;
      });
      Alert.alert('操作失败', error instanceof Error ? error.message : '请稍后再试');
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
          if (!isCurrentAccount()) return;
          try {
            await deleteDomesticFriendship(friend.id);
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
      await updateDomesticProfile(nextNickname);
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
      await updateDomesticPrivacySetting(showStatusToFriends);
    } catch (error) {
      Alert.alert('保存失败', error instanceof Error ? error.message : '请稍后再试');
      await refreshSnapshot();
    }
  }

  async function completeSignOut() {
    setSigningOut(true);
    try {
      await signOutDomestic({ preserveBiometricLogin: true });
      setSession(null);
      setSnapshot(demoSnapshot);
      setTab('today');
      setDismissedPokeIds(new Set());
      setDismissedReplyIds(new Set());
      setOptimisticPokedFriendIds(new Set());
    } catch (error) {
      Alert.alert('退出失败', error instanceof Error ? error.message : '请检查网络后再试');
    } finally {
      setSigningOut(false);
    }
  }

  function handleSignOut() {
    if (signingOut) return;

    if (demoMode) {
      setDemoMode(false);
      setSnapshot(demoSnapshot);
      return;
    }

    Alert.alert(
      '确认退出登录？',
      '退出后将回到登录页面。若已开启 Face ID，可验证面容后直接登录；未开启时需要重新使用密码或验证码登录。已经保存的内容不会被删除。',
      [
        { text: '取消', style: 'cancel' },
        {
          text: '退出登录',
          style: 'destructive',
          onPress: () => {
            void completeSignOut();
          },
        },
      ],
    );
  }

  function handleRequestAccountDeletion() {
    if (demoMode) {
      Alert.alert('演示模式', '演示模式没有真实账号，不需要注销。');
      return;
    }

    if (!userId) return;

    Alert.alert(
      '注销账户',
      '注销后会立即退出登录并停用账户，同时停止展示你的昵称、手机号和好友关系。相关个人信息和内容通常会在 7 天内彻底删除。',
      [
        { text: '取消', style: 'cancel' },
        {
          text: '继续注销',
          style: 'destructive',
          onPress: () => {
            Alert.alert(
              '再次确认注销',
              '确认后当前账户会立即停用，相关个人信息、记录和照片通常会在 7 天内彻底删除；法律法规另有要求的除外。这个操作提交后不能在 App 内撤销。',
              [
                { text: '再想想', style: 'cancel' },
                {
                  text: '确认注销',
                  style: 'destructive',
                  onPress: async () => {
                    if (!isCurrentAccount()) return;
                    try {
                      await requestDomesticAccountDeletion();
                      await disableDailyReminder().catch(() => undefined);
                      await signOutDomestic();
                      setSession(null);
                      setSnapshot(demoSnapshot);
                      setTab('today');
                      setDismissedPokeIds(new Set());
                      setDismissedReplyIds(new Set());
                      setOptimisticPokedFriendIds(new Set());
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

  async function handleSavePersonalMessages(messages: PersonalMessage[]) {
    const normalized = messages.map((item) => ({
      message: item.message.trim(),
      recipientName: item.recipientName.trim(),
    }));

    if (!userId || demoMode) {
      const saved = normalized.map((item, index) => ({
        ...item,
        id: messages[index]?.id || `message-${Date.now()}-${index}`,
      }));
      setSnapshot((current) => ({ ...current, personalMessages: saved }));
      return saved;
    }

    const saved = await saveDomesticPersonalMessages(normalized);
    setSnapshot((current) => ({ ...current, personalMessages: saved }));
    return saved;
  }

  if (!demoMode && hasDomesticApiConfig && sessionRestoring) {
    return <AccountLoadingScreen />;
  }

  if (!demoMode && hasDomesticApiConfig && !session) {
    return <AuthScreen onSignedIn={setSession} />;
  }

  if (!demoMode && !hasDomesticApiConfig) {
    return <LaunchScreen onUseDemo={() => setDemoMode(true)} />;
  }

  if (!demoMode && hasDomesticApiConfig && session && (!snapshotReady || snapshotLoading)) {
    return <AccountLoadingScreen error={snapshotError} onRetry={() => setSnapshotRetry((value) => value + 1)} onSignOut={completeSignOut} />;
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar style="light" />
      <View style={styles.app}>
        <View style={styles.topbar}>
          <View>
            <Text style={styles.date}>{todayLabel}</Text>
            <Text style={styles.logo}>在否</Text>
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
              journalEditing={journalEditing}
              journalPhotoPaths={journalPhotoPaths}
              journalPhotoUrls={journalPhotoUrls}
              journalSaveState={journalSaveState}
              journalText={journalText}
              onAddJournalPhoto={addJournalPhoto}
              onCheckin={handleCheckin}
              onOpenDiary={openTodayDiary}
              onEditJournal={startJournalEditing}
              onRemoveJournalPhoto={removeJournalPhoto}
              onSaveJournal={saveJournal}
              onSaveQuote={confirmSaveQuote}
              onShareToday={handleShareToday}
              onShuffleQuote={shuffleQuote}
              onSelectWeather={updateWeatherText}
              onToggleWeatherPicker={toggleWeatherPicker}
              quoteDraft={quoteDraft}
              quoteSaveState={quoteSaveState}
              quoteSaved={quoteSaved}
              quoteText={quoteText}
              savedJournalText={savedJournalText}
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
              onDismissReply={handleDismissAliveReply}
              onPokeFriend={handlePokeFriend}
              onReplyPoke={handleReplyPoke}
              onSendRequest={handleSendFriendRequest}
              onShareInvite={handleShareInvite}
              pokedFriendIds={pokedFriendIds}
              repliedFriendIds={repliedFriendIds}
            />
          )}
          {tab === 'todos' && (
            <TodosScreen
              addTodo={addTodo}
              addingTodo={addingTodo}
              draft={draft}
              importantDraft={importantDraft}
              onSavePersonalMessages={handleSavePersonalMessages}
              personalMessages={personalMessages}
              setImportantDraft={setImportantDraft}
              setDraft={setDraft}
              encouragementText={dailyEncouragement}
              todos={todos}
              toggleTodo={toggleTodo}
              toggleTodoImportant={toggleTodoImportant}
            />
          )}
          {tab === 'profile' && (
            <ProfileScreen
              aliveDays={aliveDays}
              avatarUploading={uploadingAvatar}
              checkedIn={checkedIn}
              diaryEntries={visibleDiaryEntries}
              doneCount={doneCount}
              isDemo={demoMode}
              onChangeAvatar={changeProfileAvatar}
              onSignOut={handleSignOut}
              signingOut={signingOut}
              onUpdatePrivacy={handleUpdatePrivacy}
              onUpdateNickname={handleUpdateNickname}
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
        <Modal animationType="fade" transparent visible={quickRecordOpen} onRequestClose={() => { if (journalSaveState !== 'saving') setQuickRecordOpen(false); }}>
          <View style={styles.modalBackdrop}>
            <View style={styles.quickRecordPanel}>
              <SectionHead title="马上记一下" meta="写进今天" />
              <TextInput
                autoFocus
                editable={journalSaveState !== 'saving'}
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
                <Pressable disabled={journalSaveState === 'saving'} style={styles.quickRecordCancel} onPress={() => setQuickRecordOpen(false)}>
                  <Text style={styles.quickRecordCancelText}>取消</Text>
                </Pressable>
                <Pressable
                  disabled={!quickRecordDraft.trim() || journalSaveState === 'saving' || uploadingPhoto}
                  style={[styles.quickRecordSave, (!quickRecordDraft.trim() || journalSaveState === 'saving' || uploadingPhoto) && styles.disabledButton]}
                  onPress={saveQuickRecord}
                >
                  <Text style={styles.quickRecordSaveText}>{journalSaveState === 'saving' ? '保存中' : '保存'}</Text>
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
              <View style={styles.todayDiaryActions}>
                <Pressable style={styles.todayDiaryGhost} onPress={() => setTodayDiaryOpen(false)}>
                  <Text style={styles.todayDiaryGhostText}>关闭</Text>
                </Pressable>
                <Pressable style={styles.todayDiaryClose} onPress={handleShareToday}>
                  <Text style={styles.quickRecordSaveText}>分享</Text>
                </Pressable>
              </View>
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

function AccountLoadingScreen({ error = '', onRetry, onSignOut }: { error?: string; onRetry?: () => void; onSignOut?: () => void }) {
  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar style="light" />
      <View style={styles.launch}>
        <View style={styles.launchCard}>
          <Text style={styles.launchKicker}>欢迎回来</Text>
          <Text style={styles.launchTitle}>{error ? '暂时无法同步' : '正在同步'}</Text>
          <Text style={styles.launchCopy}>{error || '正在读取这个账号的昵称、日记和好友状态。'}</Text>
          {error ? (
            <>
              <Pressable style={styles.primaryButton} onPress={onRetry}><Text style={styles.primaryButtonText}>重新同步</Text></Pressable>
              <Pressable style={styles.todayDiaryGhost} onPress={onSignOut}><Text style={styles.todayDiaryGhostText}>退出登录</Text></Pressable>
            </>
          ) : <ActivityIndicator color={colors.green} size="large" />}
        </View>
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
          <Text style={styles.launchTitle}>在否</Text>
          <Text style={styles.launchCopy}>
            国内服务暂时不可用。你仍可以进入演示模式查看主要功能，稍后再尝试手机号登录。
          </Text>
          <Pressable style={styles.primaryButton} onPress={onUseDemo}>
            <Text style={styles.primaryButtonText}>进入演示模式</Text>
          </Pressable>
        </View>
      </View>
    </SafeAreaView>
  );
}

function AuthScreen({
  onSignedIn,
}: {
  onSignedIn: (session: DomesticSession) => void;
}) {
  const [loginMode, setLoginMode] = useState<'password' | 'code'>('password');
  const [code, setCode] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [passwordConfirmation, setPasswordConfirmation] = useState('');
  const [sentPhone, setSentPhone] = useState('');
  const [sending, setSending] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [resendCountdown, setResendCountdown] = useState(0);
  const [rememberLogin, setRememberLogin] = useState(true);
  const [useBiometrics, setUseBiometrics] = useState(false);
  const [biometricsAvailable, setBiometricsAvailable] = useState(false);
  const [savedBiometricLogin, setSavedBiometricLogin] = useState(false);
  const [acceptedAgreements, setAcceptedAgreements] = useState(false);

  useEffect(() => {
    let active = true;
    Promise.all([
      LocalAuthentication.hasHardwareAsync(),
      LocalAuthentication.isEnrolledAsync(),
      getDomesticRememberMode(),
      getDomesticPolicyConsent(),
    ]).then(([hasHardware, isEnrolled, rememberMode, policyAccepted]) => {
      if (!active) return;
      setBiometricsAvailable(hasHardware && isEnrolled);
      setSavedBiometricLogin(rememberMode === 'biometric');
      setAcceptedAgreements(policyAccepted);
      if (rememberMode === 'biometric') {
        setRememberLogin(true);
        setUseBiometrics(true);
      }
    }).catch(() => {
      if (active) setBiometricsAvailable(false);
    });
    return () => {
      active = false;
    };
  }, []);

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
    if (/^861\d{10}$/.test(compact)) return `+${compact}`;
    if (/^1\d{10}$/.test(compact)) return `+86${compact}`;
    return compact;
  }

  function formatAuthError(error: unknown) {
    const message = error instanceof Error ? error.message : '';
    const lowerMessage = message.toLowerCase();
    if (lowerMessage.includes('token has expired') || lowerMessage.includes('expired or is invalid')) {
      return '验证码已过期或不正确。请使用最后一次收到的验证码，并在有效期内输入；如果重新发送过，旧验证码会失效。';
    }
    return message || '请稍后再试';
  }

  function requireAgreementAcceptance() {
    if (acceptedAgreements) return true;
    Alert.alert('请先阅读并同意协议', '请勾选同意《隐私政策》《用户协议》和《注册协议》后再继续。');
    return false;
  }

  async function toggleAgreementAcceptance() {
    const nextValue = !acceptedAgreements;
    try {
      await setDomesticPolicyConsent(nextValue);
      setAcceptedAgreements(nextValue);
    } catch {
      Alert.alert('保存失败', '协议同意状态保存失败，请稍后再试。');
    }
  }

  async function sendCode() {
    if (!requireAgreementAcceptance()) return;
    const value = normalizePhone(phone.trim());
    if (!value) return;

    setSending(true);
    try {
      await withTimeout(sendDomesticPhoneLoginCode(value), 10000, '发送验证码超时，请检查网络后再试');
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

  function openPasswordReset() {
    if (loginMode === 'code') return;
    setLoginMode('code');
    setCode('');
    setSentPhone('');
    setPassword('');
    setPasswordConfirmation('');
  }

  async function completeSignIn(nextSession: DomesticSession) {
    if (rememberLogin && useBiometrics) {
      const authentication = await LocalAuthentication.authenticateAsync({
        cancelLabel: '取消',
        disableDeviceFallback: false,
        fallbackLabel: '使用设备密码',
        promptMessage: '启用 Face ID 或生物识别自动登录',
      });
      if (!authentication.success) throw new Error('未完成生物识别，暂未启用自动登录');
    }
    await saveDomesticSession(nextSession, {
      remember: rememberLogin,
      useBiometrics: rememberLogin && useBiometrics,
    });
    onSignedIn(nextSession);
  }

  async function passwordLogin() {
    if (!requireAgreementAcceptance()) return;
    const value = normalizePhone(phone.trim());
    if (!value || !password) return;

    setVerifying(true);
    try {
      const nextSession = await withTimeout(
        signInDomesticWithPassword(value, password),
        10000,
        '密码登录超时，请检查网络后再试',
      );
      await completeSignIn(nextSession);
    } catch (error) {
      Alert.alert('登录失败', formatAuthError(error));
    } finally {
      setVerifying(false);
    }
  }

  async function resetPasswordAndLogin() {
    if (!requireAgreementAcceptance()) return;
    const token = code.trim();
    if (!sentPhone || token.length < 6 || !password || !passwordConfirmation) return;
    if (password !== passwordConfirmation) {
      Alert.alert('两次密码不一致', '请重新确认登录密码。');
      return;
    }

    setVerifying(true);
    try {
      const nextSession = await withTimeout(
        resetDomesticPasswordWithCode(sentPhone, token, password),
        12000,
        '验证码验证超时，请检查网络后再试',
      );
      await completeSignIn(nextSession);
    } catch (error) {
      Alert.alert('验证失败', formatAuthError(error));
    } finally {
      setVerifying(false);
    }
  }

  async function biometricLogin() {
    if (!requireAgreementAcceptance()) return;
    setVerifying(true);
    try {
      const nextSession = await getDomesticSession();
      if (!nextSession) throw new Error('没有可用的生物识别登录凭证，请使用密码登录');
      onSignedIn(nextSession);
    } catch (error) {
      Alert.alert('自动登录未完成', error instanceof Error ? error.message : '请使用密码登录');
    } finally {
      setVerifying(false);
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
          <Text style={styles.launchTitle}>今天，还在吗？</Text>
          <Text style={styles.launchCopy}>手机号就是登录账号。首次设置或忘记密码时，再使用短信验证码。</Text>

          <View style={styles.authModeTabs}>
            <Pressable
              onPress={() => {
                setLoginMode('password');
                setCode('');
                setSentPhone('');
              }}
              style={[styles.authModeButton, loginMode === 'password' && styles.authModeButtonActive]}
            >
              <Text numberOfLines={1} style={[styles.authModeText, loginMode === 'password' && styles.authModeTextActive]}>密码登录</Text>
            </Pressable>
            <Pressable
              onPress={openPasswordReset}
              style={[styles.authModeButton, loginMode === 'code' && styles.authModeButtonActive]}
            >
              <Text numberOfLines={1} style={[styles.authModeText, loginMode === 'code' && styles.authModeTextActive]}>验证码设置密码</Text>
            </Pressable>
          </View>

          <View style={styles.phoneInputWrap}>
            <Text style={styles.phonePrefix}>+86</Text>
            <TextInput
              autoComplete="tel"
              keyboardType="phone-pad"
              onChangeText={setPhone}
              placeholder="手机号（登录账号）"
              placeholderTextColor="#777268"
              style={styles.phoneInput}
              value={phone}
            />
          </View>

          {loginMode === 'password' ? (
            <>
              <TextInput
                autoCapitalize="none"
                autoComplete="password"
                maxLength={64}
                onChangeText={setPassword}
                onSubmitEditing={passwordLogin}
                placeholder="输入登录密码"
                placeholderTextColor="#777268"
                secureTextEntry
                style={styles.authInput}
                textContentType="password"
                value={password}
              />
              <Pressable accessibilityRole="button" onPress={openPasswordReset} style={styles.forgotPasswordButton}>
                <Text style={styles.forgotPasswordText}>忘记密码？使用验证码重置</Text>
              </Pressable>
              <Pressable
                disabled={verifying || !acceptedAgreements || !phone.trim() || !password}
                onPress={passwordLogin}
                style={[
                  styles.primaryButton,
                  (verifying || !acceptedAgreements || !phone.trim() || !password) && styles.disabledButton,
                ]}
              >
                <Text style={styles.primaryButtonText}>{verifying ? '登录中' : '登录'}</Text>
              </Pressable>
            </>
          ) : (
            <>
              <Pressable
                disabled={sending || !acceptedAgreements || resendCountdown > 0 || !phone.trim()}
                style={[
                  styles.primaryButton,
                  (sending || !acceptedAgreements || resendCountdown > 0 || !phone.trim()) && styles.disabledButton,
                ]}
                onPress={sendCode}
              >
                <Text style={styles.primaryButtonText}>
                  {sending ? '发送中' : resendCountdown > 0 ? `${resendCountdown} 秒后可重新发送` : sentPhone ? '重新发送验证码' : '发送验证码'}
                </Text>
              </Pressable>
              {sentPhone ? (
                <>
                  <Text style={styles.authHint}>验证码已发送到 {sentPhone}，验证后会设置或重置登录密码。</Text>
                  <TextInput
                    keyboardType="number-pad"
                    maxLength={6}
                    onChangeText={setCode}
                    placeholder="输入 6 位验证码"
                    placeholderTextColor="#777268"
                    style={styles.authInput}
                    value={code}
                  />
                  <TextInput
                    autoCapitalize="none"
                    maxLength={64}
                    onChangeText={setPassword}
                    placeholder="设置新密码（8–64 位，含字母和数字）"
                    placeholderTextColor="#777268"
                    secureTextEntry
                    style={styles.authInput}
                    textContentType="newPassword"
                    value={password}
                  />
                  <TextInput
                    autoCapitalize="none"
                    maxLength={64}
                    onChangeText={setPasswordConfirmation}
                    onSubmitEditing={resetPasswordAndLogin}
                    placeholder="再次输入新密码"
                    placeholderTextColor="#777268"
                    secureTextEntry
                    style={styles.authInput}
                    textContentType="newPassword"
                    value={passwordConfirmation}
                  />
                  <Pressable
                    disabled={verifying || !acceptedAgreements || code.trim().length < 6 || !password || !passwordConfirmation}
                    style={[
                      styles.primaryButton,
                      (verifying || !acceptedAgreements || code.trim().length < 6 || !password || !passwordConfirmation) && styles.disabledButton,
                    ]}
                    onPress={resetPasswordAndLogin}
                  >
                    <Text style={styles.primaryButtonText}>{verifying ? '验证中' : '设置密码并登录'}</Text>
                  </Pressable>
                </>
              ) : null}
            </>
          )}

          {savedBiometricLogin ? (
            <Pressable
              disabled={verifying || !acceptedAgreements}
              onPress={biometricLogin}
              style={[styles.biometricLoginButton, (verifying || !acceptedAgreements) && styles.disabledButton]}
            >
              <Text style={styles.biometricLoginIcon}>◉</Text>
              <Text numberOfLines={2} style={styles.biometricLoginText}>使用 Face ID 登录（无需输入密码）</Text>
            </Pressable>
          ) : null}

          <View style={styles.authOptions}>
            <Pressable
              accessibilityRole="checkbox"
              accessibilityState={{ checked: rememberLogin }}
              onPress={() => {
                setRememberLogin((current) => {
                  if (current) setUseBiometrics(false);
                  return !current;
                });
              }}
              style={styles.authOptionRow}
            >
              <View style={[styles.authCheckbox, rememberLogin && styles.authCheckboxChecked]}>
                <Text style={styles.authCheckboxText}>{rememberLogin ? '✓' : ''}</Text>
              </View>
              <View style={styles.authOptionCopy}>
                <Text style={styles.authOptionTitle}>记住登录状态</Text>
                <Text style={styles.authOptionMeta}>安全保存登录凭证，不保存明文密码</Text>
              </View>
            </Pressable>
            {biometricsAvailable ? (
              <Pressable
                accessibilityRole="checkbox"
                accessibilityState={{ checked: rememberLogin && useBiometrics }}
                onPress={() => {
                  setRememberLogin(true);
                  setUseBiometrics((current) => !current);
                }}
                style={styles.authOptionRow}
              >
                <View style={[styles.authCheckbox, rememberLogin && useBiometrics && styles.authCheckboxChecked]}>
                  <Text style={styles.authCheckboxText}>{rememberLogin && useBiometrics ? '✓' : ''}</Text>
                </View>
                <View style={styles.authOptionCopy}>
                  <Text style={styles.authOptionTitle}>Face ID / 生物识别自动登录</Text>
                  <Text style={styles.authOptionMeta}>下次打开 App 时由系统验证身份</Text>
                </View>
              </Pressable>
            ) : null}
          </View>

          <View style={styles.authAgreementRow}>
            <Pressable
              accessibilityLabel="同意隐私政策、用户协议和注册协议"
              accessibilityRole="checkbox"
              accessibilityState={{ checked: acceptedAgreements }}
              hitSlop={8}
              onPress={() => {
                void toggleAgreementAcceptance();
              }}
            >
              <View style={[styles.authCheckbox, acceptedAgreements && styles.authCheckboxChecked]}>
                <Text style={styles.authCheckboxText}>{acceptedAgreements ? '✓' : ''}</Text>
              </View>
            </Pressable>
            <Text style={styles.authAgreementText}>
              我已阅读并同意
              <Text style={styles.authAgreementLink} onPress={() => void openExternalUrl(PRIVACY_POLICY_URL, '隐私政策')}>
                《隐私政策》
              </Text>
              、
              <Text style={styles.authAgreementLink} onPress={() => void openExternalUrl(TERMS_OF_SERVICE_URL, '用户协议')}>
                《用户协议》
              </Text>
              和
              <Text style={styles.authAgreementLink} onPress={() => void openExternalUrl(REGISTRATION_AGREEMENT_URL, '注册协议')}>
                《注册协议》
              </Text>
            </Text>
          </View>
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
  journalEditing,
  journalPhotoPaths,
  journalPhotoUrls,
  journalSaveState,
  journalText,
  onAddJournalPhoto,
  onCheckin,
  onEditJournal,
  onOpenDiary,
  onRemoveJournalPhoto,
  onSaveJournal,
  onSaveQuote,
  onShareToday,
  onShuffleQuote,
  onSelectWeather,
  onToggleWeatherPicker,
  quoteDraft,
  quoteSaveState,
  quoteSaved,
  quoteText,
  savedJournalText,
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
  journalEditing: boolean;
  journalPhotoPaths: string[];
  journalPhotoUrls: string[];
  journalSaveState: SaveState;
  journalText: string;
  onAddJournalPhoto: () => void;
  onCheckin: () => void;
  onEditJournal: () => void;
  onOpenDiary: () => void;
  onRemoveJournalPhoto: (index: number) => void;
  onSaveJournal: () => void;
  onSaveQuote: () => void;
  onShareToday: () => void;
  onShuffleQuote: () => void;
  onSelectWeather: (weatherText: string) => void;
  onToggleWeatherPicker: () => void;
  quoteDraft: string;
  quoteSaveState: SaveState;
  quoteSaved: boolean;
  quoteText: string;
  savedJournalText: string;
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

  useEffect(() => {
    if (journalSaveState !== 'saved') return;

    Animated.sequence([
      Animated.timing(savePulse, { toValue: 1.05, duration: 120, useNativeDriver: true }),
      Animated.timing(savePulse, { toValue: 1, duration: 160, useNativeDriver: true }),
    ]).start();
  }, [journalSaveState, savePulse]);

  const canSaveJournal = journalEditing && checkedIn;
  const savingJournal = journalSaveState === 'saving';
  const journalSaveLabel = journalSaveState === 'saving' ? '保存中' : journalSaveState === 'saved' ? '已保存' : '保存';
  const savingQuote = quoteSaveState === 'saving';
  const quoteSaveLabel = savingQuote ? '保存中' : '保存今日箴言';
  const quoteDate = localDateIso();
  const hasSavedMood = checkedIn && statusText.trim().length > 0;
  const archiveItems = [
    { done: checkedIn, label: '天气', mark: '天' },
    { done: hasSavedMood, label: '心情', mark: '心' },
    { done: checkedIn && savedJournalText.trim().length > 0, label: '随笔', mark: '随' },
    { done: quoteSaved, label: '箴言', mark: '箴' },
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
                  <Text style={styles.weatherArrow}>{checkedIn ? '🔒' : weatherPickerOpen ? '⌃' : '⌄'}</Text>
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
        <Text style={styles.heroTitle}>{checkedIn ? '我还在，挺好。' : '今天，还在吗？'}</Text>
        <Text style={styles.heroCopy}>
          {checkedIn ? '今天已经留下一个小小的信号。想说的话，留在下面慢慢写。' : '点一下，不解释，不汇报。只是给自己留个小小的信号。'}
        </Text>
        <Pressable style={styles.primaryButton} onPress={onCheckin}>
          <Text style={styles.primaryButtonText}>{checkedIn ? '今天已确认' : '确认我还在'}</Text>
        </Pressable>
      </View>

      <View style={styles.metricsGrid}>
        <MetricCard label="累计存在" value={`${aliveDays} 天`} valueColor={colors.green} />
        <MetricCard label="连续存在" value={`${streak} 天`} valueColor={colors.yellow} />
        <MetricCard label="今天要做的" value={`${todos.length} 件`} valueColor={colors.blue} />
      </View>

      <View style={styles.panel}>
        <View style={styles.journalSectionHead}>
          <View style={styles.sectionHeadCopy}>
            <Text style={styles.sectionTitle}>随笔小记</Text>
            <Text style={styles.journalSectionMeta}>
              {!checkedIn ? '确认后留下' : journalEditing ? '编辑完成后请保存' : '已保存，点击编辑可修改'}
            </Text>
          </View>
          {!journalEditing ? (
            <Pressable disabled={!checkedIn} onPress={onEditJournal} style={[styles.journalEditButton, !checkedIn && styles.disabledButton]}>
              <Text style={styles.journalEditButtonText}>编辑</Text>
            </Pressable>
          ) : null}
        </View>
        <TextInput
          editable={checkedIn && journalEditing && !savingJournal}
          maxLength={180}
          multiline
          onChangeText={setJournalDraft}
          placeholder="一时兴起的话，可以写在这里。"
          placeholderTextColor="#777268"
          style={[styles.journalInput, !journalEditing && styles.journalInputReadOnly]}
          textAlignVertical="top"
          value={journalDraft}
        />
        {journalText ? <Text style={styles.journalHint}>已留在今天：{journalText}</Text> : null}
        {journalEditing ? (
          <View style={styles.photoActionRow}>
            <Animated.View style={{ transform: [{ scale: savePulse }] }}>
              <Pressable
                disabled={!canSaveJournal || savingJournal || uploadingPhoto}
                style={[
                  styles.journalSaveButton,
                  journalSaveState === 'saved' && styles.journalSaveButtonSaved,
                  (!canSaveJournal || savingJournal || uploadingPhoto) && styles.disabledButton,
                ]}
                onPress={onSaveJournal}
              >
                <Text style={styles.journalSaveButtonText}>{journalSaveLabel}</Text>
              </Pressable>
            </Animated.View>
            <Pressable
              disabled={uploadingPhoto || savingJournal || journalPhotoCount >= 3}
              style={[styles.photoAddButton, (uploadingPhoto || savingJournal || journalPhotoCount >= 3) && styles.disabledButton]}
              onPress={onAddJournalPhoto}
            >
              <Text style={styles.photoAddButtonText}>{uploadingPhoto ? '上传中' : '添加照片'}</Text>
            </Pressable>
            <Text style={styles.photoLimitText}>{journalPhotoCount}/3</Text>
          </View>
        ) : null}
        {journalPhotoPaths.length > 0 && (
          <View style={styles.photoGrid}>
            {journalPhotoPaths.map((path, index) => {
              const url = journalPhotoUrls[index] ?? '';

              return (
                <View key={path} style={styles.photoThumbWrap}>
                  {url ? <Image source={{ uri: url }} style={styles.photoThumb} /> : null}
                  {journalEditing ? (
                    <Pressable disabled={uploadingPhoto || savingJournal} style={styles.photoRemoveButton} onPress={() => onRemoveJournalPhoto(index)}>
                      <Text style={styles.photoRemoveText}>×</Text>
                    </Pressable>
                  ) : null}
                </View>
              );
            })}
          </View>
        )}
      </View>

      <View style={styles.panel}>
        <SectionHead title="每日箴言" meta="留给今天的自己" />
        <View style={styles.quoteSheet}>
          <View style={styles.quoteSheetHeader}>
            <Text style={styles.quoteSheetKicker}>TO MYSELF · {quoteDate.slice(5).replace('-', '.')}</Text>
          </View>
          {quoteSaved ? (
            <Text style={styles.quoteDisplayText}>{quoteText}</Text>
          ) : (
            <TextInput
              editable={!savingQuote}
              maxLength={96}
              multiline
              onChangeText={setQuoteDraft}
              placeholder="今天想留给自己的话"
              placeholderTextColor="#8d9a88"
              style={styles.quoteCardInput}
              textAlignVertical="top"
              value={quoteDraft}
            />
          )}
          <View style={styles.quoteSheetFooter}>
            <Text style={styles.quoteSheetMeta}>
              {quoteSaved ? `${quoteDate.replaceAll('-', '.')} · 写给自己` : '可以自己写，也可以换一句'}
            </Text>
            <Text style={[styles.quoteSheetStatus, quoteSaved && styles.quoteSheetStatusSaved]}>
              {quoteSaved ? '✓ 已保存' : '未保存'}
            </Text>
          </View>
        </View>
        {quoteSaved ? (
          <Text style={styles.quoteHint}>今天的话已留下，不再修改。明天再写新的一句。</Text>
        ) : (
          <>
            <View style={styles.quoteActionRow}>
              <Pressable disabled={!checkedIn || savingQuote} onPress={onShuffleQuote} style={[styles.quoteShuffleButton, (!checkedIn || savingQuote) && styles.disabledButton]}>
                <Text style={styles.shuffleButtonText}>换一句</Text>
              </Pressable>
              <Pressable
                disabled={!checkedIn || !quoteDraft.trim() || savingQuote}
                onPress={onSaveQuote}
                style={[styles.quoteActionButton, (!checkedIn || !quoteDraft.trim() || savingQuote) && styles.disabledButton]}
              >
                <Text style={styles.quoteActionButtonText}>{quoteSaveLabel}</Text>
              </Pressable>
            </View>
            <Text style={styles.quoteHint}>
              {checkedIn ? '保存前请确认内容，保存后不可修改。' : '确认今天还在之后可保存，保存后不可修改。'}
            </Text>
          </>
        )}
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

      <View style={styles.todayActionRow}>
        <Pressable style={[styles.diaryButton, styles.todayActionButton]} onPress={onOpenDiary}>
          <Text style={styles.diaryButtonText}>看看今天的我</Text>
        </Pressable>
        <Pressable style={[styles.shareButton, styles.todayActionButton]} onPress={onShareToday}>
          <Text style={styles.shareButtonText}>分享给微信好友/朋友圈</Text>
        </Pressable>
      </View>
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
  onShareInvite,
  pokedFriendIds,
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
  onShareInvite: () => void;
  pokedFriendIds: Set<string>;
  repliedFriendIds: Set<string>;
}) {
  const [friendDraft, setFriendDraft] = useState('');
  const isConfirmed = (friend: Friend) => repliedFriendIds.has(friend.id);
  const activeCount = friends.filter(isConfirmed).length;
  const confirmedFriends = friends.filter(isConfirmed);
  const pendingFriends = friends.filter((friend) => !isConfirmed(friend));
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
        <View style={styles.friendPhoneInputWrap}>
          <Text style={styles.friendPhonePrefix}>+86</Text>
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
        </View>
        <Pressable disabled={!friendDraft.trim()} onPress={submitRequest} style={[styles.smallButton, !friendDraft.trim() && styles.disabledButton]}>
          <Text style={styles.smallButtonText}>添加</Text>
        </Pressable>
      </View>

      <Pressable style={styles.inviteShareCard} onPress={onShareInvite}>
        <View style={styles.inviteShareCopy}>
          <Text style={styles.inviteShareTitle}>分享给微信好友/朋友圈</Text>
          <Text style={styles.inviteShareMeta}>发一句邀请，让朋友也来确认今天。</Text>
        </View>
        <Text style={styles.inviteShareArrow}>›</Text>
      </Pressable>

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
                {request.avatarUrl ? (
                  <Image source={{ uri: request.avatarUrl }} style={styles.avatarImage} />
                ) : (
                  <Text style={styles.avatarText}>{request.name.slice(0, 1)}</Text>
                )}
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
                {request.avatarUrl ? (
                  <Image source={{ uri: request.avatarUrl }} style={styles.avatarImage} />
                ) : (
                  <Text style={styles.avatarText}>{request.name.slice(0, 1)}</Text>
                )}
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
                <Text style={styles.pokeNoticeMeta}>戳了你一下：还在不？</Text>
              </View>
              <Pressable style={styles.tinyButton} onPress={() => onReplyPoke(poke)}>
                <Text style={styles.tinyButtonText}>我还在</Text>
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
                <Text style={styles.pokeNoticeMeta}>回了你一句：我还在。</Text>
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
          <Text style={styles.mutedText}>好友存在雷达</Text>
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
          <SectionHead title="待确认是否还在" meta={String(pendingFriends.length)} />
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
  const statusBadgeText = confirmed ? '在' : poked ? '待确认' : '未知';
  const statusBadgeStyle = confirmed ? styles.badgeAlive : poked ? styles.badgePending : styles.badgeQuiet;
  const interactionText = replied ? '好友回馈：我还在' : '你已问：还在不？ · 等待回馈';
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
          {friend.avatarUrl ? (
            <Image source={{ uri: friend.avatarUrl }} style={styles.avatarImage} />
          ) : (
            <Text style={styles.avatarText}>{friend.name.slice(0, 1)}</Text>
          )}
        </View>
        <View style={styles.friendBody}>
          <View style={styles.friendTop}>
            <Text numberOfLines={1} style={styles.friendName}>{friend.name}</Text>
            <Text style={[styles.badge, statusBadgeStyle]}>{statusBadgeText}</Text>
          </View>
          <Text style={styles.friendPhone}>{friend.phoneMasked}</Text>
          {(poked || replied) && (
            <View style={[styles.friendSignal, replied ? styles.friendSignalReplied : styles.friendSignalPending]}>
              <View style={[styles.friendSignalDot, replied ? styles.friendSignalDotReplied : styles.friendSignalDotPending]} />
              <Text style={[styles.friendSignalText, replied && styles.friendSignalTextReplied]} numberOfLines={1}>
                {interactionText}
              </Text>
            </View>
          )}
          <Text style={styles.friendMeta}>
            {friend.statusVisible === false ? '状态已隐藏' : `${friend.days ?? 0} 天 · 连续 ${friend.streak ?? 0} 天 · ${lastSeenText}`}
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
  addingTodo,
  draft,
  importantDraft,
  onSavePersonalMessages,
  personalMessages,
  encouragementText,
  setImportantDraft,
  setDraft,
  todos,
  toggleTodo,
  toggleTodoImportant,
}: {
  addTodo: () => void;
  addingTodo: boolean;
  draft: string;
  importantDraft: boolean;
  onSavePersonalMessages: (messages: PersonalMessage[]) => Promise<PersonalMessage[]>;
  personalMessages: PersonalMessage[];
  encouragementText: string;
  setImportantDraft: (value: boolean) => void;
  setDraft: (value: string) => void;
  todos: Todo[];
  toggleTodo: (id: string) => void;
  toggleTodoImportant: (id: string) => void;
}) {
  const [messageDrafts, setMessageDrafts] = useState<PersonalMessage[]>(personalMessages);
  const [messagesExpanded, setMessagesExpanded] = useState(false);
  const [messagesDirty, setMessagesDirty] = useState(false);
  const [messageSaveState, setMessageSaveState] = useState<SaveState>('idle');
  const [trusteeServiceOpen, setTrusteeServiceOpen] = useState(false);

  useEffect(() => {
    if (!messagesDirty) setMessageDrafts(personalMessages);
  }, [messagesDirty, personalMessages]);

  function addMessageRecipient() {
    if (messageDrafts.length >= 3) return;
    setMessageDrafts((current) => [
      ...current,
      { id: `draft-${Date.now()}-${current.length}`, message: '', recipientName: '' },
    ]);
    setMessagesDirty(true);
    setMessageSaveState('idle');
  }

  function updateMessageDraft(id: string, field: 'message' | 'recipientName', value: string) {
    setMessageDrafts((current) => current.map((item) => (item.id === id ? { ...item, [field]: value } : item)));
    setMessagesDirty(true);
    setMessageSaveState('idle');
  }

  function removeMessageDraft(id: string) {
    setMessageDrafts((current) => current.filter((item) => item.id !== id));
    setMessagesDirty(true);
    setMessageSaveState('idle');
  }

  async function saveMessageDrafts() {
    if (!messagesDirty || messageDrafts.some((item) => !item.recipientName.trim() || !item.message.trim())) return;
    setMessageSaveState('saving');
    try {
      const saved = await onSavePersonalMessages(messageDrafts);
      setMessageDrafts(saved);
      setMessagesDirty(false);
      setMessageSaveState('saved');
      setMessagesExpanded(false);
      setTimeout(() => setMessageSaveState('idle'), 1400);
    } catch (error) {
      setMessageSaveState('idle');
      Alert.alert('留言保存失败', error instanceof Error ? error.message : '请稍后再试');
    }
  }

  function toggleMessagesExpanded() {
    if (!messagesExpanded) {
      setMessagesExpanded(true);
      return;
    }
    if (!messagesDirty) {
      setMessagesExpanded(false);
      return;
    }
    Alert.alert('修改尚未保存', '请先保存留言，或放弃本次修改后收起。', [
      { style: 'cancel', text: '继续编辑' },
      {
        onPress: () => {
          setMessageDrafts(personalMessages);
          setMessagesDirty(false);
          setMessageSaveState('idle');
          setMessagesExpanded(false);
        },
        style: 'destructive',
        text: '放弃修改并收起',
      },
    ]);
  }

  return (
    <View style={styles.stack}>
      <View style={styles.panel}>
        <SectionHead title="今天最想做的三件事" meta={`${todos.length}/3`} />
        <View style={styles.addRow}>
          <TextInput
            editable={todos.length < 3 && !addingTodo}
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
            disabled={addingTodo || todos.length >= 3 || !draft.trim()}
            onPress={addTodo}
            style={[styles.addButton, (addingTodo || todos.length >= 3 || !draft.trim()) && styles.disabledButton]}
          >
            <Text style={styles.addButtonText}>{addingTodo ? '添加中' : '加'}</Text>
          </Pressable>
        </View>
        <Pressable style={[styles.importantToggle, importantDraft && styles.importantToggleActive]} onPress={() => setImportantDraft(!importantDraft)}>
          <Text style={[styles.importantToggleText, importantDraft && styles.importantToggleTextActive]}>
            {importantDraft ? '已标记为大事' : '标记为大事'}
          </Text>
        </Pressable>
      </View>

      {todos.length > 0 ? (
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
      ) : null}

      <View style={styles.softNote}>
        <Text style={styles.dailyEncouragementLabel}>今日一句</Text>
        <Text style={styles.softNoteText}>{encouragementText}</Text>
      </View>

      <View style={styles.messagePanel}>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ expanded: messagesExpanded }}
          onPress={toggleMessagesExpanded}
          style={styles.messageCollapseHeader}
        >
          <View style={styles.messageCollapseCopy}>
            <Text style={styles.sectionTitle}>我的留言</Text>
            <Text style={styles.messageCollapsedHint}>
              {messageDrafts.length > 0 ? `已设置 ${messageDrafts.length} 位留言对象` : '暂未添加留言对象'}
            </Text>
          </View>
          <View style={styles.messageCollapseAction}>
            <Text style={styles.messageCollapseText}>{messagesExpanded ? '收起' : '展开'}</Text>
            <Text style={styles.messageCollapseIcon}>{messagesExpanded ? '⌃' : '⌄'}</Text>
          </View>
        </Pressable>

        {messagesExpanded ? (
          <>
            <Text style={styles.settingHelp}>最多添加三位对象，并分别写下想对他们说的话。留言会跟随账号保存。</Text>
            {messageDrafts.map((item, index) => (
              <View key={item.id} style={styles.messageCard}>
                <View style={styles.messageCardHead}>
                  <Text style={styles.messageCardTitle}>留言对象 {index + 1}</Text>
                  <Pressable onPress={() => removeMessageDraft(item.id)}>
                    <Text style={styles.messageRemoveText}>移除</Text>
                  </Pressable>
                </View>
                <TextInput
                  maxLength={20}
                  onChangeText={(value) => updateMessageDraft(item.id, 'recipientName', value)}
                  placeholder="对象称呼，例如：妈妈"
                  placeholderTextColor="#777268"
                  style={styles.messageRecipientInput}
                  value={item.recipientName}
                />
                <TextInput
                  maxLength={600}
                  multiline
                  onChangeText={(value) => updateMessageDraft(item.id, 'message', value)}
                  placeholder="写下想对这个人说的话"
                  placeholderTextColor="#777268"
                  style={styles.messageInput}
                  textAlignVertical="top"
                  value={item.message}
                />
              </View>
            ))}
            {messageDrafts.length < 3 && (
              <Pressable style={styles.messageAddButton} onPress={addMessageRecipient}>
                <Text style={styles.messageAddButtonText}>＋ 添加留言对象</Text>
              </Pressable>
            )}
            {(messageDrafts.length > 0 || messagesDirty) && (
              <View style={styles.messageActionRow}>
                <Pressable
                  disabled={
                    !messagesDirty ||
                    messageSaveState === 'saving' ||
                    messageDrafts.some((item) => !item.recipientName.trim() || !item.message.trim())
                  }
                  onPress={saveMessageDrafts}
                  style={[
                    styles.messageSaveButton,
                    messageSaveState === 'saved' && styles.addButtonSaved,
                    (!messagesDirty ||
                      messageSaveState === 'saving' ||
                      messageDrafts.some((item) => !item.recipientName.trim() || !item.message.trim())) &&
                      styles.disabledButton,
                  ]}
                >
                  <Text style={styles.messageSaveButtonText}>
                    {messageSaveState === 'saving' ? '保存中' : messageSaveState === 'saved' ? '已保存' : '保存并收起'}
                  </Text>
                </Pressable>
                <Text style={styles.savedHint}>
                  {messageDrafts.some((item) => !item.recipientName.trim() || !item.message.trim())
                    ? '请把称呼和留言都填写完整。'
                    : messagesDirty
                      ? '修改尚未保存。'
                      : '已保存。'}
                </Text>
              </View>
            )}
          </>
        ) : null}
      </View>

      <Pressable
        accessibilityHint="查看可托付事项并联系工作人员"
        accessibilityLabel="安心托付"
        accessibilityRole="button"
        onPress={() => setTrusteeServiceOpen(true)}
        style={({ pressed }) => [styles.trusteeEntryCard, pressed && styles.trusteeEntryCardPressed]}
      >
        <View style={styles.trusteeEntryMark}>
          <Text style={styles.trusteeEntryMarkText}>托</Text>
        </View>
        <View style={styles.trusteeEntryBody}>
          <View style={styles.trusteeEntryTitleRow}>
            <Text style={styles.trusteeEntryTitle}>安心托付</Text>
          </View>
          <Text style={styles.trusteeEntryCopy}>重要物品、数字资料、账号设备、心愿留言和生活事务，都可以提前安心交代</Text>
          <Text style={styles.trusteeEntryMeta}>先发邮件说明 · 工作人员回访核实</Text>
        </View>
        <Text style={styles.trusteeEntryArrow}>›</Text>
      </Pressable>

      <Modal animationType="slide" onRequestClose={() => setTrusteeServiceOpen(false)} visible={trusteeServiceOpen}>
        <SafeAreaView style={styles.trusteePage}>
          <View style={styles.trusteePageHeader}>
            <View>
              <Text style={styles.trusteePageEyebrow}>我的留言</Text>
              <Text style={styles.trusteePageHeaderTitle}>安心托付</Text>
            </View>
            <Pressable
              accessibilityLabel="关闭安心托付页面"
              accessibilityRole="button"
              hitSlop={12}
              onPress={() => setTrusteeServiceOpen(false)}
              style={styles.trusteeCloseButton}
            >
              <Text style={styles.trusteeCloseButtonText}>关闭</Text>
            </Pressable>
          </View>

          <ScrollView contentContainerStyle={styles.trusteePageContent} showsVerticalScrollIndicator={false}>
            <View style={styles.trusteeHero}>
              <View style={styles.trusteeStatusPill}>
                <View style={styles.trusteeStatusDot} />
                <Text style={styles.trusteeStatusText}>受人之托 · 忠人之事</Text>
              </View>
              <Text style={styles.trusteeHeroTitle}>把牵挂安放好，也让在意的人更安心</Text>
              <Text style={styles.trusteeHeroCopy}>
                有些事，不必一直放在心里。只要合法合规、权属清晰、风险可控，无论身在何处，都可以先告诉我们想托付的事。工作人员会认真倾听、逐项核实，再与你确认合适的安排。
              </Text>
              <View style={styles.trusteeOfflineNote}>
                <Text style={styles.trusteeOfflineNoteText}>App 仅展示服务说明和联系邮箱，请勿在邮件中发送密码、验证码等敏感信息。</Text>
              </View>
            </View>

            <View style={styles.trusteeSection}>
              <Text style={styles.trusteeSectionKicker}>可托付事项</Text>
              <Text style={styles.trusteeSectionTitle}>从数字生活，到身边的每一份牵挂</Text>
              <Text style={styles.trusteeHeroCopy}>
                可托付账号与设备处理、照片文件整理、个人物品和资料的保管移交、向亲友传达留言、纪念安排，以及其他清晰可执行的生活事务。
              </Text>
              <Text style={styles.trusteeOfflineNoteText}>涉及违法违规、权属不明、金融交易、代替本人作出重大决定或其他较高风险的事项不予承接。</Text>
            </View>

            <View style={styles.trusteeSection}>
              <Text style={styles.trusteeSectionKicker}>服务流程</Text>
              <Text style={styles.trusteeSectionTitle}>三步确认委托服务</Text>
              {[
                ['1', '邮件告知信息', '写明所在城市、联系方式和委托内容；如不便详细书写，可注明希望通过视频说明。'],
                ['2', '等待回访核实', '工作人员与你联系，进一步核实委托需求。'],
                ['3', '确认委托服务', '双方确认具体委托内容和后续服务安排。'],
              ].map(([step, title, copy], index, items) => (
                <View key={step} style={styles.trusteeStepRow}>
                  <View style={styles.trusteeStepRail}>
                    <View style={styles.trusteeStepNumber}>
                      <Text style={styles.trusteeStepNumberText}>{step}</Text>
                    </View>
                    {index < items.length - 1 ? <View style={styles.trusteeStepLine} /> : null}
                  </View>
                  <View style={styles.trusteeStepBody}>
                    <Text style={styles.trusteeStepTitle}>{title}</Text>
                    <Text style={styles.trusteeStepCopy}>{copy}</Text>
                  </View>
                </View>
              ))}
            </View>

            <View style={styles.trusteeSafetyCard}>
              <Text style={styles.trusteeSafetyLabel}>发送邮件前请注意</Text>
              <Text style={styles.trusteeSafetyTitle}>敏感材料不要直接作为邮件附件</Text>
              <Text style={styles.trusteeSafetyCopy}>
                手持身份证原件录制的视频同时包含身份证和人脸信息，属于敏感个人信息。如需视频说明，请先在邮件中注明，等待工作人员回访并告知处理目的、必要性、保存期限和安全提交方式；取得你的单独同意后再按指定方式提供。请勿发送密码、验证码、私钥或助记词。
              </Text>
            </View>

            <View style={styles.trusteeContactCard}>
              <Text style={styles.trusteeContactLabel}>官方客服邮箱</Text>
              <Text selectable style={styles.trusteeContactEmail}>{TRUSTEE_SERVICE_EMAIL}</Text>
              <Text style={styles.trusteeContactHint}>点击下方按钮，将打开你手机里的邮件应用，并自动带入一份不含敏感信息的咨询模板。</Text>
              <Pressable
                accessibilityHint="打开系统邮件应用"
                accessibilityLabel={`发送邮件至 ${TRUSTEE_SERVICE_EMAIL}`}
                accessibilityRole="button"
                onPress={openTrusteeServiceEmail}
                style={({ pressed }) => [styles.trusteeContactButton, pressed && styles.trusteeContactButtonPressed]}
              >
                <Text style={styles.trusteeContactButtonText}>通过邮件说明委托意向</Text>
                <Text style={styles.trusteeContactButtonArrow}>↗</Text>
              </Pressable>
            </View>

            <Text style={styles.trusteeDisclaimer}>
              发送邮件仅代表提交委托意向，不构成正式受理。是否承接及具体服务内容，以工作人员回访核实后的最终确认为准。
            </Text>
          </ScrollView>
        </SafeAreaView>
      </Modal>

    </View>
  );
}

function ProfileScreen({
  aliveDays,
  avatarUploading,
  checkedIn,
  diaryEntries,
  doneCount,
  isDemo,
  onChangeAvatar,
  onSignOut,
  onUpdatePrivacy,
  onUpdateNickname,
  onRequestAccountDeletion,
  profile,
  signingOut,
  streak,
}: {
  aliveDays: number;
  avatarUploading: boolean;
  checkedIn: boolean;
  diaryEntries: DiaryEntry[];
  doneCount: number;
  isDemo: boolean;
  onChangeAvatar: () => void;
  onSignOut: () => void;
  onUpdatePrivacy: (showStatusToFriends: boolean) => void;
  onUpdateNickname: (nickname: string) => Promise<void>;
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
  const [friendVisible, setFriendVisible] = useState(profile.showStatusToFriends);
  const [softReminder, setSoftReminder] = useState(false);
  const [reminderTime, setReminderTime] = useState('22:30');
  const [reminderSaving, setReminderSaving] = useState(false);

  useEffect(() => {
    setNicknameDraft(profile.nickname);
    setNicknameSaveState('idle');
  }, [profile.nickname]);

  useEffect(() => {
    setFriendVisible(profile.showStatusToFriends);
  }, [profile.showStatusToFriends]);

  useEffect(() => {
    let active = true;
    getReminderSettings()
      .then((settings) => {
        if (!active) return;
        setSoftReminder(settings.enabled);
        setReminderTime(settings.time);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

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

  function showReminderPermissionAlert() {
    Alert.alert('需要开启通知', '请在系统设置中允许“在否”发送通知，然后再开启每日提醒。', [
      { text: '取消', style: 'cancel' },
      { text: '前往设置', onPress: () => void Linking.openSettings() },
    ]);
  }

  async function toggleSoftReminder() {
    if (reminderSaving) return;
    setReminderSaving(true);
    try {
      if (softReminder) {
        const settings = await disableDailyReminder();
        setSoftReminder(settings.enabled);
        setReminderTime(settings.time);
      } else {
        const settings = await scheduleDailyReminder(reminderTime);
        setSoftReminder(settings.enabled);
        setReminderTime(settings.time);
      }
    } catch (error) {
      const actual = await getReminderSettings().catch(() => null);
      if (actual) {
        setSoftReminder(actual.enabled);
        setReminderTime(actual.time);
      }
      if (error instanceof Error && error.message.includes('通知权限')) {
        showReminderPermissionAlert();
      } else {
        Alert.alert('提醒设置失败', error instanceof Error ? error.message : '请稍后再试。');
      }
    } finally {
      setReminderSaving(false);
    }
  }

  async function selectReminderTime(time: string) {
    if (reminderSaving || time === reminderTime) return;
    const previousTime = reminderTime;
    setReminderTime(time);
    if (!softReminder) return;

    setReminderSaving(true);
    try {
      const settings = await scheduleDailyReminder(time);
      setReminderTime(settings.time);
    } catch (error) {
      setReminderTime(previousTime);
      const actual = await getReminderSettings().catch(() => null);
      if (actual) {
        setSoftReminder(actual.enabled);
        setReminderTime(actual.time);
      }
      if (error instanceof Error && error.message.includes('通知权限')) {
        showReminderPermissionAlert();
      } else {
        Alert.alert('提醒时间保存失败', error instanceof Error ? error.message : '请稍后再试。');
      }
    } finally {
      setReminderSaving(false);
    }
  }

  return (
    <View style={styles.stack}>
      <View style={styles.profileCard}>
        <Pressable
          accessibilityLabel="更换头像"
          disabled={avatarUploading}
          onPress={onChangeAvatar}
          style={[styles.profileAvatar, { backgroundColor: profile.avatarColor }]}
        >
          {profile.avatarUrl ? (
            <Image source={{ uri: profile.avatarUrl }} style={styles.profileAvatarImage} />
          ) : (
            <Text style={styles.avatarText}>{profile.nickname.slice(0, 1)}</Text>
          )}
          {avatarUploading && (
            <View style={styles.avatarLoadingOverlay}>
              <ActivityIndicator color={colors.text} size="small" />
            </View>
          )}
        </Pressable>
        <Pressable disabled={avatarUploading} onPress={onChangeAvatar}>
          <Text style={styles.profileAvatarHint}>{avatarUploading ? '头像上传中…' : '点击更换头像'}</Text>
        </Pressable>
        <Text numberOfLines={1} style={styles.profileName}>{profile.nickname}</Text>
        <Text style={styles.profilePhone}>{profile.phoneMasked}</Text>
        <Text style={styles.mutedText}>{checkedIn ? '今天已确认还在' : '今天还没出现'}</Text>
        <View style={styles.profileStats}>
          <ProfileStat label="累计存在" value={`${aliveDays} 天`} valueColor={colors.green} />
          <ProfileStat label="连续存在" value={`${streak} 天`} valueColor={colors.yellow} />
          <ProfileStat label="今天已做的" value={`${doneCount} 件`} valueColor={colors.blue} />
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
                !item.date && styles.calendarCellBlank,
                item.active && styles.calendarCellActive,
                item.today && styles.calendarCellToday,
                selectedDiaryDate === item.date && styles.calendarCellSelected,
              ]}
              onPress={() => setSelectedDiaryDate(item.date)}
            >
              <Text
                maxFontSizeMultiplier={1.2}
                style={[
                  styles.calendarCellText,
                  item.active && styles.calendarCellTextActive,
                  selectedDiaryDate === item.date && styles.calendarCellTextSelected,
                ]}
              >
                {item.dayNumber || ''}
              </Text>
              <View style={styles.calendarIndicatorSlot}>
                {item.active && (
                  <View
                    style={[
                      styles.calendarDot,
                      selectedDiaryDate === item.date && styles.calendarDotSelected,
                    ]}
                  />
                )}
              </View>
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
            <Pressable onPress={() => void openExternalUrl(PRIVACY_POLICY_URL, '隐私政策')}>
              <Text style={styles.linkText}>查看隐私政策</Text>
            </Pressable>
            <Pressable onPress={() => void openExternalUrl(TERMS_OF_SERVICE_URL, '用户协议')}>
              <Text style={styles.linkText}>查看用户协议</Text>
            </Pressable>
            <Pressable onPress={() => void openExternalUrl(REGISTRATION_AGREEMENT_URL, '注册协议')}>
              <Text style={styles.linkText}>查看注册协议</Text>
            </Pressable>
            <Pressable style={[styles.settingItem, styles.accountDeleteItem]} onPress={onRequestAccountDeletion}>
              <View style={styles.accountDeleteCopy}>
                <Text style={styles.accountDeleteText}>注销账户</Text>
                <Text style={styles.accountDeleteMeta}>二次确认后立即停用，通常 7 天内彻底删除</Text>
              </View>
              <Text style={styles.settingArrow}>›</Text>
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
                <Text style={styles.settingHelp}>{softReminder ? `每天 ${reminderTime} 提醒你确认还在。` : '打开后，每天到点提醒你确认还在。'}</Text>
              </View>
              <Pressable
                accessibilityRole="switch"
                accessibilityState={{ checked: softReminder }}
                disabled={reminderSaving}
                onPress={() => void toggleSoftReminder()}
                style={[styles.switchTrack, softReminder && styles.switchTrackActive, reminderSaving && styles.disabledButton]}
              >
                <View style={[styles.switchThumb, softReminder && styles.switchThumbActive]} />
              </Pressable>
            </View>
            <View style={styles.timeChipRow}>
              {['21:30', '22:30', '23:00'].map((time) => (
                <Pressable
                  disabled={reminderSaving}
                  key={time}
                  style={[styles.timeChip, reminderTime === time && styles.timeChipActive, reminderSaving && styles.disabledButton]}
                  onPress={() => void selectReminderTime(time)}
                >
                  <Text style={[styles.timeChipText, reminderTime === time && styles.timeChipTextActive]}>{time}</Text>
                </Pressable>
              ))}
            </View>
            <Text style={styles.savedHint}>
              {reminderSaving
                ? '正在保存系统提醒…'
                : softReminder
                  ? `系统通知已开启，每天 ${reminderTime} 提醒。`
                  : '开启后会申请系统通知权限，并按所选时间每天提醒。'}
            </Text>
          </View>
        )}

        <Pressable disabled={signingOut} style={[styles.settingItem, signingOut && styles.disabledButton]} onPress={onSignOut}>
          <Text style={styles.settingText}>{signingOut ? '退出中...' : isDemo ? '退出演示模式' : '退出登录'}</Text>
        </Pressable>
      </View>
      <Pressable
        accessibilityRole="link"
        accessibilityLabel={`APP备案号 ${APP_FILING_NUMBER}，查询备案信息`}
        style={styles.appFilingLink}
        onPress={() => void openExternalUrl(APP_FILING_QUERY_URL, 'APP备案信息')}
      >
        <Text style={styles.appFilingText}>APP备案号</Text>
        <Text style={styles.appFilingText}>{APP_FILING_NUMBER}</Text>
      </Pressable>
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
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        style={[styles.diaryEntryHead, expanded && styles.diaryEntryHeadExpanded]}
        onPress={() => setExpanded((current) => !current)}
      >
        <Text style={styles.diaryEntryDate}>{formatDiaryDate(entry.date)}</Text>
        <Text style={styles.diaryEntryMeta}>{entry.photoUrls.length} 图 · {entry.todos.filter((todo) => todo.done).length} 件事</Text>
        <View accessible={false} style={styles.diaryEntryArrowWrap}>
          <View style={[styles.diaryEntryArrow, expanded && styles.diaryEntryArrowExpanded]} />
        </View>
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
      <Text adjustsFontSizeToFit minimumFontScale={0.82} numberOfLines={1} style={styles.metricLabel}>{label}</Text>
      <Text adjustsFontSizeToFit minimumFontScale={0.78} numberOfLines={1} style={[styles.metricValue, valueColor ? { color: valueColor } : null]}>{value}</Text>
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
      <Text numberOfLines={1} style={styles.sectionTitle}>{title}</Text>
      <Text numberOfLines={1} style={styles.sectionMeta}>{meta}</Text>
    </View>
  );
}

function ProfileStat({ label, value, valueColor }: { label: string; value: string; valueColor?: string }) {
  return (
    <View style={styles.profileStat}>
      <Text adjustsFontSizeToFit minimumFontScale={0.78} numberOfLines={1} style={[styles.profileStatValue, valueColor ? { color: valueColor } : null]}>{value}</Text>
      <Text adjustsFontSizeToFit minimumFontScale={0.8} numberOfLines={1} style={styles.profileStatLabel}>{label}</Text>
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
    <Pressable
      accessibilityRole="tab"
      accessibilityState={{ selected: active }}
      style={[styles.tabButton, active && styles.tabButtonActive]}
      onPress={onPress}
    >
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
      <Text numberOfLines={1} style={[styles.tabLabel, active && styles.tabTextActive]}>{label}</Text>
    </Pressable>
  );
}

function TabGlyph({ active, icon }: { active: boolean; icon: TabIconKey }) {
  const main = active ? '#10120f' : colors.green;
  const frame = {
    backgroundColor: active ? 'rgba(16,18,15,0.06)' : '#1b211a',
    borderColor: active ? 'rgba(16,18,15,0.3)' : 'rgba(155,226,124,0.38)',
  };

  if (icon === 'today') {
    return (
      <View accessible={false} style={[styles.tabGlyphBox, frame]}>
        <View style={styles.tabGlyphSwitchTrack}>
          <Text style={styles.tabGlyphSwitchHeart}>♥</Text>
          <View style={styles.tabGlyphSwitchKnob} />
        </View>
      </View>
    );
  }

  if (icon === 'friends') {
    return (
      <View accessible={false} style={[styles.tabGlyphBox, frame]}>
        <View style={[styles.tabGlyphFriendRing, { left: 5, borderColor: main }]} />
        <View style={[styles.tabGlyphFriendRing, { right: 5, borderColor: main }]} />
        <View style={styles.tabGlyphFriendAccent} />
      </View>
    );
  }

  if (icon === 'todos') {
    return (
      <View accessible={false} style={[styles.tabGlyphBox, frame]}>
        {[0, 1, 2].map((item) => (
          <View key={item} style={[styles.tabGlyphTodoRow, { top: 6 + item * 7 }]}>
            <View style={[styles.tabGlyphTodoDot, { backgroundColor: item === 2 ? colors.red : main }]} />
            <View style={[styles.tabGlyphTodoLine, { backgroundColor: main }]} />
          </View>
        ))}
      </View>
    );
  }

  return (
    <View accessible={false} style={[styles.tabGlyphBox, frame]}>
      <View style={[styles.tabGlyphProfileHead, { backgroundColor: main }]} />
      <View style={[styles.tabGlyphProfileBody, { backgroundColor: main }]} />
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
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
    padding: 22,
  },
  launchKeyboard: {
    flex: 1,
  },
  authLaunch: {
    alignItems: 'center',
    flexGrow: 1,
    justifyContent: 'center',
    paddingBottom: 120,
    paddingHorizontal: 16,
    paddingTop: 22,
  },
  launchCard: {
    backgroundColor: colors.panel,
    borderColor: colors.line,
    borderRadius: 32,
    borderWidth: 1,
    maxWidth: 520,
    padding: 20,
    width: '100%',
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
  authAgreementRow: {
    alignItems: 'flex-start',
    backgroundColor: 'rgba(255,255,255,0.025)',
    borderColor: colors.line,
    borderRadius: 14,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 10,
    marginTop: 16,
    padding: 12,
  },
  authAgreementText: {
    color: colors.muted,
    flex: 1,
    fontSize: 12,
    lineHeight: 20,
  },
  authAgreementLink: {
    color: colors.green,
    fontWeight: '900',
  },
  biometricLoginButton: {
    alignItems: 'center',
    backgroundColor: 'rgba(105, 184, 255, 0.1)',
    borderColor: 'rgba(105, 184, 255, 0.32)',
    borderRadius: 16,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 10,
    justifyContent: 'center',
    marginTop: 10,
    minHeight: 48,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  biometricLoginIcon: {
    color: colors.blue,
    fontSize: 20,
    fontWeight: '900',
  },
  biometricLoginText: {
    color: colors.blue,
    flexShrink: 1,
    fontSize: 14,
    fontWeight: '900',
    lineHeight: 20,
    textAlign: 'center',
  },
  authModeTabs: {
    backgroundColor: colors.panel2,
    borderRadius: 16,
    flexDirection: 'row',
    gap: 4,
    marginBottom: 14,
    padding: 4,
  },
  authModeButton: {
    alignItems: 'center',
    borderRadius: 12,
    flex: 1,
    justifyContent: 'center',
    minHeight: 40,
    paddingHorizontal: 8,
  },
  authModeButtonActive: {
    backgroundColor: colors.green,
  },
  authModeText: {
    color: colors.muted,
    flexShrink: 1,
    fontSize: 13,
    fontWeight: '800',
    textAlign: 'center',
  },
  authModeTextActive: {
    color: '#10120f',
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
  forgotPasswordButton: {
    alignSelf: 'flex-end',
    marginBottom: 12,
    marginTop: -2,
    paddingHorizontal: 2,
    paddingVertical: 4,
  },
  forgotPasswordText: {
    color: colors.green,
    fontSize: 13,
    fontWeight: '800',
  },
  phoneInputWrap: {
    alignItems: 'center',
    backgroundColor: colors.panel2,
    borderColor: colors.line,
    borderRadius: 16,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 10,
    height: 52,
    marginBottom: 12,
    paddingHorizontal: 14,
  },
  phonePrefix: {
    color: colors.green,
    fontSize: 16,
    fontWeight: '900',
  },
  phoneInput: {
    color: colors.text,
    flex: 1,
    fontSize: 16,
    height: 50,
  },
  authHint: {
    color: colors.muted,
    fontSize: 13,
    lineHeight: 20,
    marginBottom: 10,
    marginTop: 12,
  },
  authOptions: {
    gap: 10,
    marginTop: 16,
  },
  authOptionRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 10,
    minHeight: 44,
  },
  authCheckbox: {
    alignItems: 'center',
    borderColor: colors.line,
    borderRadius: 7,
    borderWidth: 1,
    height: 24,
    justifyContent: 'center',
    width: 24,
  },
  authCheckboxChecked: {
    backgroundColor: colors.green,
    borderColor: colors.green,
  },
  authCheckboxText: {
    color: '#10120f',
    fontSize: 15,
    fontWeight: '900',
  },
  authOptionCopy: {
    flex: 1,
  },
  authOptionTitle: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '800',
  },
  authOptionMeta: {
    color: colors.muted,
    fontSize: 11,
    marginTop: 2,
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
    alignSelf: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    maxWidth: 680,
    paddingHorizontal: 22,
    paddingTop: 16,
    paddingBottom: 14,
    width: '100%',
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
    alignSelf: 'center',
    maxWidth: 680,
    paddingHorizontal: 18,
    paddingBottom: 18,
    width: '100%',
  },
  stack: {
    gap: 14,
    width: '100%',
  },
  heroCard: {
    backgroundColor: '#22211e',
    borderColor: 'rgba(255,255,255,0.1)',
    borderRadius: 32,
    borderWidth: 1,
    minHeight: 300,
    overflow: 'visible',
    padding: 20,
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
    position: 'relative',
  },
  pulseMark: {
    alignItems: 'center',
    backgroundColor: 'rgba(155,226,124,0.13)',
    borderRadius: 28,
    flexShrink: 0,
    height: 78,
    justifyContent: 'center',
    width: 78,
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
    height: 78,
    justifyContent: 'center',
    paddingHorizontal: 12,
    paddingVertical: 9,
    width: '100%',
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
    flex: 1,
    maxWidth: 150,
    minHeight: 78,
    minWidth: 0,
    position: 'relative',
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
    gap: 8,
  },
  metricCard: {
    backgroundColor: colors.panel,
    borderColor: colors.line,
    borderRadius: 20,
    borderWidth: 1,
    flex: 1,
    minWidth: 0,
    padding: 12,
  },
  metricValue: {
    color: colors.text,
    fontSize: 21,
    fontWeight: '800',
    marginTop: 8,
  },
  metricLabel: {
    color: colors.muted,
    fontSize: 12,
    lineHeight: 17,
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
    gap: 12,
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  sectionTitle: {
    color: colors.text,
    flexShrink: 1,
    fontSize: 16,
    fontWeight: '800',
  },
  sectionMeta: {
    color: colors.muted,
    flexShrink: 1,
    fontSize: 13,
    textAlign: 'right',
  },
  sectionHeadCopy: {
    flex: 1,
    minWidth: 0,
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
  journalSectionHead: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12,
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  journalSectionMeta: {
    color: colors.soft,
    fontSize: 12,
    marginTop: 4,
  },
  journalEditButton: {
    alignItems: 'center',
    backgroundColor: 'rgba(155,226,124,0.12)',
    borderColor: 'rgba(155,226,124,0.32)',
    borderRadius: 12,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: 36,
    minWidth: 64,
    paddingHorizontal: 14,
    flexShrink: 0,
  },
  journalEditButtonText: {
    color: colors.green,
    fontSize: 13,
    fontWeight: '900',
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
  journalInputReadOnly: {
    backgroundColor: 'rgba(255,255,255,0.025)',
    borderColor: 'rgba(255,255,255,0.07)',
    color: colors.muted,
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
    flexWrap: 'wrap',
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
    minHeight: 46,
    justifyContent: 'center',
    paddingHorizontal: 8,
    paddingVertical: 8,
  },
  diaryButtonText: {
    color: colors.green,
    fontSize: 13,
    fontWeight: '800',
  },
  todayActionRow: {
    alignItems: 'stretch',
    flexDirection: 'row',
    gap: 10,
    marginTop: 12,
  },
  todayActionButton: {
    flex: 1,
    marginTop: 0,
  },
  shareButton: {
    alignItems: 'center',
    backgroundColor: 'rgba(155,226,124,0.12)',
    borderColor: 'rgba(155,226,124,0.32)',
    borderRadius: 14,
    borderWidth: 1,
    minHeight: 46,
    justifyContent: 'center',
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  shareButtonText: {
    color: colors.green,
    fontSize: 12,
    fontWeight: '900',
    lineHeight: 18,
    textAlign: 'center',
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
    paddingVertical: 8,
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
    minWidth: 0,
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
    lineHeight: 21,
    minWidth: 0,
  },
  todoTextDone: {
    color: colors.muted,
    textDecorationLine: 'line-through',
  },
  todoImportantButton: {
    borderColor: colors.line,
    borderRadius: 999,
    borderWidth: 1,
    flexShrink: 0,
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
    padding: 14,
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
    includeFontPadding: false,
    lineHeight: 22,
    minHeight: 44,
    minWidth: 0,
    paddingHorizontal: 0,
    paddingVertical: 0,
    textAlignVertical: 'center',
  },
  friendPhoneInputWrap: {
    alignItems: 'center',
    flex: 1,
    flexDirection: 'row',
    gap: 8,
    minHeight: 44,
    minWidth: 0,
  },
  friendPhonePrefix: {
    color: colors.green,
    flexShrink: 0,
    fontSize: 15,
    fontWeight: '900',
    includeFontPadding: false,
    lineHeight: 22,
  },
  smallButton: {
    alignItems: 'center',
    backgroundColor: colors.green,
    borderRadius: 14,
    flexShrink: 0,
    justifyContent: 'center',
    minHeight: 44,
    paddingHorizontal: 13,
    paddingVertical: 11,
  },
  smallButtonText: {
    color: '#10120f',
    fontSize: 15,
    fontWeight: '800',
    includeFontPadding: false,
    lineHeight: 22,
    textAlign: 'center',
  },
  inviteShareCard: {
    alignItems: 'center',
    backgroundColor: 'rgba(155,226,124,0.1)',
    borderColor: 'rgba(155,226,124,0.24)',
    borderRadius: 20,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 12,
    justifyContent: 'space-between',
    minHeight: 64,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  inviteShareCopy: {
    flex: 1,
    minWidth: 0,
  },
  inviteShareTitle: {
    color: colors.green,
    fontSize: 15,
    fontWeight: '900',
    lineHeight: 21,
  },
  inviteShareMeta: {
    color: colors.muted,
    fontSize: 12,
    lineHeight: 18,
    marginTop: 4,
  },
  inviteShareArrow: {
    color: colors.green,
    flexShrink: 0,
    fontSize: 24,
    fontWeight: '900',
  },
  summaryCard: {
    alignItems: 'flex-end',
    backgroundColor: '#202630',
    borderColor: 'rgba(255,255,255,0.1)',
    borderRadius: 28,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 16,
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
    flexShrink: 1,
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
    gap: 10,
    padding: 12,
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
    flexShrink: 0,
    height: 44,
    justifyContent: 'center',
    overflow: 'hidden',
    width: 44,
  },
  avatarImage: {
    height: '100%',
    width: '100%',
  },
  avatarText: {
    color: '#141414',
    fontSize: 18,
    fontWeight: '900',
  },
  friendBody: {
    flex: 1,
    minWidth: 0,
  },
  friendTop: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 8,
  },
  friendName: {
    color: colors.text,
    flex: 1,
    fontSize: 15,
    fontWeight: '800',
    minWidth: 0,
  },
  friendPhone: {
    color: colors.soft,
    fontSize: 11,
    marginTop: 3,
  },
  friendSignal: {
    alignItems: 'center',
    borderRadius: 10,
    flexDirection: 'row',
    gap: 6,
    marginVertical: 6,
    paddingHorizontal: 8,
    paddingVertical: 5,
  },
  friendSignalPending: {
    backgroundColor: 'rgba(255,209,102,0.09)',
  },
  friendSignalReplied: {
    backgroundColor: 'rgba(155,226,124,0.1)',
  },
  friendSignalDot: {
    borderRadius: 999,
    height: 5,
    width: 5,
  },
  friendSignalDotPending: {
    backgroundColor: colors.yellow,
  },
  friendSignalDotReplied: {
    backgroundColor: colors.green,
  },
  friendSignalText: {
    color: colors.yellow,
    flex: 1,
    fontSize: 11,
    fontWeight: '700',
  },
  friendSignalTextReplied: {
    color: colors.green,
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
    minWidth: 64,
    paddingHorizontal: 8,
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
    flexShrink: 0,
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
    minWidth: 0,
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
    minWidth: 0,
  },
  pokeNoticeMeta: {
    color: colors.muted,
    fontSize: 12,
    marginTop: 3,
  },
  tinyButton: {
    backgroundColor: colors.green,
    borderRadius: 12,
    flexShrink: 0,
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
    flexShrink: 0,
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
    alignItems: 'center',
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
    fontSize: 14,
    height: 46,
    includeFontPadding: false,
    lineHeight: 20,
    minWidth: 0,
    paddingHorizontal: 14,
    paddingVertical: 0,
    textAlignVertical: 'center',
  },
  addButton: {
    alignItems: 'center',
    backgroundColor: colors.green,
    borderRadius: 16,
    height: 46,
    justifyContent: 'center',
    flexShrink: 0,
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
    fontSize: 14,
    fontWeight: '900',
    includeFontPadding: false,
    lineHeight: 20,
    textAlign: 'center',
  },
  quoteCardInput: {
    color: colors.text,
    fontSize: 21,
    fontWeight: '700',
    lineHeight: 34,
    minHeight: 104,
    paddingHorizontal: 0,
    paddingBottom: 8,
    paddingTop: 2,
  },
  quoteSheet: {
    backgroundColor: '#252b23',
    borderColor: '#3e4c38',
    borderRadius: 20,
    borderWidth: 1,
    paddingHorizontal: 18,
    paddingTop: 17,
    paddingBottom: 15,
  },
  quoteSheetHeader: {
    marginBottom: 12,
  },
  quoteSheetKicker: {
    color: colors.green,
    flexShrink: 1,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1,
  },
  quoteDisplayText: {
    color: colors.text,
    fontSize: 21,
    fontWeight: '700',
    lineHeight: 35,
    minHeight: 104,
    paddingBottom: 8,
    paddingTop: 2,
  },
  quoteSheetFooter: {
    alignItems: 'center',
    borderTopColor: '#455241',
    borderTopWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 8,
    paddingTop: 12,
  },
  quoteSheetMeta: {
    color: '#a8b8a1',
    flexShrink: 1,
    fontSize: 11,
  },
  quoteSheetStatus: {
    color: '#a8b8a1',
    flexShrink: 0,
    fontSize: 11,
  },
  quoteSheetStatusSaved: {
    color: colors.green,
    fontWeight: '800',
  },
  quoteHint: {
    color: '#a8b49f',
    fontSize: 12,
    lineHeight: 19,
    marginTop: 10,
  },
  quoteActionRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 10,
    marginTop: 12,
  },
  quoteActionButton: {
    alignItems: 'center',
    backgroundColor: colors.green,
    borderRadius: 13,
    flex: 1,
    justifyContent: 'center',
    minHeight: 44,
    paddingHorizontal: 12,
  },
  quoteActionButtonText: {
    color: '#10120f',
    fontSize: 14,
    fontWeight: '900',
  },
  quoteShuffleButton: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 44,
    paddingHorizontal: 10,
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
  dailyEncouragementLabel: {
    color: colors.green,
    fontSize: 12,
    fontWeight: '900',
    marginBottom: 5,
  },
  profileCard: {
    alignItems: 'center',
    backgroundColor: '#29261f',
    borderColor: colors.line,
    borderRadius: 32,
    borderWidth: 1,
    padding: 20,
  },
  profileAvatar: {
    alignItems: 'center',
    backgroundColor: colors.yellow,
    borderRadius: 18,
    height: 54,
    justifyContent: 'center',
    marginBottom: 6,
    overflow: 'hidden',
    position: 'relative',
    width: 54,
  },
  profileAvatarImage: {
    height: '100%',
    width: '100%',
  },
  avatarLoadingOverlay: {
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.56)',
    bottom: 0,
    justifyContent: 'center',
    left: 0,
    position: 'absolute',
    right: 0,
    top: 0,
  },
  profileAvatarHint: {
    color: colors.green,
    fontSize: 12,
    fontWeight: '800',
    marginBottom: 12,
  },
  profileName: {
    color: colors.text,
    fontSize: 24,
    fontWeight: '900',
    marginBottom: 6,
    maxWidth: '100%',
  },
  profilePhone: {
    color: colors.soft,
    fontSize: 12,
    marginBottom: 8,
  },
  profileStats: {
    flexDirection: 'row',
    gap: 8,
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
    minWidth: 0,
    paddingHorizontal: 4,
    paddingVertical: 11,
  },
  profileStatValue: {
    color: colors.text,
    fontSize: 20,
    fontWeight: '900',
    maxWidth: '100%',
  },
  profileStatLabel: {
    color: colors.muted,
    fontSize: 11,
    marginTop: 3,
    maxWidth: '100%',
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
    justifyContent: 'space-between',
  },
  weekText: {
    color: colors.soft,
    fontSize: 12,
    fontWeight: '800',
    lineHeight: 18,
    textAlign: 'center',
    width: '13%',
  },
  monthCalendar: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    rowGap: 8,
  },
  calendarCell: {
    alignItems: 'center',
    backgroundColor: colors.panel2,
    borderColor: colors.line,
    borderRadius: 12,
    borderWidth: 1,
    height: 42,
    justifyContent: 'flex-start',
    paddingTop: 5,
    width: '13%',
  },
  calendarCellBlank: {
    backgroundColor: 'transparent',
    borderColor: 'transparent',
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
    lineHeight: 18,
  },
  calendarCellTextActive: {
    color: colors.text,
  },
  calendarCellTextSelected: {
    color: colors.bg,
  },
  calendarIndicatorSlot: {
    alignItems: 'center',
    height: 8,
    justifyContent: 'center',
    marginTop: 3,
  },
  calendarDot: {
    backgroundColor: colors.green,
    borderRadius: 999,
    height: 5,
    width: 5,
  },
  calendarDotSelected: {
    backgroundColor: colors.bg,
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
  appFilingLink: {
    alignItems: 'center',
    minHeight: 44,
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  appFilingText: {
    color: colors.muted,
    fontSize: 12,
    lineHeight: 20,
    textAlign: 'center',
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
    gap: 8,
    justifyContent: 'space-between',
    minHeight: 24,
  },
  diaryEntryHeadExpanded: {
    marginBottom: 10,
  },
  diaryEntryDate: {
    color: colors.green,
    flex: 1,
    fontSize: 13,
    fontWeight: '900',
    includeFontPadding: false,
    lineHeight: 20,
  },
  diaryEntryMeta: {
    color: colors.soft,
    flexShrink: 1,
    fontSize: 11,
    fontWeight: '800',
    includeFontPadding: false,
    lineHeight: 20,
    textAlign: 'right',
  },
  diaryEntryArrowWrap: {
    alignItems: 'center',
    flexShrink: 0,
    height: 20,
    justifyContent: 'center',
    width: 20,
  },
  diaryEntryArrow: {
    borderBottomWidth: 2,
    borderColor: colors.green,
    borderRightWidth: 2,
    height: 8,
    transform: [{ translateY: -2 }, { rotate: '45deg' }],
    width: 8,
  },
  diaryEntryArrowExpanded: {
    transform: [{ translateY: 2 }, { rotate: '225deg' }],
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
  accountDeleteItem: {
    borderColor: 'rgba(255,31,61,0.32)',
    justifyContent: 'space-between',
    minHeight: 68,
  },
  accountDeleteCopy: {
    flex: 1,
    marginRight: 12,
    minWidth: 0,
  },
  accountDeleteText: {
    color: '#ff6b78',
    fontSize: 15,
    fontWeight: '900',
  },
  accountDeleteMeta: {
    color: colors.muted,
    fontSize: 12,
    lineHeight: 18,
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
    fontSize: 13,
    lineHeight: 20,
  },
  messagePanel: {
    backgroundColor: colors.panel,
    borderColor: 'rgba(105, 184, 255, 0.28)',
    borderRadius: 22,
    borderWidth: 1,
    gap: 12,
    padding: 16,
  },
  messageCollapseHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12,
    justifyContent: 'space-between',
    minHeight: 48,
  },
  messageCollapseCopy: {
    flex: 1,
    minWidth: 0,
  },
  messageCollapseAction: {
    alignItems: 'center',
    flexDirection: 'row',
    flexShrink: 0,
    gap: 6,
  },
  messageCollapseText: {
    color: colors.blue,
    fontSize: 13,
    fontWeight: '900',
  },
  messageCollapseIcon: {
    color: colors.blue,
    fontSize: 18,
    fontWeight: '900',
    lineHeight: 20,
  },
  messageCollapsedHint: {
    color: colors.muted,
    fontSize: 12,
    marginTop: 4,
  },
  messageCard: {
    backgroundColor: colors.panel2,
    borderColor: colors.line,
    borderRadius: 18,
    borderWidth: 1,
    gap: 10,
    padding: 12,
  },
  messageCardHead: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  messageCardTitle: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '900',
  },
  messageRemoveText: {
    color: '#ff8b8b',
    fontSize: 13,
    fontWeight: '800',
  },
  messageRecipientInput: {
    backgroundColor: colors.panel,
    borderColor: colors.line,
    borderRadius: 14,
    borderWidth: 1,
    color: colors.text,
    fontSize: 14,
    minHeight: 44,
    paddingHorizontal: 12,
  },
  messageInput: {
    backgroundColor: colors.panel2,
    borderColor: colors.line,
    borderRadius: 16,
    borderWidth: 1,
    color: colors.text,
    fontSize: 14,
    lineHeight: 20,
    minHeight: 120,
    paddingHorizontal: 13,
    paddingVertical: 12,
  },
  savedHint: {
    color: colors.soft,
    flex: 1,
    fontSize: 12,
    lineHeight: 18,
    minWidth: 0,
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
  messageAddButton: {
    alignItems: 'center',
    backgroundColor: 'rgba(105, 184, 255, 0.1)',
    borderColor: 'rgba(105, 184, 255, 0.32)',
    borderRadius: 16,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: 44,
  },
  messageAddButtonText: {
    color: colors.blue,
    fontSize: 14,
    fontWeight: '900',
  },
  messageActionRow: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: 12,
  },
  messageSaveButton: {
    alignItems: 'center',
    backgroundColor: 'rgba(105, 184, 255, 0.18)',
    borderColor: 'rgba(105, 184, 255, 0.42)',
    borderRadius: 14,
    borderWidth: 1,
    height: 42,
    justifyContent: 'center',
    paddingHorizontal: 20,
    flexShrink: 0,
  },
  messageSaveButtonText: {
    color: colors.blue,
    fontSize: 14,
    fontWeight: '900',
  },
  trusteeEntryCard: {
    alignItems: 'center',
    backgroundColor: '#25231f',
    borderColor: 'rgba(255,209,102,0.28)',
    borderRadius: 22,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 10,
    minHeight: 112,
    padding: 14,
  },
  trusteeEntryCardPressed: {
    opacity: 0.72,
  },
  trusteeEntryMark: {
    alignItems: 'center',
    backgroundColor: 'rgba(255,209,102,0.13)',
    borderColor: 'rgba(255,209,102,0.32)',
    borderRadius: 18,
    borderWidth: 1,
    flexShrink: 0,
    height: 48,
    justifyContent: 'center',
    width: 48,
  },
  trusteeEntryMarkText: {
    color: colors.yellow,
    fontSize: 22,
    fontWeight: '900',
  },
  trusteeEntryBody: {
    flex: 1,
    minWidth: 0,
  },
  trusteeEntryTitleRow: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  trusteeEntryTitle: {
    color: colors.text,
    fontSize: 17,
    fontWeight: '900',
  },
  trusteeEntryBadge: {
    backgroundColor: 'rgba(155,226,124,0.1)',
    borderColor: 'rgba(155,226,124,0.24)',
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  trusteeEntryBadgeText: {
    color: colors.green,
    fontSize: 10,
    fontWeight: '900',
  },
  trusteeEntryCopy: {
    color: colors.muted,
    fontSize: 13,
    lineHeight: 19,
    marginTop: 7,
  },
  trusteeEntryMeta: {
    color: colors.soft,
    fontSize: 11,
    marginTop: 5,
  },
  trusteeEntryArrow: {
    color: colors.yellow,
    flexShrink: 0,
    fontSize: 30,
    fontWeight: '400',
    lineHeight: 32,
  },
  trusteePage: {
    backgroundColor: colors.bg,
    flex: 1,
  },
  trusteePageHeader: {
    alignItems: 'center',
    borderBottomColor: colors.line,
    borderBottomWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    maxWidth: 680,
    minHeight: 72,
    paddingHorizontal: 20,
    alignSelf: 'center',
    width: '100%',
  },
  trusteePageEyebrow: {
    color: colors.soft,
    fontSize: 11,
    fontWeight: '800',
    marginBottom: 3,
  },
  trusteePageHeaderTitle: {
    color: colors.text,
    fontSize: 20,
    fontWeight: '900',
  },
  trusteeCloseButton: {
    alignItems: 'center',
    borderColor: colors.line,
    borderRadius: 999,
    borderWidth: 1,
    height: 38,
    justifyContent: 'center',
    paddingHorizontal: 14,
  },
  trusteeCloseButtonText: {
    color: colors.muted,
    fontSize: 13,
    fontWeight: '800',
  },
  trusteePageContent: {
    alignSelf: 'center',
    gap: 16,
    maxWidth: 680,
    padding: 18,
    paddingBottom: 44,
    width: '100%',
  },
  trusteeHero: {
    backgroundColor: '#25231f',
    borderColor: 'rgba(255,209,102,0.25)',
    borderRadius: 28,
    borderWidth: 1,
    padding: 20,
  },
  trusteeStatusPill: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(155,226,124,0.08)',
    borderColor: 'rgba(155,226,124,0.2)',
    borderRadius: 999,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 7,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  trusteeStatusDot: {
    backgroundColor: colors.green,
    borderRadius: 999,
    height: 6,
    width: 6,
  },
  trusteeStatusText: {
    color: colors.green,
    fontSize: 11,
    fontWeight: '900',
  },
  trusteeHeroTitle: {
    color: colors.text,
    fontSize: 29,
    fontWeight: '900',
    letterSpacing: -0.6,
    lineHeight: 38,
    marginTop: 18,
    maxWidth: 500,
  },
  trusteeHeroCopy: {
    color: colors.muted,
    fontSize: 14,
    lineHeight: 23,
    marginTop: 12,
  },
  trusteeOfflineNote: {
    backgroundColor: 'rgba(132,197,244,0.07)',
    borderColor: 'rgba(132,197,244,0.18)',
    borderRadius: 16,
    borderWidth: 1,
    marginTop: 16,
    padding: 12,
  },
  trusteeOfflineNoteText: {
    color: colors.blue,
    fontSize: 12,
    fontWeight: '700',
    lineHeight: 19,
  },
  trusteeSection: {
    backgroundColor: colors.panel,
    borderColor: colors.line,
    borderRadius: 24,
    borderWidth: 1,
    padding: 17,
  },
  trusteeSectionKicker: {
    color: colors.yellow,
    fontSize: 11,
    fontWeight: '900',
  },
  trusteeSectionTitle: {
    color: colors.text,
    fontSize: 18,
    fontWeight: '900',
    marginBottom: 14,
    marginTop: 5,
  },
  trusteeScopeRow: {
    alignItems: 'flex-start',
    borderTopColor: colors.line,
    borderTopWidth: 1,
    flexDirection: 'row',
    gap: 12,
    paddingVertical: 13,
  },
  trusteeScopeMark: {
    color: colors.yellow,
    fontSize: 12,
    fontWeight: '900',
    paddingTop: 2,
    width: 24,
  },
  trusteeScopeBody: {
    flex: 1,
  },
  trusteeScopeTitle: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '900',
  },
  trusteeScopeCopy: {
    color: colors.muted,
    fontSize: 13,
    lineHeight: 20,
    marginTop: 5,
  },
  trusteeStepRow: {
    alignItems: 'stretch',
    flexDirection: 'row',
    gap: 12,
    minHeight: 74,
  },
  trusteeStepRail: {
    alignItems: 'center',
    width: 28,
  },
  trusteeStepNumber: {
    alignItems: 'center',
    backgroundColor: 'rgba(255,209,102,0.12)',
    borderColor: 'rgba(255,209,102,0.3)',
    borderRadius: 999,
    borderWidth: 1,
    height: 28,
    justifyContent: 'center',
    width: 28,
  },
  trusteeStepNumberText: {
    color: colors.yellow,
    fontSize: 11,
    fontWeight: '900',
  },
  trusteeStepLine: {
    backgroundColor: 'rgba(255,209,102,0.18)',
    flex: 1,
    width: 1,
  },
  trusteeStepBody: {
    flex: 1,
    paddingBottom: 16,
    paddingTop: 3,
  },
  trusteeStepTitle: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '900',
  },
  trusteeStepCopy: {
    color: colors.muted,
    fontSize: 13,
    lineHeight: 19,
    marginTop: 5,
  },
  trusteeSafetyCard: {
    backgroundColor: 'rgba(255,31,61,0.065)',
    borderColor: 'rgba(255,107,120,0.24)',
    borderRadius: 24,
    borderWidth: 1,
    padding: 17,
  },
  trusteeSafetyLabel: {
    color: '#ff8b95',
    fontSize: 11,
    fontWeight: '900',
  },
  trusteeSafetyTitle: {
    color: colors.text,
    fontSize: 18,
    fontWeight: '900',
    marginTop: 6,
  },
  trusteeSafetyCopy: {
    color: '#c5b8b8',
    fontSize: 13,
    lineHeight: 21,
    marginTop: 9,
  },
  trusteeContactCard: {
    backgroundColor: '#22271f',
    borderColor: 'rgba(155,226,124,0.28)',
    borderRadius: 24,
    borderWidth: 1,
    padding: 17,
  },
  trusteeContactLabel: {
    color: colors.green,
    fontSize: 11,
    fontWeight: '900',
  },
  trusteeContactEmail: {
    color: colors.text,
    flexShrink: 1,
    fontSize: 18,
    fontWeight: '900',
    marginTop: 7,
  },
  trusteeContactHint: {
    color: colors.muted,
    fontSize: 12,
    lineHeight: 19,
    marginTop: 9,
  },
  trusteeContactButton: {
    alignItems: 'center',
    backgroundColor: colors.green,
    borderRadius: 16,
    flexDirection: 'row',
    justifyContent: 'center',
    marginTop: 16,
    minHeight: 50,
    paddingHorizontal: 16,
  },
  trusteeContactButtonPressed: {
    opacity: 0.72,
  },
  trusteeContactButtonText: {
    color: colors.bg,
    fontSize: 14,
    fontWeight: '900',
  },
  trusteeContactButtonArrow: {
    color: colors.bg,
    fontSize: 17,
    fontWeight: '900',
    marginLeft: 8,
  },
  trusteeDisclaimer: {
    color: colors.soft,
    fontSize: 11,
    lineHeight: 18,
    paddingHorizontal: 6,
    textAlign: 'center',
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
    alignItems: 'center',
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
    maxWidth: 520,
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
    maxWidth: 560,
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
  todayDiaryActions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 12,
  },
  todayDiaryClose: {
    alignItems: 'center',
    backgroundColor: colors.green,
    borderRadius: 16,
    flex: 1,
    height: 46,
    justifyContent: 'center',
  },
  todayDiaryGhost: {
    alignItems: 'center',
    borderColor: colors.line,
    borderRadius: 16,
    borderWidth: 1,
    flex: 1,
    height: 46,
    justifyContent: 'center',
  },
  todayDiaryGhostText: {
    color: colors.muted,
    fontSize: 14,
    fontWeight: '800',
  },
  weatherPickerPanel: {
    backgroundColor: colors.panel,
    borderColor: colors.line,
    borderRadius: 24,
    borderWidth: 1,
    maxWidth: 520,
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
    alignSelf: 'center',
    backgroundColor: colors.bg,
    borderTopColor: colors.line,
    borderTopWidth: 1,
    flexDirection: 'row',
    gap: 6,
    maxWidth: 680,
    paddingHorizontal: 12,
    paddingTop: 12,
    paddingBottom: Platform.OS === 'android' ? 28 : 16,
    width: '100%',
  },
  tabButton: {
    alignItems: 'center',
    borderRadius: 18,
    flex: 1,
    gap: 4,
    height: 54,
    justifyContent: 'center',
    minWidth: 0,
  },
  tabButtonActive: {
    backgroundColor: colors.green,
  },
  tabIconWrap: {
    alignItems: 'center',
    height: 32,
    justifyContent: 'center',
    position: 'relative',
    width: 32,
  },
  tabGlyphBox: {
    borderRadius: 10,
    borderWidth: 1,
    height: 32,
    position: 'relative',
    width: 32,
  },
  tabGlyphSwitchTrack: {
    backgroundColor: colors.green,
    borderRadius: 7,
    height: 12,
    left: 4,
    position: 'absolute',
    top: 9,
    width: 22,
  },
  tabGlyphSwitchHeart: {
    color: colors.red,
    fontSize: 9,
    fontWeight: '900',
    height: 10,
    includeFontPadding: false,
    left: 1,
    lineHeight: 10,
    position: 'absolute',
    textAlign: 'center',
    top: 1,
    width: 10,
  },
  tabGlyphSwitchKnob: {
    backgroundColor: '#10120f',
    borderColor: 'rgba(255,255,255,0.18)',
    borderRadius: 5,
    borderWidth: 1,
    height: 10,
    position: 'absolute',
    right: 1,
    top: 1,
    width: 10,
  },
  tabGlyphFriendRing: {
    borderRadius: 6,
    borderWidth: 2,
    height: 12,
    position: 'absolute',
    top: 10,
    width: 12,
  },
  tabGlyphFriendAccent: {
    backgroundColor: colors.red,
    borderRadius: 3,
    height: 5,
    left: 18,
    position: 'absolute',
    top: 4,
    width: 5,
  },
  tabGlyphTodoRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 4,
    height: 4,
    left: 6,
    position: 'absolute',
    width: 18,
  },
  tabGlyphTodoDot: {
    borderRadius: 2,
    height: 4,
    width: 4,
  },
  tabGlyphTodoLine: {
    borderRadius: 1,
    height: 2,
    width: 10,
  },
  tabGlyphProfileHead: {
    borderRadius: 4,
    height: 8,
    left: 11,
    position: 'absolute',
    top: 6,
    width: 8,
  },
  tabGlyphProfileBody: {
    borderBottomLeftRadius: 3,
    borderBottomRightRadius: 3,
    borderTopLeftRadius: 8,
    borderTopRightRadius: 8,
    height: 8,
    left: 7,
    position: 'absolute',
    top: 17,
    width: 16,
  },
  tabGlyphProfileHeart: {
    color: colors.red,
    fontSize: 9,
    fontWeight: '900',
    height: 10,
    includeFontPadding: false,
    left: 16,
    lineHeight: 10,
    position: 'absolute',
    textAlign: 'center',
    top: 9,
    width: 10,
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
    fontSize: 12,
    includeFontPadding: false,
    lineHeight: 16,
  },
  tabTextActive: {
    color: '#10120f',
    fontWeight: '800',
  },
});
