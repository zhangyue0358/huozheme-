export type Friend = {
  id: string;
  name: string;
  avatarUrl: string;
  phoneMasked: string;
  days: number;
  streak: number;
  aliveToday: boolean;
  lastSeen: string;
  mood: string;
  color: string;
};

export type FriendRequest = {
  id: string;
  name: string;
  avatarUrl: string;
  phoneMasked: string;
  color: string;
  direction: 'incoming' | 'outgoing';
};

export type IncomingPoke = {
  id: string;
  friendId: string;
  friendName: string;
  friendColor: string;
  createdAt: string;
  acknowledgedAt?: string | null;
};

export type Profile = {
  id: string;
  nickname: string;
  avatarUrl: string;
  phoneE164: string;
  phoneMasked: string;
  avatarColor: string;
  showStatusToFriends: boolean;
};

export type Todo = {
  id: string;
  text: string;
  done: boolean;
  important: boolean;
};

export type PersonalMessage = {
  id: string;
  recipientName: string;
  message: string;
};

export type DiaryEntry = {
  date: string;
  statusText: string;
  weatherText: string;
  quoteText: string;
  journalText: string;
  photoUrls: string[];
  todos: Todo[];
};

export type AppSnapshot = {
  aliveDays: number;
  checkedIn: boolean;
  diaryEntries: DiaryEntry[];
  aliveReplies: IncomingPoke[];
  friends: Friend[];
  friendRequests: FriendRequest[];
  incomingPokes: IncomingPoke[];
  sentPokes: IncomingPoke[];
  journalPhotoPaths: string[];
  journalPhotoUrls: string[];
  personalMessages: PersonalMessage[];
  profile: Profile;
  journalText: string;
  quoteText: string;
  quoteSaved: boolean;
  statusText: string;
  streak: number;
  todos: Todo[];
  weatherText: string;
};
