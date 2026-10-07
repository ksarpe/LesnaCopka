/**
 * Akcje powiadomień spinające store'y (wyprawy, gracz, gminy) z centrum powiadomień w aplikacji
 * i lokalnymi powiadomieniami systemowymi (src/services/live/notifications.ts).
 *
 * Model: każde zdarzenie to wpis „zaplanowany” (useNotificationStore.pending) – trafia do centrum,
 * gdy nadejdzie jego czas, a natywnie (przy zgodzie) dostaje też powiadomienie systemowe o tym
 * samym kluczu. Cykliczne (seria, podsumowanie tygodnia, wyzwania gmin) planujemy w systemie
 * z wyprzedzeniem, a w centrum dopisujemy je przy otwarciu aplikacji po czasie.
 *
 * Reakcje, komentarze i zaproszenia: w mockach symulowane (plan po publikacji wyprawy), w trybie Supabase –
 * prawdziwa aktywność z serwera (`FeedService.getActivity`, pollActivity) na pierwszym planie, jako wpis
 * w centrum + toast (na pierwszym planie zamiast banera systemowego – jak pozostałe powiadomienia).
 */
import { router, type Href } from 'expo-router';

import { AUTHORS } from '@/data/mock/users';
import { systemNotifications, type SystemNotification } from '@/services/live/notifications';
import type { FeedService, StatsService } from '@/services/types';
import type { Trip, TripPost } from '@/types';
import { activityEntries } from '@/utils/activity';
import { fmtInt, fmtKm, plural } from '@/utils/format';
import {
  atHour,
  dayKey,
  GMINY_CHALLENGES,
  LONG_TRIP_MS,
  longTripNotification,
  lastWeeklyOccurrence,
  mockSocialNotifications,
  streakReminderPlan,
  visibleNotification,
  WEEKLY_SUMMARY,
  type PlannedNotification,
} from '@/utils/notifications';
import { catalog } from './useCatalogStore';
import { useFeedSync } from './useFeedSync';
import { INBOX_CAP, useNotificationStore, type InboxItem, type NotifPermission } from './useNotificationStore';
import { useSimStore } from './useSimStore';
import { tripElapsedMs, useTripStore } from './useTripStore';
import { ui, useUiStore } from './useUiStore';
import { todayKey, useUserStore } from './useUserStore';

/** Opóźnienie prywatności: inni widzą wpis po 24 h (jak Post.visibleFrom w mocku feedu). */
const VISIBILITY_DELAY_MS = 24 * 3600 * 1000;

const store = () => useNotificationStore.getState();

/* ───────────────────────── Zgoda ───────────────────────── */

export async function refreshNotificationPermission(): Promise<NotifPermission> {
  const p = await systemNotifications.getPermission();
  store().setPermission(p);
  return p;
}

export async function requestNotificationPermission(): Promise<NotifPermission> {
  const p = await systemNotifications.requestPermission();
  store().setPermission(p);
  return p;
}

/** Prośba o zgodę z komunikatem (ekran ustawień, dialog po obserwowaniu gminy). */
export async function enableNotifications(): Promise<NotifPermission> {
  const p = await requestNotificationPermission();
  if (p === 'granted') ui.toast('Powiadomienia włączone', 'notifications_active');
  else if (p === 'denied') ui.toast('Bez zgody – powiadomienia zobaczysz w centrum w aplikacji', 'notifications_off');
  return p;
}

/**
 * Po pierwszym obserwowaniu gminy: jeśli system jeszcze nie pytał o zgodę – pytamy (raz).
 * Wywoływane z ekranu gminy po przełączeniu „Obserwuj”.
 */
export function maybeAskNotificationsAfterFollow(gminaName: string) {
  const s = store();
  if (s.permission !== 'undetermined' || s.marks.askedAfterFollow || !s.prefs.gminy || !systemNotifications.supported()) return;
  s.setMarks({ askedAfterFollow: true });
  // Po toaście „Obserwujesz gminę…”.
  setTimeout(
    () =>
      useUiStore.getState().showDialog({
        title: 'Włączyć powiadomienia?',
        message: `Damy znać o nowych wyzwaniach w gminie ${gminaName} i reakcjach znajomych. Zmienisz to w Ustawieniach → Powiadomienia.`,
        icon: 'notifications_active',
        actions: [
          { label: 'Nie teraz', style: 'cancel' },
          { label: 'Włącz', style: 'primary', onPress: () => void enableNotifications() },
        ],
      }),
    900,
  );
}

