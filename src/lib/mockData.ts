import type { AppSnapshot, Friend, Todo } from './types';

export const demoFriends: Friend[] = [
  { id: 'friend-1', name: '小北', phoneMasked: '139****0421', days: 142, streak: 18, aliveToday: true, lastSeen: '08:42', mood: '今天也算数', color: '#ffbf75' },
  { id: 'friend-2', name: '阿燃', phoneMasked: '139****0617', days: 86, streak: 7, aliveToday: true, lastSeen: '10:03', mood: '不太行，但在', color: '#88e0b8' },
  { id: 'friend-3', name: 'Momo', phoneMasked: '139****0908', days: 219, streak: 1, aliveToday: false, lastSeen: '昨天 23:19', mood: '加班到灵魂出窍', color: '#aab2ff' },
  { id: 'friend-4', name: '陈醒醒', phoneMasked: '139****1120', days: 31, streak: 0, aliveToday: false, lastSeen: '3 天前', mood: '先睡了', color: '#ff9daf' },
];

export const demoTodos: Todo[] = [
  { id: 'todo-1', text: '喝一杯水', done: true, important: false },
  { id: 'todo-2', text: '把重要事情收一下尾', done: false, important: true },
];

export const demoSnapshot: AppSnapshot = {
  aliveDays: 127,
  aliveReplies: [],
  checkedIn: false,
  diaryEntries: [],
  friends: demoFriends,
  friendRequests: [],
  incomingPokes: [],
  sentPokes: [],
  journalPhotoPaths: [],
  journalPhotoUrls: [],
  profile: {
    id: 'demo-user',
    nickname: '张越',
    phoneE164: '',
    phoneMasked: '手机号未绑定',
    avatarColor: '#ffd166',
    showStatusToFriends: true,
  },
  journalText: '',
  quoteText: '今天不用很厉害，能把自己带到晚上就很好。',
  statusText: '',
  streak: 11,
  todos: demoTodos,
  weatherText: '☀️ 晴',
};
