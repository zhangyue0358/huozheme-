export type Friend = {
  id: string;
  name: string;
  days: number;
  streak: number;
  aliveToday: boolean;
  lastSeen: string;
  mood: string;
  color: string;
};

export type Todo = {
  id: string;
  text: string;
  done: boolean;
};

export type AppSnapshot = {
  aliveDays: number;
  checkedIn: boolean;
  friends: Friend[];
  statusText: string;
  streak: number;
  todos: Todo[];
};
