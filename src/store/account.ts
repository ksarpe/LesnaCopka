/**
 * Konto gracza – akcje ekranów Ustawienia → Konto, „Usuń konto”, „Pobierz moje dane” i onboardingu, wspólne
 * dla obu trybów: Supabase (prawdziwe konto – src/services/supabase/account.ts) i mock (wszystko w telefonie).
 */
import Constants from 'expo-constants';
import { Platform } from 'react-native';

import { useRegionStore } from '@/hooks/useRegion';
import { shareJsonFile, type ShareOutcome } from '@/services/live/exportFile';
import { useMockDb } from '@/services/mock/db';
import { playerById } from '@/data/mock/social';
import {
  deleteAccount as deleteServerAccount,
  exportServerData,
  loginWithCode,
  signOutToAnonymous,
  type DeleteOutcome,
} from '@/services/supabase/account';
import { supabaseEnabled } from '@/services/supabase/client';
import { requestSync, type SwitchResult } from '@/services/supabase/sync';
import { ServiceError, type Services } from '@/services/types';
import { buildLocalExport, exportFileName, mergeExport, type LocalExportInput } from '@/utils/exportData';
import { plural } from '@/utils/format';
import { freshPlayerState, resetAll } from './game';
import { requestSync as requestNotificationSync } from './notify';
import { useFeedSync } from './useFeedSync';
import { useNotificationStore } from './useNotificationStore';
import { usePrefsStore } from './usePrefsStore';
import { useSimStore } from './useSimStore';
import { useStatsSync } from './useStatsSync';
import { useOutboxStore } from './useOutboxStore';
import { useTripStore } from './useTripStore';
import { ui } from './useUiStore';
import { useUserStore } from './useUserStore';

/**
 * Stan telefonu po zmianie konta (wylogowanie, usunięcie, logowanie na inne): bez postępów, zdjęć, powiadomień
 * i danych „serwera” mocków; zgody systemowe, źródła GPS / aparatu i mapy offline zostają (to stan telefonu, nie konta).
 * `onboarded: false` – nowe konto zaczyna od onboardingu (w trybie Supabase stan konta z serwera i tak przyjdzie zaraz
 * potem).
 */
export function wipeLocalData(services: Services, opts: { onboarded: boolean }) {
  const sim = useSimStore.getState();
  const keep = { permissions: sim.permissions, locationSource: sim.locationSource, cameraSource: sim.cameraSource };
  resetAll();
  useSimStore.getState().set(keep);
  useUserStore.getState().reset({
    ...freshPlayerState({ name: 'Grzybiarz', firstName: 'Grzybiarz', handle: '@grzybiarz' }),
    onboarded: opts.onboarded,
    // Nowe konto (onboarding) – gmina domowa z pierwszego wykrycia GPS albo z serwera (konto, które już ją ma).
    homeGminaPending: !opts.onboarded,
  });
  services.dev?.reset({ emptyFeed: true });
  useNotificationStore.getState().reset();
  requestNotificationSync();
  useRegionStore.getState().set({ status: 'idle', region: null });
  useFeedSync.getState().invalidate();
  useStatsSync.getState().invalidate();
}

/* ───────────────────────── Logowanie / wylogowanie (Supabase) ───────────────────────── */

/** Kod z e-maila → konto z tym adresem (stan telefonu zastąpiony stanem konta). Błąd kodu – `error` w wyniku. */
export function loginWithEmailCode(services: Services, email: string, code: string): Promise<SwitchResult> {
  return loginWithCode(email, code, () => wipeLocalData(services, { onboarded: false }));
}

/** „Wyloguj” – nowe konto anonimowe i onboarding. */
export function signOut(services: Services): Promise<SwitchResult> {
  return signOutToAnonymous(() => wipeLocalData(services, { onboarded: false }));
}

/* ───────────────────────── Usunięcie konta ───────────────────────── */

/**
 * „Usuń konto”. Supabase: dane i pliki na serwerze, konto, potem telefon (src/services/supabase/account.ts). Mock: tylko
 * telefon i „serwer” mocków. W obu – na końcu onboarding (nowe konto).
 */
export async function deleteMyAccount(services: Services): Promise<DeleteOutcome> {
  if (!supabaseEnabled) {
    wipeLocalData(services, { onboarded: false });
    return { ok: true, filesError: null };
  }
  return deleteServerAccount(() => wipeLocalData(services, { onboarded: false }));
}

/* ───────────────────────── Eksport ───────────────────────── */

const APP_VERSION = Constants.expoConfig?.version ?? '–';