/* ───────────────────────── Doręczanie do centrum ───────────────────────── */

/** Toast o nowych wpisach w centrum: jeden – jego tytuł, kilka – liczba. */
function toastFresh(fresh: InboxItem[]) {
  if (!fresh.length) return;
  const last = fresh[fresh.length - 1];
  const n = fresh.length;
  if (n === 1) ui.toast(last.title, last.icon);
  else ui.toast(`Masz ${n} ${plural(n, 'nowe powiadomienie', 'nowe powiadomienia', 'nowych powiadomień')}`, 'notifications_active');
}

/** Przenosi zaległe wpisy do centrum; nowy wpis (najnowszy) pokazujemy toastem. */
export function deliverDue(opts: { all?: boolean; toast?: boolean } = {}): InboxItem[] {
  const fresh = store().deliverDue({ all: opts.all });
  if (opts.toast !== false) toastFresh(fresh);
  return fresh;
}

let activityPoll: Promise<number> | null = null;

/**
 * Tryb Supabase: nowa aktywność innych (reakcje, komentarze, zaproszenia) → wpisy w centrum (klucz = id
 * aktywności, więc nic nie przychodzi dwa razy; wyłączona kategoria „social” – pomijane) i toast. Zapamiętuje
 * najnowszy znacznik z serwera. Bez `getActivity` (mocki) – nic. Nie rzuca; zwraca liczbę nowych wpisów.
 */
export function pollActivity(feed: Pick<FeedService, 'getActivity'>, opts: { toast?: boolean } = {}): Promise<number> {
  if (!feed.getActivity) return Promise.resolve(0);
  if (activityPoll) return activityPoll;
  const getActivity = feed.getActivity.bind(feed);
  activityPoll = (async () => {
    try {
      const since = store().marks.activitySince;
      const { entries, since: next } = activityEntries(await getActivity(since), since);
      const fresh = entries.map((e) => store().push(e)).filter((x): x is InboxItem => !!x);
      if (next && next !== since) store().setMarks({ activitySince: next });
      // Reakcje, komentarze i znajomi zmieniają feed – odświeży się po cichu przy powrocie na ekran.
      if (entries.length) useFeedSync.getState().markStale();
      if (opts.toast !== false) toastFresh(fresh);
      return fresh.length;
    } catch {
      return 0; // offline – spróbujemy przy następnym cyklu
    } finally {
      activityPoll = null;
    }
  })();
  return activityPoll;
}

/** Gracz był dziś w lesie (wyprawa / skan) albo wyprawa właśnie trwa. */
export function isActiveToday(): boolean {
  return useUserStore.getState().lastActiveDate === todayKey() || !!useTripStore.getState().activeTripId;
}

function streakPlan(now = new Date()) {
  const u = useUserStore.getState();
  return streakReminderPlan({
    now,
    hour: store().reminderHour,
    activeToday: isActiveToday(),
    lastActiveDate: u.lastActiveDate,
    streakDays: u.user.streakDays,
  });
}

let ticking = false;

/**
 * Cykl w aplikacji (co kilkanaście sekund i po powrocie na pierwszy plan): zaległe wpisy,
 * przypomnienie o serii po godzinie przypomnienia, podsumowanie tygodnia i wyzwania gmin.
 */
