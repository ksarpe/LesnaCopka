/**
 * Blokowanie grzybiarzy – wspólne dla mini profilu (PlayerSheet), menu wpisu w feedzie, menu komentarza
 * i ekranu Ustawienia → Prywatność → Zablokowani: potwierdzenie, wywołanie FeedService, odświeżenie feedu i toast.
 */
import { ServiceError, type FeedService } from '@/services/types';
import { useFeedSync } from './useFeedSync';
import { ui } from './useUiStore';

export const BLOCK_CONSEQUENCES = 'Nie zobaczycie nawzajem swoich wpisów i komentarzy, a znajomość zostanie usunięta.';

function failed(e: unknown, fallback: string) {
  const server = e instanceof ServiceError && e.code !== 'NETWORK';
  ui.toast(server ? e.message : fallback, server ? 'error' : 'wifi_off');
}

/** Blokuje od razu (bez pytania). Zwraca, czy się udało. */
export async function blockNow(feed: FeedService, user: { id: string; name: string }): Promise<boolean> {
  try {
    await feed.blockUser(user.id);
    useFeedSync.getState().markStale();
    ui.toast(`Zablokowano: ${user.name}`, 'block');
    return true;
  } catch (e) {
    failed(e, 'Brak sieci – nie udało się zablokować');
    return false;
  }
}

/** „Zablokuj” z potwierdzeniem; `onBlocked` – np. usunięcie wpisów / komentarzy z listy na ekranie. */
export function confirmBlock(feed: FeedService, user: { id: string; name: string }, onBlocked?: () => void) {
  ui.confirm({
    title: `Zablokować: ${user.name}?`,
    message: `${BLOCK_CONSEQUENCES} Odblokujesz w Ustawieniach → Prywatność → Zablokowani.`,
    icon: 'block',
    confirmLabel: 'Zablokuj',
    danger: true,
    onConfirm: async () => {
      if (await blockNow(feed, user)) onBlocked?.();
    },
  });
}

/** „Odblokuj” (bez przywracania znajomości). Zwraca, czy się udało. */
export async function unblockNow(feed: FeedService, user: { id: string; name: string }): Promise<boolean> {
  try {
    await feed.unblockUser(user.id);
    useFeedSync.getState().markStale();
    ui.toast(`Odblokowano: ${user.name}`, 'lock_open');
    return true;
  } catch (e) {
    failed(e, 'Brak sieci – nie udało się odblokować');
    return false;
  }
}
