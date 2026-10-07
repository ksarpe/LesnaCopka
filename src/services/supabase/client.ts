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

export const supabase: SupabaseClient | null = supabaseEnabled
  ? createClient(SUPABASE_URL, SUPABASE_KEY, {
      auth: {
        ...(Platform.OS !== 'web' ? { storage: AsyncStorage } : {}),
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: false,
      },
    })
  : null;

// Odświeżanie sesji tylko, gdy aplikacja jest na pierwszym planie (zalecenie Supabase dla RN).
if (supabase && Platform.OS !== 'web') {
  AppState.addEventListener('change', (state) => {
    if (state === 'active') supabase.auth.startAutoRefresh();
    else supabase.auth.stopAutoRefresh();
  });
}
