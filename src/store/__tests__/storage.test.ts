/**
 * Leniwy zapis store'ów (persistLazily + lazyPersistStorage): dystans z GPS nie serializuje stanu przy każdym odczycie,
 * ale nic nie ginie – zapis po 30 s, przy zwykłym zapisie store'u, w tle aplikacji i na żądanie.
 */
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';

/* eslint-disable @typescript-eslint/no-require-imports */
jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));

const AsyncStorage = require('@react-native-async-storage/async-storage') as {
  setItem: jest.Mock;
  getItem: jest.Mock;
  __INTERNAL_MOCK_STORAGE__: Record<string, string>;
};
const { AppState } = require('react-native') as { AppState: { addEventListener: jest.Mock } };
const storage = require('../storage') as typeof import('../storage');
/* eslint-enable @typescript-eslint/no-require-imports */

const KEY = 'test.lazy';
const lazy = storage.lazyPersistStorage!;
const value = (n: number) => ({ state: { n }, version: 1 });
const saved = () => {
  const raw = AsyncStorage.__INTERNAL_MOCK_STORAGE__[KEY];
  return raw ? (JSON.parse(raw) as { state: { n: number } }).state.n : undefined;
};
/** Zapis mocka AsyncStorage to kilka kolejnych `await` – mikrozadania (zegar jest udawany). */
const flushPromises = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};

beforeEach(() => {
  jest.useFakeTimers();
  storage.flushPersist();
  delete AsyncStorage.__INTERNAL_MOCK_STORAGE__[KEY];
  AsyncStorage.setItem.mockClear();
});

afterEach(() => {
  storage.flushPersist();
  jest.useRealTimers();
});

describe('lazyPersistStorage', () => {
  it('zapis z persistLazily czeka najwyżej 30 s i zapisuje najnowszy stan (jeden zapis)', async () => {
    storage.persistLazily(() => lazy.setItem(KEY, value(1)));
    storage.persistLazily(() => lazy.setItem(KEY, value(2)));
    expect(AsyncStorage.setItem).not.toHaveBeenCalled();
    expect(storage.persistPending()).toBe(true);
    // Odczyt (np. rehydrate) widzi stan, który czeka na zapis.
    expect(await lazy.getItem(KEY)).toEqual(value(2));

    jest.advanceTimersByTime(storage.LAZY_PERSIST_MS - 1);
    expect(AsyncStorage.setItem).not.toHaveBeenCalled();
    jest.advanceTimersByTime(1);
    await flushPromises();
    expect(AsyncStorage.setItem).toHaveBeenCalledTimes(1);
    expect(saved()).toBe(2);
    expect(storage.persistPending()).toBe(false);
  });

  it('zwykły zapis idzie od razu i unieważnia odłożony (bez starszego zapisu po nim)', async () => {
    storage.persistLazily(() => lazy.setItem(KEY, value(1)));
    lazy.setItem(KEY, value(2));
    await flushPromises();
    expect(saved()).toBe(2);
    jest.advanceTimersByTime(storage.LAZY_PERSIST_MS);
    await flushPromises();
    expect(AsyncStorage.setItem).toHaveBeenCalledTimes(1);
    expect(saved()).toBe(2);
  });

  it('przejście aplikacji w tło zapisuje od razu', async () => {
    storage.persistLazily(() => lazy.setItem(KEY, value(7)));
    const calls = AppState.addEventListener.mock.calls as unknown as [string, (s: string) => void][];
    const onChange = calls.filter(([type]) => type === 'change').at(-1)?.[1];
    expect(onChange).toBeDefined();
    onChange!('active');
    await flushPromises();
    expect(AsyncStorage.setItem).not.toHaveBeenCalled();
    onChange!('background');
    await flushPromises();
    expect(saved()).toBe(7);
  });

  it('removeItem porzuca odłożony zapis', async () => {
    storage.persistLazily(() => lazy.setItem(KEY, value(3)));
    await lazy.removeItem(KEY);
    storage.flushPersist();
    await flushPromises();
    expect(AsyncStorage.setItem).not.toHaveBeenCalled();
    expect(saved()).toBeUndefined();
  });
});
