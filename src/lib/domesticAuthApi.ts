import {
  clearDomesticSession,
  domesticRequest,
  getDomesticRememberMode,
  lockDomesticSession,
  type DomesticSession,
} from './domesticClient';

export async function sendDomesticPhoneLoginCode(phone: string) {
  await domesticRequest<{ ok: boolean }>('/auth/send-code', {
    auth: false,
    body: { phone },
    method: 'POST',
  });
}

export async function verifyDomesticPhoneLoginCode(phone: string, code: string) {
  return domesticRequest<DomesticSession>('/auth/verify-code', {
    auth: false,
    body: { code, phone },
    method: 'POST',
  });
}

export async function resetDomesticPasswordWithCode(phone: string, code: string, newPassword: string) {
  return domesticRequest<DomesticSession>('/auth/reset-password', {
    auth: false,
    body: { code, newPassword, phone },
    method: 'POST',
  });
}

export async function signInDomesticWithPassword(phone: string, password: string) {
  return domesticRequest<DomesticSession>('/auth/password-login', {
    auth: false,
    body: { password, phone },
    method: 'POST',
  });
}

export async function signOutDomestic(options: { preserveBiometricLogin?: boolean } = {}) {
  if (options.preserveBiometricLogin && (await getDomesticRememberMode()) === 'biometric') {
    lockDomesticSession();
    return { biometricLoginPreserved: true };
  }

  await clearDomesticSession();
  return { biometricLoginPreserved: false };
}
