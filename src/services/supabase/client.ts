import 'react-native-url-polyfill/auto';

import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { AppState, Platform } from 'react-native';

/** mock (domyślnie) albo supabase – z .env.local (EXPO_PUBLIC_BACKEND). */
export const BACKEND = process.env.EXPO_PUBLIC_BACKEND === 'supabase' ? 'supabase' : 'mock';
export const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
/** Klucz publiczny (publishable) – także dla klienta pomocniczego (sprzątanie osieroconego konta anonimowego). */
export const SUPABASE_KEY = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? '';

export const supabaseEnabled = BACKEND === 'supabase' && !!SUPABASE_URL && !!SUPABASE_KEY;
/** Adres i klucz serwera są ustawione – rozpoznawanie zdjęć (Edge Function `identify`) działa też przy grze na mockach. */
export const supabaseConfigured = !!SUPABASE_URL && !!SUPABASE_KEY;

const auth = (storageKey?: string) => ({
  ...(Platform.OS !== 'web' ? { storage: AsyncStorage } : {}),
  ...(storageKey ? { storageKey } : {}),
  autoRefreshToken: true,
  persistSession: true,
  detectSessionInUrl: false,
});

export const supabase: SupabaseClient | null = supabaseEnabled ? createClient(SUPABASE_URL, SUPABASE_KEY, { auth: auth() }) : null;

let identifyOnly: SupabaseClient | null = null;

/**
 * Klient do Edge Function `identify` (wymaga sesji – konto anonimowe): w trybie Supabase ten sam co gra, w trybie mock
 * z adresem i kluczem serwera – osobny, z własną sesją (tylko do rozpoznawania; gra zostaje na mockach). Bez adresu
 * i klucza → null (rozpoznawanie niedostępne).
 */
export function identifyClient(): SupabaseClient | null {
  if (supabase) return supabase;
  if (!supabaseConfigured) return null;
  identifyOnly ??= createClient(SUPABASE_URL, SUPABASE_KEY, { auth: auth('grzybobranie-identify-auth') });
  return identifyOnly;
}

// Odświeżanie sesji tylko, gdy aplikacja jest na pierwszym planie (zalecenie Supabase dla RN).
if (supabase && Platform.OS !== 'web') {
  AppState.addEventListener('change', (state) => {
    if (state === 'active') supabase.auth.startAutoRefresh();
    else supabase.auth.stopAutoRefresh();
  });
}
