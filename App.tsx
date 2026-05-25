import { StatusBar } from 'expo-status-bar';
import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import type { Session } from '@supabase/supabase-js';

import { createTodo, ensureProfile, loadAppSnapshot, saveCheckin, updateTodoDone } from './src/lib/appApi';
import { sendLoginLink, signOut } from './src/lib/authApi';
import { demoSnapshot } from './src/lib/mockData';
import { hasSupabaseConfig, supabase } from './src/lib/supabase';
import type { AppSnapshot, Friend, Todo } from './src/lib/types';

type TabKey = 'today' | 'friends' | 'todos' | 'profile';

const notes = [
  '我还活着，今天也算数。',
  '精神一般，但人还在线。',
  '今天想做一个低电量的人。',
  '苟住了，奖励自己早点睡。',
];

export default function App() {
  const [tab, setTab] = useState<TabKey>('today');
  const [snapshot, setSnapshot] = useState<AppSnapshot>(demoSnapshot);
  const [draft, setDraft] = useState('');
  const [demoMode, setDemoMode] = useState(!hasSupabaseConfig);
  const [session, setSession] = useState<Session | null>(null);

  const checkedIn = snapshot.checkedIn;
  const statusText = snapshot.statusText;
  const todos = snapshot.todos;
  const friends = snapshot.friends;
  const aliveDays = snapshot.aliveDays;
  const streak = snapshot.streak;

  const todayLabel = useMemo(() => {
    return new Intl.DateTimeFormat('zh-CN', {
      month: 'long',
      day: 'numeric',
      weekday: 'long',
    }).format(new Date());
  }, []);

  const doneCount = todos.filter((todo) => todo.done).length;
  const userId = session?.user.id;

  useEffect(() => {
    if (!hasSupabaseConfig) return;

    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: subscription } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
    });

    return () => subscription.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!userId || demoMode) return;

    const emailName = session?.user.email?.split('@')[0] || '新朋友';

    ensureProfile(userId, emailName)
      .then(() => loadAppSnapshot(userId))
      .then(setSnapshot)
      .catch((error) => Alert.alert('同步失败', error.message));
  }, [demoMode, session?.user.email, userId]);

  async function handleCheckin() {
    setSnapshot((current) => ({
      ...current,
      aliveDays: current.checkedIn ? current.aliveDays : current.aliveDays + 1,
      checkedIn: true,
      streak: current.checkedIn ? current.streak : current.streak + 1,
    }));

    if (!userId || demoMode) return;

    try {
      await saveCheckin(userId, statusText);
    } catch (error) {
      Alert.alert('打卡失败', error instanceof Error ? error.message : '请稍后再试');
    }
  }

  async function toggleTodo(id: string) {
    const target = todos.find((todo) => todo.id === id);
    if (!target) return;

    setSnapshot((current) => ({
      ...current,
      todos: current.todos.map((item) => (item.id === id ? { ...item, done: !item.done } : item)),
    }));

    if (!userId || demoMode) return;

    try {
      await updateTodoDone(id, !target.done);
    } catch (error) {
      Alert.alert('更新失败', error instanceof Error ? error.message : '请稍后再试');
    }
  }

  async function addTodo() {
    const text = draft.trim();
    if (!text || todos.length >= 3) return;

    if (userId && !demoMode) {
      try {
        const todo = await createTodo(userId, text);
        setSnapshot((current) => ({ ...current, todos: [...current.todos, todo] }));
      } catch (error) {
        Alert.alert('添加失败', error instanceof Error ? error.message : '请稍后再试');
        return;
      }
    } else {
      setSnapshot((current) => ({
        ...current,
        todos: [...current.todos, { id: String(Date.now()), text, done: false }],
      }));
    }

    setDraft('');
  }

  function updateStatusText(value: string) {
    setSnapshot((current) => ({ ...current, statusText: value }));
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
          <Pressable style={styles.iconButton}>
            <Text style={styles.iconText}>!</Text>
          </Pressable>
        </View>

        <ScrollView style={styles.content} contentContainerStyle={styles.contentInner} showsVerticalScrollIndicator={false}>
          {tab === 'today' && (
            <TodayScreen
              aliveDays={aliveDays}
              checkedIn={checkedIn}
              doneCount={doneCount}
              onCheckin={handleCheckin}
              setStatusText={updateStatusText}
              statusText={statusText}
              streak={streak}
              todos={todos}
              toggleTodo={toggleTodo}
            />
          )}
          {tab === 'friends' && <FriendsScreen friends={friends} />}
          {tab === 'todos' && (
            <TodosScreen
              addTodo={addTodo}
              draft={draft}
              setDraft={setDraft}
              todos={todos}
              toggleTodo={toggleTodo}
            />
          )}
          {tab === 'profile' && (
            <ProfileScreen
              aliveDays={aliveDays}
              checkedIn={checkedIn}
              isDemo={demoMode}
              onSignOut={async () => {
                if (demoMode) {
                  setDemoMode(false);
                  return;
                }
                await signOut();
              }}
              streak={streak}
            />
          )}
        </ScrollView>

        <View style={styles.tabbar}>
          <TabButton active={tab === 'today'} label="今天" icon="⌂" onPress={() => setTab('today')} />
          <TabButton active={tab === 'friends'} label="好友" icon="◎" onPress={() => setTab('friends')} />
          <TabButton active={tab === 'todos'} label="待办" icon="□" onPress={() => setTab('todos')} />
          <TabButton active={tab === 'profile'} label="我" icon="○" onPress={() => setTab('profile')} />
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
  const [email, setEmail] = useState('');
  const [sending, setSending] = useState(false);

  async function submit() {
    const value = email.trim();
    if (!value) return;

    setSending(true);
    try {
      await sendLoginLink(value);
      Alert.alert('邮件已发送', '打开邮箱里的登录链接，就能进入活着吗。');
    } catch (error) {
      Alert.alert('发送失败', error instanceof Error ? error.message : '请稍后再试');
    } finally {
      setSending(false);
    }
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar style="light" />
      <View style={styles.launch}>
        <View style={styles.launchCard}>
          <Text style={styles.launchKicker}>欢迎回来</Text>
          <Text style={styles.launchTitle}>今天，活着吗？</Text>
          <Text style={styles.launchCopy}>输入邮箱获取登录链接。第一版先用邮箱验证码，省掉密码，也更适合 MVP。</Text>
          <TextInput
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            onChangeText={setEmail}
            placeholder="you@example.com"
            placeholderTextColor="#777268"
            style={styles.authInput}
            value={email}
          />
          <Pressable disabled={sending || !email.trim()} style={[styles.primaryButton, (sending || !email.trim()) && styles.disabledButton]} onPress={submit}>
            <Text style={styles.primaryButtonText}>{sending ? '发送中' : '发送登录链接'}</Text>
          </Pressable>
          <Pressable style={styles.secondaryButton} onPress={onUseDemo}>
            <Text style={styles.secondaryButtonText}>先看演示模式</Text>
          </Pressable>
        </View>
      </View>
    </SafeAreaView>
  );
}

