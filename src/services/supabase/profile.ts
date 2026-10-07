/**
 * Edycja profilu → serwer (tryb Supabase). Profil gracza żyje w useUserStore (zmiana widoczna od razu);
 * tu dokładamy zdarzenie `profile.update` do kolejki synchronizacji – silnik (./sync.ts) wyśle je, gdy
 * będzie sieć (nick/imię i gmina domowa osobno, żeby gmina spoza słownika nie blokowała nicku).
 * W kolejce czeka zawsze najnowsza wersja całego profilu. W trybie mock – nic. Nie rzuca.
 * Motyw avatara idzie do `profiles.avatar_preset` (widzą go inni w feedzie i u znajomych), zdjęcie profilowe –
 * osobnym zdarzeniem `photo.avatar` (Storage `avatars` + `profiles.avatar_path`, ./photos.ts); `bio` zostaje
 * lokalnie (w schemacie nie ma kolumny bio).
 */
import { useOutboxStore } from '@/store/useOutboxStore';
import { useUserStore } from '@/store/useUserStore';
import { profilePayload } from './gameState';

export interface ProfilePatch {
  name?: string;
  firstName?: string;
  /** Z „@” albo bez – w bazie bez (`^[a-z0-9._]{3,24}$`). */
  handle?: string;
  homeGminaId?: string;
}

/** Wywoływane po zapisaniu zmian w useUserStore; `p` nadpisuje to, co jest w store. */
export function syncProfile(p: ProfilePatch = {}): void {
  const user = useUserStore.getState().user;
  const payload = profilePayload({
    ...user,
    name: p.name ?? user.name,
    firstName: p.firstName ?? user.firstName,
    handle: p.handle ?? user.handle,
    homeGminaId: p.homeGminaId ?? user.homeGminaId,
  });
  useOutboxStore.getState().enqueue({ type: 'profile.update', payload });
}

/**
 * Zmiana avatara (zdjęcie / motyw / usunięcie) – wywoływane po zapisaniu profilu, gdy avatar się zmienił. Silnik
 * wyśle bieżący avatar z profilu: zdjęcie → Storage + `avatar_path`, inaczej `avatar_path = null` (w kolejce tylko najnowsza zmiana).
 */
export function syncAvatar(now = Date.now()): void {
  const avatar = useUserStore.getState().user.avatar;
  useOutboxStore.getState().enqueue({ type: 'photo.avatar', payload: { photo: avatar?.kind === 'photo', ts: now } });
}