export async function tickNotifications(stats: StatsService) {
  if (ticking) return;
  ticking = true;
  try {
    deliverDue();
    const s = store();
    const now = new Date();

    // Seria: po godzinie przypomnienia, bez aktywności dziś – raz dziennie.
    const today = dayKey(now);
    const at = atHour(now, 0, s.reminderHour);
    if (s.prefs.streak && s.marks.streak !== today && now >= at && !isActiveToday()) {
      s.setMarks({ streak: today });
      const item = streakPlan(new Date(at.getTime() - 1)).find((p) => p.key === `streak.${today}`);
      if (item) {
        const entry = s.push({ ...item, createdAt: at.toISOString() });
        if (entry) ui.toast(entry.title, entry.icon);
      }
    }

    // Podsumowanie tygodnia (niedziela 19:00). Pierwsze uruchomienie tylko zapamiętuje tydzień.
    const weekly = lastWeeklyOccurrence(now, WEEKLY_SUMMARY.weekday, WEEKLY_SUMMARY.hour).getTime();
    if (s.marks.weekly == null) s.setMarks({ weekly });
    else if (weekly > s.marks.weekly) {
      s.setMarks({ weekly });
      if (s.prefs.weekly) {
        const entry = s.push({ ...(await weeklySummary(stats)), key: `weekly.${dayKey(new Date(weekly))}`, createdAt: new Date(weekly).toISOString() });
        if (entry) ui.toast(entry.title, entry.icon);
      }
    }

    // Wyzwania tygodnia w obserwowanych gminach (poniedziałek 9:00).
    const challenges = lastWeeklyOccurrence(now, GMINY_CHALLENGES.weekday, GMINY_CHALLENGES.hour).getTime();
    if (s.marks.gminy == null) s.setMarks({ gminy: challenges });
    else if (challenges > s.marks.gminy) {
      s.setMarks({ gminy: challenges });
      const followed = useUserStore.getState().followedGminy.slice(0, 3);
      if (s.prefs.gminy && followed.length) {
        const week = dayKey(new Date(challenges));
        let last: InboxItem | null = null;
        for (const id of followed) {
          const item = await challengeItem(stats, id, `gminy.week.${week}.${id}`, challenges);
          if (item) last = store().push({ ...item, createdAt: new Date(challenges).toISOString() }) ?? last;
        }
        if (last) ui.toast(last.title, last.icon);
      }
    }
  } finally {
    ticking = false;
  }
}

async function weeklySummary(stats: StatsService): Promise<Omit<PlannedNotification, 'key' | 'dueAt'>> {
  const u = useUserStore.getState();
  const home = catalog().gminaById[u.user.homeGminaId];
  let rank = '';
  let contribution = u.weeklyContribution;
  let empty = false;
  try {
    // Mocki: ranking podlaskiego z makiety (jak dotąd). Z bazą: województwo gminy domowej i wkład z serwera.
    const r = await stats.getRanking('week', stats.live && home ? { voivodeship: home.voivodeship } : undefined);
    const row = r.rows.find((x) => x.gminaId === u.user.homeGminaId);
    if (row && home) rank = `${home.name} zajmuje ${row.rank}. miejsce w rankingu tygodnia. `;
    if (stats.live) {
      contribution = r.userContribution;
      empty = !r.rows.length;
    }
  } catch {
    // Offline – bez miejsca w rankingu.
  }
  return {
    kind: 'weekly',
    title: 'Podsumowanie tygodnia',
    // Pusty ranking z bazy (nikt w województwie nie ma punktów) – neutralna zachęta zamiast „0 pkt”.
    body:
      empty && !contribution
        ? 'W tym tygodniu nikt w Twoim województwie nie zdobył jeszcze punktów – wybierz się na grzyby i bądź pierwszy!'
        : `${rank}Twój wkład: ${fmtInt(contribution)} pkt. Zobacz pełny ranking gmin.`,
    icon: 'emoji_events',
    href: '/gminy',
  };
}

async function challengeItem(stats: StatsService, gminaId: string, key: string, dueAt: number): Promise<PlannedNotification | null> {
  const name = catalog().gminaById[gminaId]?.name ?? gminaId;
  try {
    const st = await stats.getGminaStats(gminaId);
    // Brak wyzwania albo (tryb Supabase) gracz już je przyjął / ukończył – nie ma o czym przypominać.
    if (!st.challenge || st.challengeAccepted || st.challengeCompleted) return null;
    return {
      key,
      kind: 'gminy',
      title: `Wyzwanie w gminie ${name}`,
      body: `${st.challenge.title} · +${fmtInt(st.challenge.xp)} XP. Przyjmij je na ekranie gminy.`,
      icon: 'flag',
      href: `/gminy/${gminaId}`,
      dueAt,
    };
  } catch {
    return null;
  }
}

