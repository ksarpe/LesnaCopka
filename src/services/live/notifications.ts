/**
 * Lokalne powiadomienia systemowe (expo-notifications) – cienka warstwa bez logiki aplikacji.
 *
 * - Web: brak powiadomień systemowych (status 'unsupported'); wpisy trafiają tylko do centrum w aplikacji.
 * - Expo Go: lokalne powiadomienia działają (iOS). Zdalnych (push token) nie rejestrujemy wcale.
 *   Moduł ładujemy leniwie – w Expo Go na Androidzie sam import rzuca błąd (push usunięty z Expo Go),
 *   wtedy traktujemy powiadomienia jako niedostępne zamiast wysypać aplikację.
 * - Identyfikatory: „grzyb.<klucz>” – stabilne per kategoria, więc ponowne zaplanowanie podmienia wpis.
 */
import { isRunningInExpoGo } from 'expo';
import type * as ExpoNotifications from 'expo-notifications';
import { LogBox, Platform } from 'react-native';

import { hashString } from '@/utils/random';

import type { PermissionStatus } from '../types';

type NotificationsModule = typeof ExpoNotifications;

export type SystemNotifPermission = PermissionStatus | 'unsupported';

/** Wyzwalacz: konkretna chwila, co tydzień (weekday 0 = niedziela, jak Date.getDay) albo za N sekund. */
export type SystemTrigger =
  | { type: 'date'; at: number }
  | { type: 'weekly'; weekday: number; hour: number; minute?: number }
  | { type: 'seconds'; seconds: number };

export interface SystemNotification {
  /** Klucz bez prefiksu – ten sam co klucz wpisu w centrum powiadomień. */
  key: string;
  title: string;
  body: string;
  href?: string;
  /** Pokaż baner również, gdy aplikacja jest na pierwszym planie. */
  banner?: boolean;
  trigger: SystemTrigger;
}

/** Dane z tapnięcia / odebrania powiadomienia. */
export interface SystemNotificationEvent {
  key: string;
  href?: string;
  banner: boolean;
}

const PREFIX = 'grzyb.';
const CHANNEL_ID = 'default';

let mod: NotificationsModule | null | undefined;
let initialized = false;
/** Odpowiedzi (tapnięcia) już obsłużone – zimny start i listener potrafią zgłosić to samo. */
const handledResponses = new Set<string>();

function load(): NotificationsModule | null {
  if (mod !== undefined) return mod;
  if (Platform.OS === 'web') return (mod = null);
  // Expo Go na Androidzie: import rzuca błąd, którego try/catch nie złapie (Metro zgłasza go jako błąd krytyczny
  // przy leniwym require) – sprawdzamy środowisko, zanim w ogóle sięgniemy po moduł.
  if (Platform.OS === 'android' && isRunningInExpoGo()) return (mod = null);
  try {
    // Ostrzeżenia expo-notifications o Expo Go dotyczą zdalnych push – lokalnych nie używamy inaczej.
    LogBox.ignoreLogs(['`expo-notifications` functionality is not fully supported in Expo Go', 'expo-notifications: Android Push']);
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    mod = (require('expo-notifications') as NotificationsModule | undefined) ?? null;
  } catch {
    mod = null;
  }
  return mod;
}

function toStatus(m: NotificationsModule, p: ExpoNotifications.NotificationPermissionsStatus): PermissionStatus {
  if (p.granted) return 'granted';
  const ios = p.ios?.status;
  if (ios === m.IosAuthorizationStatus.PROVISIONAL || ios === m.IosAuthorizationStatus.EPHEMERAL) return 'granted';
  // Android pozwala zapytać ponownie po pierwszej odmowie.
  if (p.status === 'denied') return Platform.OS === 'android' && p.canAskAgain ? 'undetermined' : 'denied';
  return 'undetermined';
}

const sig = (n: SystemNotification) => String(hashString(JSON.stringify([n.title, n.body, n.href ?? '', n.trigger])));

function toTrigger(m: NotificationsModule, t: SystemTrigger): ExpoNotifications.NotificationTriggerInput {
  // Kanał tylko na Androidzie (bez pól undefined w obiekcie dla natywnego mostu).
  const channel = Platform.OS === 'android' ? { channelId: CHANNEL_ID } : {};
  const T = m.SchedulableTriggerInputTypes;
  if (t.type === 'date') return { type: T.DATE, date: t.at, ...channel };
  if (t.type === 'seconds') return { type: T.TIME_INTERVAL, seconds: Math.max(1, Math.round(t.seconds)), repeats: false, ...channel };
  // expo-notifications: 1 = niedziela … 7 = sobota.
  return { type: T.WEEKLY, weekday: t.weekday + 1, hour: t.hour, minute: t.minute ?? 0, ...channel };
}

function eventOf(n: ExpoNotifications.Notification): SystemNotificationEvent | null {
  const id = n.request.identifier;
  if (!id.startsWith(PREFIX)) return null;
  const data = (n.request.content.data ?? {}) as Record<string, unknown>;
  return { key: id.slice(PREFIX.length), href: typeof data.href === 'string' ? data.href : undefined, banner: data.banner === true };
}

