import { beforeEach, describe, expect, it, jest } from '@jest/globals';

import { useNotificationStore, type PendingNotification } from '../useNotificationStore';

// jest.mock jest wynoszony nad importy (babel-jest) – store dostaje AsyncStorage z pamięci.
// eslint-disable-next-line @typescript-eslint/no-require-imports
jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));

const T0 = new Date(2026, 9, 6, 12).getTime();

const pending = (key: string, dueAt: number, kind: PendingNotification['kind'] = 'social'): PendingNotification => ({
  key,
  kind,
  title: key,
  body: '',
  icon: 'favorite',
  href: '/feed',
  dueAt,
  system: true,
});

const st = () => useNotificationStore.getState();

describe('useNotificationStore', () => {
  beforeEach(() => st().reset());

  it('doręcza tylko zaległe wpisy, od najnowszych', () => {
    st().enqueue([pending('a', T0 - 2000), pending('b', T0 + 60000), pending('c', T0 - 1000)]);
    const fresh = st().deliverDue({ now: T0 });
    expect(fresh.map((i) => i.key)).toEqual(['a', 'c']);
    expect(st().inbox.map((i) => i.key)).toEqual(['c', 'a']);
    expect(st().pending.map((p) => p.key)).toEqual(['b']);
  });

  it('tap w cykliczne powiadomienie systemowe oznacza wpisy tego tygodnia jako przeczytane', () => {
    st().enqueue([pending('weekly.2026-10-04', T0 - 1000, 'weekly'), pending('gminy.week.41.suprasl', T0 - 500, 'gminy')]);
    st().deliverDue({ now: T0 });
    st().markReadByKey('weekly');
    const byKey = Object.fromEntries(st().inbox.map((i) => [i.key, i.read]));
    expect(byKey['weekly.2026-10-04']).toBe(true);
    expect(byKey['gminy.week.41.suprasl']).toBe(false);
    st().markReadByKey('gminy.weekly');
    expect(st().inbox.every((i) => i.read)).toBe(true);
  });

  it('ten sam klucz nie przychodzi drugi raz – także po wyczyszczeniu centrum', () => {
    st().enqueue([pending('a', T0)]);
    st().deliverDue({ now: T0 });
    st().clearInbox();
    st().enqueue([pending('a', T0)]);
    expect(st().pending).toHaveLength(0);
    expect(st().push({ key: 'a', kind: 'social', title: 'a', body: '', icon: 'favorite' })).toBeNull();
  });

  it('wyłączona kategoria nie trafia do centrum (wpisy systemowe – zawsze)', () => {
    st().setPref('social', false);
    st().enqueue([pending('a', T0), pending('t', T0, 'system')]);
    expect(st().deliverDue({ now: T0 }).map((i) => i.key)).toEqual(['t']);
    expect(st().pending).toHaveLength(0);
  });

  it('nieprzeczytane, oznaczanie i limit centrum', () => {
    st().enqueue(Array.from({ length: 60 }, (_, i) => pending(`k${i}`, T0 - i * 1000)));
    st().deliverDue({ now: T0 });
    expect(st().inbox).toHaveLength(50);
    st().markReadByKey('k0');
    expect(st().inbox.find((i) => i.key === 'k0')?.read).toBe(true);
    st().markAllRead();
    expect(st().inbox.every((i) => i.read)).toBe(true);
  });

  it('cancel usuwa zaplanowane po prefiksie', () => {
    st().enqueue([pending('longTrip.t1', T0 + 1000, 'longTrip'), pending('social.p1.1', T0 + 1000)]);
    st().cancel('longTrip.');
    expect(st().pending.map((p) => p.key)).toEqual(['social.p1.1']);
  });
});
