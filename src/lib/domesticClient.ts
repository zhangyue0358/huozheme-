import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';

const DOMESTIC_TOKEN_KEY = 'huozhema.domestic.accessToken';
const DOMESTIC_PROFILE_KEY = 'huozhema.domestic.profile';
const DOMESTIC_SECURE_SESSION_KEY = 'huozhema.domestic.secureSession';
const DOMESTIC_REMEMBER_MODE_KEY = 'huozhema.domestic.rememberMode';
const DOMESTIC_POLICY_CONSENT_KEY = 'huozhema.domestic.policyConsent.v2';
const DOMESTIC_SECURE_SERVICE = 'huozhema.domestic.login';
const BIOMETRIC_PROMPT = '验证身份后自动登录“在否”';

export type DomesticRememberMode = 'none' | 'remember' | 'biometric';
export type DomesticSessionPersistence = {
  remember: boolean;
  useBiometrics: boolean;
};

let activeSession: DomesticSession | null = null;
const sessionExpiredListeners = new Set<() => void>();

export class DomesticApiError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
    this.name = 'DomesticApiError';
  }
}

export class StaleSessionError extends Error {
  constructor() {
    super('账号已变化，本次操作已取消');
    this.name = 'StaleSessionError';
  }
}

export function guardDomesticSession() {
  const token = activeSession?.accessToken;
  return () => {
    if (!token || activeSession?.accessToken !== token) throw new StaleSessionError();
  };
}

export function onDomesticSessionExpired(listener: () => void) {
  sessionExpiredListeners.add(listener);
  return () => { sessionExpiredListeners.delete(listener); };
}

export const domesticApiUrl = (process.env.EXPO_PUBLIC_DOMESTIC_API_URL ?? '').replace(/\/$/, '');
export const hasDomesticApiConfig = domesticApiUrl.length > 0;

export type DomesticProfile = {
  id: string;
  nickname: string;
  passwordConfigured: boolean;
  avatarUrl: string;
  phoneE164: string;
  phoneMasked: string;
  avatarColor: string;
  showStatusToFriends: boolean;
};

export type DomesticSession = {
  accessToken: string;
  profile: DomesticProfile;
};

type DomesticRequestOptions = {
  auth?: boolean;
  body?: unknown;
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
};

function secureOptions(useBiometrics: boolean): SecureStore.SecureStoreOptions {
  return {
    authenticationPrompt: BIOMETRIC_PROMPT,
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    keychainService: DOMESTIC_SECURE_SERVICE,
    requireAuthentication: useBiometrics,
  };
}

export async function saveDomesticSession(
  session: DomesticSession,
  persistence: DomesticSessionPersistence = { remember: true, useBiometrics: false },
) {
  const rememberMode: DomesticRememberMode = persistence.remember
    ? persistence.useBiometrics
      ? 'biometric'
      : 'remember'
    : 'none';

  await AsyncStorage.multiRemove([DOMESTIC_TOKEN_KEY, DOMESTIC_PROFILE_KEY]);
  await SecureStore.deleteItemAsync(DOMESTIC_SECURE_SESSION_KEY, {
    keychainService: DOMESTIC_SECURE_SERVICE,
  });
  if (rememberMode === 'none') {
    await AsyncStorage.setItem(DOMESTIC_REMEMBER_MODE_KEY, rememberMode);
    activeSession = session;
    return;
  }

  await SecureStore.setItemAsync(DOMESTIC_SECURE_SESSION_KEY, JSON.stringify(session), secureOptions(rememberMode === 'biometric'));
  await AsyncStorage.setItem(DOMESTIC_REMEMBER_MODE_KEY, rememberMode);
  activeSession = session;
}