export const systemNotifications = {
  /** Czy na tej platformie są lokalne powiadomienia systemowe. */
  supported(): boolean {
    return load() != null;
  },

  /** Kanał Androida + zachowanie na pierwszym planie (idempotentne). */
  async init(): Promise<void> {
    const m = load();
    if (!m || initialized) return;
    initialized = true;
    // Na pierwszym planie zamiast banera pokazujemy toast w aplikacji (wyjątek: powiadomienie testowe).
    m.setNotificationHandler({
      handleNotification: async (n) => {
        const banner = (n.request.content.data as Record<string, unknown> | undefined)?.banner === true;
        return { shouldShowBanner: banner, shouldShowList: true, shouldPlaySound: banner, shouldSetBadge: false };
      },
    });
    if (Platform.OS === 'android') {
      await m
        .setNotificationChannelAsync(CHANNEL_ID, { name: 'Grzybobranie', importance: m.AndroidImportance.DEFAULT })
        .catch(() => {});
    }
  },

  async getPermission(): Promise<SystemNotifPermission> {
    const m = load();
    if (!m) return 'unsupported';
    try {
      return toStatus(m, await m.getPermissionsAsync());
    } catch {
      return 'unsupported';
    }
  },

  /** Systemowy prompt (iOS: alert + dźwięk + plakietka). */
  async requestPermission(): Promise<SystemNotifPermission> {
    const m = load();
    if (!m) return 'unsupported';
    try {
      await systemNotifications.init();
      return toStatus(m, await m.requestPermissionsAsync({ ios: { allowAlert: true, allowSound: true, allowBadge: true } }));
    } catch {
      return 'unsupported';
    }
  },

  async schedule(n: SystemNotification): Promise<boolean> {
    const m = load();
    if (!m) return false;
    if (n.trigger.type === 'date' && n.trigger.at <= Date.now() + 1000) return false;
    try {
      await m.scheduleNotificationAsync({
        identifier: PREFIX + n.key,
        content: {
          title: n.title,
          body: n.body,
          sound: 'default',
          // Bez pól undefined – natywny most ich nie lubi.
          data: { banner: n.banner === true, sig: sig(n), ...(n.href ? { href: n.href } : {}) },
        },
        trigger: toTrigger(m, n.trigger),
      });
      return true;
    } catch {
      return false;
    }
  },

  async cancel(key: string): Promise<void> {
    await load()?.cancelScheduledNotificationAsync(PREFIX + key).catch(() => {});
  },

  /**
   * Uzgadnia zaplanowane powiadomienia aplikacji z listą docelową: usuwa zbędne (poza `keep`),
   * planuje brakujące i zmienione (porównanie po podpisie treści + wyzwalacza).
   */
  async reconcile(desired: SystemNotification[], keep: Set<string> = new Set()): Promise<void> {
    const m = load();
    if (!m) return;
    let ours: ExpoNotifications.NotificationRequest[] = [];
    try {
      ours = (await m.getAllScheduledNotificationsAsync()).filter((r) => r.identifier.startsWith(PREFIX));
    } catch {
      return;
    }
    const want = new Map(desired.map((d) => [PREFIX + d.key, d]));
    for (const r of ours) {
      if (!want.has(r.identifier) && !keep.has(r.identifier.slice(PREFIX.length))) {
        await m.cancelScheduledNotificationAsync(r.identifier).catch(() => {});
      }
    }
    for (const [id, d] of want) {
      const existing = ours.find((r) => r.identifier === id);
      if (existing && (existing.content.data as Record<string, unknown> | undefined)?.sig === sig(d)) continue;
      await systemNotifications.schedule(d);
    }
  },

  /** Tapnięcie powiadomienia (także to, które uruchomiło aplikację). */
  onResponse(cb: (e: SystemNotificationEvent) => void): () => void {
    const m = load();
    if (!m) return () => {};
    const handle = (r: ExpoNotifications.NotificationResponse | null) => {
      if (!r) return;
      const id = `${r.notification.request.identifier}@${r.notification.date}`;
      if (handledResponses.has(id)) return;
      handledResponses.add(id);
      const e = eventOf(r.notification);
      if (e) cb(e);
    };
    m.getLastNotificationResponseAsync()
      .then((r) => {
        handle(r);
        if (r) return m.clearLastNotificationResponseAsync();
      })
      .catch(() => {});
    const sub = m.addNotificationResponseReceivedListener(handle);
    return () => sub.remove();
  },

  /** Powiadomienie odebrane, gdy aplikacja jest na pierwszym planie. */
  onReceived(cb: (e: SystemNotificationEvent) => void): () => void {
    const m = load();
    if (!m) return () => {};
    const sub = m.addNotificationReceivedListener((n) => {
      const e = eventOf(n);
      if (e) cb(e);
    });
    return () => sub.remove();
  },
};