function TodayScreen({
  aliveDays,
  checkedIn,
  doneCount,
  onCheckin,
  setStatusText,
  statusText,
  streak,
  todos,
  toggleTodo,
}: {
  aliveDays: number;
  checkedIn: boolean;
  doneCount: number;
  onCheckin: () => void;
  setStatusText: (value: string) => void;
  statusText: string;
  streak: number;
  todos: Todo[];
  toggleTodo: (id: string) => void;
}) {
  return (
    <View style={styles.stack}>
      <View style={[styles.heroCard, checkedIn && styles.heroCardChecked]}>
        <View style={styles.pulseMark}>
          <Text style={styles.pulseIcon}>♡</Text>
        </View>
        <Text style={styles.heroKicker}>{checkedIn ? '今日已确认' : '今日还没确认'}</Text>
        <Text style={styles.heroTitle}>{checkedIn ? '你今天也在。' : '今天，活着吗？'}</Text>
        <Text style={styles.heroCopy}>
          {checkedIn ? statusText : '点一下，不解释，不汇报。只是给自己留个小小的信号。'}
        </Text>
        <Pressable style={styles.primaryButton} onPress={onCheckin}>
          <Text style={styles.primaryButtonText}>{checkedIn ? '已确认存活' : '我还活着'}</Text>
        </Pressable>
      </View>

      <View style={styles.metricsGrid}>
        <MetricCard label="存活天数" value={String(aliveDays)} icon="火" />
        <MetricCard label="连续打卡" value={String(streak)} icon="时" />
        <MetricCard label="今日计划" value={`${doneCount}/${todos.length}`} icon="勾" />
      </View>

      <View style={styles.panel}>
        <SectionHead title="今天留一句" meta="状态" />
        <View style={styles.noteList}>
          {notes.map((note) => (
            <Pressable
              key={note}
              style={[styles.noteChip, statusText === note && styles.noteChipActive]}
              onPress={() => setStatusText(note)}
            >
              <Text style={[styles.noteText, statusText === note && styles.noteTextActive]}>{note}</Text>
            </Pressable>
          ))}
        </View>
      </View>

      <View style={styles.panel}>
        <SectionHead title="今日最多三件小事" meta={`${doneCount}/${todos.length}`} />
        {todos.map((todo) => (
          <TodoRow key={todo.id} todo={todo} onPress={() => toggleTodo(todo.id)} />
        ))}
      </View>
    </View>
  );
}

