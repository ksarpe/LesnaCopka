/**
 * Znajomi w obie strony (zaproszenia) – czyste funkcje dla ekranu Znajomi, mini profilu i strony zaproszenia.
 * Testy: src/utils/__tests__/friends.test.ts.
 */
import type { FriendsOverview, FriendStatus, SocialUser } from '@/types';

export type FriendAction = 'request' | 'accept' | 'reject' | 'cancel' | 'remove';

export const EMPTY_OVERVIEW: FriendsOverview = { friends: [], incoming: [], outgoing: [] };

const LIST_OF: Partial<Record<FriendStatus, keyof FriendsOverview>> = {
  friends: 'friends',
  incoming: 'incoming',
  outgoing: 'outgoing',
};

/** Relacja z grzybiarzem wg list ekranu (stan po ostatniej akcji); null = nie ma go na żadnej liście. */
export function statusIn(o: FriendsOverview | undefined, userId: string): FriendStatus | null {
  if (!o) return null;
  if (o.friends.some((u) => u.id === userId)) return 'friends';
  if (o.incoming.some((u) => u.id === userId)) return 'incoming';
  if (o.outgoing.some((u) => u.id === userId)) return 'outgoing';
  return null;
}

/**
 * Status do pokazania przy wyniku wyszukiwania: wynik ostatniej akcji na tym ekranie (`overrides`), potem listy
 * znajomych / zaproszeń, a gdy go tam nie ma – status z wyszukiwarki.
 */
export function effectiveStatus(
  o: FriendsOverview | undefined,
  user: SocialUser,
  overrides: Record<string, FriendStatus> = {},
): FriendStatus {
  return overrides[user.id] ?? statusIn(o, user.id) ?? user.friendStatus;
}

/** Grzybiarz z nowym statusem. */
export function withFriendStatus(user: SocialUser, status: FriendStatus): SocialUser {
  return { ...user, friendStatus: status, friend: status === 'friends' };
}

/** Przenosi grzybiarza na listę odpowiadającą statusowi (`none` – znika ze wszystkich). Nowe pozycje na górze. */
export function moveTo(o: FriendsOverview, user: SocialUser, status: FriendStatus): FriendsOverview {
  const drop = (l: SocialUser[]) => l.filter((u) => u.id !== user.id);
  const next: FriendsOverview = { friends: drop(o.friends), incoming: drop(o.incoming), outgoing: drop(o.outgoing) };
  const key = LIST_OF[status];
  if (key) next[key] = [withFriendStatus(user, status), ...next[key]];
  return next;
}

/**
 * Status od razu po tapnięciu (UI optymistyczne), zanim odpowie serwer. Zaproszenie do kogoś, kto sam zaprasza
 * gracza, to akceptacja; bez zaproszeń w obie strony (mock) dodanie działa od razu.
 */
export function optimisticStatus(action: FriendAction, current: FriendStatus, twoSided: boolean): FriendStatus {
  switch (action) {
    case 'request':
      return current === 'incoming' || !twoSided ? 'friends' : 'outgoing';
    case 'accept':
      return 'friends';
    default:
      return 'none';
  }
}

/** Komunikat po udanej akcji (`status` – wynik z serwera). */
export function friendActionToast(action: FriendAction, name: string, status: FriendStatus): string {
  switch (action) {
    case 'request':
      return status === 'friends' ? `${name} – dodano do znajomych` : `Wysłano zaproszenie do ${name}`;
    case 'accept':
      return `${name} – jesteście znajomymi`;
    case 'reject':
      return `Odrzucono zaproszenie od ${name}`;
    case 'cancel':
      return `Anulowano zaproszenie do ${name}`;
    case 'remove':
      return `${name} nie jest już Twoim znajomym`;
  }
}

/** Komunikat przy braku sieci. */
export function friendActionError(action: FriendAction): string {
  switch (action) {
    case 'request':
      return 'Brak sieci – nie udało się dodać znajomego';
    case 'accept':
    case 'reject':
      return 'Brak sieci – nie udało się odpowiedzieć na zaproszenie';
    case 'cancel':
      return 'Brak sieci – nie udało się anulować zaproszenia';
    case 'remove':
      return 'Brak sieci – nie udało się usunąć znajomego';
  }
}

/** Przycisk przy grzybiarzu na liście wyników: „Dodaj” / „Wysłano” / „Akceptuj” / „Znajomi”. */
export type FriendButton = 'add' | 'sent' | 'accept' | 'friends';

export function friendButton(status: FriendStatus): FriendButton {
  switch (status) {
    case 'friends':
      return 'friends';
    case 'outgoing':
      return 'sent';
    case 'incoming':
      return 'accept';
    default:
      return 'add';
  }
}