/* ───────────────────────── Zdarzenia gry ───────────────────────── */

/** „Wciąż w lesie?” po 3 h wyprawy (czas z uwzględnieniem przyspieszenia z panelu dev). */
export function syncLongTrip() {
  const ts = useTripStore.getState();
  const trip = ts.activeTripId ? ts.trips[ts.activeTripId] : null;
  const key = trip ? `longTrip.${trip.id}` : null;
  store()
    .pending.filter((p) => p.kind === 'longTrip' && p.key !== key)
    .forEach((p) => store().cancel(p.key));
  if (!trip || !key) return;
  const speed = useSimStore.getState().timeSpeed;
  const now = Date.now();
  const dueAt = now + Math.max(0, LONG_TRIP_MS - tripElapsedMs(trip, speed, now)) / speed;
  const existing = store().pending.find((p) => p.key === key);
  if (existing && Math.abs(existing.dueAt - dueAt) < 60000) return;
  store().enqueue([{ ...longTripNotification(trip.id, dueAt), system: true }]);
}

/**
 * Publikacja wyprawy: „wpis widoczny dla innych” po opóźnieniu prywatności i (mocki) symulowane reakcje
 * znajomych – w trybie Supabase reakcje przychodzą z serwera (pollActivity), więc `simulatedSocial: false`.
 * Host wywołuje to sam po zmianie statusu wyprawy na „published”; z dokładnym wpisem
 * (visibleFrom z serwera) można wywołać bezpośrednio – ten sam klucz podmienia plan.
 */
export function onTripPublished(
  post: Pick<TripPost, 'id' | 'gminaId' | 'visibleFrom'> & { detail?: string },
  opts: { simulatedSocial?: boolean } = {},
) {
  const visibleFrom = new Date(post.visibleFrom).getTime();
  const name = catalog().gminaById[post.gminaId]?.name;
  const detail = post.detail ?? (name ? `z gminy ${name}` : '');
  const social = opts.simulatedSocial === false ? [] : mockSocialNotifications(post.id, visibleFrom, Object.values(AUTHORS));
  const items = [visibleNotification(post.id, detail, visibleFrom), ...social];
  store().enqueue(items.map((i) => ({ ...i, system: true })));
}

/** Z wyprawy (bez wpisu): visibleFrom = teraz + 24 h, opis z dystansu i liczby grzybów. */
export function onTripPublishedFromTrip(trip: Trip, opts: { simulatedSocial?: boolean } = {}) {
  if (!trip.postId) return;
  const finds = useTripStore.getState().finds;
  const mushrooms = trip.findIds.filter((id) => finds[id]?.collected).length;
  const name = catalog().gminaById[trip.gminaId]?.name;
  const parts = [fmtKm(trip.distanceKm), `${mushrooms} ${plural(mushrooms, 'grzyb', 'grzyby', 'grzybów')}`];
  onTripPublished({
    id: trip.postId,
    gminaId: trip.gminaId,
    visibleFrom: new Date(Date.now() + VISIBILITY_DELAY_MS).toISOString(),
    detail: `${name ? `z gminy ${name} ` : ''}(${parts.join(', ')})`,
  }, opts);
}

/** Obserwowanie gminy: powitanie od razu, a po chwili bieżące wyzwanie gminy (jeśli jest). */
export async function onGminaFollowed(gminaId: string, stats: StatsService) {
  const s = store();
  if (!s.prefs.gminy) return;
  const name = catalog().gminaById[gminaId]?.name ?? gminaId;
  s.push({
    key: `gminy.follow.${gminaId}`,
    kind: 'gminy',
    title: `Obserwujesz gminę ${name}`,
    body: 'Damy znać o nowych wyzwaniach tygodnia w tej gminie.',
    icon: 'notifications_active',
    href: `/gminy/${gminaId}`,
  });
  const item = await challengeItem(stats, gminaId, `gminy.challenge.${gminaId}`, Date.now() + 20000);
  if (item && useUserStore.getState().followedGminy.includes(gminaId)) store().enqueue([{ ...item, system: true }]);
}

