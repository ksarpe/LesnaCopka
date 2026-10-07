/**
 * Akcje znajomych wspólne dla ekranu Znajomi, mini profilu (PlayerSheet) i strony zaproszenia:
 * wywołanie FeedService, odświeżenie feedu (zakres „Znajomi”) i toast. Logika statusów – src/utils/friends.ts.
 */
import type { IconName } from '@/components/Icon';
import { ServiceError, type FeedService } from '@/services/types';
import type { FriendStatus, SocialUser } from '@/types';
import { friendActionError, friendActionToast, type FriendAction } from '@/utils/friends';
import { noteSocial } from './game';
import { useFeedSync } from './useFeedSync';
import { ui } from './useUiStore';

const ICON: Record<FriendAction, IconName> = {
  request: 'send',
  accept: 'group',
  reject: 'close',
  cancel: 'undo',
  remove: 'person_remove',
};

/** Wykonuje akcję i zwraca nowy status relacji (z serwera). Błąd leci dalej – UI cofa zmianę (friendActionFailed). */
export async function runFriendAction(feed: FeedService, user: SocialUser, action: FriendAction): Promise<FriendStatus> {
  let status: FriendStatus;
  switch (action) {
    case 'request':
      status = (await feed.addFriend(user.id)).friendStatus;
      break;
    case 'accept':
    case 'reject':
      status = await feed.respondFriendRequest(user.id, action === 'accept');
      break;
    default:
      await feed.removeFriend(user.id);
      status = 'none';
  }
  useFeedSync.getState().markStale();
  ui.toast(friendActionToast(action, user.name, status), action === 'request' && status === 'friends' ? 'group' : ICON[action]);
  // Nowy znajomy (przyjęte zaproszenie albo wzajemne) – osiągnięcie „Leśna wataha”.
  if (status === 'friends' && user.friendStatus !== 'friends' && (action === 'accept' || action === 'request')) noteSocial('friend');
  if (action === 'remove' && user.friendStatus === 'friends') noteSocial('friendRemoved');
  return status;
}

/** Toast po nieudanej akcji: brak sieci albo komunikat serwera. */
export function friendActionFailed(action: FriendAction, e: unknown) {
  const server = e instanceof ServiceError && e.code !== 'NETWORK';
  ui.toast(server ? e.message : friendActionError(action), server ? 'error' : 'wifi_off');
}
