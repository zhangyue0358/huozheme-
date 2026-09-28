import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

const REMINDER_SETTINGS_KEY = 'zaifou.reminder.settings.v1';
const REMINDER_CHANNEL_ID = 'daily-checkin-reminders';

export type ReminderSettings = {
  enabled: boolean;
  notificationId: string;
  time: string;
};

const defaultSettings: ReminderSettings = {
  enabled: false,
  notificationId: '',
  time: '22:30',
};

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldPlaySound: true,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

function isNotificationPermissionGranted(settings: Notifications.NotificationPermissionsStatus) {
  if (settings.granted) return true;
  if (Platform.OS !== 'ios') return false;
  return (
    settings.ios?.status === Notifications.IosAuthorizationStatus.AUTHORIZED ||
    settings.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL
  );
}

async function prepareNotificationPermission() {
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync(REMINDER_CHANNEL_ID, {
      importance: Notifications.AndroidImportance.DEFAULT,
      name: '每日提醒',
      sound: 'default',
      vibrationPattern: [0, 180, 120, 180],
    });
  }

  let settings = await Notifications.getPermissionsAsync();
  if (!isNotificationPermissionGranted(settings)) {
    settings = await Notifications.requestPermissionsAsync({
      ios: {
        allowAlert: true,
        allowBadge: false,
        allowSound: true,
      },
    });
  }

  if (!isNotificationPermissionGranted(settings)) {
    throw new Error('通知权限未开启');
  }
}

function parseReminderTime(time: string) {
  if (!/^\d{2}:\d{2}$/.test(time)) throw new Error('提醒时间无效');
  const [hourText, minuteText] = time.split(':');
  const hour = Number(hourText);
  const minute = Number(minuteText);
  if (!Number.isInteger(hour) || !Number.isInteger(minute) || hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    throw new Error('提醒时间无效');
  }
  return { hour, minute };
}

async function readStoredSettings(): Promise<ReminderSettings> {
  const stored = await AsyncStorage.getItem(REMINDER_SETTINGS_KEY);
  if (!stored) return defaultSettings;

  try {
    const parsed = JSON.parse(stored) as Partial<ReminderSettings>;
    parseReminderTime(typeof parsed.time === 'string' ? parsed.time : defaultSettings.time);
    return {
      enabled: parsed.enabled === true,
      notificationId: typeof parsed.notificationId === 'string' ? parsed.notificationId : '',
      time: typeof parsed.time === 'string' ? parsed.time : defaultSettings.time,
    };
  } catch {
    return defaultSettings;
  }
}

async function getScheduledReminders(current: ReminderSettings) {
  const scheduled = await Notifications.getAllScheduledNotificationsAsync();
  return scheduled.filter((request) => request.identifier === current.notificationId
    || request.content.data?.source === 'daily-reminder');
}

export async function getReminderSettings(): Promise<ReminderSettings> {
  const current = await readStoredSettings();
  const reminders = await getScheduledReminders(current);
  const scheduled = reminders.find((request) => request.identifier === current.notificationId) || reminders[0];
  if (!scheduled) return { ...current, enabled: false, notificationId: '' };
  const scheduledTime = scheduled.content.data?.reminderTime;
  return {
    enabled: true,
    notificationId: scheduled.identifier,
    time: typeof scheduledTime === 'string' && /^\d{2}:\d{2}$/.test(scheduledTime) ? scheduledTime : current.time,
  };
}

let reminderOperation: Promise<unknown> = Promise.resolve();
function serializeReminderChange<T>(action: () => Promise<T>): Promise<T> {
  const next = reminderOperation.then(action, action);
  reminderOperation = next.catch(() => undefined);
  return next;
}

async function scheduleReminder(time: string) {
  const { hour, minute } = parseReminderTime(time);
  await prepareNotificationPermission();

  const current = await getReminderSettings();
  const previousReminders = await getScheduledReminders(current);
  const notificationId = await Notifications.scheduleNotificationAsync({
    content: {
      body: '给今天留一个小小的信号：我还在，挺好。',
      data: { destination: 'today', source: 'daily-reminder', reminderTime: time },
      sound: 'default',
      title: '今天，还在吗？',
    },
    trigger: {
      channelId: Platform.OS === 'android' ? REMINDER_CHANNEL_ID : undefined,
      hour,
      minute,
      type: Notifications.SchedulableTriggerInputTypes.DAILY,
    },
  });

  const nextSettings: ReminderSettings = { enabled: true, notificationId, time };
  try {
    for (const previous of previousReminders) {
      await Notifications.cancelScheduledNotificationAsync(previous.identifier);
    }
    await AsyncStorage.setItem(REMINDER_SETTINGS_KEY, JSON.stringify(nextSettings));
  } catch (error) {
    try {
      await Notifications.cancelScheduledNotificationAsync(notificationId);
    } catch {
      // Still discoverable by its source tag; the next reconciliation/disable
      // scans native scheduled notifications instead of trusting a lost ID.
      throw new Error('提醒设置未完成，请重新打开提醒设置后重试');
    }
    throw error;
  }
  return nextSettings;
}

async function disableReminder() {
  const current = await getReminderSettings();
  for (const request of await getScheduledReminders(current)) {
    // A cancellation failure must not erase the only reference or report success.
    await Notifications.cancelScheduledNotificationAsync(request.identifier);
  }
  const nextSettings: ReminderSettings = { enabled: false, notificationId: '', time: current.time };
  await AsyncStorage.setItem(REMINDER_SETTINGS_KEY, JSON.stringify(nextSettings));
  return nextSettings;
}

export function scheduleDailyReminder(time: string) {
  return serializeReminderChange(() => scheduleReminder(time));
}

export function disableDailyReminder() {
  return serializeReminderChange(disableReminder);
}
