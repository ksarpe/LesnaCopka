import { Platform } from 'react-native';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

import type { IconName } from '@/components/Icon';
import type { PermissionStatus } from '@/services/types';
import type { ISODate } from '@/types';
import {
  DEFAULT_NOTIF_PREFS,
  DEFAULT_REMINDER_HOUR,
  type NotifCategory,
  type NotifKind,
  type PlannedNotification,
} from '@/utils/notifications';
import { makeId } from '@/utils/random';
import { persistStorage, STORAGE_KEYS } from './storage';

/** Zgoda systemowa; 'unsupported' = web / środowisko bez lokalnych powiadomień. */
export type NotifPermission = PermissionStatus | 'unsupported';

/** Wpis w centrum powiadomień. */
export interface InboxItem {
  id: string;
  /** Klucz deduplikacji = identyfikator powiadomienia systemowego (bez prefiksu). */
  key?: string;
  kind: NotifKind;
  title: string;
  body: string;
  icon: IconName;
  createdAt: ISODate;
  read: boolean;
  /** Dokąd prowadzi tapnięcie (ścieżka expo-router). */
  href?: string;
}

/** Zaplanowany wpis: trafia do centrum, gdy nadejdzie `dueAt`; `system` = także powiadomienie systemowe. */
export interface PendingNotification extends PlannedNotification {
  system: boolean;
  /** Baner także na pierwszym planie (powiadomienie testowe). */
  banner?: boolean;
}

/** Maks. liczba wpisów w centrum (najstarsze odpadają). */
export const INBOX_CAP = 50;
const SEEN_CAP = 200;

/** Klucz cyklicznego powiadomienia systemowego → prefiks kluczy jego wpisów w centrum (src/store/notify.ts). */
const REPEATING_KEYS: Record<string, string> = { weekly: 'weekly.', 'gminy.weekly': 'gminy.week.' };

const addSeen = (seen: string[], keys: (string | undefined)[]) => {
  const add = keys.filter((k): k is string => !!k && !seen.includes(k));
  return add.length ? [...seen, ...add].slice(-SEEN_CAP) : seen;
};

export interface NotificationState {
  prefs: Record<NotifCategory, boolean>;
  /** Godzina przypomnienia o serii (pełne godziny). */
  reminderHour: number;
  permission: NotifPermission;
  inbox: InboxItem[];
  pending: PendingNotification[];
  /** Klucze już doręczonych wpisów (także usuniętych z centrum) – żeby nie przyszły drugi raz. */
  seen: string[];
  /**
   * Znaczniki cykli w aplikacji: dzień przypomnienia o serii, tydzień podsumowania / wyzwań (ms),
   * `activitySince` – najnowsza pobrana aktywność z serwera (tryb Supabase, `get_activity`).
   */
  marks: { streak?: string; weekly?: number; gminy?: number; askedAfterFollow?: boolean; activitySince?: string };

  setPref: (id: NotifCategory, on: boolean) => void;
  setReminderHour: (hour: number) => void;
  setPermission: (p: NotifPermission) => void;
  setMarks: (patch: NotificationState['marks']) => void;
  /** Dodaje wpis od razu (pomija wyłączone kategorie i duplikaty klucza). */
  push: (item: Omit<InboxItem, 'id' | 'read' | 'createdAt'> & { createdAt?: ISODate }) => InboxItem | null;
  /** Planuje wpisy (ten sam klucz = podmiana; już doręczone pomijamy). */
  enqueue: (items: PendingNotification[]) => void;
  /** Usuwa zaplanowane wpisy o kluczu zaczynającym się od `prefix`. */
  cancel: (prefix: string) => void;
  /** Przenosi zaległe wpisy do centrum; `all` = także przyszłe (panel dev). Zwraca nowe wpisy. */
  deliverDue: (opts?: { now?: number; all?: boolean }) => InboxItem[];
  markRead: (id: string) => void;
  markReadByKey: (key: string) => void;
  markAllRead: () => void;
  remove: (id: string) => void;
  clearInbox: () => void;
  reset: () => void;
}

const INITIAL = {
  prefs: { ...DEFAULT_NOTIF_PREFS },
  reminderHour: DEFAULT_REMINDER_HOUR,
  // Na webie lokalne powiadomienia systemowe nie działają – tylko centrum w aplikacji.
  permission: (Platform.OS === 'web' ? 'unsupported' : 'undetermined') as NotifPermission,
  inbox: [] as InboxItem[],
  pending: [] as PendingNotification[],
  seen: [] as string[],
  marks: {} as NotificationState['marks'],
};

const enabled = (prefs: Record<NotifCategory, boolean>, kind: NotifKind) => kind === 'system' || prefs[kind];

