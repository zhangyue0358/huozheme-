import { supabase } from './supabase';

export async function sendPhoneLoginCode(phone: string) {
  const { error } = await supabase.auth.signInWithOtp({
    phone,
    options: {
      shouldCreateUser: true,
    },
  });

  if (error) throw error;
}

export async function verifyPhoneLoginCode(phone: string, token: string) {
  const { error } = await supabase.auth.verifyOtp({
    phone,
    token,
    type: 'sms',
  });

  if (error) throw error;
}

export async function signInWithPassword(email: string, password: string) {
  const { error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (error) throw error;
}

export async function signOut() {
  const { error } = await supabase.auth.signOut({ scope: 'local' });

  if (error?.name === 'AuthSessionMissingError' || error?.message?.toLowerCase().includes('session missing')) return;
  if (error) throw error;
}
