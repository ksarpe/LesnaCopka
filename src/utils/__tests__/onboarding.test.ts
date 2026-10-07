import { describe, expect, it } from '@jest/globals';

import type { User } from '@/types';
import {
  canAdvance,
  EMPTY_DRAFT,
  firstIncompleteStep,
  isLastStep,
  nextStep,
  ONBOARDING_STEPS,
  onboardingResult,
  prevStep,
  profileFields,
  stepBlocker,
  stepIndex,
  type OnboardingDraft,
} from '../onboarding';

const USER: User = {
  id: 'u-1',
  name: 'Grzybiarz',
  firstName: 'Grzybiarz',
  handle: '@grzybiarz_1a2b3c4d',
  level: 1,
  xp: 0,
  streakDays: 0,
  tripsCount: 0,
  mushroomsCount: 0,
  homeGminaId: 'suprasl',
};

const COMPLETE: OnboardingDraft = {
  ...EMPTY_DRAFT,
  safetyAck: true,
  termsAccepted: true,
  ageConfirmed: true,
  name: '  Leśny   Dziadek ',
  handle: 'lesny.dziadek',
  homeGminaId: 'hajnowka',
};

describe('onboarding – kroki', () => {
  it('6 kroków w kolejności z makiety zadania; dalej / wstecz nie wychodzą poza zakres', () => {
    expect(ONBOARDING_STEPS).toEqual(['welcome', 'safety', 'terms', 'profile', 'gmina', 'permissions']);
    expect(nextStep('welcome')).toBe('safety');
    expect(nextStep('gmina')).toBe('permissions');
    expect(nextStep('permissions')).toBe('permissions');
    expect(prevStep('safety')).toBe('welcome');
    expect(prevStep('welcome')).toBe('welcome');
    expect(stepIndex('terms')).toBe(2);
    expect(isLastStep('permissions')).toBe(true);
    expect(isLastStep('gmina')).toBe(false);
  });

  it('powitanie i uprawnienia nie blokują, bezpieczeństwo wymaga potwierdzenia', () => {
    expect(canAdvance('welcome', EMPTY_DRAFT, USER)).toBe(true);
    expect(canAdvance('permissions', EMPTY_DRAFT, USER)).toBe(true);
    expect(stepBlocker('safety', EMPTY_DRAFT, USER)).toMatch(/bezpieczeństwa/);
    expect(canAdvance('safety', { ...EMPTY_DRAFT, safetyAck: true }, USER)).toBe(true);
  });

  it('regulamin: akceptacja i 16 lat – oba wymagane', () => {
    expect(stepBlocker('terms', EMPTY_DRAFT, USER)).toMatch(/regulamin/);
    expect(stepBlocker('terms', { ...EMPTY_DRAFT, termsAccepted: true }, USER)).toMatch(/16 lat/);
    expect(stepBlocker('terms', { ...EMPTY_DRAFT, ageConfirmed: true }, USER)).toMatch(/regulamin/);
    expect(canAdvance('terms', { ...EMPTY_DRAFT, termsAccepted: true, ageConfirmed: true }, USER)).toBe(true);
  });

  it('profil: wartości z profilu, dopóki gracz ich nie zmieni; walidacja jak w edycji profilu', () => {
    expect(profileFields(EMPTY_DRAFT, USER)).toEqual({ name: 'Grzybiarz', handle: 'grzybiarz_1a2b3c4d' });
    // Nick z profilu serwera (24 znaki) jest za długi dla aplikacji (20) – trzeba go zmienić.
    expect(stepBlocker('profile', EMPTY_DRAFT, { ...USER, handle: '@grzybiarz_1a2b3c4d5e6f7a8b' })).toMatch(/Najwyżej/);
    expect(stepBlocker('profile', { ...EMPTY_DRAFT, name: ' ' }, USER)).toBe('Podaj imię');
    expect(stepBlocker('profile', { ...EMPTY_DRAFT, handle: 'Zły Nick' }, USER)).toMatch(/Tylko małe litery/);
    expect(stepBlocker('profile', { ...EMPTY_DRAFT, handle: 'ab' }, USER)).toMatch(/Co najmniej/);
    expect(canAdvance('profile', { ...EMPTY_DRAFT, name: 'Ola', handle: 'ola.w' }, USER)).toBe(true);
  });

  it('gmina domowa: trzeba ją wybrać świadomie (nie bierzemy domyślnej z profilu)', () => {
    expect(stepBlocker('gmina', EMPTY_DRAFT, USER)).toBe('Wybierz gminę domową');
    expect(canAdvance('gmina', { ...EMPTY_DRAFT, homeGminaId: 'suprasl' }, USER)).toBe(true);
  });

  it('pierwszy niekompletny krok', () => {
    expect(firstIncompleteStep(EMPTY_DRAFT, USER)).toBe('safety');
    expect(firstIncompleteStep({ ...COMPLETE, ageConfirmed: false }, USER)).toBe('terms');
    expect(firstIncompleteStep({ ...COMPLETE, homeGminaId: null }, USER)).toBe('gmina');
    expect(firstIncompleteStep(COMPLETE, USER)).toBeNull();
  });
});

describe('onboarding – wynik', () => {
  it('profil: imię oczyszczone, imię do powitania, nick z „@”, gmina domowa', () => {
    const r = onboardingResult(COMPLETE, USER);
    expect(r.user).toMatchObject({
      id: 'u-1',
      name: 'Leśny Dziadek',
      firstName: 'Leśny',
      handle: '@lesny.dziadek',
      homeGminaId: 'hajnowka',
    });
    expect(r.avatarChanged).toBe(false);
    expect(r.user.avatar).toBeUndefined();
  });

  it('avatar: motyw wybrany, ten sam co w profilu (bez zmiany) albo usunięty', () => {
    const chosen = onboardingResult({ ...COMPLETE, avatar: { kind: 'preset', id: 'sowa' } }, USER);
    expect(chosen.avatarChanged).toBe(true);
    expect(chosen.user.avatar).toEqual({ kind: 'preset', id: 'sowa' });

    const withPreset: User = { ...USER, avatar: { kind: 'preset', id: 'sowa' } };
    expect(onboardingResult({ ...COMPLETE, avatar: { kind: 'preset', id: 'sowa' } }, withPreset).avatarChanged).toBe(false);

    const removed = onboardingResult({ ...COMPLETE, avatar: null }, withPreset);
    expect(removed.avatarChanged).toBe(true);
    expect(removed.user.avatar).toBeUndefined();
  });

  it('niekompletny onboarding nie daje wyniku', () => {
    expect(() => onboardingResult({ ...COMPLETE, safetyAck: false }, USER)).toThrow(/safety/);
  });
});