function FriendsScreen({ friends }: { friends: Friend[] }) {
  const activeCount = friends.filter((friend) => friend.aliveToday).length;

  return (
    <View style={styles.stack}>
      <View style={styles.searchPanel}>
        <Text style={styles.searchText}>搜索好友或输入邀请码</Text>
        <Pressable style={styles.smallButton}>
          <Text style={styles.smallButtonText}>添加</Text>
        </Pressable>
      </View>

      <View style={styles.summaryCard}>
        <View>
          <Text style={styles.mutedText}>好友存活雷达</Text>
          <Text style={styles.summaryNumber}>{activeCount}/{friends.length}</Text>
        </View>
        <Text style={styles.mutedText}>今天已经出现</Text>
      </View>

      {friends.map((friend) => (
        <View key={friend.id} style={styles.friendCard}>
          <View style={[styles.avatar, { backgroundColor: friend.color }]}>
            <Text style={styles.avatarText}>{friend.name.slice(0, 1)}</Text>
          </View>
          <View style={styles.friendBody}>
            <View style={styles.friendTop}>
              <Text style={styles.friendName}>{friend.name}</Text>
              <Text style={[styles.badge, friend.aliveToday ? styles.badgeAlive : styles.badgeQuiet]}>
                {friend.aliveToday ? '还活着' : '没出现'}
              </Text>
            </View>
            <Text style={styles.friendMood} numberOfLines={1}>{friend.mood}</Text>
            <Text style={styles.friendMeta}>
              {friend.days} 天 · 连续 {friend.streak} 天 · {friend.lastSeen}
            </Text>
          </View>
        </View>
      ))}
    </View>
  );
}

function TodosScreen({
  addTodo,
  draft,
  setDraft,
  todos,
  toggleTodo,
}: {
  addTodo: () => void;
  draft: string;
  setDraft: (value: string) => void;
  todos: Todo[];
  toggleTodo: (id: string) => void;
}) {
  return (
    <View style={styles.stack}>
      <View style={styles.panel}>
        <SectionHead title="今天只放三件事" meta={`${todos.length}/3`} />
        <View style={styles.addRow}>
          <TextInput
            editable={todos.length < 3}
            maxLength={24}
            onChangeText={setDraft}
            onSubmitEditing={addTodo}
            placeholder={todos.length >= 3 ? '今天已经够了' : '加一件很小的事'}
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
      </View>

      <View style={styles.panel}>
        {todos.map((todo) => (
          <TodoRow large key={todo.id} todo={todo} onPress={() => toggleTodo(todo.id)} />
        ))}
      </View>

      <View style={styles.softNote}>
        <Text style={styles.softNoteText}>不是效率工具。只是帮你把今天从一团雾里捞出来一点点。</Text>
      </View>
    </View>
  );
}

function ProfileScreen({
  aliveDays,
  checkedIn,
  isDemo,
  onSignOut,
  streak,
}: {
  aliveDays: number;
  checkedIn: boolean;
  isDemo: boolean;
  onSignOut: () => void;
  streak: number;
}) {
  const heatmap = Array.from({ length: 35 }, (_, index) => index % 6 !== 0 && index % 11 !== 0);

  return (
    <View style={styles.stack}>
      <View style={styles.profileCard}>
        <View style={styles.profileAvatar}>
          <Text style={styles.avatarText}>越</Text>
        </View>
        <Text style={styles.profileName}>张越</Text>
        <Text style={styles.mutedText}>{checkedIn ? '今天已确认存活' : '今天还没出现'}</Text>
        <View style={styles.profileStats}>
          <ProfileStat label="总天数" value={String(aliveDays)} />
          <ProfileStat label="连续" value={String(streak)} />
          <ProfileStat label="好友" value="4" />
        </View>
      </View>

      <View style={styles.panel}>
        <SectionHead title="最近 35 天" meta="打卡热力" />
        <View style={styles.heatmap}>
          {heatmap.map((active, index) => (
            <View key={index} style={[styles.heatCell, active && styles.heatCellActive, index === 34 && styles.heatCellToday]} />
          ))}
        </View>
      </View>

      <View style={styles.settingsList}>
        {['账号和昵称', '隐私设置', '提醒时间'].map((item) => (
          <Pressable key={item} style={styles.settingItem}>
            <Text style={styles.settingText}>{item}</Text>
          </Pressable>
        ))}
        <Pressable style={styles.settingItem} onPress={onSignOut}>
          <Text style={styles.settingText}>{isDemo ? '退出演示模式' : '退出登录'}</Text>
        </Pressable>
      </View>
    </View>
  );
}

