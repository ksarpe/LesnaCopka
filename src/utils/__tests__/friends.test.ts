import { describe, expect, it } from '@jest/globals';

import type { FriendsOverview, SocialUser } from '@/types';
import {
  effectiveStatus,
  EMPTY_OVERVIEW,
  friendActionToast,
  friendButton,
  moveTo,
  optimisticStatus,
  statusIn,
  withFriendStatus,
} from '../friends';

const user = (id: string, friendStatus: SocialUser['friendStatus'] = 'none'): SocialUser => ({
  id,
  name: id.toUpperCase(),
  level: 5,
  ringRarity: 'pospolity',
  fullName: '',
  handle: `@${id}`,
  homeGminaId: 'suprasl',
  tripsCount: 3,
  friendStatus,
  friend: friendStatus === 'friends',
});

const ids = (o: FriendsOverview) => ({
  friends: o.friends.map((u) => u.id),
  incoming: o.incoming.map((u) => u.id),
  outgoing: o.outgoing.map((u) => u.id),
});

describe('znajomi w obie strony – przejścia statusów', () => {
  it('zaproszenie → wysłane; druga strona akceptuje → znajomi; usunięcie → nigdzie', () => {
    const ewa = user('ewa');
    let o: FriendsOverview = { ...EMPTY_OVERVIEW, friends: [user('ola', 'friends')] };
    o = moveTo(o, ewa, optimisticStatus('request', 'none', true));
    expect(ids(o)).toEqual({ friends: ['ola'], incoming: [], outgoing: ['ewa'] });
    expect(o.outgoing[0]).toMatchObject({ friendStatus: 'outgoing', friend: false });
    o = moveTo(o, ewa, 'friends');
    expect(ids(o)).toEqual({ friends: ['ewa', 'ola'], incoming: [], outgoing: [] });
    expect(o.friends[0].friend).toBe(true);
    o = moveTo(o, ewa, optimisticStatus('remove', 'friends', true));
    expect(ids(o)).toEqual({ friends: ['ola'], incoming: [], outgoing: [] });
  });

  it('przychodzące: akceptacja → znajomi, odrzucenie → znika; zaproszenie do kogoś, kto zaprasza = akceptacja', () => {
    const bartek = user('bartek', 'incoming');
    const o: FriendsOverview = { ...EMPTY_OVERVIEW, incoming: [bartek] };
    expect(ids(moveTo(o, bartek, optimisticStatus('accept', 'incoming', true)))).toEqual({ friends: ['bartek'], incoming: [], outgoing: [] });
    expect(ids(moveTo(o, bartek, optimisticStatus('reject', 'incoming', true)))).toEqual({ friends: [], incoming: [], outgoing: [] });
    expect(optimisticStatus('request', 'incoming', true)).toBe('friends');
    expect(optimisticStatus('cancel', 'outgoing', true)).toBe('none');
  });

  it('mock (bez zaproszeń): dodanie od razu daje znajomego', () => {
    expect(optimisticStatus('request', 'none', false)).toBe('friends');
  });

  it('status przy wyniku wyszukiwania: ostatnia akcja > listy ekranu > wyszukiwarka', () => {
    const o: FriendsOverview = { friends: [user('ola', 'friends')], incoming: [user('ewa', 'incoming')], outgoing: [] };
    expect(statusIn(o, 'ola')).toBe('friends');
    expect(statusIn(o, 'ewa')).toBe('incoming');
    expect(statusIn(o, 'kasia')).toBeNull();
    expect(statusIn(undefined, 'ola')).toBeNull();
    expect(effectiveStatus(o, user('kasia', 'outgoing'))).toBe('outgoing');
    expect(effectiveStatus(o, user('ola', 'none'))).toBe('friends');
    expect(effectiveStatus(o, user('ola', 'friends'), { ola: 'none' })).toBe('none');
    expect(effectiveStatus(undefined, user('tomek', 'incoming'))).toBe('incoming');
  });

  it('przycisk i komunikaty', () => {
    expect(['none', 'outgoing', 'incoming', 'friends'].map((s) => friendButton(s as SocialUser['friendStatus']))).toEqual([
      'add',
      'sent',
      'accept',
      'friends',
    ]);
    expect(friendActionToast('request', 'Ewa', 'outgoing')).toBe('Wysłano zaproszenie do Ewa');
    expect(friendActionToast('request', 'Ola_W', 'friends')).toBe('Ola_W – dodano do znajomych');
    expect(friendActionToast('accept', 'Bartek', 'friends')).toBe('Bartek – jesteście znajomymi');
    expect(friendActionToast('remove', 'Ola_W', 'none')).toBe('Ola_W nie jest już Twoim znajomym');
    expect(withFriendStatus(user('ola'), 'friends')).toMatchObject({ friendStatus: 'friends', friend: true });
  });
});