export function onGminaUnfollowed(gminaId: string) {
  store().cancel(`gminy.challenge.${gminaId}`);
}

/* ───────────────────────── Powiadomienia systemowe ───────────────────────── */

let syncTimer: ReturnType<typeof setTimeout> | null = null;
let syncing: Promise<void> | null = null;
let syncAgain = false;

/** Uzgodnienie zaplanowanych powiadomień systemowych z preferencjami i stanem gry (z opóźnieniem). */
export function requestSync(delayMs = 400) {
  if (syncTimer) clearTimeout(syncTimer);
  syncTimer = setTimeout(() => {
    syncTimer = null;
    void syncSystemNotifications();
  }, delayMs);
}

export async function syncSystemNotifications(): Promise<void> {
  if (syncing) {
    syncAgain = true;
    return syncing;
  }
  syncing = (async () => {
    try {
      do {
        syncAgain = false;
        await reconcileOnce();
      } while (syncAgain);
    } finally {
      syncing = null;
    }
  })();
  return syncing;
}

async function reconcileOnce() {
  if (!systemNotifications.supported()) return;
  const s = store();
  // Bez zgody nic nie planujemy (zaplanowane wcześniej i tak się nie pokażą).
  if (s.permission !== 'granted') return;
  const now = Date.now();
  const desired: SystemNotification[] = [];
  const keep = new Set<string>();
  s.pending.forEach((p) => {
    if (!p.system || (p.kind !== 'system' && !s.prefs[p.kind])) return;
    keep.add(p.key);
    if (p.dueAt > now + 1000) {
      desired.push({ key: p.key, title: p.title, body: p.body, href: p.href, banner: p.banner, trigger: { type: 'date', at: p.dueAt } });
    }
  });
  if (s.prefs.streak) {
    streakPlan().forEach((p) => desired.push({ key: p.key, title: p.title, body: p.body, href: p.href, trigger: { type: 'date', at: p.dueAt } }));
  }
  const u = useUserStore.getState();
  if (s.prefs.weekly) {
    const home = catalog().gminaById[u.user.homeGminaId]?.name;
    desired.push({
      key: 'weekly',
      title: 'Podsumowanie tygodnia',
      body: home ? `Sprawdź, które miejsce zajęła gmina ${home} i ile punktów dołożyłeś.` : 'Sprawdź ranking gmin i swój wkład w tym tygodniu.',
      href: '/gminy',
      trigger: { type: 'weekly', ...WEEKLY_SUMMARY },
    });
  }
  if (s.prefs.gminy && u.followedGminy.length) {
    const first = catalog().gminaById[u.followedGminy[0]]?.name ?? u.followedGminy[0];
    const more = u.followedGminy.length - 1;
    desired.push({
      key: 'gminy.weekly',
      title: 'Nowe wyzwania w obserwowanych gminach',
      body: more ? `Sprawdź, co nowego w gminie ${first} i ${more} ${plural(more, 'innej', 'innych', 'innych')}.` : `Sprawdź nowe wyzwanie tygodnia w gminie ${first}.`,
      href: u.followedGminy.length === 1 ? `/gminy/${u.followedGminy[0]}` : '/gminy',
      trigger: { type: 'weekly', ...GMINY_CHALLENGES },
    });
  }
  await systemNotifications.reconcile(desired, keep);
}

/* ───────────────────────── Akcje ekranów ───────────────────────── */

const TAB_ROOTS = new Set(['/', '/feed', '/gminy', '/profil']);

/** Nawigacja do celu powiadomienia (zakładki – navigate, reszta – push). */
export function openHref(href: string) {
  if (TAB_ROOTS.has(href)) router.navigate(href as Href);
  else router.push(href as Href);
}

/** Tapnięcie wpisu w centrum: przeczytany + przejście do celu. */
export function openNotification(item: InboxItem) {
  store().markRead(item.id);
  if (item.href) openHref(item.href);
}

