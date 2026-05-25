import type { AppSnapshot, Friend, Todo } from './types';
import { demoSnapshot } from './mockData';
import { supabase } from './supabase';

type TodoRow = {
  id: number;
  text: string;
  done: boolean;
};

type CheckinRow = {
  checkin_date: string;
  status_text: string;
};

function todayIso() {
  return new Date().toISOString().slice(0, 10);
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

  while (dates.has(cursor.toISOString().slice(0, 10))) {
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }

  return streak;
}

export async function loadAppSnapshot(userId: string): Promise<AppSnapshot> {
  const today = todayIso();

  const [{ data: profile, error: profileError }, { data: checkins, error: checkinsError }, { data: todos, error: todosError }] =
    await Promise.all([
      supabase.from('profiles').select('started_on').eq('id', userId).single(),
      supabase
        .from('checkins')
        .select('checkin_date,status_text')
        .eq('user_id', userId)
        .order('checkin_date', { ascending: false })
        .limit(60),
      supabase.from('todos').select('id,text,done').eq('user_id', userId).eq('todo_date', today).order('created_at'),
    ]);

  if (profileError || checkinsError || todosError) {
    throw profileError ?? checkinsError ?? todosError;
  }

  const rows = (checkins ?? []) as CheckinRow[];
  const todayCheckin = rows.find((item) => item.checkin_date === today);

  return {
    ...demoSnapshot,
    aliveDays: dayDiff(profile?.started_on ?? today),
    checkedIn: Boolean(todayCheckin),
    statusText: todayCheckin?.status_text ?? demoSnapshot.statusText,
    streak: calculateStreak(rows),
    todos: ((todos ?? []) as TodoRow[]).map((todo) => ({
      id: String(todo.id),
      text: todo.text,
      done: todo.done,
    })),
  };
}

export async function ensureProfile(userId: string, nickname: string) {
  const { error } = await supabase.from('profiles').upsert({
    id: userId,
    nickname,
  });

  if (error) throw error;
}

export async function saveCheckin(userId: string, statusText: string) {
  const { error } = await supabase.from('checkins').upsert({
    user_id: userId,
    checkin_date: todayIso(),
    status_text: statusText,
  });

  if (error) throw error;
}

export async function createTodo(userId: string, text: string): Promise<Todo> {
  const { data, error } = await supabase
    .from('todos')
    .insert({
      user_id: userId,
      todo_date: todayIso(),
      text,
    })
    .select('id,text,done')
    .single();

  if (error) throw error;
  return { id: String(data.id), text: data.text, done: data.done };
}

export async function updateTodoDone(todoId: string, done: boolean) {
  const { error } = await supabase.from('todos').update({ done }).eq('id', Number(todoId));

  if (error) throw error;
}

export async function listFriends(): Promise<Friend[]> {
  return demoSnapshot.friends;
}
