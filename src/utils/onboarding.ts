/**
 * Onboarding (pierwsze uruchomienie, app/onboarding.tsx) – czyste funkcje: kroki, walidacja kroków i wynik
 * do zapisania w profilu. Testy: src/utils/__tests__/onboarding.test.ts.
 */
import type { User, UserAvatar } from '@/types';
import { cleanName, firstNameOf, handleBody, handleError, nameError, normalizeHandle } from './profile';

export const ONBOARDING_STEPS = ['welcome', 'safety', 'terms', 'profile', 'gmina', 'permissions'] as const;
export type OnboardingStep = (typeof ONBOARDING_STEPS)[number];

/** To, co gracz wybrał po drodze (stan ekranu). */
export interface OnboardingDraft {
  /** Krok 2: „Rozumiem – aplikacja nie decyduje, czy grzyb jest jadalny”. */
  safetyAck: boolean;
  /** Krok 3: „Akceptuję regulamin i politykę prywatności”. */
  termsAccepted: boolean;
  /** Krok 3: „Mam ukończone 16 lat”. */
  ageConfirmed: boolean;
  /** Krok 4: imię lub pseudonim / nick (bez „@”) – null = jeszcze nieruszone, pokazujemy wartość z profilu. */
  name: string | null;
  handle: string | null;
  /** Krok 4: avatar – undefined = bez zmian (z profilu), null = bez avatara. */
  avatar?: UserAvatar | null;
  /** Krok 5: gmina domowa wybrana świadomie (null = jeszcze nie). */
  homeGminaId: string | null;
}

export const EMPTY_DRAFT: OnboardingDraft = {
  safetyAck: false,
  termsAccepted: false,
  ageConfirmed: false,
  name: null,
  handle: null,
  homeGminaId: null,
};

export const stepIndex = (step: OnboardingStep) => ONBOARDING_STEPS.indexOf(step);
export const isLastStep = (step: OnboardingStep) => stepIndex(step) === ONBOARDING_STEPS.length - 1;

export function nextStep(step: OnboardingStep): OnboardingStep {
  return ONBOARDING_STEPS[Math.min(stepIndex(step) + 1, ONBOARDING_STEPS.length - 1)];
}

export function prevStep(step: OnboardingStep): OnboardingStep {
  return ONBOARDING_STEPS[Math.max(stepIndex(step) - 1, 0)];
}

/** Pola profilu do pokazania: wpisane w onboardingu albo bieżące z profilu (np. po synchronizacji z serwerem). */
export function profileFields(draft: OnboardingDraft, user: Pick<User, 'name' | 'handle'>) {
  return { name: draft.name ?? user.name, handle: draft.handle ?? handleBody(user.handle) };
}

/**
 * Dlaczego z kroku nie da się przejść dalej (komunikat pod przyciskiem) – null = można.
 * Uprawnienia i powitanie są zawsze opcjonalne.
 */
export function stepBlocker(step: OnboardingStep, draft: OnboardingDraft, user: Pick<User, 'name' | 'handle'>): string | null {
  switch (step) {
    case 'safety':
      return draft.safetyAck ? null : 'Zaznacz, że rozumiesz zasady bezpieczeństwa';
    case 'terms':
      if (!draft.termsAccepted) return 'Zaakceptuj regulamin i politykę prywatności';
      if (!draft.ageConfirmed) return 'Potwierdź, że masz ukończone 16 lat';
      return null;
    case 'profile': {
      const f = profileFields(draft, user);
      return nameError(f.name) ?? handleError(f.handle);
    }
    case 'gmina':
      return draft.homeGminaId ? null : 'Wybierz gminę domową';
    default:
      return null;
  }
}

export const canAdvance = (step: OnboardingStep, draft: OnboardingDraft, user: Pick<User, 'name' | 'handle'>) =>
  stepBlocker(step, draft, user) === null;

/** Pierwszy krok, którego warunki nie są spełnione (np. przed zapisem) – null = komplet. */
export function firstIncompleteStep(draft: OnboardingDraft, user: Pick<User, 'name' | 'handle'>): OnboardingStep | null {
  return ONBOARDING_STEPS.find((s) => !canAdvance(s, draft, user)) ?? null;
}

export interface OnboardingResult {
  /** Profil po onboardingu (store) – avatar: undefined = bez avatara. */
  user: User;
  /** Czy avatar się zmienił (→ zdarzenie `photo.avatar` w trybie Supabase). */
  avatarChanged: boolean;
}

/** Profil gracza po onboardingu. Rzuca, gdy kroki nie są kompletne (UI na to nie pozwala). */
export function onboardingResult(draft: OnboardingDraft, user: User): OnboardingResult {
  const missing = firstIncompleteStep(draft, user);
  if (missing) throw new Error(`Onboarding niekompletny: ${missing}`);
  const f = profileFields(draft, user);
  const name = cleanName(f.name);
  const next: User = { ...user, name, firstName: firstNameOf(name), handle: normalizeHandle(f.handle), homeGminaId: draft.homeGminaId! };
  const avatarChanged = draft.avatar !== undefined && !sameAvatar(draft.avatar ?? undefined, user.avatar);
  if (avatarChanged) {
    if (draft.avatar) next.avatar = draft.avatar;
    else delete next.avatar;
  }
  return { user: next, avatarChanged };
}

function sameAvatar(a?: UserAvatar, b?: UserAvatar) {
  if (!a || !b) return a === b;
  return a.kind === 'preset' ? b.kind === 'preset' && a.id === b.id : b.kind === 'photo' && a.uri === b.uri;
}
