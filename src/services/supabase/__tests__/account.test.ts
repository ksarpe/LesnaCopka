/**
 * Konto (etap 6) z atrapą Supabase: logowanie kodem na inne konto (switchAccount – kolejka starego konta porzucona,
 * stan telefonu wyczyszczony, stan nowego konta z serwera, onboarding z `onboardedAt`, osierocone konto anonimowe
 * usunięte), zły kod, wylogowanie, zabezpieczenie e-mailem i usunięcie konta (z Edge Function i bez).
 */
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';

type Row = Record<string, unknown>;
type Account = { id: string; email: string | null; anonymous: boolean; onboardedAt: string | null; name: string };

/** Serwer w pamięci (prefiks `mock` – dozwolony w fabrykach jest.mock). */
const mockAuth = {
  online: true,
  accounts: new Map<string, Account>(),
  session: null as null | { user: Account; access_token: string },
  pendingEmail: null as string | null,
  code: '123456',
  anonCounter: 0,
  calls: [] as { fn: string; params?: unknown; token?: string }[],
  storage: new Map<string, string[]>(),
  deleteResult: { deleted: true, authUserDeleted: true, next: null, authError: null } as Row,
  edgeError: null as null | Error,
  reset() {
    this.online = true;
    this.accounts = new Map([
      ['acc-email', { id: 'acc-email', email: 'ola@poczta.pl', anonymous: false, onboardedAt: '2026-10-01T10:00:00.000Z', name: 'Ola z e-mailem' }],
      ['acc-new', { id: 'acc-new', email: 'nowy@poczta.pl', anonymous: false, onboardedAt: null, name: 'Bez onboardingu' }],
      ['anon-1', { id: 'anon-1', email: null, anonymous: true, onboardedAt: '2026-10-05T10:00:00.000Z', name: 'Anonim' }],
    ]);
    this.session = { user: this.accounts.get('anon-1')!, access_token: 'jwt-anon-1' };
    this.pendingEmail = null;
    this.anonCounter = 1;
    this.calls = [];
    this.storage = new Map([
      ['scan-photos', ['anon-1/f1.jpg', 'anon-1/f2.jpg']],
      ['avatars', ['anon-1/avatar-1.jpg']],
      ['post-media', []],
    ]);
    this.deleteResult = { deleted: true, authUserDeleted: true, next: null, authError: null };
    this.edgeError = null;
  },
  authUser(a: Account) {
    return { id: a.id, email: a.email ?? '', new_email: this.pendingEmail ?? undefined, is_anonymous: a.anonymous };
  },
  err(status: number, code: string) {
    return Object.assign(new Error(code), { status, code, name: 'AuthApiError' });
  },
  gameState(id: string) {
    const a = this.accounts.get(id)!;
    return {
      userId: id,
      serverTime: new Date().toISOString(),
      profile: {
        handle: `h_${id.replace(/-/g, '')}`, displayName: a.name, firstName: null, homeGminaId: 'hajnowka', totalXp: 0, level: 3,
        xpInLevel: 10, streakDays: 0, lastActiveDate: null, tripsCount: 7, mushroomsCount: 20, totalDistanceM: 0,
        termsVersion: a.onboardedAt ? '2026-10-01' : null, termsAcceptedAt: a.onboardedAt, onboardedAt: a.onboardedAt,
      },
      atlas: [], badges: [], achievements: {}, quests: { day: null, progress: [] }, trips: [], finds: [], challenges: [], followedGminy: [],
    };
  },
  rpc(fn: string, token?: string) {
    if (!this.online) return { data: null, error: { message: 'TypeError: Network request failed', code: '' }, status: 0 };
    this.calls.push({ fn, token });
    const uid = token ? token.replace('jwt-', '') : this.session?.user.id;
    if (!uid || !this.accounts.has(uid)) return { data: null, error: { message: 'not_authenticated', code: '28000' }, status: 401 };
    switch (fn) {
      case 'get_game_state':
        return { data: this.gameState(uid), error: null, status: 200 };
      case 'prepare_account_deletion':
        return {
          data: { storagePaths: Object.fromEntries([...this.storage].map(([b, p]) => [b, p.filter((x) => x.startsWith(`${uid}/`))])), counts: { trips: 3 } },
          error: null,
          status: 200,
        };
      case 'delete_my_account':
        if (this.deleteResult.authUserDeleted) this.accounts.delete(uid);
        return { data: this.deleteResult, error: null, status: 200 };
      default:
        return { data: null, error: { message: `Could not find the function public.${fn}`, code: 'PGRST202' }, status: 404 };
    }
  },
  thenable<T>(run: () => T) {
    const p = Promise.resolve().then(run);
    return Object.assign(p, { abortSignal: () => p });
  },
  storageApi(token?: string) {
    return {
      from: (bucket: string) => ({
        remove: async (paths: string[]) => {
          this.calls.push({ fn: `storage.remove:${bucket}`, params: paths, token });
          this.storage.set(bucket, (this.storage.get(bucket) ?? []).filter((x) => !paths.includes(x)));
          return { data: paths.map((name) => ({ name })), error: null };
        },
        list: async (folder: string) => {
          this.calls.push({ fn: `storage.list:${bucket}`, params: folder, token });
          return {
            data: (this.storage.get(bucket) ?? []).filter((x) => x.startsWith(`${folder}/`)).map((x) => ({ id: x, name: x.slice(folder.length + 1) })),
            error: null,
          };
        },
      }),
    };
  },
  get client() {
    return {
      rpc: (fn: string) => this.thenable(() => this.rpc(fn)),
      storage: this.storageApi(),
      functions: {
        invoke: async (fn: string) => {
          this.calls.push({ fn: `functions.${fn}` });
          if (this.edgeError) return { data: null, error: this.edgeError };
          this.accounts.delete(this.session!.user.id);
          return { data: { deleted: true, authUserDeleted: true }, error: null };
        },
      },
      auth: {
        getSession: async () => ({ data: { session: this.session ? { user: this.authUser(this.session.user), access_token: this.session.access_token } : null } }),
        getUser: async () => (this.session ? { data: { user: this.authUser(this.session.user) }, error: null } : { data: { user: null }, error: this.err(401, 'no_authorization') }),
        signInAnonymously: async () => {
          const id = `anon-${++this.anonCounter}`;
          this.accounts.set(id, { id, email: null, anonymous: true, onboardedAt: null, name: 'Grzybiarz' });
          this.session = { user: this.accounts.get(id)!, access_token: `jwt-${id}` };
          return { data: { user: { id } }, error: null };
        },
        signOut: async () => {
          this.session = null;
          return { error: null };
        },
        signInWithOtp: async ({ email }: { email: string }) => {
          const known = [...this.accounts.values()].some((a) => a.email === email);
          return known ? { data: {}, error: null } : { data: {}, error: this.err(422, 'otp_disabled') };
        },
        updateUser: async ({ email }: { email: string }) => {
          if ([...this.accounts.values()].some((a) => a.email === email)) return { data: { user: null }, error: this.err(422, 'email_exists') };
          this.pendingEmail = email;
          return { data: { user: this.authUser(this.session!.user) }, error: null };
        },
        verifyOtp: async ({ email, token, type }: { email: string; token: string; type: string }) => {
          if (token !== this.code) return { data: { user: null, session: null }, error: this.err(403, 'otp_expired') };
          if (type === 'email_change') {
            const me = this.session!.user;
            Object.assign(me, { email, anonymous: false });
            this.pendingEmail = null;
            return { data: { user: this.authUser(me), session: {} }, error: null };
          }
          const acc = [...this.accounts.values()].find((a) => a.email === email)!;
          this.session = { user: acc, access_token: `jwt-${acc.id}` };
          return { data: { user: this.authUser(acc), session: {} }, error: null };
        },
        onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
      },
    };
  },
};