const byNewest = (a: InboxItem, b: InboxItem) => b.createdAt.localeCompare(a.createdAt);

export const useNotificationStore = create<NotificationState>()(
  persist(
    (set, get) => ({
      ...INITIAL,
      setPref: (id, on) => set((s) => ({ prefs: { ...s.prefs, [id]: on } })),
      setReminderHour: (hour) => set({ reminderHour: Math.min(23, Math.max(0, Math.round(hour))) }),
      setPermission: (permission) => {
        if (get().permission !== permission) set({ permission });
      },
      setMarks: (patch) => set((s) => ({ marks: { ...s.marks, ...patch } })),
      push: (item) => {
        const s = get();
        if (!enabled(s.prefs, item.kind)) return null;
        if (item.key && s.seen.includes(item.key)) return null;
        const entry: InboxItem = { ...item, id: makeId('ntf'), read: false, createdAt: item.createdAt ?? new Date().toISOString() };
        set({ inbox: [entry, ...s.inbox].sort(byNewest).slice(0, INBOX_CAP), seen: addSeen(s.seen, [item.key]) });
        return entry;
      },
      enqueue: (items) =>
        set((s) => {
          const fresh = items.filter((p) => !s.seen.includes(p.key));
          const keys = new Set(fresh.map((p) => p.key));
          return { pending: [...s.pending.filter((p) => !keys.has(p.key)), ...fresh] };
        }),
      cancel: (prefix) => set((s) => ({ pending: s.pending.filter((p) => !p.key.startsWith(prefix)) })),
      deliverDue: ({ now = Date.now(), all = false } = {}) => {
        const s = get();
        // Sekunda zapasu: powiadomienie systemowe i licznik w aplikacji odpalają „w tej samej chwili”.
        const due = s.pending.filter((p) => all || p.dueAt <= now + 1000);
        if (!due.length) return [];
        const fresh: InboxItem[] = due
          .filter((p) => enabled(s.prefs, p.kind) && !s.seen.includes(p.key))
          .sort((a, b) => a.dueAt - b.dueAt)
          .map((p) => ({
            id: makeId('ntf'),
            key: p.key,
            kind: p.kind,
            title: p.title,
            body: p.body,
            icon: p.icon,
            href: p.href,
            read: false,
            createdAt: new Date(Math.min(p.dueAt, now)).toISOString(),
          }));
        const dueKeys = new Set(due.map((p) => p.key));
        set({
          pending: s.pending.filter((p) => !dueKeys.has(p.key)),
          inbox: [...fresh, ...s.inbox].sort(byNewest).slice(0, INBOX_CAP),
          seen: addSeen(s.seen, [...dueKeys]),
        });
        return fresh;
      },
      markRead: (id) => set((s) => ({ inbox: s.inbox.map((i) => (i.id === id && !i.read ? { ...i, read: true } : i)) })),
      markReadByKey: (key) =>
        set((s) => {
          // Cykliczne powiadomienia systemowe mają jeden klucz, a wpisy w centrum – klucz z datą tygodnia.
          const prefix = REPEATING_KEYS[key];
          const hit = (k?: string) => k === key || (!!prefix && !!k?.startsWith(prefix));
          return { inbox: s.inbox.map((i) => (!i.read && hit(i.key) ? { ...i, read: true } : i)) };
        }),
      markAllRead: () => set((s) => ({ inbox: s.inbox.map((i) => (i.read ? i : { ...i, read: true })) })),
      remove: (id) => set((s) => ({ inbox: s.inbox.filter((i) => i.id !== id) })),
      clearInbox: () => set({ inbox: [] }),
      // Zgoda to stan systemu – reset aplikacji jej nie zmienia.
      reset: () => set((s) => ({ ...INITIAL, prefs: { ...DEFAULT_NOTIF_PREFS }, permission: s.permission })),
    }),
    {
      name: STORAGE_KEYS.notifications,
      storage: persistStorage,
      version: 1,
      // Zgodę zawsze czytamy z systemu po starcie – nie zapisujemy jej.
      partialize: ({ prefs, reminderHour, inbox, pending, seen, marks }) => ({ prefs, reminderHour, inbox, pending, seen, marks }),
      // Nowe kategorie dostają wartość domyślną (zapis sprzed ich dodania).
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<NotificationState>;
        return { ...current, ...p, prefs: { ...DEFAULT_NOTIF_PREFS, ...p.prefs } };
      },
    },
  ),
);

export const useUnreadCount = () => useNotificationStore((s) => s.inbox.reduce((n, i) => n + (i.read ? 0 : 1), 0));
