import { useEffect } from 'react';

import { useRegionStore } from '@/hooks/useRegion';
import { adoptHomeGmina } from '@/store/onboarding';
import { useOutboxStore } from '@/store/useOutboxStore';
import { ui, useUiStore } from '@/store/useUiStore';
import { useUserStore } from '@/store/useUserStore';

/**
 * Nowy gracz (onboarding nie pyta o gminę domową): pierwsza wykryta gmina zostaje domową (adoptHomeGmina – z serwerem
 * dopiero po pierwszym przyjęciu stanu konta, stąd zależność od `syncedUserId`). Wykrycie ze Startu, Skanu i mapy liczy
 * się tak samo. Montowane w głównym layoucie (obok TripTrackera), a nie na Starcie – ekrany i zakładki w tle są
 * zamrażane (`freezeOnBlur`), więc efekt na Starcie nie zadziałałby, dopóki gracz tam nie wróci.
 */
export function HomeGminaFromGps() {
  const region = useRegionStore((s) => s.region);
  const pending = useUserStore((s) => !!s.homeGminaPending);
  const synced = useOutboxStore((s) => s.syncedUserId);
  useEffect(() => {
    if (!region || !pending || !adoptHomeGmina(region.gmina.id)) return;
    // Powitanie z onboardingu może jeszcze wisieć – ten komunikat po nim (toast jest globalny, bez sprzątania timera:
    // zmiana `pending` po przyjęciu gminy i tak przerysuje ekran).
    const wait = useUiStore.getState().toast ? 2700 : 0;
    setTimeout(() => ui.toast(`Gmina domowa: ${region.gmina.name} – zmienisz ją w Ustawieniach`, 'home_pin'), wait);
  }, [region, pending, synced]);
  return null;
}