/* eslint-disable @typescript-eslint/no-require-imports */
jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));
jest.mock('@/geo', () => ({ missingGminy: () => Promise.resolve([]) }));
jest.mock('@/services/live/findPhotos', () => ({
  deleteFindPhoto: () => {},
  clearFindPhotos: () => {},
  resolveFindPhoto: (uri: string) => uri,
  downloadFindPhoto: async () => 'file:///x.jpg',
}));
jest.mock('@/services/live/avatarPhoto', () => ({ pruneAvatarFiles: () => {}, resolveAvatarUri: (uri: string) => uri }));
jest.mock('@/services/live/photoBytes', () => ({ readImageBytes: async () => null, fetchAsDataUri: async () => null }));
jest.mock('../client', () => ({
  BACKEND: 'supabase',
  SUPABASE_URL: 'http://test',
  SUPABASE_KEY: 'key',
  supabaseEnabled: true,
  get supabase() {
    return mockAuth.client;
  },
}));
// Klient pomocniczy (sprzątanie osieroconego konta anonimowego) – z tokenem starego konta.
jest.mock('@supabase/supabase-js', () => ({
  createClient: (_url: string, _key: string, opts: { global: { headers: { Authorization: string } } }) => {
    const token = opts.global.headers.Authorization.replace('Bearer ', '');
    return {
      rpc: (fn: string) => mockAuth.thenable(() => mockAuth.rpc(fn, token)),
      storage: mockAuth.storageApi(token),
    };
  },
}));