/** Dane z telefonu do eksportu (store'y). */
export function localExportInput(): LocalExportInput {
  const u = useUserStore.getState();
  const n = useNotificationStore.getState();
  const db = useMockDb.getState();
  return {
    user: u,
    trips: useTripStore.getState().trips,
    finds: useTripStore.getState().finds,
    settings: {
      hideRouteByDefault: usePrefsStore.getState().hideRouteByDefault,
      notifications: { prefs: { ...n.prefs }, reminderHour: n.reminderHour },
    },
    notifications: n.inbox,
    // Tryb mock: znajomi i blokady żyją w „bazie” mocków na telefonie (w trybie Supabase są w eksporcie z serwera).
    ...(supabaseEnabled
      ? {}
      : {
          social: {
            friends: db.friendIds.map((id) => playerById(id)?.handle ?? id),
            blocked: db.blocked.map((b) => ({
              handle: playerById(b.id)?.handle ?? b.id,
              name: playerById(b.id)?.name ?? b.id,
              blockedAt: b.at,
            })),
          },
        }),
  };
}

/** Plik eksportu: serwer (Supabase) + telefon. Bez sieci w trybie Supabase – ServiceError('NETWORK'). */
export async function buildExport(now = new Date()) {
  const server = supabaseEnabled ? await exportServerData() : null;
  const local = buildLocalExport(localExportInput());
  return mergeExport(server, local, { backend: supabaseEnabled ? 'supabase' : 'mock', appVersion: APP_VERSION, platform: Platform.OS }, now);
}

/** „Pobierz moje dane”: JSON → plik → udostępnianie systemowe (telefon) / pobranie (web). */
export async function exportMyData(now = new Date()): Promise<ShareOutcome> {
  const data = await buildExport(now);
  const { outcome } = await shareJsonFile(exportFileName(now), JSON.stringify(data, null, 2), 'Twoje dane z Grzybobrania');
  return outcome;
}

/* ───────────────────────── Niewysłane zdarzenia przed zmianą konta ───────────────────────── */

/**
 * Przed zmianą konta (logowanie na inne, wylogowanie): niewysłane zdarzenia należą do obecnego konta i przepadną.
 * Pusta kolejka → true. Inaczej pytamy: „Synchronizuj teraz” (wysyła i kontynuuje, gdy się udało), „Odrzuć i kontynuuj”
 * albo „Anuluj”. Zwraca, czy kontynuować.
 */
export async function confirmPendingSync(): Promise<boolean> {
  const pending = useOutboxStore.getState().items.length;
  if (!pending) return true;
  const choice = await ui.choose({
    title: 'Najpierw poczekaj na synchronizację',
    message:
      `Na serwer czeka jeszcze ${pending} ${plural(pending, 'zmiana', 'zmiany', 'zmian')} z tego telefonu (wyprawy, znaleziska, profil). ` +
      'Po zmianie konta przepadną.',
    icon: 'sync',
    actions: [
      { label: 'Synchronizuj teraz', style: 'primary', value: 'sync' },
      { label: 'Odrzuć i kontynuuj', style: 'danger', value: 'discard' },
      { label: 'Anuluj', style: 'cancel', value: null },
    ],
  });
  if (choice === 'discard') return true;
  if (choice !== 'sync') return false;
  const r = await requestSync('manual');
  if (r.remaining === 0) {
    ui.toast('Zsynchronizowano', 'cloud_done');
    return true;
  }
  ui.toast('Nie udało się wysłać zmian – sprawdź połączenie', 'cloud_off');
  return false;
}

let exporting = false;

/** „Pobierz moje dane” z komunikatami (Ustawienia, ekran usuwania konta). Drugie tapnięcie w trakcie – nic. */
export async function runExport(): Promise<void> {
  if (exporting) return;
  exporting = true;
  ui.toast('Przygotowujemy plik z Twoimi danymi…', 'download');
  try {
    const outcome = await exportMyData();
    if (outcome === 'downloaded') ui.toast('Plik z danymi pobrany (folder Pobrane)', 'download');
    else if (outcome === 'saved') ui.toast('Udostępnianie niedostępne – plik zapisany w pamięci aplikacji', 'download');
    else ui.toast('Plik z danymi gotowy', 'task_alt');
  } catch (e) {
    const network = e instanceof ServiceError && e.code === 'NETWORK';
    ui.toast(network ? 'Brak połączenia – dane z serwera pobierzesz, gdy będzie internet' : 'Nie udało się przygotować pliku z danymi', network ? 'wifi_off' : 'error');
  } finally {
    exporting = false;
  }
}