function MetricCard({ icon, label, value }: { icon: string; label: string; value: string }) {
  return (
    <View style={styles.metricCard}>
      <Text style={styles.metricIcon}>{icon}</Text>
      <Text style={styles.metricValue}>{value}</Text>
      <Text style={styles.metricLabel}>{label}</Text>
    </View>
  );
}

function TodoRow({ large, onPress, todo }: { large?: boolean; onPress: () => void; todo: Todo }) {
  return (
    <Pressable style={[styles.todoRow, large && styles.todoRowLarge]} onPress={onPress}>
      <Text style={[styles.todoCheck, todo.done && styles.todoCheckDone]}>{todo.done ? '✓' : '○'}</Text>
      <Text style={[styles.todoText, todo.done && styles.todoTextDone]}>{todo.text}</Text>
    </Pressable>
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

function ProfileStat({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.profileStat}>
      <Text style={styles.profileStatValue}>{value}</Text>
      <Text style={styles.profileStatLabel}>{label}</Text>
    </View>
  );
}

function TabButton({ active, icon, label, onPress }: { active: boolean; icon: string; label: string; onPress: () => void }) {
  return (
    <Pressable style={[styles.tabButton, active && styles.tabButtonActive]} onPress={onPress}>
      <Text style={[styles.tabIcon, active && styles.tabTextActive]}>{icon}</Text>
      <Text style={[styles.tabLabel, active && styles.tabTextActive]}>{label}</Text>
    </Pressable>
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
  launch: {
    flex: 1,
    justifyContent: 'center',
    padding: 22,
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
    padding: 24,
  },
  heroCardChecked: {
    backgroundColor: '#1c2d24',
  },
  pulseMark: {
    alignItems: 'center',
    backgroundColor: 'rgba(155,226,124,0.13)',
    borderRadius: 24,
    height: 72,
    justifyContent: 'center',
    marginBottom: 54,
    width: 72,
  },
  pulseIcon: {
    color: colors.green,
    fontSize: 34,
    fontWeight: '800',
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
  metricIcon: {
    color: colors.yellow,
    fontSize: 15,
    marginBottom: 8,
  },
  metricValue: {
    color: colors.text,
    fontSize: 23,
    fontWeight: '800',
  },
  metricLabel: {
    color: colors.muted,
    fontSize: 12,
    marginTop: 5,
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
    fontSize: 14,
  },
  noteTextActive: {
    color: '#10120f',
    fontWeight: '700',
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
  todoRowLarge: {
    minHeight: 62,
    paddingHorizontal: 16,
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
  friendMood: {
    color: colors.muted,
    fontSize: 13,
    marginVertical: 6,
  },
  friendMeta: {
    color: colors.soft,
    fontSize: 11,
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
  badgeQuiet: {
    backgroundColor: 'rgba(255,255,255,0.07)',
    color: colors.muted,
  },
  addRow: {
    flexDirection: 'row',
    gap: 10,
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
    width: 48,
  },
  disabledButton: {
    opacity: 0.45,
  },
  addButtonText: {
    color: '#10120f',
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
    backgroundColor: colors.green,
  },
  settingsList: {
    gap: 10,
  },
  settingItem: {
    backgroundColor: colors.panel,
    borderColor: colors.line,
    borderRadius: 18,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: 54,
    paddingHorizontal: 16,
  },
  settingText: {
    color: colors.text,
    fontSize: 15,
  },
  tabbar: {
    backgroundColor: colors.bg,
    borderTopColor: colors.line,
    borderTopWidth: 1,
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 14,
    paddingTop: 12,
    paddingBottom: 16,
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
  tabLabel: {
    color: colors.muted,
    fontSize: 11,
  },
  tabTextActive: {
    color: '#10120f',
    fontWeight: '800',
  },
});