const account = require('../account') as typeof import('../account');
const { stopSync } = require('../sync') as typeof import('../sync');
const { backendStatus } = require('../status') as typeof import('../status');
const { setOutboxEnabled, useOutboxStore } = require('../../../store/useOutboxStore') as typeof import('../../../store/useOutboxStore');
const { useCatalogStore } = require('../../../store/useCatalogStore') as typeof import('../../../store/useCatalogStore');
const { useTripStore } = require('../../../store/useTripStore') as typeof import('../../../store/useTripStore');
const { useUserStore } = require('../../../store/useUserStore') as typeof import('../../../store/useUserStore');
const { GMINY } = require('../../../data/mock/gminy') as typeof import('../../../data/mock/gminy');
/* eslint-enable @typescript-eslint/no-require-imports */

const fns = () => mockAuth.calls.map((c) => c.fn);
/** Stan telefonu po zmianie konta (jak wipeLocalData w src/store/account.ts – tu bez zależności od UI). */
const wipe = jest.fn(() => {
  useTripStore.getState().reset();
  useUserStore.getState().reset({ onboarded: false });
});
const flush = () => new Promise((r) => setTimeout(r, 0));

function queueSomething() {
  useOutboxStore.getState().enqueue({ type: 'trip.start', payload: { tripId: 't1', gminaId: 'suprasl', startedAt: '2026-10-07T06:00:00.000Z' } }, { kick: false });
}

beforeEach(() => {
  mockAuth.reset();
  wipe.mockClear();
  setOutboxEnabled(true);
  useOutboxStore.getState().reset();
  useOutboxStore.getState().patch({ syncedUserId: 'anon-1' });
  useUserStore.getState().reset();
  useTripStore.getState().reset();
  useCatalogStore.setState({ ready: true, gminy: GMINY, gminaById: Object.fromEntries(GMINY.map((g) => [g.id, g])) });
  backendStatus().set({ state: 'online', userId: 'anon-1', error: null });
});

afterEach(() => {
  stopSync();
  setOutboxEnabled(false);
});

