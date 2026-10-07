/**
 * Koniec onboardingu: stan w telefonie, zdarzenia kolejki (FIFO: profil → regulamin → koniec onboardingu),
 * ich RPC i przyjęcie onboardingu / regulaminu ze stanu serwera.
 */
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';

import { LEGAL_VERSION, REGULAMIN } from '@/data/legal';
import { EMPTY_DRAFT, type OnboardingDraft } from '@/utils/onboarding';

/* eslint-disable @typescript-eslint/no-require-imports */
jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));
jest.mock('@/geo', () => ({ missingGminy: () => Promise.resolve([]) }));

const { completeOnboarding, devShowOnboarding, devSkipOnboarding } = require('../onboarding') as typeof import('../onboarding');
const { enqueueItem, makeItem, setOutboxEnabled, useOutboxStore } = require('../useOutboxStore') as typeof import('../useOutboxStore');
const { initialUserState, useUserStore } = require('../useUserStore') as typeof import('../useUserStore');
const { rpcFor, tolerated } = require('../../services/supabase/syncRpc') as typeof import('../../services/supabase/syncRpc');
const { onboardingFromServer, parseGameState } = require('../../services/supabase/gameState') as typeof import('../../services/supabase/gameState');
/* eslint-enable @typescript-eslint/no-require-imports */

const DRAFT: OnboardingDraft = {
  ...EMPTY_DRAFT,
  safetyAck: true,
  termsAccepted: true,
  ageConfirmed: true,
  name: 'Ola Wiśniewska',
  handle: 'ola.las',
  avatar: { kind: 'preset', id: 'wrzos' },
  homeGminaId: 'hajnowka',
};

const types = () => useOutboxStore.getState().items.map((x) => x.type);

beforeEach(() => {
  useOutboxStore.getState().reset();
  useUserStore.getState().reset({ onboarded: false });
});

afterEach(() => setOutboxEnabled(false));

describe('wersja regulaminu', () => {
  it('LEGAL_VERSION = data ostatniej zmiany dokumentów (1–32 znaki, jak wymaga accept_terms)', () => {
    expect(LEGAL_VERSION).toBe(REGULAMIN.updated);
    expect(LEGAL_VERSION.length).toBeGreaterThan(0);
    expect(LEGAL_VERSION.length).toBeLessThanOrEqual(32);
  });
});

describe('completeOnboarding', () => {
  it('tryb Supabase: profil, motyw avatara, regulamin i koniec onboardingu w kolejce – w tej kolejności', () => {
    setOutboxEnabled(true);
    const user = completeOnboarding(DRAFT, new Date('2026-10-07T08:00:00.000Z'));

    const s = useUserStore.getState();
    expect(s.onboarded).toBe(true);
    expect(s.terms).toEqual({ version: LEGAL_VERSION, acceptedAt: '2026-10-07T08:00:00.000Z' });
    expect(user).toMatchObject({ name: 'Ola Wiśniewska', firstName: 'Ola', handle: '@ola.las', homeGminaId: 'hajnowka' });
    expect(s.user.avatar).toEqual({ kind: 'preset', id: 'wrzos' });

    expect(types()).toEqual(['profile.update', 'photo.avatar', 'terms.accept', 'onboarding.complete']);
    const [profile, , terms, done] = useOutboxStore.getState().items;
    expect(profile.payload).toMatchObject({ displayName: 'Ola Wiśniewska', firstName: 'Ola', handle: 'ola.las', homeGminaId: 'hajnowka', avatarPreset: 'wrzos' });
    expect(terms.payload).toEqual({ version: LEGAL_VERSION });
    expect(done.payload).toEqual({ at: '2026-10-07T08:00:00.000Z' });
  });

  it('bez zmiany avatara – bez zdarzenia zdjęcia; czekający profil zostaje przed regulaminem', () => {
    setOutboxEnabled(true);
    useOutboxStore.getState().enqueue({ type: 'trip.start', payload: { tripId: 't1', gminaId: 'suprasl', startedAt: '2026-10-07T06:00:00.000Z' } });
    useOutboxStore.getState().enqueue({
      type: 'profile.update',
      payload: { displayName: 'Stare', firstName: 'Stare', handle: 'stare', homeGminaId: 'suprasl' },
    });
    completeOnboarding({ ...DRAFT, avatar: undefined });
    expect(types()).toEqual(['trip.start', 'profile.update', 'terms.accept', 'onboarding.complete']);
    // W kolejce najnowsza wersja profilu (na miejscu starej).
    expect(useOutboxStore.getState().items[1].payload).toMatchObject({ handle: 'ola.las' });
  });

  it('tryb mock: tylko stan w telefonie (kolejka wyłączona)', () => {
    completeOnboarding(DRAFT);
    expect(useUserStore.getState().onboarded).toBe(true);
    expect(useOutboxStore.getState().items).toEqual([]);
  });

  it('niekompletny onboarding nic nie zapisuje', () => {
    setOutboxEnabled(true);
    expect(() => completeOnboarding({ ...DRAFT, ageConfirmed: false })).toThrow();
    expect(useUserStore.getState().onboarded).toBe(false);
    expect(types()).toEqual([]);
  });

  it('dev: pokaż / pomiń onboarding bez zdarzeń', () => {
    setOutboxEnabled(true);
    devSkipOnboarding();
    expect(useUserStore.getState().onboarded).toBe(true);
    devShowOnboarding();
    expect(useUserStore.getState().onboarded).toBe(false);
    expect(types()).toEqual([]);
  });

  it('gracz demo i reset danych: onboarding zakończony (scenariusze z makiety bez zmian)', () => {
    expect(initialUserState().onboarded).toBe(true);
  });
});

