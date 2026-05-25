import type { AppSnapshot, Friend, Todo } from './types';

export const demoFriends: Friend[] = [
  { id: 'friend-1', name: '小北', days: 142, streak: 18, aliveToday: true, lastSeen: '08:42', mood: '今天也算数', color: '#ffbf75' },
  { id: 'friend-2', name: '阿燃', days: 86, streak: 7, aliveToday: true, lastSeen: '10:03', mood: '不太行，但在', color: '#88e0b8' },
  { id: 'friend-3', name: 'Momo', days: 219, streak: 1, aliveToday: false, lastSeen: '昨天 23:19', mood: '加班到灵魂出窍', color: '#aab2ff' },
  { id: 'friend-4', name: '陈醒醒', days: 31, streak: 0, aliveToday: false, lastSeen: '3 天前', mood: '先睡了', color: '#ff9daf' },
];

export const demoTodos: Todo[] = [
  { id: 'todo-1', text: '喝一杯水', done: true },
  { id: 'todo-2', text: '把房间地面收一下', done: false },
];

export const demoSnapshot: AppSnapshot = {
  aliveDays: 127,
  checkedIn: false,
  friends: demoFriends,
  statusText: '我还活着，今天也算数。',
  streak: 11,
  todos: demoTodos,
};
