import { useEffect, useSyncExternalStore } from 'react';
import { AppState } from 'react-native';

import { useServices } from '@/services';
import { systemNotifications } from '@/services/live/notifications';
import { ensureDailyReset } from '@/store/game';
import {
  deliverDue,
  onGminaFollowed,
  onGminaUnfollowed,
  onTripPublishedFromTrip,
  openHref,
  pollActivity,
  refreshNotificationPermission,
  requestSync,
  syncLongTrip,
  tickNotifications,
} from '@/store/notify';
import { useNotificationStore } from '@/store/useNotificationStore';
import { useSimStore } from '@/store/useSimStore';
import { useTripStore } from '@/store/useTripStore';
import { isServerPatch, useUserStore } from '@/store/useUserStore';

/** Co ile sprawdzamy zaległe wpisy, gdy aplikacja jest otwarta. */
const TICK_MS = 15000;
/** Co ile pytamy serwer o nową aktywność (tryb Supabase), gdy aplikacja jest na pierwszym planie. */
const ACTIVITY_MS = 2 * 60_000;

const onHydrated = (cb: () => void) => useNotificationStore.persist.onFinishHydration(cb);
const hasHydrated = () => useNotificationStore.persist.hasHydrated();

/**
 * Powiadomienia w tle (montowany raz w app/_layout.tsx, obok TripTracker): zgoda systemowa,
 * subskrypcje store'ów (start/koniec wyprawy, publikacja, obserwowane gminy, aktywność dziś),
 * doręczanie zaplanowanych wpisów do centrum i uzgadnianie powiadomień systemowych.
 * Tryb Supabase (FeedService.getActivity): reakcje, komentarze i zaproszenia z serwera – przy starcie,
 * po powrocie na pierwszy plan i co 2 min – zamiast symulowanych reakcji znajomych.
 */
export function NotificationsHost() {
  const { stats, feed } = useServices();
  // Centrum i plany z AsyncStorage – startujemy dopiero po hydratacji store'u.
  const hydrated = useSyncExternalStore(onHydrated, hasHydrated);

  useEffect(() => {
    if (!hydrated) return;
    const tick = () => void tickNotifications(stats);
    const realSocial = !!feed.getActivity;
    const poll = () => {
      if (realSocial && AppState.currentState !== 'background') void pollActivity(feed);
    };

    void systemNotifications.init();
    void refreshNotificationPermission().then(() => requestSync(0));
    syncLongTrip();
    tick();
    poll();

    // Tapnięcie powiadomienia systemowego → przeczytane + cel (także przy zimnym starcie).
    const offResponse = systemNotifications.onResponse(({ key, href }) => {
      deliverDue({ toast: false });
      useNotificationStore.getState().markReadByKey(key);
      if (href) setTimeout(() => openHref(href), 350);
    });
    // Na pierwszym planie zamiast banera – wpis w centrum i toast.
    const offReceived = systemNotifications.onReceived(({ banner }) => {
      deliverDue({ toast: !banner });
    });

    const timer = setInterval(tick, TICK_MS);
    const activityTimer = realSocial ? setInterval(poll, ACTIVITY_MS) : null;
    const app = AppState.addEventListener('change', (state) => {
      if (state !== 'active') return;
      // Po powrocie: zgoda mogła się zmienić w ustawieniach, a dzień – minąć (nowe zadania, przerwana seria).
      ensureDailyReset();
      void refreshNotificationPermission().then(() => requestSync());
      syncLongTrip();
      tick();
      poll();
    });

    const offTrips = useTripStore.subscribe((s, prev) => {
      if (s.activeTripId !== prev.activeTripId) {
        syncLongTrip();
        requestSync();
      }
      if (s.trips !== prev.trips) {
        // Tylko przejście istniejącej wyprawy → „published” (nie wczytanie gotowego stanu).
        Object.values(s.trips).forEach((t) => {
          const before = prev.trips[t.id];
          if (t.status === 'published' && t.postId && before && before.status !== 'published') {
            onTripPublishedFromTrip(t, { simulatedSocial: !realSocial });
          }
        });
      }
    });
    const offSim = useSimStore.subscribe((s, prev) => {
      if (s.timeSpeed !== prev.timeSpeed) syncLongTrip();
    });
    const offUser = useUserStore.subscribe((s, prev) => {
      if (s.followedGminy !== prev.followedGminy) {
        // Obserwowane z serwera (tryb Supabase: inny telefon, reinstalacja) – bez powitania „Obserwujesz gminę…”.
        if (!isServerPatch()) {
          s.followedGminy.filter((id) => !prev.followedGminy.includes(id)).forEach((id) => void onGminaFollowed(id, stats));
        }
        prev.followedGminy.filter((id) => !s.followedGminy.includes(id)).forEach(onGminaUnfollowed);
        requestSync();
      }
      if (s.lastActiveDate !== prev.lastActiveDate || s.user.streakDays !== prev.user.streakDays || s.user.homeGminaId !== prev.user.homeGminaId) {
        requestSync();
      }
    });
    const offNotif = useNotificationStore.subscribe((s, prev) => {
      if (s.prefs !== prev.prefs || s.reminderHour !== prev.reminderHour || s.pending !== prev.pending || s.permission !== prev.permission) {
        requestSync();
      }
    });

    return () => {
      offResponse();
      offReceived();
      clearInterval(timer);
      if (activityTimer) clearInterval(activityTimer);
      app.remove();
      offTrips();
      offSim();
      offUser();
      offNotif();
    };
  }, [stats, feed, hydrated]);

  return null;
}