describe('logowanie kodem na inne konto', () => {
  it('nowe konto: kolejka starego porzucona, telefon wyczyszczony, stan konta z serwera, onboarding zakończony', async () => {
    queueSomething();
    const r = await account.loginWithCode('ola@poczta.pl', '123456', wipe);
    expect(r).toMatchObject({ ok: true, userId: 'acc-email', sameAccount: false, hydrated: true });
    expect(wipe).toHaveBeenCalledTimes(1);

    const ob = useOutboxStore.getState();
    expect(ob.items).toEqual([]);
    expect(ob.failed[0]).toMatchObject({ error: 'porzucone: logowanie na inne konto', item: { type: 'trip.start' } });
    expect(ob.syncedUserId).toBe('acc-email');
    const u = useUserStore.getState();
    expect(u.user).toMatchObject({ id: 'acc-email', name: 'Ola z e-mailem', handle: '@h_accemail', level: 3 });
    expect(u.onboarded).toBe(true);
    expect(u.terms).toEqual({ version: '2026-10-01', acceptedAt: '2026-10-01T10:00:00.000Z' });
    expect(backendStatus().userId).toBe('acc-email');
  });

  it('osierocone konto anonimowe usuwa się samo – jego tokenem (pliki, potem konto)', async () => {
    await account.loginWithCode('ola@poczta.pl', '123456', wipe);
    await flush();
    await flush();
    const orphan = mockAuth.calls.filter((c) => c.token === 'jwt-anon-1').map((c) => c.fn);
    expect(orphan).toEqual(['prepare_account_deletion', 'storage.remove:scan-photos', 'storage.remove:avatars', 'delete_my_account']);
    expect(mockAuth.accounts.has('anon-1')).toBe(false);
    expect(mockAuth.storage.get('scan-photos')).toEqual([]);
  });

  it('konto bez onboardingu → onboarding na tym telefonie', async () => {
    const r = await account.loginWithCode('nowy@poczta.pl', '123456', wipe);
    expect(r.ok).toBe(true);
    expect(useUserStore.getState().onboarded).toBe(false);
    expect(useUserStore.getState().terms).toBeUndefined();
  });

  it('zły kod: błąd otp_expired, nic się nie zmienia', async () => {
    queueSomething();
    const before = useUserStore.getState().user;
    const r = await account.loginWithCode('ola@poczta.pl', '000000', wipe);
    expect(r.ok).toBe(false);
    expect(r.error).toMatchObject({ status: 403, code: 'otp_expired' });
    expect(wipe).not.toHaveBeenCalled();
    expect(useOutboxStore.getState().items).toHaveLength(1);
    expect(useUserStore.getState().user).toEqual(before);
    expect(mockAuth.session?.user.id).toBe('anon-1');
    expect(mockAuth.accounts.has('anon-1')).toBe(true);
  });

  it('to samo konto (ponowne logowanie) – kolejka i telefon bez zmian', async () => {
    mockAuth.session = { user: mockAuth.accounts.get('acc-email')!, access_token: 'jwt-acc-email' };
    backendStatus().set({ userId: 'acc-email' });
    queueSomething();
    const r = await account.loginWithCode('ola@poczta.pl', '123456', wipe);
    expect(r).toMatchObject({ ok: true, sameAccount: true });
    expect(wipe).not.toHaveBeenCalled();
    expect(useOutboxStore.getState().items).toHaveLength(1);
  });

  it('kod logowania na nieznany adres → otp_disabled', async () => {
    await expect(account.sendLoginCode('nikt@poczta.pl')).rejects.toMatchObject({ code: 'otp_disabled' });
    await expect(account.sendLoginCode('ola@poczta.pl')).resolves.toBeUndefined();
  });
});

describe('zabezpieczenie konta e-mailem', () => {
  it('kod na nowy adres → konto stałe, ten sam id, stan gry bez zmian', async () => {
    queueSomething();
    await account.sendLinkCode('moj@poczta.pl');
    expect(await account.getAccountInfo()).toMatchObject({ userId: 'anon-1', anonymous: true, pendingEmail: 'moj@poczta.pl' });
    const info = await account.confirmLinkCode('moj@poczta.pl', '123456');
    expect(info).toEqual({ userId: 'anon-1', email: 'moj@poczta.pl', pendingEmail: null, anonymous: false });
    expect(useOutboxStore.getState().items).toHaveLength(1);
  });

  it('adres zajęty → email_exists; zły kod → otp_expired', async () => {
    await expect(account.sendLinkCode('ola@poczta.pl')).rejects.toMatchObject({ code: 'email_exists' });
    await account.sendLinkCode('moj@poczta.pl');
    await expect(account.confirmLinkCode('moj@poczta.pl', '999999')).rejects.toMatchObject({ code: 'otp_expired' });
  });
});

