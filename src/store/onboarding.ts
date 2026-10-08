/**
 * Koniec onboardingu (app/onboarding.tsx – jedno naciśnięcie „Zaczynamy!”): akceptacja regulaminu (wersja i czas)
 * i flaga `onboarded`. W trybie Supabase dwa zdarzenia kolejki w tej kolejności (FIFO): `terms.accept`
 * (`accept_terms`) → `onboarding.complete` (`complete_onboarding`). Onboarding nie wysyła profilu (nick i imię –
 * z serwera albo domyślne, zmiana w Ustawieniach → Edytuj profil), a gminę domową przyjmuje pierwsze wykrycie GPS
 * (adoptHomeGmina). W trybie mock kolejka jest wyłączona – zostaje stan w telefonie.
 */
import { LEGAL_VERSION } from '@/data/legal';
import { syncProfile } from '@/services/supabase/profile';
import { shouldAdoptHomeGmina } from '@/utils/onboarding';
import { freshPlayerState } from './game';
import { outboxEnabled, useOutboxStore } from './useOutboxStore';
import { useUserStore } from './useUserStore';

/** Zapisuje akceptację regulaminu (LEGAL_VERSION, teraz) i koniec onboardingu – layout sam przełączy na zakładki. */
export function completeOnboarding(now = new Date()): void {
  const acceptedAt = now.toISOString();
  const terms = { version: LEGAL_VERSION, acceptedAt };
  const u = useUserStore.getState();
  if (outboxEnabled() && !useOutboxStore.getState().syncedUserId) {
    // Z serwerem, ale bez przyjętego jeszcze stanu konta (pierwsze uruchomienie bez sieci albo szybsze niż połączenie):
    // w telefonie wciąż gracz demo z makiety – zaczynamy od nowego gracza (jak po wylogowaniu, wipeLocalData), a stan
    // konta przyjmie pierwsza synchronizacja (`replace`).
    u.reset({
      ...freshPlayerState({ name: 'Grzybiarz', firstName: 'Grzybiarz', handle: '@grzybiarz' }),
      onboarded: true,
      terms,
      homeGminaPending: true,
    });
  } else {
    u.patch({ onboarded: true, terms });
  }
  // Kolejność ma znaczenie: regulamin przed końcem onboardingu (complete_onboarding go nie sprawdza).
  const ob = useOutboxStore.getState();
  ob.enqueue({ type: 'terms.accept', payload: { version: LEGAL_VERSION } });
  ob.enqueue({ type: 'onboarding.complete', payload: { at: acceptedAt } });
}

/**
 * Gmina domowa z wykrycia GPS (Start), dopóki gracz żadnej nie wybrał (`homeGminaPending` – nowy gracz po onboardingu).
 * Z serwerem dopiero po pierwszym przyjęciu stanu konta (shouldAdoptHomeGmina). Zwraca true, gdy przyjęła – wtedy
 * gmina idzie też na serwer (`profile.update`). Ręczny wybór (Ustawienia → Gmina domowa) kasuje flagę.
 */
export function adoptHomeGmina(gminaId: string): boolean {
  const u = useUserStore.getState();
  const ok = shouldAdoptHomeGmina({
    pending: !!u.homeGminaPending,
    serverMode: outboxEnabled(),
    synced: !!useOutboxStore.getState().syncedUserId,
  });
  if (!ok) return false;
  u.patch({ user: { ...u.user, homeGminaId: gminaId }, homeGminaPending: false });
  syncProfile({ homeGminaId: gminaId });
  return true;
}

/** Panel /dev: pokaż onboarding jeszcze raz (bez zmiany postępów). */
export function devShowOnboarding() {
  useUserStore.getState().patch({ onboarded: false });
}

/** Panel /dev i dev-link `onboarding=0`: pomiń onboarding (bez zdarzeń na serwer). */
export function devSkipOnboarding() {
  useUserStore.getState().patch({ onboarded: true });
}