export async function getDomesticSession(): Promise<DomesticSession | null> {
  const rememberMode = await getDomesticRememberMode();
  if (rememberMode !== 'none') {
    const sessionText = await SecureStore.getItemAsync(
      DOMESTIC_SECURE_SESSION_KEY,
      secureOptions(rememberMode === 'biometric'),
    );
    if (!sessionText) return null;
    try {
      activeSession = JSON.parse(sessionText) as DomesticSession;
      return activeSession;
    } catch {
      await clearDomesticSession();
      return null;
    }
  }

  // One-time migration for users signed in before secure session storage was introduced.
  const values = await AsyncStorage.multiGet([DOMESTIC_TOKEN_KEY, DOMESTIC_PROFILE_KEY]);
  const token = values.find(([key]) => key === DOMESTIC_TOKEN_KEY)?.[1] ?? '';
  const profileText = values.find(([key]) => key === DOMESTIC_PROFILE_KEY)?.[1] ?? '';
  if (!token || !profileText) return null;

  try {
    const session = {
      accessToken: token,
      profile: JSON.parse(profileText) as DomesticProfile,
    };
    await saveDomesticSession(session, { remember: true, useBiometrics: false });
    return session;
  } catch {
    await clearDomesticSession();
    return null;
  }
}

export async function getDomesticRememberMode(): Promise<DomesticRememberMode> {
  const value = await AsyncStorage.getItem(DOMESTIC_REMEMBER_MODE_KEY);
  return value === 'remember' || value === 'biometric' ? value : 'none';
}

export async function getDomesticPolicyConsent() {
  return (await AsyncStorage.getItem(DOMESTIC_POLICY_CONSENT_KEY)) === 'accepted';
}

export async function setDomesticPolicyConsent(accepted: boolean) {
  if (accepted) {
    await AsyncStorage.setItem(DOMESTIC_POLICY_CONSENT_KEY, 'accepted');
    return;
  }
  await AsyncStorage.removeItem(DOMESTIC_POLICY_CONSENT_KEY);
}

export async function clearDomesticSession() {
  activeSession = null;
  await Promise.all([
    AsyncStorage.multiRemove([DOMESTIC_TOKEN_KEY, DOMESTIC_PROFILE_KEY, DOMESTIC_REMEMBER_MODE_KEY]),
    SecureStore.deleteItemAsync(DOMESTIC_SECURE_SESSION_KEY, {
      keychainService: DOMESTIC_SECURE_SERVICE,
    }),
  ]);
}

export function lockDomesticSession() {
  activeSession = null;
}

async function getDomesticToken() {
  const token = activeSession?.accessToken || '';
  if (!token) throw new Error('请先登录');
  return token;
}

export async function domesticRequest<T>(path: string, options: DomesticRequestOptions = {}): Promise<T> {
  if (!domesticApiUrl) throw new Error('国内后端地址还没有配置');

  const headers: Record<string, string> = {
    Accept: 'application/json',
  };
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  const requestToken = options.auth === false ? '' : await getDomesticToken();
  if (requestToken) headers.Authorization = `Bearer ${requestToken}`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);
  let response: Response;
  let payload: unknown;
  try {
    response = await fetch(`${domesticApiUrl}${path}`, {
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      headers,
      method: options.method ?? (options.body === undefined ? 'GET' : 'POST'),
      signal: controller.signal,
    });
    payload = await response.json().catch((error) => {
      if (controller.signal.aborted) throw error;
      return {};
    });
  } catch (error) {
    if (controller.signal.aborted) throw new Error('网络请求超时，请检查网络后重试');
    throw error;
  } finally {
    clearTimeout(timeout);
  }
  if (response.ok && requestToken && activeSession?.accessToken !== requestToken) throw new StaleSessionError();
  if (!response.ok) {
    if (response.status === 401 && requestToken && activeSession?.accessToken === requestToken) {
      // Ignore stale responses from an older login, and notify only once.
      const clearing = clearDomesticSession();
      for (const listener of sessionExpiredListeners) listener();
      await clearing.catch(() => {});
    }
    const fallback = response.status === 401
      ? (options.auth === false ? '手机号或密码不正确' : '登录已失效，请重新登录')
      : '请求失败，请稍后再试';
    const serverError = payload && typeof payload === 'object' && 'error' in payload ? payload.error : undefined;
    throw new DomesticApiError(typeof serverError === 'string' ? serverError : fallback, response.status);
  }
  return payload as T;
}