describe('wylogowanie', () => {
  it('nowe konto anonimowe, telefon wyczyszczony, onboarding od nowa', async () => {
    mockAuth.session = { user: mockAuth.accounts.get('acc-email')!, access_token: 'jwt-acc-email' };
    backendStatus().set({ userId: 'acc-email' });
    useOutboxStore.getState().patch({ syncedUserId: 'acc-email' });
    const r = await account.signOutToAnonymous(wipe);
    expect(r).toMatchObject({ ok: true, userId: 'anon-2', hydrated: true });
    expect(wipe).toHaveBeenCalledTimes(1);
    expect(useUserStore.getState().onboarded).toBe(false);
    expect(useUserStore.getState().user.id).toBe('anon-2');
    // Konto z e-mailem zostaje (zalogujesz się na nie ponownie).
    expect(mockAuth.accounts.has('acc-email')).toBe(true);
  });
});

describe('usunięcie konta', () => {
  it('pliki → delete_my_account → wylogowanie → nowe konto anonimowe i onboarding', async () => {
    queueSomething();
    const r = await account.deleteAccount(wipe);
    expect(r).toEqual({ ok: true, filesError: null });
    expect(fns().slice(0, 2)).toEqual(['prepare_account_deletion', 'storage.remove:scan-photos']);
    expect(fns().indexOf('delete_my_account')).toBeGreaterThan(fns().indexOf('storage.remove:avatars'));
    expect(fns()).not.toContain('functions.delete-account');
    expect(mockAuth.accounts.has('anon-1')).toBe(false);
    expect(mockAuth.storage.get('scan-photos')).toEqual([]);
    expect(wipe).toHaveBeenCalledTimes(1);
    expect(useOutboxStore.getState().items).toEqual([]);
    expect(backendStatus().userId).toBe('anon-2');
    expect(useUserStore.getState().onboarded).toBe(false);
  });

  it('SQL nie usunął konta auth → Edge Function delete-account', async () => {
    mockAuth.deleteResult = { deleted: true, authUserDeleted: false, next: 'edge_function:delete-account', authError: '42501' };
    const r = await account.deleteAccount(wipe);
    expect(r.ok).toBe(true);
    expect(fns()).toContain('functions.delete-account');
    expect(mockAuth.accounts.has('anon-1')).toBe(false);
  });

  it('Edge Function niedostępna → komunikat, dane w telefonie i sesja zostają', async () => {
    mockAuth.deleteResult = { deleted: true, authUserDeleted: false, next: 'edge_function:delete-account', authError: '42501' };
    mockAuth.edgeError = new Error('FunctionsFetchError: Failed to send a request to the Edge Function');
    queueSomething();
    const r = await account.deleteAccount(wipe);
    expect(r).toMatchObject({ ok: false, reason: 'needs_production', message: expect.stringMatching(/serwerem produkcyjnym/) });
    expect(wipe).not.toHaveBeenCalled();
    expect(mockAuth.session?.user.id).toBe('anon-1');
    expect(useOutboxStore.getState().items).toHaveLength(1);
  });

  it('bez sieci: nic nie znika', async () => {
    mockAuth.online = false;
    const r = await account.deleteAccount(wipe);
    expect(r).toMatchObject({ ok: false, reason: 'network' });
    expect(wipe).not.toHaveBeenCalled();
    expect(mockAuth.accounts.has('anon-1')).toBe(true);
  });

  it('wynik delete_my_account: authUserDeleted (stary kontrakt void = usunięte)', () => {
    expect(account.authUserDeleted({ authUserDeleted: false })).toBe(false);
    expect(account.authUserDeleted({ authUserDeleted: true })).toBe(true);
    expect(account.authUserDeleted(null)).toBe(true);
    expect(account.authUserDeleted('{"authUserDeleted":false}')).toBe(false);
  });
});
