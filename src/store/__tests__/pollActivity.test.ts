import { beforeEach, describe, expect, it, jest } from '@jest/globals';

import type { ActivityItem } from '@/types';

/* eslint-disable @typescript-eslint/no-require-imports */
jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));
jest.mock('expo-router', () => ({ router: { navigate: () => {}, push: () => {} } }));
jest.mock('@/services/live/notifications', () => ({ systemNotifications: { supported: () => false } }));

const { pollActivity } = require('../notify') as typeof import('../notify');
const { useNotificationStore } = require('../useNotificationStore') as typeof import('../useNotificationStore');
const { useFeedSync } = require('../useFeedSync') as typeof import('../useFeedSync');
const { ui } = require('../useUiStore') as typeof import('../useUiStore');
/* eslint-enable @typescript-eslint/no-require-imports */

const actor = (name: string) => ({ id: `u-${name}`, name, level: 9, ringRarity: 'rzadki' as const });
const recent = (min: number) => new Date(Date.now() - min * 60_000).toISOString();

const ITEMS: ActivityItem[] = [
  { id: 'reaction:p1:u-ola', kind: 'reaction', actor: actor('Ola_W'), postId: 'p1', text: null, createdAt: recent(30) },
  { id: 'friend_request:u-ewa', kind: 'friend_request', actor: actor('Ewa'), postId: null, text: null, createdAt: recent(10) },
];

const st = () => useNotificationStore.getState();

describe('pollActivity – prawdziwa aktywność → centrum powiadomień', () => {
  let toast: ReturnType<typeof jest.spyOn>;
  beforeEach(() => {
    st().reset();
    useFeedSync.setState({ stale: false, commentCounts: {} });
    toast?.mockRestore();
    toast = jest.spyOn(ui, 'toast').mockImplementation(() => {});
  });

  it('wpisy z kluczem aktywności, znacznik `since`, toast; drugi raz to samo nie przychodzi', async () => {
    const getActivity = jest.fn(async (_since?: string) => ITEMS);
    expect(await pollActivity({ getActivity })).toBe(2);
    expect(getActivity).toHaveBeenLastCalledWith(undefined);
    expect(st().inbox.map((i) => [i.key, i.href])).toEqual([
      ['activity.friend_request:u-ewa', '/znajomi'],
      ['activity.reaction:p1:u-ola', '/komentarze/p1'],
    ]);
    expect(st().marks.activitySince).toBe(ITEMS[1].createdAt);
    expect(useFeedSync.getState().stale).toBe(true);
    expect(toast).toHaveBeenCalledWith('Masz 2 nowe powiadomienia', 'notifications_active');

    expect(await pollActivity({ getActivity })).toBe(0);
    expect(getActivity).toHaveBeenLastCalledWith(ITEMS[1].createdAt);
    expect(st().inbox).toHaveLength(2);
  });

  it('wyłączona kategoria „Reakcje i komentarze” – nic nie trafia do centrum; offline – bez błędu', async () => {
    st().setPref('social', false);
    expect(await pollActivity({ getActivity: async () => ITEMS })).toBe(0);
    expect(st().inbox).toEqual([]);
    expect(await pollActivity({ getActivity: async () => Promise.reject(new Error('offline')) })).toBe(0);
  });

  it('mock (bez getActivity) – nic', async () => {
    expect(await pollActivity({})).toBe(0);
    expect(st().inbox).toEqual([]);
  });
});