/** „Wyślij testowe powiadomienie”: systemowe (natywnie, przy zgodzie) albo tylko wpis w centrum. */
export async function sendTestNotification(delaySec = 3): Promise<'system' | 'inbox'> {
  const s = store();
  const key = `test.${Date.now()}`;
  const item: PlannedNotification = {
    key,
    kind: 'system',
    title: 'Testowe powiadomienie',
    body: 'Tak wyglądają powiadomienia Grzybobrania. Darz grzyb!',
    icon: 'notifications_active',
    href: '/powiadomienia',
    dueAt: Date.now() + delaySec * 1000,
  };
  const system = systemNotifications.supported() && s.permission === 'granted';
  s.enqueue([{ ...item, system, banner: system }]);
  if (system) {
    await systemNotifications.schedule({ key, title: item.title, body: item.body, href: item.href, banner: true, trigger: { type: 'seconds', seconds: delaySec } });
    ui.toast(`Powiadomienie za ${delaySec} s – możesz zminimalizować aplikację`, 'schedule');
  } else {
    ui.toast(`Powiadomienie testowe pojawi się w centrum za ${delaySec} s`, 'schedule');
  }
  // Baner systemowy wystarczy – toast tylko dla wpisu w samym centrum.
  setTimeout(() => deliverDue({ toast: !system }), delaySec * 1000 + 300);
  return system ? 'system' : 'inbox';
}

/** Panel dev: przykładowe wpisy we wszystkich kategoriach (część przeczytana). */
export function addSampleNotifications() {
  const now = Date.now();
  const min = 60000;
  const home = useUserStore.getState().user.homeGminaId;
  const name = catalog().gminaById[home]?.name ?? 'Supraśl';
  const [a, b] = [AUTHORS.ola, AUTHORS.marek];
  const samples: (Omit<InboxItem, 'id' | 'createdAt'> & { ago: number })[] = [
    { kind: 'social', title: `${a.name}: Darz grzyb!`, body: 'Pierwsza reakcja na Twoją wyprawę – wpis właśnie pojawił się u znajomych.', icon: 'favorite', href: '/feed', read: false, ago: 6 * min },
    { kind: 'social', title: `Nowy komentarz od ${b.name}`, body: '„Piękne okazy! Gdzie takie rosną?”', icon: 'chat_bubble', href: '/feed', read: false, ago: 48 * min },
    { kind: 'visible', title: 'Twoja wyprawa jest już widoczna', body: `Znajomi widzą już Twoją wyprawę z gminy ${name} (6,4 km, 9 grzybów) – bez dokładnej lokalizacji.`, icon: 'visibility', href: '/feed', read: false, ago: 3 * 60 * min },
    { kind: 'gminy', title: `Wyzwanie w gminie ${name}`, body: 'Znajdź kanię w Puszczy Knyszyńskiej · +300 XP. Przyjmij je na ekranie gminy.', icon: 'flag', href: `/gminy/${home}`, read: false, ago: 26 * 60 * min },
    { kind: 'streak', title: 'Nie przerwij serii 3 dni!', body: 'Wystarczy krótka wyprawa albo jeden skan przed północą.', icon: 'local_fire_department', href: '/', read: true, ago: 30 * 60 * min },
    { kind: 'weekly', title: 'Podsumowanie tygodnia', body: `${name} zajmuje 1. miejsce w rankingu tygodnia. Twój wkład: 1 280 pkt.`, icon: 'emoji_events', href: '/gminy', read: true, ago: 3 * 24 * 60 * min },
    { kind: 'longTrip', title: 'Wciąż w lesie?', body: 'Wyprawa trwa już ponad 3 godziny. Zakończ ją, żeby zapisać wynik – albo zbieraj dalej.', icon: 'hiking', href: '/', read: true, ago: 4 * 24 * 60 * min },
  ];
  const items: InboxItem[] = samples.map(({ ago, ...x }, i) => ({
    ...x,
    id: `ntf_sample_${now.toString(36)}_${i}`,
    key: `sample.${now}.${i}`,
    createdAt: new Date(now - ago).toISOString(),
  }));
  useNotificationStore.setState((st) => ({
    inbox: [...items, ...st.inbox].sort((x, y) => y.createdAt.localeCompare(x.createdAt)).slice(0, INBOX_CAP),
  }));
}
