/**
 * Publikacja wyprawy w trybie Supabase (local-first): zdarzenie `trip.publish` w kolejce synchronizacji
 * (kolejka FIFO – po `trip.finish`) i od razu własny wpis „wysyłanie…” w telefonie. Feed pokazuje go na górze,
 * dopóki `get_feed` nie zwróci wpisu z serwera dla tej wyprawy (./feed.ts). Publikacja działa też offline.
 * Okładkę (najlepsze znalezisko ze zdjęciem) silnik wysyła do Storage tuż przed `publish_trip` (./photos.ts).
 */
import { catalog } from '@/store/useCatalogStore';
import { useNotificationStore } from '@/store/useNotificationStore';
import { useOutboxStore } from '@/store/useOutboxStore';
import { useTripStore } from '@/store/useTripStore';
import { ui } from '@/store/useUiStore';
import { useUserStore } from '@/store/useUserStore';
import type { Trip, TripPost } from '@/types';
import { localPostId } from '@/utils/social';
import { buildOwnTripPost, claimedFindsOf } from '@/utils/tripPost';

/** Wpis czekający na serwer + zdarzenie w kolejce. Zwraca wpis (id `local:<tripId>`) – Podsumowanie oznacza wyprawę. */
export function publishLocally(trip: Trip, hideRoute: boolean): TripPost {
  const user = useUserStore.getState().user;
  const post = buildOwnTripPost({
    id: localPostId(trip.id),
    trip,
    finds: claimedFindsOf(trip, useTripStore.getState().finds),
    author: { id: user.id, name: user.firstName, level: user.level, ringRarity: 'primary', handle: user.handle, avatar: user.avatar },
    speciesName: (id) => catalog().speciesById[id]?.name,
    hideRoute,
    now: new Date(),
  });
  const ob = useOutboxStore.getState();
  ob.addLocalPost(post);
  ob.enqueue({ type: 'trip.publish', payload: { tripId: trip.id, hideRoute, title: post.title } });
  return post;
}

/**
 * Serwer odrzucił publikację (np. koniec wyprawy do niego nie dotarł): wpis znika z feedu, wyprawa wraca
 * do „zakończonej” (Podsumowanie pozwala opublikować ją ponownie), plan „wpis widoczny” – do kosza.
 */
export function rejectLocalPublish(tripId: string) {
  useOutboxStore.getState().removeLocalPosts([tripId]);
  const ts = useTripStore.getState();
  const trip = ts.trips[tripId];
  if (trip?.status === 'published') ts.upsertTrip({ ...trip, status: 'finished', postId: undefined });
  useNotificationStore.getState().cancel(`visible.${localPostId(tripId)}`);
  ui.toast('Serwer nie przyjął publikacji wyprawy – spróbuj ponownie w podsumowaniu', 'cloud_off');
}