describe('zdarzenia onboardingu w kolejce i RPC', () => {
  const terms = (version: string) => makeItem({ type: 'terms.accept', payload: { version } });
  const done = () => makeItem({ type: 'onboarding.complete', payload: { at: '2026-10-07T08:00:00.000Z' } });

  it('ta sama wersja regulaminu i drugi koniec onboardingu nie dublują się', () => {
    let q = enqueueItem([], terms('2026-10-07'));
    q = enqueueItem(q, terms('2026-10-07'));
    q = enqueueItem(q, terms('2026-11-01'));
    q = enqueueItem(q, done());
    q = enqueueItem(q, done());
    expect(q.map((x) => (x.type === 'terms.accept' ? x.payload.version : x.type))).toEqual(['2026-10-07', '2026-11-01', 'onboarding.complete']);
  });

  it('wysyłany element nie blokuje nowego', () => {
    const first = done();
    expect(enqueueItem([first], done(), first.id)).toHaveLength(2);
  });

  it('RPC: accept_terms(p_version) i complete_onboarding()', () => {
    expect(rpcFor(terms('2026-10-07'))).toEqual({ fn: 'accept_terms', params: { p_version: '2026-10-07' } });
    expect(rpcFor(done())).toEqual({ fn: 'complete_onboarding', params: {} });
  });

  it('serwer sprzed etapu 6 (PGRST202) – zdarzenie pominięte, kolejka gry nie czeka', () => {
    const missing = { message: 'Could not find the function public.accept_terms', code: 'PGRST202', status: 404 };
    expect(tolerated(terms('2026-10-07'), missing)).toBe(true);
    expect(tolerated(done(), missing)).toBe(true);
    expect(tolerated(terms('2026-10-07'), { message: 'invalid_terms_version', code: 'P0001', status: 400 })).toBe(false);
  });
});

describe('onboarding i regulamin ze stanu serwera', () => {
  const local = { onboarded: true, terms: { version: '2026-10-07', acceptedAt: '2026-10-07T08:00:00.000Z' } };

  it('parsowanie: pola etapu 6 (null = brak), starszy serwer – brak pól', () => {
    const base = { userId: 'u', profile: { handle: 'ola' } };
    const fresh = parseGameState({ ...base, profile: { handle: 'ola', termsVersion: null, termsAcceptedAt: null, onboardedAt: null } });
    expect(fresh.profile).toMatchObject({ termsVersion: null, termsAcceptedAt: null, onboardedAt: null });
    const old = parseGameState(base);
    expect('onboardedAt' in old.profile).toBe(false);
    expect('termsVersion' in old.profile).toBe(false);
  });

  it('nowe powiązanie (replace): stan konta z serwera – nowe konto przechodzi onboarding od nowa', () => {
    expect(onboardingFromServer({ onboardedAt: null, termsVersion: null, termsAcceptedAt: null }, local, 'replace')).toEqual({
      onboarded: false,
      terms: undefined,
    });
    expect(
      onboardingFromServer({ onboardedAt: '2026-10-01T10:00:00.000Z', termsVersion: '2026-10-01', termsAcceptedAt: '2026-10-01T10:00:00.000Z' }, { onboarded: false }, 'replace'),
    ).toEqual({ onboarded: true, terms: { version: '2026-10-01', acceptedAt: '2026-10-01T10:00:00.000Z' } });
  });

  it('merge: zakończony gdziekolwiek = zakończony; lokalnego nie cofamy', () => {
    expect(onboardingFromServer({ onboardedAt: null, termsVersion: null, termsAcceptedAt: null }, local, 'merge')).toEqual({ onboarded: true });
    expect(onboardingFromServer({ onboardedAt: '2026-10-01T10:00:00.000Z' }, { onboarded: false }, 'merge')).toEqual({ onboarded: true });
  });

  it('serwer sprzed etapu 6 – stan lokalny bez zmian', () => {
    expect(onboardingFromServer({}, { onboarded: false }, 'replace')).toEqual({ onboarded: false });
    expect(onboardingFromServer({}, local, 'merge')).toEqual({ onboarded: true });
  });
});
