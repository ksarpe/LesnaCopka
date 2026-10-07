/**
 * Koniec onboardingu (app/onboarding.tsx): profil, regulamin i flaga `onboarded`. W trybie Supabase trzy zdarzenia
 * kolejki w tej kolejności (FIFO): `profile.update` (+ `photo.avatar`, gdy zmienił się motyw) → `terms.accept`
 * (`accept_terms`) → `onboarding.complete` (`complete_onboarding`). W trybie mock kolejka jest wyłączona – zostaje
 * stan w telefonie.
 */
import { LEGAL_VERSION } from '@/data/legal';
import { syncAvatar, syncProfile } from '@/services/supabase/profile';
import type { User } from '@/types';
import { onboardingResult, type OnboardingDraft } from '@/utils/onboarding';
import { useOutboxStore } from './useOutboxStore';
import { useUserStore } from './useUserStore';

/** Zapisuje wynik onboardingu. Rzuca, gdy kroki nie są kompletne (UI na to nie pozwala). */
export function completeOnboarding(draft: OnboardingDraft, now = new Date()): User {
  const u = useUserStore.getState();
  const { user, avatarChanged } = onboardingResult(draft, u.user);
  const acceptedAt = now.toISOString();
  u.patch({ user, onboarded: true, terms: { version: LEGAL_VERSION, acceptedAt } });
  // Kolejność ma znaczenie: profil (nick, gmina) przed regulaminem i końcem onboardingu.
  syncProfile();
  if (avatarChanged) syncAvatar(now.getTime());
  const ob = useOutboxStore.getState();
  ob.enqueue({ type: 'terms.accept', payload: { version: LEGAL_VERSION } });
  ob.enqueue({ type: 'onboarding.complete', payload: { at: acceptedAt } });
  return user;
}

/** Panel /dev: pokaż onboarding jeszcze raz (bez zmiany postępów). */
export function devShowOnboarding() {
  useUserStore.getState().patch({ onboarded: false });
}

/** Panel /dev i dev-link `onboarding=0`: pomiń onboarding (bez zdarzeń na serwer). */
export function devSkipOnboarding() {
  useUserStore.getState().patch({ onboarded: true });
}
